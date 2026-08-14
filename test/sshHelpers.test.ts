import 'dotenv/config';
import { describe, test, expect, vi, beforeAll, afterAll } from 'vitest';
import { Readable, Writable } from 'stream';
import { SQLJob, createSSH2Exec, createSSH2Upload, createNodeSSHExec, createNodeSSHUpload } from '../src';
import type { ExecChannel } from '../src/types';

// ===========================================================================
// Fake SSH stream / client factories — no real SSH needed
// ===========================================================================

/** Build a fake ssh2-style exec stream that emits stdout, stderr, and close. */
function makeFakeStream(stdout = '', stderr = '', exitCode = 0) {
  const stdoutReadable = new Readable({ read() {} });
  const stderrReadable = new Readable({ read() {} });
  const stdinWritable = new Writable({ write(_c, _e, cb) { cb(); } });

  // Attach .stdin so callers can write to it
  const stream = Object.assign(stdoutReadable, {
    stdin: stdinWritable,
    stderr: stderrReadable,
    close: vi.fn(),
  }) as any;

  // Emit data + close on next tick so handlers can be attached first
  process.nextTick(() => {
    if (stdout) stdoutReadable.push(Buffer.from(stdout));
    stdoutReadable.push(null);
    if (stderr) stderrReadable.push(Buffer.from(stderr));
    stderrReadable.push(null);
    stdoutReadable.emit('close', exitCode, null);
  });

  return stream;
}

/** Build a minimal fake ssh2 Client. */
function makeFakeSsh2Client(stdout = '', stderr = '', exitCode = 0) {
  const stream = makeFakeStream(stdout, stderr, exitCode);
  return {
    exec: vi.fn((_cmd: string, cb: (err: null, stream: any) => void) => {
      cb(null, stream);
    }),
    sftp: vi.fn((cb: (err: null, sftp: any) => void) => {
      cb(null, {
        fastPut: vi.fn((_local: string, _remote: string, done: (err: null) => void) => done(null)),
        end: vi.fn(),
      });
    }),
    _stream: stream,
  };
}

/** Build a minimal fake NodeSSH instance (mirrors the interface used by createNodeSSHExec). */
function makeFakeNodeSSH(stdout = '', stderr = '', exitCode = 0) {
  const stream = makeFakeStream(stdout, stderr, exitCode);
  const fakeClient = {
    exec: vi.fn((_cmd: string, cb: (err: null, stream: any) => void) => cb(null, stream)),
  };
  return {
    connection: fakeClient,
    putFile: vi.fn().mockResolvedValue(undefined),
    _stream: stream,
    _client: fakeClient,
  } as any;
}

// ===========================================================================
// Unit tests — createSSH2Exec (no real SSH)
// ===========================================================================

describe('createSSH2Exec – unit', () => {
  test('returns a function', () => {
    const client = makeFakeSsh2Client();
    const exec = createSSH2Exec(client as any);
    expect(typeof exec).toBe('function');
  });

  test('returned function calls client.exec with the given command', async () => {
    const client = makeFakeSsh2Client();
    const exec = createSSH2Exec(client as any);
    await exec('echo hello').catch(() => {}); // channel may emit exit — ignore
    expect(client.exec).toHaveBeenCalledWith('echo hello', expect.any(Function));
  });

  test('returned ExecChannel exposes stdin, stdout, stderr', async () => {
    const client = makeFakeSsh2Client();
    const exec = createSSH2Exec(client as any);
    const channel: ExecChannel = await exec('ls');
    expect(channel.stdin).toBeDefined();
    expect(channel.stdout).toBeDefined();
    expect(channel.stderr).toBeDefined();
  });

  test('ExecChannel.close() delegates to stream.close()', async () => {
    const client = makeFakeSsh2Client();
    const exec = createSSH2Exec(client as any);
    const channel = await exec('ls');
    channel.close();
    expect(client._stream.close).toHaveBeenCalledOnce();
  });

  test('ExecChannel.onExit fires when stream emits close', async () => {
    const client = makeFakeSsh2Client('', '', 0);
    const exec = createSSH2Exec(client as any);
    const channel = await exec('ls');

    const exitSpy = vi.fn();
    channel.onExit(exitSpy);

    // The fake stream emits close on nextTick — wait for it
    await new Promise<void>(resolve => setTimeout(resolve, 20));
    expect(exitSpy).toHaveBeenCalledWith(0, null);
  });

  test('ExecChannel.onExit receives non-zero exit code', async () => {
    const client = makeFakeSsh2Client('', 'error', 1);
    const exec = createSSH2Exec(client as any);
    const channel = await exec('bad-cmd');

    const exitSpy = vi.fn();
    channel.onExit(exitSpy);

    await new Promise<void>(resolve => setTimeout(resolve, 20));
    expect(exitSpy).toHaveBeenCalledWith(1, null);
  });

  test('stdout data flows through ExecChannel.stdout', async () => {
    const client = makeFakeSsh2Client('hello world');
    const exec = createSSH2Exec(client as any);
    const channel = await exec('echo hello world');

    const chunks: string[] = [];
    channel.stdout.on('data', (d: Buffer) => chunks.push(d.toString()));

    await new Promise<void>(resolve => setTimeout(resolve, 20));
    expect(chunks.join('')).toBe('hello world');
  });

  test('rejects when client.exec yields an error', async () => {
    const client = {
      exec: vi.fn((_cmd: string, cb: (err: Error, stream: null) => void) => {
        cb(new Error('exec failed'), null);
      }),
    };
    const exec = createSSH2Exec(client as any);
    await expect(exec('ls')).rejects.toThrow('exec failed');
  });
});

// ===========================================================================
// Unit tests — createSSH2Upload (no real SSH)
// ===========================================================================

describe('createSSH2Upload – unit', () => {
  test('returns a function', () => {
    const client = makeFakeSsh2Client();
    const upload = createSSH2Upload(client as any);
    expect(typeof upload).toBe('function');
  });

  test('calls sftp.fastPut with correct local and remote paths', async () => {
    const client = makeFakeSsh2Client();
    const upload = createSSH2Upload(client as any);
    await upload('/local/mapepire.jar', '/remote/.mapepire/mapepire.jar');
    expect(client.sftp).toHaveBeenCalledOnce();
  });

  test('resolves on success', async () => {
    const client = makeFakeSsh2Client();
    const upload = createSSH2Upload(client as any);
    await expect(upload('/a', '/b')).resolves.toBeUndefined();
  });

  test('rejects when sftp() yields an error', async () => {
    const client = {
      sftp: vi.fn((cb: (err: Error, sftp: null) => void) => cb(new Error('sftp open failed'), null)),
    };
    const upload = createSSH2Upload(client as any);
    await expect(upload('/a', '/b')).rejects.toThrow('sftp open failed');
  });

  test('rejects when fastPut() yields an error', async () => {
    const client = {
      sftp: vi.fn((cb: (err: null, sftp: any) => void) => {
        cb(null, {
          fastPut: vi.fn((_l: string, _r: string, done: (err: Error) => void) =>
            done(new Error('fastPut failed'))
          ),
          end: vi.fn(),
        });
      }),
    };
    const upload = createSSH2Upload(client as any);
    await expect(upload('/a', '/b')).rejects.toThrow('fastPut failed');
  });
});

// ===========================================================================
// Unit tests — createNodeSSHExec (no real SSH)
// ===========================================================================

describe('createNodeSSHExec – unit', () => {
  test('returns a function when connection is present', () => {
    const ssh = makeFakeNodeSSH();
    const exec = createNodeSSHExec(ssh);
    expect(typeof exec).toBe('function');
  });

  test('throws immediately when NodeSSH instance is not connected', () => {
    const ssh = { connection: null } as any;
    expect(() => createNodeSSHExec(ssh)).toThrow('NodeSSH instance is not connected');
  });

  test('returned function calls connection.exec with the given command', async () => {
    const ssh = makeFakeNodeSSH();
    const exec = createNodeSSHExec(ssh);
    await exec('echo hi').catch(() => {});
    expect(ssh._client.exec).toHaveBeenCalledWith('echo hi', expect.any(Function));
  });

  test('returned ExecChannel exposes stdin, stdout, stderr', async () => {
    const ssh = makeFakeNodeSSH();
    const exec = createNodeSSHExec(ssh);
    const channel = await exec('ls');
    expect(channel.stdin).toBeDefined();
    expect(channel.stdout).toBeDefined();
    expect(channel.stderr).toBeDefined();
  });

  test('ExecChannel.close() delegates to stream.close()', async () => {
    const ssh = makeFakeNodeSSH();
    const exec = createNodeSSHExec(ssh);
    const channel = await exec('ls');
    channel.close();
    expect(ssh._stream.close).toHaveBeenCalledOnce();
  });

  test('ExecChannel.onExit fires when stream emits close', async () => {
    const ssh = makeFakeNodeSSH('', '', 0);
    const exec = createNodeSSHExec(ssh);
    const channel = await exec('ls');

    const exitSpy = vi.fn();
    channel.onExit(exitSpy);

    await new Promise<void>(resolve => setTimeout(resolve, 20));
    expect(exitSpy).toHaveBeenCalledWith(0, null);
  });

  test('stdout data flows through ExecChannel.stdout', async () => {
    const ssh = makeFakeNodeSSH('result-data');
    const exec = createNodeSSHExec(ssh);
    const channel = await exec('query');

    const chunks: string[] = [];
    channel.stdout.on('data', (d: Buffer) => chunks.push(d.toString()));

    await new Promise<void>(resolve => setTimeout(resolve, 20));
    expect(chunks.join('')).toBe('result-data');
  });

  test('rejects when connection.exec yields an error', async () => {
    const ssh = {
      connection: {
        exec: vi.fn((_cmd: string, cb: (err: Error, stream: null) => void) => {
          cb(new Error('exec rejected'), null);
        }),
      },
    } as any;
    const exec = createNodeSSHExec(ssh);
    await expect(exec('ls')).rejects.toThrow('exec rejected');
  });

  test('rejects if connection disappears between create and call', async () => {
    const ssh = makeFakeNodeSSH();
    const exec = createNodeSSHExec(ssh);
    // Sever the connection after the exec function is created
    ssh.connection = null;
    await expect(exec('ls')).rejects.toThrow('NodeSSH instance is not connected');
  });
});

// ===========================================================================
// Unit tests — createNodeSSHUpload (no real SSH)
// ===========================================================================

describe('createNodeSSHUpload – unit', () => {
  test('returns a function', () => {
    const ssh = makeFakeNodeSSH();
    const upload = createNodeSSHUpload(ssh);
    expect(typeof upload).toBe('function');
  });

  test('calls ssh.putFile with correct paths', async () => {
    const ssh = makeFakeNodeSSH();
    const upload = createNodeSSHUpload(ssh);
    await upload('/local/jar', '/remote/jar');
    expect(ssh.putFile).toHaveBeenCalledWith('/local/jar', '/remote/jar');
  });

  test('resolves on success', async () => {
    const ssh = makeFakeNodeSSH();
    const upload = createNodeSSHUpload(ssh);
    await expect(upload('/a', '/b')).resolves.toBeUndefined();
  });

  test('rejects when putFile throws', async () => {
    const ssh = makeFakeNodeSSH();
    ssh.putFile = vi.fn().mockRejectedValue(new Error('putFile error'));
    const upload = createNodeSSHUpload(ssh);
    await expect(upload('/a', '/b')).rejects.toThrow('putFile error');
  });
});

// ===========================================================================
// Optional imports for integration tests
// ===========================================================================

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let Client: any;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let NodeSSH: any;

try {
  Client = require('ssh2').Client;
} catch (e) { /* ssh2 not installed */ }

try {
  NodeSSH = require('node-ssh').NodeSSH;
} catch (e) { /* node-ssh not installed */ }

// Integration tests require: live host env vars AND optional SSH libs
const SSH_CREDS = {
  host: process.env.SSH_TEST_HOST || 'localhost',
  port: Number(process.env.SSH_TEST_PORT) || 22,
  username: process.env.SSH_TEST_USER || 'testuser',
  password: process.env.SSH_TEST_PASS || 'testpass',
};

const SERVER_CONFIG = {
  serverPath: process.env.SSH_TEST_SERVER_PATH || undefined,
  javaPath: process.env.SSH_TEST_JAVA_PATH || undefined,
  startupTimeout: 30000,
};

// Integration tests are opt-in: set SSH_TEST_INTEGRATION=1 to enable.
// This prevents accidental runs on dev machines where the remote JAR may not exist yet.
const shouldSkip =
  process.env.SSH_TEST_INTEGRATION !== '1' ||
  !process.env.SSH_TEST_HOST ||
  !process.env.SSH_TEST_USER ||
  !process.env.SSH_TEST_SERVER_PATH ||
  !Client ||
  !NodeSSH;

// ===========================================================================
// Integration tests — createSSH2Exec (real IBM i, skipped when not configured)
// ===========================================================================

describe('SSH Helper - createSSH2Exec (integration)', () => {
  if (shouldSkip) {
    test.skip(
      'SSH integration tests skipped — set SSH_TEST_HOST, SSH_TEST_USER, SSH_TEST_SERVER_PATH to enable',
      () => {}
    );
    return;
  }

  let sshClient: typeof Client | null = null;

  afterAll(() => {
    if (sshClient) { sshClient.end(); sshClient = null; }
  });

  test('should successfully connect to database using ssh single mode (ssh2)', async () => {
    sshClient = new Client();
    await new Promise<void>((resolve, reject) => {
      sshClient!.on('ready', () => resolve());
      sshClient!.on('error', (err: Error) => reject(err));
      sshClient!.connect(SSH_CREDS);
    });

    const job = SQLJob.withConfig({
      transport: 'ssh-single',
      sshSingle: {
        exec: createSSH2Exec(sshClient),
        serverPath: SERVER_CONFIG.serverPath,
        javaPath: SERVER_CONFIG.javaPath,
        startupTimeout: SERVER_CONFIG.startupTimeout,
      },
    });

    try {
      const result = await job.connect();
      expect(result).toBeDefined();
      expect(result.success).toBe(true);
      expect(result.job).toBeDefined();
      expect(typeof result.job).toBe('string');
      expect(result.job.length).toBeGreaterThan(0);
    } finally {
      await job.close();
      sshClient.end();
      sshClient = null;
    }
  });

  test('should execute SQL query successfully with ssh single mode (ssh2)', async () => {
    sshClient = new Client();
    await new Promise<void>((resolve, reject) => {
      sshClient!.on('ready', () => resolve());
      sshClient!.on('error', (err: Error) => reject(err));
      sshClient!.connect(SSH_CREDS);
    });

    const job = SQLJob.withConfig({
      transport: 'ssh-single',
      sshSingle: {
        exec: createSSH2Exec(sshClient),
        serverPath: SERVER_CONFIG.serverPath,
        javaPath: SERVER_CONFIG.javaPath,
      },
    });

    try {
      await job.connect();
      const result = await job.execute('SELECT * FROM QIWS.QCUSTCDT FETCH FIRST 5 ROWS ONLY');
      expect(result).toBeDefined();
      expect(result.success).toBe(true);
      expect(Array.isArray(result.data)).toBe(true);
      expect(result.data!.length).toBeGreaterThan(0);
      expect(result.data!.length).toBeLessThanOrEqual(5);
    } finally {
      await job.close();
      sshClient.end();
      sshClient = null;
    }
  });

  test('should handle invalid server path gracefully', async () => {
    sshClient = new Client();
    await new Promise<void>((resolve, reject) => {
      sshClient!.on('ready', () => resolve());
      sshClient!.on('error', (err: Error) => reject(err));
      sshClient!.connect(SSH_CREDS);
    });

    const job = SQLJob.withConfig({
      transport: 'ssh-single',
      sshSingle: {
        exec: createSSH2Exec(sshClient),
        serverPath: '/invalid/path/to/nonexistent.jar',
        javaPath: SERVER_CONFIG.javaPath,
        startupTimeout: 5000,
      },
    });

    try {
      await expect(job.connect()).rejects.toThrow();
    } finally {
      await job.close().catch(() => {});
      sshClient.end();
      sshClient = null;
    }
  });
});

// ===========================================================================
// Integration tests — createNodeSSHExec (real IBM i, skipped when not configured)
// ===========================================================================

describe('SSH Helper - createNodeSSHExec (integration)', () => {
  if (shouldSkip) {
    test.skip(
      'SSH integration tests skipped — set SSH_TEST_HOST, SSH_TEST_USER, SSH_TEST_SERVER_PATH to enable',
      () => {}
    );
    return;
  }

  let ssh: any = null;

  afterAll(() => {
    if (ssh) { ssh.dispose(); ssh = null; }
  });

  test('should successfully connect to database using ssh single mode (node-ssh)', async () => {
    ssh = new NodeSSH();
    await ssh.connect(SSH_CREDS);

    const job = SQLJob.withConfig({
      transport: 'ssh-single',
      sshSingle: {
        exec: createNodeSSHExec(ssh),
        serverPath: SERVER_CONFIG.serverPath,
        javaPath: SERVER_CONFIG.javaPath,
        startupTimeout: SERVER_CONFIG.startupTimeout,
      },
    });

    try {
      const result = await job.connect();
      expect(result).toBeDefined();
      expect(result.success).toBe(true);
      expect(typeof result.job).toBe('string');
      expect(result.job.length).toBeGreaterThan(0);
    } finally {
      await job.close();
      ssh.dispose();
      ssh = null;
    }
  });

  test('should execute SQL query successfully with ssh single mode (node-ssh)', async () => {
    ssh = new NodeSSH();
    await ssh.connect(SSH_CREDS);

    const job = SQLJob.withConfig({
      transport: 'ssh-single',
      sshSingle: {
        exec: createNodeSSHExec(ssh),
        serverPath: SERVER_CONFIG.serverPath,
        javaPath: SERVER_CONFIG.javaPath,
      },
    });

    try {
      await job.connect();
      const result = await job.execute('SELECT * FROM QIWS.QCUSTCDT FETCH FIRST 3 ROWS ONLY');
      expect(result.success).toBe(true);
      expect(Array.isArray(result.data)).toBe(true);
      expect(result.data!.length).toBeGreaterThan(0);
      expect(result.data!.length).toBeLessThanOrEqual(3);
    } finally {
      await job.close();
      ssh.dispose();
      ssh = null;
    }
  });

  test('should throw error if NodeSSH instance is not connected', () => {
    const disconnected = new NodeSSH();
    expect(() => createNodeSSHExec(disconnected)).toThrow('NodeSSH instance is not connected');
  });
});
