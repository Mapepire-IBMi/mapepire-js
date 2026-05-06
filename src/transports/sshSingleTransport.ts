/**
 * SSH Single Transport implementation for mapepire-js
 * Library-agnostic transport that uses an exec function to launch mapepire-server in single mode
 */

import { BaseTransport, TransportOptions } from "../transport";
import { DaemonServer, ServerRequest, ServerResponse, SSHSingleConfig, ExecChannel } from "../types";
import { LineBuffer } from "./lineBuffer";

/**
 * Connection states for SSH single transport
 */
enum ConnectionState {
  IDLE = 'idle',
  CONNECTING = 'connecting',
  STARTING_SERVER = 'starting-server',
  HANDSHAKING = 'handshaking',
  READY = 'ready',
  CLOSING = 'closing',
  CLOSED = 'closed',
  ERROR = 'error'
}

/**
 * SSH Single transport options
 */
export interface SSHSingleTransportOptions extends TransportOptions, Partial<SSHSingleConfig> {}

/**
 * SSH Single Transport implementation
 * Launches mapepire-server with --single flag via SSH exec and communicates over stdio
 */
export class SSHSingleTransport extends BaseTransport {
  private channel: ExecChannel | undefined;
  private lineBuffer: LineBuffer = new LineBuffer();
  private stderrBuffer: string = '';
  private remoteCommand: string | undefined;
  private state: ConnectionState = ConnectionState.IDLE;
  private startupTimer: NodeJS.Timeout | undefined;
  private pendingHandshake: { resolve: () => void; reject: (err: Error) => void } | undefined;

  /**
   * Check if debug logging is enabled
   */
  private debugEnabled(): boolean {
    return process.env.MAPEPIRE_SSH_DEBUG === '1';
  }

  /**
   * Sanitize sensitive data from debug output
   */
  private sanitizeForDebug(data: unknown): unknown {
    if (data === null || data === undefined) {
      return data;
    }

    if (typeof data === 'string') {
      // Redact potential passwords, tokens, and keys in strings
      return data.replace(/(password|token|key|secret|credential)[=:]\s*[^\s,}]+/gi, '$1=***');
    }

    if (Array.isArray(data)) {
      return data.map(item => this.sanitizeForDebug(item));
    }

    if (typeof data === 'object') {
      const sanitized: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(data)) {
        const lowerKey = key.toLowerCase();
        // Redact sensitive fields
        if (lowerKey.includes('password') || lowerKey.includes('token') ||
            lowerKey.includes('secret') || lowerKey.includes('credential') ||
            lowerKey.includes('key')) {
          sanitized[key] = '***';
        } else {
          sanitized[key] = this.sanitizeForDebug(value);
        }
      }
      return sanitized;
    }

    return data;
  }

  /**
   * Log debug message if debug is enabled
   */
  private debugLog(message: string, meta?: unknown): void {
    if (!this.debugEnabled()) {
      return;
    }

    const prefix = '[ssh-single transport]';
    if (typeof meta === 'undefined') {
      console.log(`${prefix} ${message}`);
    } else {
      const sanitized = this.sanitizeForDebug(meta);
      console.log(`${prefix} ${message}`, sanitized);
    }
  }

  /**
   * Build the remote command to launch mapepire-server
   */
  private buildRemoteCommand(config: SSHSingleConfig): string {
    const javaPath = config.javaPath || 'java';
    const jvmArgs = config.jvmArgs || [];
    const serverArgs = config.serverArgs || [];
    
    // Ensure --single is included
    const args = serverArgs.includes('--single')
      ? serverArgs
      : [...serverArgs, '--single'];

    // Add workaround for jar bug: automatically include system property for local IBM i connections
    // This ensures jdbc:default:connection is used instead of jdbc:db2:localhost
    // See SINGLE_MODE_JAR_ISSUE_ANALYSIS.md for details
    const jvmArgsWithWorkaround = [
      '-Djdbc.db2.restricted.local.connection.only=true',
      ...jvmArgs
    ];

    const envEntries = Object.entries(config.env || {})
      .filter(([, value]) => typeof value !== 'undefined')
      .map(([key, value]) => `${key}=${this.shellEscape(String(value))}`);

    const commandParts: string[] = [];

    // Change directory if specified
    if (config.cwd) {
      commandParts.push(`cd ${this.shellEscape(config.cwd)}`);
    }

    // Build the launch command
    const launchCommand = [
      envEntries.length > 0 ? `env ${envEntries.join(' ')}` : '',
      this.shellEscape(javaPath),
      ...jvmArgsWithWorkaround.map(arg => this.shellEscape(arg)),
      '-jar',
      this.shellEscape(config.serverPath),
      ...args.map(arg => this.shellEscape(arg))
    ].filter(Boolean).join(' ');

    commandParts.push(launchCommand);

    return commandParts.join(' && ');
  }

  /**
   * Escape shell argument
   */
  private shellEscape(arg: string): string {
    // Simple shell escaping - wrap in single quotes and escape any single quotes
    return `'${arg.replace(/'/g, "'\\''")}'`;
  }

  /**
   * Transition to a new state
   */
  private setState(newState: ConnectionState): void {
    const oldState = this.state;
    this.state = newState;
    this.debugLog(`state transition: ${oldState} -> ${newState}`);
  }

  /**
   * Handle stdout data from the remote process
   */
  private handleStdout(data: Buffer): void {
    // Ignore stdout data if we're closing or closed
    if (this.state === ConnectionState.CLOSING || this.state === ConnectionState.CLOSED) {
      return;
    }

    const text = data.toString();
    this.trace(`stdout: ${text}`);

    const lines = this.lineBuffer.push(text);
    
    for (const line of lines) {
      this.handleProtocolLine(line);
    }
  }

  /**
   * Handle a complete protocol line
   */
  private handleProtocolLine(line: string): void {
    this.debugLog('received line', { line });

    try {
      const response: ServerResponse = JSON.parse(line);
      
      // If we're handshaking and receive a valid response, consider handshake complete
      if (this.state === ConnectionState.HANDSHAKING && this.pendingHandshake) {
        this.debugLog('handshake complete');
        this.setState(ConnectionState.READY);
        this.connected = true;
        this.pendingHandshake.resolve();
        this.pendingHandshake = undefined;
        
        if (this.startupTimer) {
          clearTimeout(this.startupTimer);
          this.startupTimer = undefined;
        }
      }

      this.emitResponse(response);
    } catch (e: any) {
      this.debugLog('protocol parse error', { line, error: e.message });
      
      if (this.state === ConnectionState.HANDSHAKING && this.pendingHandshake) {
        this.pendingHandshake.reject(new Error(`Protocol initialization failed: invalid JSON response: ${e.message}`));
        this.pendingHandshake = undefined;
      }
    }
  }

  /**
   * Handle stderr data from the remote process
   */
  private handleStderr(data: Buffer): void {
    const text = data.toString();
    this.stderrBuffer += text;
    this.debugLog('stderr', { text });
  }

  /**
   * Handle process exit
   */
  private handleExit(code: number | null, signal?: string): void {
    this.debugLog('remote process exited', { code, signal, stderr: this.stderrBuffer });
    
    this.connected = false;
    this.setState(ConnectionState.CLOSED);

    if (this.pendingHandshake) {
      const errorMsg = this.stderrBuffer 
        ? `Server process exited during startup: ${this.stderrBuffer}`
        : `Server process exited during startup with code ${code}`;
      this.pendingHandshake.reject(new Error(errorMsg));
      this.pendingHandshake = undefined;
    }

    // Notify any pending requests
    this.notifyConnectionFailure(code || 0, signal || 'Process exited');
  }

  /**
   * Perform handshake with the server
   */
  private async performHandshake(timeout: number): Promise<void> {
    return new Promise((resolve, reject) => {
      this.setState(ConnectionState.HANDSHAKING);
      this.pendingHandshake = { resolve, reject };

      // Set startup timeout
      this.startupTimer = setTimeout(() => {
        if (this.pendingHandshake) {
          this.pendingHandshake.reject(new Error(`Server startup timeout after ${timeout}ms`));
          this.pendingHandshake = undefined;
        }
        this.close();
      }, timeout);

      // Send a version check request as handshake
      const handshakeRequest: ServerRequest = {
        id: 'handshake',
        type: 'version'
      };

      this.debugLog('sending handshake request', handshakeRequest);
      
      try {
        const requestJson = JSON.stringify(handshakeRequest) + '\n';
        this.channel!.stdin.write(requestJson);
      } catch (e: any) {
        if (this.pendingHandshake) {
          this.pendingHandshake.reject(new Error(`Failed to send handshake: ${e.message}`));
          this.pendingHandshake = undefined;
        }
      }
    });
  }

  /**
   * Establishes an SSH single connection
   * @param server - Server connection details (not used for ssh-single, kept for interface compatibility)
   * @param options - SSH single transport options
   */
  async connect(server: DaemonServer, options: SSHSingleTransportOptions = {}): Promise<void> {
    if (!options.exec) {
      throw new Error('SSH single transport requires an exec function in sshSingle config');
    }

    if (!options.serverPath) {
      throw new Error('SSH single transport requires serverPath in sshSingle config');
    }

    this.setState(ConnectionState.CONNECTING);

    const config: SSHSingleConfig = {
      exec: options.exec,
      serverPath: options.serverPath,
      javaPath: options.javaPath,
      jvmArgs: options.jvmArgs,
      serverArgs: options.serverArgs,
      cwd: options.cwd,
      env: options.env,
      startupTimeout: options.startupTimeout || 10000,
      requestTimeout: options.requestTimeout || 30000
    };

    this.remoteCommand = this.buildRemoteCommand(config);

    this.debugLog('launching remote server', {
      command: this.remoteCommand,
      config: {
        serverPath: config.serverPath,
        javaPath: config.javaPath,
        cwd: config.cwd
      }
    });

    try {
      this.setState(ConnectionState.STARTING_SERVER);
      
      // Execute the remote command
      this.channel = await config.exec(this.remoteCommand);

      this.debugLog('exec channel established');

      // Set up stream handlers
      this.channel.stdout.on('data', (data: Buffer) => this.handleStdout(data));
      this.channel.stderr.on('data', (data: Buffer) => this.handleStderr(data));
      this.channel.onExit((code, signal) => this.handleExit(code, signal));

      // Perform handshake
      await this.performHandshake(config.startupTimeout!);

      this.debugLog('connection established successfully');
    } catch (err: any) {
      this.setState(ConnectionState.ERROR);
      this.debugLog('connection failed', { error: err.message });
      throw new Error(`SSH single transport connection failed: ${err.message}`);
    }
  }

  /**
   * Sends a request through the SSH single connection
   * @param request - The request to send
   */
  async send(request: ServerRequest): Promise<void> {
    if (!this.channel || !this.connected) {
      throw new Error("SSH single transport is not connected");
    }

    if (this.state !== ConnectionState.READY) {
      throw new Error(`SSH single transport is not ready (state: ${this.state})`);
    }

    this.trace(request);
    const requestJson = JSON.stringify(request) + '\n';
    this.channel.stdin.write(requestJson);
  }

  /**
   * Closes the SSH single connection
   */
  async close(): Promise<void> {
    if (this.state === ConnectionState.CLOSED || this.state === ConnectionState.CLOSING) {
      return;
    }

    this.setState(ConnectionState.CLOSING);
    this.debugLog('closing connection');

    if (this.startupTimer) {
      clearTimeout(this.startupTimer);
      this.startupTimer = undefined;
    }

    // Clear the line buffer to prevent processing partial data
    this.lineBuffer.clear();

    if (this.channel) {
      try {
        this.channel.close();
      } catch (e: any) {
        this.debugLog('error closing channel', { error: e.message });
      }
      this.channel = undefined;
    }

    this.connected = false;
    this.setState(ConnectionState.CLOSED);
    this.debugLog('connection closed');
  }

}


