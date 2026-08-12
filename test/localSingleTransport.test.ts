import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Readable, Writable } from 'stream';
import { EventEmitter } from 'events';

// ── Mock child_process.spawn before importing the module under test ──────────
// vi.hoisted ensures spawnMock is initialised before the vi.mock factory runs
// (vi.mock is hoisted to the top of the file by Vitest, so bare `const` declarations
// above it are not yet initialised when the factory executes).
const { spawnMock } = vi.hoisted(() => ({ spawnMock: vi.fn() }));
vi.mock('child_process', () => ({
  spawn: spawnMock,
}));

import { LocalSingleTransport } from '../src/transports/localSingleTransport';
import { DaemonServer } from '../src/types';

// ── MockChildProcess ──────────────────────────────────────────────────────────
/**
 * Minimal child process mock that satisfies what LocalSingleTransport wires up:
 *   - stdin: Writable with a spy on write()
 *   - stdout / stderr: Readable (push-based)
 *   - events: 'exit' and 'error' via EventEmitter
 *   - kill(): marks as killed
 */
class MockChildProcess extends EventEmitter {
  stdin: Writable & { write: ReturnType<typeof vi.fn> };
  stdout: Readable;
  stderr: Readable;
  killed = false;
  private _closed = false;

  constructor() {
    super();

    this.stdin = new Writable({
      write(_chunk, _enc, cb) { cb(); return true; },
    }) as Writable & { write: ReturnType<typeof vi.fn> };

    const boundWrite = this.stdin.write.bind(this.stdin);
    this.stdin.write = vi.fn((...args: any[]) => boundWrite(...args));

    this.stdout = new Readable({ read() {} });
    this.stderr = new Readable({ read() {} });

    // Drain initial read buffers
    this.stdout.read();
    this.stderr.read();
  }

  kill(_signal?: string): boolean {
    this.killed = true;
    this._closed = true;
    this.stdout.push(null);
    this.stderr.push(null);
    this.emit('exit', null, 'SIGTERM');
    return true;
  }

  // ── Test helpers ───────────────────────────────────────────────────────────
  emitStdout(data: string): void {
    if (!this._closed) this.stdout.push(data);
  }

  emitStderr(data: string): void {
    if (!this._closed) this.stderr.push(data);
  }

  emitExit(code: number, signal?: string): void {
    this._closed = true;
    this.emit('exit', code, signal ?? null);
  }

  emitError(err: Error): void {
    this.emit('error', err);
  }
}

// ── Shared constants ──────────────────────────────────────────────────────────
const TEST_HANDSHAKE_DELAY_MS = 10;
const TEST_SHORT_STARTUP_TIMEOUT_MS = 100;
const TEST_PARTIAL_MESSAGE_DELAY_MS = 5;

const DUMMY_SERVER: DaemonServer = { host: 'localhost' };
const MINIMAL_OPTIONS = { serverPath: '/path/to/mapepire-server.jar' };

/**
 * Simulate the server sending a successful handshake response on stdout.
 */
function simulateHandshake(proc: MockChildProcess, delayMs = TEST_HANDSHAKE_DELAY_MS): NodeJS.Timeout {
  return setTimeout(() => {
    proc.emitStdout(
      JSON.stringify({ id: 'handshake', success: true, job: '123456/USER/QZDASOINIT' }) + '\n'
    );
  }, delayMs);
}

// ── Tests ─────────────────────────────────────────────────────────────────────
describe('LocalSingleTransport', () => {
  let transport: LocalSingleTransport;
  let mockProc: MockChildProcess;

  beforeEach(() => {
    transport = new LocalSingleTransport();
    mockProc = new MockChildProcess();
    // Use mockReturnValueOnce so each test gets exactly the proc set up in this hook.
    // Tests that need an extra spawn (e.g. the isolated close test) call mockReturnValueOnce
    // themselves before connecting.
    spawnMock.mockReturnValue(mockProc);
  });

  afterEach(async () => {
    if (transport) {
      try { await transport.close(); } catch { /* ignore cleanup errors */ }
    }
    mockProc.stdout.destroy();
    mockProc.stderr.destroy();
    mockProc.stdout.removeAllListeners();
    mockProc.stderr.removeAllListeners();
    vi.clearAllMocks();
  });

  // ── connect() ───────────────────────────────────────────────────────────────
  describe('connect', () => {
    it('should successfully connect with minimal config', async () => {
      simulateHandshake(mockProc);
      await transport.connect(DUMMY_SERVER, MINIMAL_OPTIONS);

      expect(spawnMock).toHaveBeenCalledOnce();
      const [javaPath, args] = spawnMock.mock.calls[0];
      expect(args).toContain('-jar');
      expect(args).toContain('/path/to/mapepire-server.jar');
      expect(args).toContain('--single');
      expect(transport.isConnected()).toBe(true);
    });

    it('should use default serverPath when not provided', async () => {
      simulateHandshake(mockProc);
      await transport.connect(DUMMY_SERVER, {});

      const [, args] = spawnMock.mock.calls[0];
      expect(args).toContain('/QOpenSys/pkgs/lib/mapepire/mapepire-server.jar');
    });

    it('should use default javaPath when not provided', async () => {
      simulateHandshake(mockProc);
      await transport.connect(DUMMY_SERVER, MINIMAL_OPTIONS);

      const [javaPath] = spawnMock.mock.calls[0];
      expect(javaPath).toBe('/QOpenSys/QIBM/ProdData/JavaVM/jdk80/64bit/bin/java');
    });

    it('should use custom javaPath when provided', async () => {
      simulateHandshake(mockProc);
      await transport.connect(DUMMY_SERVER, {
        ...MINIMAL_OPTIONS,
        javaPath: '/custom/java/bin/java',
      });

      const [javaPath] = spawnMock.mock.calls[0];
      expect(javaPath).toBe('/custom/java/bin/java');
    });

    it('should include additional jvmArgs in spawn args', async () => {
      simulateHandshake(mockProc);
      await transport.connect(DUMMY_SERVER, {
        ...MINIMAL_OPTIONS,
        jvmArgs: ['-Xmx512m', '-Dfile.encoding=UTF-8'],
      });

      const [, args] = spawnMock.mock.calls[0];
      expect(args).toContain('-Xmx512m');
      expect(args).toContain('-Dfile.encoding=UTF-8');
    });

    it('should include additional serverArgs in spawn args', async () => {
      simulateHandshake(mockProc);
      await transport.connect(DUMMY_SERVER, {
        ...MINIMAL_OPTIONS,
        serverArgs: ['--traceOn'],
      });

      const [, args] = spawnMock.mock.calls[0];
      expect(args).toContain('--traceOn');
      expect(args).toContain('--single');
    });

    it('should not duplicate --single if already in serverArgs', async () => {
      simulateHandshake(mockProc);
      await transport.connect(DUMMY_SERVER, {
        ...MINIMAL_OPTIONS,
        serverArgs: ['--single', '--traceOn'],
      });

      const [, args] = spawnMock.mock.calls[0];
      const singleCount = args.filter((a: string) => a === '--single').length;
      expect(singleCount).toBe(1);
    });

    it('should always include required IBM i env vars in spawn options', async () => {
      simulateHandshake(mockProc);
      await transport.connect(DUMMY_SERVER, MINIMAL_OPTIONS);

      const [, , spawnOpts] = spawnMock.mock.calls[0];
      expect(spawnOpts.env).toMatchObject({
        QIBM_JAVA_STDIO_CONVERT: 'N',
        QIBM_PASE_DESCRIPTOR_STDIO: 'B',
        QIBM_USE_DESCRIPTOR_STDIO: 'Y',
        QIBM_MULTI_THREADED: 'Y',
      });
    });

    it('required IBM i env vars cannot be overridden by user-supplied env', async () => {
      simulateHandshake(mockProc);
      await transport.connect(DUMMY_SERVER, {
        ...MINIMAL_OPTIONS,
        env: { QIBM_JAVA_STDIO_CONVERT: 'Y' }, // attempt to override
      });

      const [, , spawnOpts] = spawnMock.mock.calls[0];
      // Required var must still be 'N' regardless of user override
      expect(spawnOpts.env.QIBM_JAVA_STDIO_CONVERT).toBe('N');
    });

    it('should merge user env vars with required vars', async () => {
      simulateHandshake(mockProc);
      await transport.connect(DUMMY_SERVER, {
        ...MINIMAL_OPTIONS,
        env: { MY_CUSTOM_VAR: 'hello' },
      });

      const [, , spawnOpts] = spawnMock.mock.calls[0];
      expect(spawnOpts.env.MY_CUSTOM_VAR).toBe('hello');
      // Required vars still present
      expect(spawnOpts.env.QIBM_JAVA_STDIO_CONVERT).toBe('N');
    });

    it('should pass cwd option to spawn', async () => {
      simulateHandshake(mockProc);
      await transport.connect(DUMMY_SERVER, {
        ...MINIMAL_OPTIONS,
        cwd: '/tmp/mydir',
      });

      const [, , spawnOpts] = spawnMock.mock.calls[0];
      expect(spawnOpts.cwd).toBe('/tmp/mydir');
    });

    it('should use stdio: pipe for all streams', async () => {
      simulateHandshake(mockProc);
      await transport.connect(DUMMY_SERVER, MINIMAL_OPTIONS);

      const [, , spawnOpts] = spawnMock.mock.calls[0];
      expect(spawnOpts.stdio).toEqual(['pipe', 'pipe', 'pipe']);
    });

    it('should handle handshake timeout and reject', async () => {
      // No handshake response emitted — timeout fires
      await expect(
        transport.connect(DUMMY_SERVER, {
          ...MINIMAL_OPTIONS,
          startupTimeout: TEST_SHORT_STARTUP_TIMEOUT_MS,
        })
      ).rejects.toThrow('Server startup timeout');
    });

    it('should handle spawn error (e.g. java not found)', async () => {
      // spawn itself succeeds but emits an 'error' event
      setTimeout(() => mockProc.emitError(new Error('spawn ENOENT')), 5);

      await expect(
        transport.connect(DUMMY_SERVER, {
          ...MINIMAL_OPTIONS,
          startupTimeout: TEST_SHORT_STARTUP_TIMEOUT_MS,
        })
      ).rejects.toThrow();
    });

    it('should handle process exit before handshake completes', async () => {
      setTimeout(() => mockProc.emitExit(1), 5);

      await expect(
        transport.connect(DUMMY_SERVER, {
          ...MINIMAL_OPTIONS,
          startupTimeout: TEST_SHORT_STARTUP_TIMEOUT_MS,
        })
      ).rejects.toThrow('Server process exited during startup');
    });

    it('should include stderr in error message when process exits early', async () => {
      setTimeout(() => {
        mockProc.emitStderr('Error: Class not found\n');
        mockProc.emitExit(1);
      }, 5);

      await expect(
        transport.connect(DUMMY_SERVER, {
          ...MINIMAL_OPTIONS,
          startupTimeout: TEST_SHORT_STARTUP_TIMEOUT_MS,
        })
      ).rejects.toThrow('Error: Class not found');
    });

    it('should handle stderr during startup without failing (warning case)', async () => {
      setTimeout(() => {
        mockProc.emitStderr('WARNING: some JVM warning\n');
        simulateHandshake(mockProc, 0);
      }, TEST_HANDSHAKE_DELAY_MS);

      // Connection should still succeed despite stderr output
      await expect(transport.connect(DUMMY_SERVER, MINIMAL_OPTIONS)).resolves.not.toThrow();
      expect(transport.isConnected()).toBe(true);
    });
  });

  // ── send() ───────────────────────────────────────────────────────────────────
  describe('send', () => {
    beforeEach(async () => {
      simulateHandshake(mockProc);
      await transport.connect(DUMMY_SERVER, MINIMAL_OPTIONS);
    });

    it('should send request and receive response', async () => {
      const request = { id: 'test-1', type: 'sql', sql: 'SELECT 1 FROM SYSIBM.SYSDUMMY1' };

      setTimeout(() => {
        mockProc.emitStdout(JSON.stringify({ id: 'test-1', success: true, data: [] }) + '\n');
      }, TEST_HANDSHAKE_DELAY_MS);

      await transport.send(request);

      expect(mockProc.stdin.write).toHaveBeenCalled();
      const written = (mockProc.stdin.write as ReturnType<typeof vi.fn>).mock.calls
        .map((c: any[]) => c[0])
        .find((s: string) => s.includes('"test-1"'));
      expect(written).toBeDefined();
    });

    it('should handle multiple concurrent requests', async () => {
      const req1 = { id: 'req-1', type: 'sql', sql: 'SELECT 1' };
      const req2 = { id: 'req-2', type: 'sql', sql: 'SELECT 2' };

      const p1 = transport.send(req1);
      const p2 = transport.send(req2);

      setTimeout(() => {
        mockProc.emitStdout(JSON.stringify({ id: 'req-1', success: true, data: [] }) + '\n');
        mockProc.emitStdout(JSON.stringify({ id: 'req-2', success: true, data: [] }) + '\n');
      }, TEST_HANDSHAKE_DELAY_MS);

      await Promise.all([p1, p2]);
    });

    it('should handle partial JSON chunks across multiple stdout events', async () => {
      const request = { id: 'chunk-1', type: 'sql', sql: 'SELECT 1' };
      const sendPromise = transport.send(request);

      setTimeout(() => {
        const response = JSON.stringify({ id: 'chunk-1', success: true, data: [] });
        mockProc.emitStdout(response.substring(0, 20));
        setTimeout(() => {
          mockProc.emitStdout(response.substring(20) + '\n');
        }, TEST_PARTIAL_MESSAGE_DELAY_MS);
      }, TEST_HANDSHAKE_DELAY_MS);

      await sendPromise;
      // Allow all pending timers to drain
      await new Promise(r => setTimeout(r, TEST_HANDSHAKE_DELAY_MS + TEST_PARTIAL_MESSAGE_DELAY_MS + 10));
    });

    it('should throw if send is called when not connected', async () => {
      const fresh = new LocalSingleTransport();
      await expect(
        fresh.send({ id: 'x', type: 'sql' })
      ).rejects.toThrow('not connected');
    });

    it('should handle malformed JSON response without crashing', async () => {
      // Send a bad line followed by a valid one
      const request = { id: 'good-1', type: 'sql' };
      const sendPromise = transport.send(request);

      setTimeout(() => {
        mockProc.emitStdout('this is not json\n');
        mockProc.emitStdout(JSON.stringify({ id: 'good-1', success: true, data: [] }) + '\n');
      }, TEST_HANDSHAKE_DELAY_MS);

      await sendPromise; // should still resolve on the valid response
    });
  });

  // ── close() ───────────────────────────────────────────────────────────────────
  describe('close', () => {
    it('should close the child process and mark as disconnected', async () => {
      // Create an isolated transport + proc so this test is not affected by state
      // left by the send describe block (which shares mockProc via beforeEach).
      const isolatedProc = new MockChildProcess();
      const isolatedTransport = new LocalSingleTransport();
      spawnMock.mockReturnValueOnce(isolatedProc);
      simulateHandshake(isolatedProc);
      await isolatedTransport.connect(DUMMY_SERVER, MINIMAL_OPTIONS);

      expect(isolatedTransport.isConnected()).toBe(true);
      await isolatedTransport.close();
      expect(isolatedTransport.isConnected()).toBe(false);
      expect(isolatedProc.killed).toBe(true);
    });

    it('should be idempotent — multiple close() calls should not throw', async () => {
      simulateHandshake(mockProc);
      await transport.connect(DUMMY_SERVER, MINIMAL_OPTIONS);

      await transport.close();
      await expect(transport.close()).resolves.not.toThrow();
      await expect(transport.close()).resolves.not.toThrow();
    });

    it('should close cleanly without connecting first', async () => {
      const fresh = new LocalSingleTransport();
      await expect(fresh.close()).resolves.not.toThrow();
    });

    it('should send exit request before killing when connected', async () => {
      simulateHandshake(mockProc);
      await transport.connect(DUMMY_SERVER, MINIMAL_OPTIONS);

      await transport.close();

      const writtenPayloads = (mockProc.stdin.write as ReturnType<typeof vi.fn>).mock.calls
        .map((c: any[]) => c[0] as string)
        .filter(s => s.includes('"exit"'));
      expect(writtenPayloads.length).toBeGreaterThan(0);
    });

    it('should reject pending requests when child process exits unexpectedly', async () => {
      simulateHandshake(mockProc);
      await transport.connect(DUMMY_SERVER, MINIMAL_OPTIONS);

      const responsePromise = transport.send({ id: 'pending-1', type: 'sql' });

      // Register conn_fail listener before exit fires
      const rejectSpy = new Promise<void>((_, reject) => {
        transport.getResponseEmitter().once('pending-1_conn_fail', (err: Error) => reject(err));
      });

      // Crash the child process
      setTimeout(() => mockProc.emitExit(1), 5);

      await expect(rejectSpy).rejects.toThrow();
    });
  });

  // ── SQLJob integration ────────────────────────────────────────────────────────
  describe('SQLJob.withConfig integration', () => {
    it('should create LocalSingleTransport via SQLJob.withConfig', async () => {
      const { SQLJob } = await import('../src/sqlJob');
      const job = SQLJob.withConfig({
        transport: 'local-single',
        localSingle: { serverPath: '/path/to/server.jar' },
      });
      expect(job.getTransport()).toBeInstanceOf(LocalSingleTransport);
    });

    it('should allow local-single transport without providing localSingle object', async () => {
      const { SQLJob } = await import('../src/sqlJob');
      const job = SQLJob.withConfig({
        transport: 'local-single',
      });
      expect(job.getTransport()).toBeInstanceOf(LocalSingleTransport);
    });
  });
});
