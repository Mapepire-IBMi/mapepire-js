import { spawn, ChildProcessWithoutNullStreams } from 'child_process';
import { BaseTransport, TransportOptions } from '../transport';
import { DaemonServer, ServerRequest, ServerResponse, LocalSingleConfig } from '../types';
import { LineBuffer } from './lineBuffer';

enum ConnectionState {
  IDLE       = 'idle',
  HANDSHAKING = 'handshaking',
  READY      = 'ready',
  CLOSED     = 'closed',
}

export interface LocalSingleTransportOptions extends TransportOptions, Partial<LocalSingleConfig> {}

const DEFAULT_JAVA_PATH = '/QOpenSys/QIBM/ProdData/JavaVM/jdk80/64bit/bin/java';
const DEFAULT_SERVER_PATH = '/QOpenSys/pkgs/lib/mapepire/mapepire-server.jar';

// Always applied last — prevent the JVM/PASE layer from corrupting the JSON stream
const REQUIRED_IBM_I_ENV: Record<string, string> = {
  QIBM_JAVA_STDIO_CONVERT: 'N',
  QIBM_PASE_DESCRIPTOR_STDIO: 'B',
  QIBM_USE_DESCRIPTOR_STDIO: 'Y',
  QIBM_MULTI_THREADED: 'Y',
};

/**
 * Spawns mapepire-server with --single flag as a child process and communicates
 * over stdin/stdout using newline-delimited JSON — identical protocol to SSH single transport.
 */
export class LocalSingleTransport extends BaseTransport {
  private childProcess: ChildProcessWithoutNullStreams | undefined;
  private lineBuffer: LineBuffer = new LineBuffer();
  private stderrBuffer: string = '';
  private state: ConnectionState = ConnectionState.IDLE;
  private startupTimer: NodeJS.Timeout | undefined;
  private pendingHandshake: { resolve: () => void; reject: (err: Error) => void } | undefined;

  private debugLog(message: string, meta?: unknown): void {
    if (process.env.MAPEPIRE_LOCAL_DEBUG !== '1') return;
    if (typeof meta === 'undefined') {
      console.log(`[local-single] ${message}`);
    } else {
      console.log(`[local-single] ${message}`, meta);
    }
  }

  private setState(newState: ConnectionState): void {
    this.state = newState;
    this.debugLog(`state -> ${newState}`);
  }

  private buildSpawnArgs(config: LocalSingleConfig): {
    javaPath: string;
    args: string[];
    env: NodeJS.ProcessEnv;
  } {
    const javaPath = config.javaPath || DEFAULT_JAVA_PATH;
    const serverPath = config.serverPath || DEFAULT_SERVER_PATH;

    const jvmArgs = [
      '-Djdbc.db2.restricted.local.connection.only=true',
      '-Dos400.stdio.convert=N',
      ...(config.jvmArgs || []),
    ];

    const serverArgs = config.serverArgs || [];
    const effectiveServerArgs = serverArgs.includes('--single')
      ? serverArgs
      : [...serverArgs, '--single'];

    const args = [...jvmArgs, '-jar', serverPath, ...effectiveServerArgs];

    const env: NodeJS.ProcessEnv = {
      ...process.env,
      ...(config.env || {}),
    };
    Object.assign(env, REQUIRED_IBM_I_ENV);

    return { javaPath, args, env };
  }

  private handleStdout(data: Buffer): void {
    if (this.state === ConnectionState.CLOSED) return;

    const text = data.toString('utf8');
    this.trace(`stdout: ${text}`);

    for (const line of this.lineBuffer.push(text)) {
      this.handleProtocolLine(line);
    }
  }

  private handleProtocolLine(line: string): void {
    this.debugLog('recv', line);

    try {
      const response: ServerResponse = JSON.parse(line);

      if (this.state === ConnectionState.HANDSHAKING && this.pendingHandshake) {
        this.setState(ConnectionState.READY);
        this.connected = true;
        if (this.startupTimer) {
          clearTimeout(this.startupTimer);
          this.startupTimer = undefined;
        }
        this.pendingHandshake.resolve();
        this.pendingHandshake = undefined;
      }

      this.emitResponse(response);
    } catch (e: any) {
      this.debugLog('parse error', { line, error: e.message });
      if (this.state === ConnectionState.HANDSHAKING && this.pendingHandshake) {
        this.pendingHandshake.reject(
          new Error(`Protocol initialization failed: ${e.message}`)
        );
        this.pendingHandshake = undefined;
      }
    }
  }

  private handleStderr(data: Buffer): void {
    this.stderrBuffer += data.toString('utf8');
  }

  private handleExit(code: number | null, signal: NodeJS.Signals | null): void {
    this.debugLog('exit', { code, signal });
    this.connected = false;
    this.setState(ConnectionState.CLOSED);

    if (this.pendingHandshake) {
      const errorMsg = this.stderrBuffer
        ? `Server process exited during startup: ${this.stderrBuffer}`
        : `Server process exited during startup with code ${code}`;
      this.pendingHandshake.reject(new Error(errorMsg));
      this.pendingHandshake = undefined;
    }

    this.notifyConnectionFailure(code ?? 0, signal ?? 'Process exited');
  }

  private handleSpawnError(err: Error): void {
    this.debugLog('spawn error', err.message);
    this.connected = false;
    this.setState(ConnectionState.CLOSED);

    if (this.pendingHandshake) {
      this.pendingHandshake.reject(new Error(`Failed to spawn server process: ${err.message}`));
      this.pendingHandshake = undefined;
    }
  }

  private async performHandshake(timeout: number): Promise<void> {
    return new Promise((resolve, reject) => {
      this.setState(ConnectionState.HANDSHAKING);
      this.pendingHandshake = { resolve, reject };

      this.startupTimer = setTimeout(() => {
        if (this.pendingHandshake) {
          this.pendingHandshake.reject(new Error(`Server startup timeout after ${timeout}ms`));
          this.pendingHandshake = undefined;
        }
        this.close();
      }, timeout);

      const handshakeRequest: ServerRequest = { id: 'handshake', type: 'getversion' };
      this.debugLog('handshake ->', handshakeRequest);

      try {
        this.childProcess!.stdin.write(JSON.stringify(handshakeRequest) + '\n', 'utf8');
      } catch (e: any) {
        if (this.pendingHandshake) {
          this.pendingHandshake.reject(new Error(`Failed to send handshake: ${e.message}`));
          this.pendingHandshake = undefined;
        }
      }
    });
  }

  /**
   * Spawns the Mapepire server JAR locally and connects via stdin/stdout.
   * @param _server - Unused; the server authenticates as the current IBM i job user
   * @param options - Local single transport options
   */
  async connect(_server: DaemonServer, options: LocalSingleTransportOptions = {}): Promise<void> {
    const config: LocalSingleConfig = {
      serverPath: options.serverPath,
      javaPath: options.javaPath,
      jvmArgs: options.jvmArgs,
      serverArgs: options.serverArgs,
      cwd: options.cwd,
      env: options.env,
      startupTimeout: options.startupTimeout ?? 10000,
      requestTimeout: options.requestTimeout ?? 30000,
    };

    const { javaPath, args, env } = this.buildSpawnArgs(config);
    this.debugLog('spawn', { javaPath, args });

    try {
      this.childProcess = spawn(javaPath, args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        env,
        cwd: config.cwd,
      }) as ChildProcessWithoutNullStreams;

      this.childProcess.stdout.on('data', (data: Buffer) => this.handleStdout(data));
      this.childProcess.stderr.on('data', (data: Buffer) => this.handleStderr(data));
      this.childProcess.on('exit', (code: number | null, signal: NodeJS.Signals | null) => this.handleExit(code, signal));
      this.childProcess.on('error', (err: Error) => this.handleSpawnError(err));

      await this.performHandshake(config.startupTimeout!);
    } catch (err: any) {
      this.setState(ConnectionState.CLOSED);
      throw new Error(`Local single transport connection failed: ${err.message}`);
    }
  }

  /** Sends a request to the server via the child process stdin. */
  async send(request: ServerRequest): Promise<void> {
    if (!this.childProcess || !this.connected) {
      throw new Error('Local single transport is not connected');
    }
    this.trace(request);
    this.childProcess.stdin.write(JSON.stringify(request) + '\n', 'utf8');
  }

  /** Closes the local single connection and terminates the child process. */
  async close(): Promise<void> {
    if (this.state === ConnectionState.CLOSED) return;

    this.setState(ConnectionState.CLOSED);

    if (this.startupTimer) {
      clearTimeout(this.startupTimer);
      this.startupTimer = undefined;
    }

    this.lineBuffer.clear();

    if (this.childProcess) {
      try {
        if (this.connected) {
          const exitRequest: ServerRequest = { id: 'exit-req', type: 'exit' };
          // Send graceful exit then wait for the process to terminate itself,
          // falling back to SIGTERM after 2 seconds.
          this.childProcess.stdin.write(JSON.stringify(exitRequest) + '\n', 'utf8');
          await new Promise<void>(resolve => {
            const timer = setTimeout(() => { this.childProcess?.kill(); resolve(); }, 2000);
            this.childProcess!.once('exit', () => { clearTimeout(timer); resolve(); });
          });
        } else {
          this.childProcess.kill();
        }
      } catch {
        // ignore — process may have already exited
      }
      this.childProcess = undefined;
    }

    this.connected = false;
  }
}
