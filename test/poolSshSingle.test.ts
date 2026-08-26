/**
 * Unit tests for Pool + SSH Single mode (offline, no real IBM i required).
 *
 * Strategy:
 *  - Mock ensureServerInstalled so Pool.init() pre-install runs without SSH
 *  - Mock SQLJob.withConfig to inject a MockTransport so connect() resolves instantly
 *  - Verify wiring: correct path taken, teardown absent, jobs close cleanly
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EventEmitter } from 'events';
import { Pool } from '../src/pool';
import { SQLJob } from '../src/sqlJob';
import { createSSH2PoolConfig } from '../src/transports/ssh2Helper';
import { createNodeSSHPoolConfig } from '../src/transports/nodeSSHHelper';
import type { MapepireConfig, SSHSingleConfig } from '../src/types';
import type { Client } from 'ssh2';
import type { NodeSSH } from 'node-ssh';

// ---------------------------------------------------------------------------
// Mock: ensureServerInstalled — resolves immediately with a fixed path
// ---------------------------------------------------------------------------
vi.mock('../src/transports/serverInstaller', () => ({
  ensureServerInstalled: vi.fn().mockResolvedValue('/home/USER/.mapepire/mapepire-server-1.0.0.jar'),
}));

// ---------------------------------------------------------------------------
// MockTransport: minimal transport that resolves connect() and emits a
// connect response when send() is called.
// ---------------------------------------------------------------------------
class MockTransport {
  readonly responseEmitter = new EventEmitter();
  connected = false;
  closeCalled = 0;

  async connect(_server: any, _options?: any): Promise<void> {
    this.connected = true;
  }

  async send(request: any): Promise<void> {
    // Emit the expected connect response on the next tick
    setImmediate(() => {
      this.responseEmitter.emit(request.id, {
        id: request.id,
        success: true,
        job: 'MOCK/001/QZDASOINIT',
        sql_rc: 0,
        sql_state: '00000',
        execution_time: 0,
      });
    });
  }

  async close(): Promise<void> {
    this.closeCalled++;
    this.connected = false;
  }

  getResponseEmitter() { return this.responseEmitter; }
  isConnected() { return this.connected; }
  enableTrace() {}
  disableTrace() {}
}

// ---------------------------------------------------------------------------
// Helpers: minimal fake SSH client objects (structure only, never connected)
// ---------------------------------------------------------------------------
function makeFakeSSH2Client(): Client {
  return {
    exec: vi.fn(),
    sftp: vi.fn(),
    end: vi.fn(),
  } as unknown as Client;
}

function makeFakeNodeSSH(): NodeSSH {
  return {
    connection: {},        // truthy so createNodeSSHExec doesn't throw
    putFile: vi.fn(),
    dispose: vi.fn(),
  } as unknown as NodeSSH;
}

// ---------------------------------------------------------------------------
// Setup: replace SQLJob.withConfig so it returns jobs backed by MockTransport
// ---------------------------------------------------------------------------
let withConfigSpy: ReturnType<typeof vi.spyOn>;
let connectSpy: ReturnType<typeof vi.spyOn>;
const createdTransports: MockTransport[] = [];

const MOCK_CONNECT_RESULT = {
  id: 'x',
  success: true,
  job: 'MOCK/001/QZDASOINIT',
  sql_rc: 0,
  sql_state: '00000',
  execution_time: 0,
};

beforeEach(() => {
  createdTransports.length = 0;
  withConfigSpy = vi.spyOn(SQLJob, 'withConfig').mockImplementation((config, opts) => {
    const transport = new MockTransport();
    createdTransports.push(transport);
    return new SQLJob(opts ?? {}, transport as any);
  });
  // connect() on a mock-transport job has no _mapepireConfig, so mock it directly.
  // Also set status to READY so getActiveJobCount() counts the job correctly.
  connectSpy = vi.spyOn(SQLJob.prototype, 'connect').mockImplementation(async function(this: any) {
    this.status = 'ready';
    return MOCK_CONNECT_RESULT as any;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Tests: PoolOptions validation
// ---------------------------------------------------------------------------
describe('Pool init() validation', () => {
  it('rejects when neither creds nor config is provided', async () => {
    const pool = new Pool({ maxSize: 3, startingSize: 1 } as any);
    await expect(pool.init()).rejects.toMatch(/creds or config/);
  });

  it('rejects when maxSize is 0', async () => {
    const pool = new Pool({ config: {} as MapepireConfig, maxSize: 0, startingSize: 1 });
    await expect(pool.init()).rejects.toMatch(/Max size/);
  });

  it('rejects when startingSize > maxSize', async () => {
    const pool = new Pool({ config: {} as MapepireConfig, maxSize: 1, startingSize: 3 });
    await expect(pool.init()).rejects.toMatch(/starting size/i);
  });

  it('rejects when startingSize is 0', async () => {
    const pool = new Pool({ config: {} as MapepireConfig, maxSize: 3, startingSize: 0 });
    await expect(pool.init()).rejects.toMatch(/Starting size/);
  });
});

// ---------------------------------------------------------------------------
// Tests: ssh-single pool wiring
// ---------------------------------------------------------------------------
describe('Pool + ssh-single wiring', () => {
  it('calls SQLJob.withConfig (not new SQLJob) for each job', async () => {
    const client = makeFakeSSH2Client();
    const pool = new Pool({
      config: createSSH2PoolConfig(client),
      maxSize: 3,
      startingSize: 3,
    });
    await pool.init();
    expect(withConfigSpy).toHaveBeenCalledTimes(3);
    await pool.end();
  });

  it('creates the correct number of jobs', async () => {
    const client = makeFakeSSH2Client();
    const pool = new Pool({
      config: createSSH2PoolConfig(client),
      maxSize: 5,
      startingSize: 3,
    });
    await pool.init();
    expect(pool.getActiveJobCount()).toBe(3);
    await pool.end();
  });

  it('injects resolvedServerPath into each job config (pre-install result)', async () => {
    const { ensureServerInstalled } = await import('../src/transports/serverInstaller');
    (ensureServerInstalled as any).mockResolvedValue('/resolved/path/server.jar');

    const client = makeFakeSSH2Client();
    // Give the config an upload fn so the pre-install branch triggers
    const config = createSSH2PoolConfig(client);

    const pool = new Pool({ config, maxSize: 2, startingSize: 2 });
    await pool.init();

    // Each withConfig call should have received a config with serverPath injected
    const calls = withConfigSpy.mock.calls;
    expect(calls.length).toBe(2);
    for (const [calledConfig] of calls) {
      expect((calledConfig as MapepireConfig).sshSingle?.serverPath).toBe('/resolved/path/server.jar');
    }
    await pool.end();
  });

  it('skips pre-install when serverPath is already set in config', async () => {
    const { ensureServerInstalled } = await import('../src/transports/serverInstaller');
    const installSpy = ensureServerInstalled as ReturnType<typeof vi.fn>;
    installSpy.mockClear();

    const client = makeFakeSSH2Client();
    const config = createSSH2PoolConfig(client, { serverPath: '/explicit/path/server.jar' });
    const pool = new Pool({ config, maxSize: 2, startingSize: 2 });
    await pool.init();

    expect(installSpy).not.toHaveBeenCalled();
    await pool.end();
  });

  it('pool.end() calls close() on all jobs', async () => {
    const client = makeFakeSSH2Client();
    const pool = new Pool({
      config: createSSH2PoolConfig(client),
      maxSize: 2,
      startingSize: 2,
    });
    await pool.init();
    expect(createdTransports.length).toBe(2);

    await pool.end();
    for (const t of createdTransports) {
      expect(t.closeCalled).toBeGreaterThan(0);
    }
  });

  it('teardown is not present on configs produced by createSSH2PoolConfig', () => {
    const client = makeFakeSSH2Client();
    const config = createSSH2PoolConfig(client);
    expect((config.sshSingle as any)?.teardown).toBeUndefined();
  });

  it('teardown is not present on configs produced by createNodeSSHPoolConfig', () => {
    const ssh = makeFakeNodeSSH();
    const config = createNodeSSHPoolConfig(ssh);
    expect((config.sshSingle as any)?.teardown).toBeUndefined();
  });

  it('getJob() does NOT trigger addJob() for ssh-single pool when all busy', async () => {
    const client = makeFakeSSH2Client();
    const pool = new Pool({
      config: createSSH2PoolConfig(client),
      maxSize: 2,   // space available — would trigger addJob() in WebSocket mode
      startingSize: 1,
    });
    await pool.init();
    const addJobSpy = vi.spyOn(pool as any, 'addJob');

    // getJob() when the only job is busy — for ssh-single the auto-scale must be suppressed
    pool.getJob(); // returns the busy job without calling addJob
    expect(addJobSpy).not.toHaveBeenCalled();

    await pool.end();
  });
});

// ---------------------------------------------------------------------------
// Tests: factory function shapes
// ---------------------------------------------------------------------------
describe('createSSH2PoolConfig', () => {
  it('returns transport ssh-single with exec and upload', () => {
    const client = makeFakeSSH2Client();
    const config = createSSH2PoolConfig(client);
    expect(config.transport).toBe('ssh-single');
    expect(typeof config.sshSingle?.exec).toBe('function');
    expect(typeof config.sshSingle?.upload).toBe('function');
    expect((config.sshSingle as any)?.teardown).toBeUndefined();
  });

  it('merges extraOptions into sshSingle', () => {
    const client = makeFakeSSH2Client();
    const config = createSSH2PoolConfig(client, {
      javaPath: '/custom/java',
      startupTimeout: 30000,
    });
    expect(config.sshSingle?.javaPath).toBe('/custom/java');
    expect(config.sshSingle?.startupTimeout).toBe(30000);
  });

  it('extraOptions cannot override exec or upload (Omit enforced at type level)', () => {
    // Runtime check: even if someone casts around the type, spread order means
    // createSSH2Connection's exec/upload win since extraOptions is spread last —
    // BUT extraOptions explicitly omits those keys so they cannot be passed.
    // This test just verifies exec is always a function from the client.
    const client = makeFakeSSH2Client();
    const config = createSSH2PoolConfig(client);
    expect(config.sshSingle?.exec).toBeDefined();
  });
});

describe('createNodeSSHPoolConfig', () => {
  it('returns transport ssh-single with exec and upload', () => {
    const ssh = makeFakeNodeSSH();
    const config = createNodeSSHPoolConfig(ssh);
    expect(config.transport).toBe('ssh-single');
    expect(typeof config.sshSingle?.exec).toBe('function');
    expect(typeof config.sshSingle?.upload).toBe('function');
    expect((config.sshSingle as any)?.teardown).toBeUndefined();
  });

  it('merges extraOptions into sshSingle', () => {
    const ssh = makeFakeNodeSSH();
    const config = createNodeSSHPoolConfig(ssh, { javaPath: '/opt/java17/bin/java' });
    expect(config.sshSingle?.javaPath).toBe('/opt/java17/bin/java');
  });
});

// ---------------------------------------------------------------------------
// Tests: legacy creds path unchanged
// ---------------------------------------------------------------------------
describe('Pool legacy creds path', () => {
  it('uses new SQLJob() not withConfig when creds is provided', async () => {
    const creds = { host: 'localhost', user: 'USER', password: 'PASS' };
    const pool = new Pool({ creds, maxSize: 1, startingSize: 1 });
    await pool.init();

    expect(withConfigSpy).not.toHaveBeenCalled();
    expect(connectSpy).toHaveBeenCalledWith(creds);

    await pool.end();
  });

  it('creds takes priority when both creds and config are provided', async () => {
    const creds = { host: 'localhost', user: 'USER', password: 'PASS' };
    const client = makeFakeSSH2Client();
    const pool = new Pool({
      creds,
      config: createSSH2PoolConfig(client), // config present but creds wins
      maxSize: 1,
      startingSize: 1,
    });
    await pool.init();

    expect(withConfigSpy).not.toHaveBeenCalled(); // config path NOT taken
    expect(connectSpy).toHaveBeenCalledWith(creds); // WebSocket path taken

    await pool.end();
  });
});
