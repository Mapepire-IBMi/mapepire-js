import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ensureServerInstalled, ServerInstallerOptions } from '../src/transports/serverInstaller';
import { ExecChannel, ExecFunction, UploadFunction } from '../src/types';
import { Readable, Writable } from 'stream';

// ---------------------------------------------------------------------------
// Helpers to build mock ExecChannels for simple command output
// ---------------------------------------------------------------------------

function makeExecChannel(stdout: string, exitCode = 0): ExecChannel {
  const stdoutStream = new Readable({ read() {} });
  const stderrStream = new Readable({ read() {} });
  const stdinStream  = new Writable({ write(_c, _e, cb) { cb(); } });

  let exitCb: ((code: number | null, signal?: string) => void) | undefined;

  // Push data and emit exit in sequence: data first, then a second tick for exit.
  // This ensures the 'data' event fires before runCommand's onExit resolves.
  process.nextTick(() => {
    if (stdout) stdoutStream.push(Buffer.from(stdout));
    stdoutStream.push(null);
    stderrStream.push(null);
    // Give the stream a chance to flush data listeners before firing exit
    process.nextTick(() => exitCb?.(exitCode));
  });

  return {
    stdin: stdinStream,
    stdout: stdoutStream,
    stderr: stderrStream,
    close: vi.fn(),
    onExit(cb) { exitCb = cb; },
  };
}

/** Build an ExecFunction that dispatches different responses based on command substring */
function makeExec(routes: Array<{ match: string | RegExp; stdout: string; code?: number }>): ExecFunction {
  return vi.fn(async (command: string) => {
    for (const route of routes) {
      const hit = typeof route.match === 'string'
        ? command.includes(route.match)
        : route.match.test(command);
      if (hit) return makeExecChannel(route.stdout, route.code ?? 0);
    }
    // Default: success with empty output
    return makeExecChannel('');
  }) as unknown as ExecFunction;
}

// ---------------------------------------------------------------------------
// Common options factory
// ---------------------------------------------------------------------------

const BUNDLED_VERSION = '2.3.5';
const BUNDLED_SHA256  = 'abc123def456abc123def456abc123def456abc123def456abc123def456abc1';
const LOCAL_JAR       = '/local/dist/mapepire-server-2.3.5.jar';
const HOME_DIR        = '/home/testuser';
const INSTALL_DIR     = `${HOME_DIR}/.mapepire`;
const REMOTE_JAR      = `${INSTALL_DIR}/mapepire-server-${BUNDLED_VERSION}.jar`;

function makeUpload(): UploadFunction {
  return vi.fn().mockResolvedValue(undefined) as unknown as UploadFunction;
}

function makeOpenSslRoute(sha256 = BUNDLED_SHA256): { match: string; stdout: string } {
  return { match: 'openssl dgst -sha256', stdout: `SHA256(${REMOTE_JAR})= ${sha256}` };
}

function baseOptions(exec: ExecFunction, upload: UploadFunction): ServerInstallerOptions {
  return {
    exec,
    upload,
    localJarPath: LOCAL_JAR,
    version: BUNDLED_VERSION,
    jarSha256: BUNDLED_SHA256,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ensureServerInstalled', () => {

  it('Test A: JAR found at correct version — upload NOT called, SHA256 verified, path returned', async () => {
    const upload = makeUpload();
    const exec = makeExec([
      { match: 'echo $HOME',      stdout: HOME_DIR },
      { match: '/QOpenSys/usr/bin/find', stdout: REMOTE_JAR },
      makeOpenSslRoute(),
    ]);

    const result = await ensureServerInstalled(baseOptions(exec, upload));

    expect(result).toBe(REMOTE_JAR);
    expect(upload).not.toHaveBeenCalled();
  });

  it('Test B: No JAR found — mkdir called, upload called, chmod called, SHA256 verified', async () => {
    const upload = makeUpload();
    const exec = makeExec([
      { match: 'echo $HOME',            stdout: HOME_DIR },
      { match: '/QOpenSys/usr/bin/find', stdout: '' },   // nothing found
      { match: 'mkdir -p',              stdout: '' },
      { match: 'chmod +x',             stdout: '' },
      makeOpenSslRoute(),
    ]) as ReturnType<typeof vi.fn> & ExecFunction;

    const result = await ensureServerInstalled(baseOptions(exec, upload));

    expect(result).toBe(REMOTE_JAR);
    expect(upload).toHaveBeenCalledOnce();
    expect(upload).toHaveBeenCalledWith(LOCAL_JAR, REMOTE_JAR);

    const calls = (exec as ReturnType<typeof vi.fn>).mock.calls.map((c: any[]) => c[0] as string);
    expect(calls.some(c => c.includes('mkdir -p'))).toBe(true);
    expect(calls.some(c => c.includes('chmod +x'))).toBe(true);
  });

  it('Test C: Single outdated JAR found — upload triggered', async () => {
    const upload = makeUpload();
    const oldJarPath = `${INSTALL_DIR}/mapepire-server-2.2.0.jar`;
    const exec = makeExec([
      { match: 'echo $HOME',            stdout: HOME_DIR },
      { match: '/QOpenSys/usr/bin/find', stdout: oldJarPath },
      { match: 'mkdir -p',              stdout: '' },
      { match: 'chmod +x',             stdout: '' },
      makeOpenSslRoute(),
    ]);

    const result = await ensureServerInstalled(baseOptions(exec, upload));

    expect(result).toBe(REMOTE_JAR);
    expect(upload).toHaveBeenCalledOnce();
  });

  it('Test D: Mixed versions — one outdated, one current — upload NOT triggered', async () => {
    const upload = makeUpload();
    const oldJar     = `${INSTALL_DIR}/mapepire-server-2.2.0.jar`;
    const currentJar = `${INSTALL_DIR}/mapepire-server-2.3.5.jar`;
    const exec = makeExec([
      { match: 'echo $HOME',            stdout: HOME_DIR },
      { match: '/QOpenSys/usr/bin/find', stdout: `${oldJar}\n${currentJar}` },
      makeOpenSslRoute(),
    ]);

    const result = await ensureServerInstalled(baseOptions(exec, upload));

    expect(result).toBe(REMOTE_JAR);
    expect(upload).not.toHaveBeenCalled();
  });

  it('Test E: Upload function throws — error propagated', async () => {
    const upload = vi.fn().mockRejectedValue(new Error('SFTP transfer failed')) as unknown as UploadFunction;
    const exec = makeExec([
      { match: 'echo $HOME',            stdout: HOME_DIR },
      { match: '/QOpenSys/usr/bin/find', stdout: '' },
      { match: 'mkdir -p',              stdout: '' },
    ]);

    await expect(ensureServerInstalled(baseOptions(exec, upload)))
      .rejects.toThrow('SFTP transfer failed');
  });

  it('Test F: SHA256 mismatch after upload — tamper error thrown', async () => {
    const upload = makeUpload();
    const exec = makeExec([
      { match: 'echo $HOME',            stdout: HOME_DIR },
      { match: '/QOpenSys/usr/bin/find', stdout: '' },
      { match: 'mkdir -p',              stdout: '' },
      { match: 'chmod +x',             stdout: '' },
      { match: 'openssl dgst -sha256',  stdout: `SHA256(${REMOTE_JAR})= deadbeef` },
    ]);

    await expect(ensureServerInstalled(baseOptions(exec, upload)))
      .rejects.toThrow(/SHA-256 mismatch/);
  });

  it('Test G: echo $HOME returns empty — error propagated', async () => {
    const upload = makeUpload();
    const exec = makeExec([
      { match: 'echo $HOME', stdout: '' },
    ]);

    await expect(ensureServerInstalled(baseOptions(exec, upload)))
      .rejects.toThrow(/Could not resolve \$HOME/);
  });

  it('Test H: newer version already present — upload NOT triggered, newer path returned, SHA256 NOT called', async () => {
    const upload = makeUpload();
    const newerJar = `${INSTALL_DIR}/mapepire-server-3.0.0.jar`;
    const exec = makeExec([
      { match: 'echo $HOME',            stdout: HOME_DIR },
      { match: '/QOpenSys/usr/bin/find', stdout: newerJar },
      // No openssl route — SHA-256 must NOT be called for a pre-existing remote JAR
    ]) as ReturnType<typeof vi.fn> & ExecFunction;

    const result = await ensureServerInstalled(baseOptions(exec, upload));

    expect(result).toBe(newerJar);
    expect(upload).not.toHaveBeenCalled();
    const calls = (exec as ReturnType<typeof vi.fn>).mock.calls.map((c: any[]) => c[0] as string);
    expect(calls.some(c => c.includes('openssl'))).toBe(false);
  });

  it('Test I: custom remoteInstallDir is respected', async () => {
    const customDir = '/custom/install/dir';
    const customJar = `${customDir}/mapepire-server-${BUNDLED_VERSION}.jar`;
    const upload = makeUpload();
    const exec = makeExec([
      { match: 'echo $HOME',            stdout: HOME_DIR },
      { match: '/QOpenSys/usr/bin/find', stdout: '' },
      { match: 'mkdir -p',              stdout: '' },
      { match: 'chmod +x',             stdout: '' },
      { match: 'openssl dgst -sha256',  stdout: `SHA256(${customJar})= ${BUNDLED_SHA256}` },
    ]);

    const result = await ensureServerInstalled({
      ...baseOptions(exec, upload),
      remoteInstallDir: customDir,
    });

    expect(result).toBe(customJar);
    expect(upload).toHaveBeenCalledWith(LOCAL_JAR, customJar);
  });

  it('Test J: empty jarSha256 — SHA256 verification skipped', async () => {
    const upload = makeUpload();
    const exec = makeExec([
      { match: 'echo $HOME',            stdout: HOME_DIR },
      { match: '/QOpenSys/usr/bin/find', stdout: '' },
      { match: 'mkdir -p',              stdout: '' },
      { match: 'chmod +x',             stdout: '' },
      // No openssl route — should not be called
    ]);

    const result = await ensureServerInstalled({
      ...baseOptions(exec, upload),
      jarSha256: '',
    });

    expect(result).toBe(REMOTE_JAR);
    const calls = (exec as ReturnType<typeof vi.fn>).mock.calls.map((c: any[]) => c[0] as string);
    expect(calls.some(c => c.includes('openssl'))).toBe(false);
  });
});
