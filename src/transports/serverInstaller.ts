/**
 * ServerInstaller — private install of the Mapepire server JAR over SSH.
 *
 * On first connect (or after version upgrade), automatically installs the
 * bundled server JAR to $HOME/.mapepire/ on the remote IBM i system.
 *
 * The install lifecycle (version check → upload → SHA-256 verify) is
 * inspired by the equivalent feature in codefori/vscode-ibmi.
 *
 * Algorithm:
 *   1. Resolve $HOME via exec("echo $HOME")
 *   2. installDir = $HOME/.mapepire  (or overridden via remoteInstallDir)
 *   3. find all mapepire-server-*.jar in installDir
 *   4. Parse semver from each filename
 *   5a. None found      → NotInstalled → upload
 *   5b. ALL < bundled   → NeedsUpdate  → upload
 *   5c. ANY >= bundled  → Installed    → verify SHA-256 → return path
 *   6. Upload: mkdir -p, sftp/scp, chmod +x
 *   7. Verify: openssl dgst -sha256 <remote>, compare to jarSha256
 */

import path from 'path';
import type { ExecFunction, UploadFunction } from '../types';
import { SERVER_FILE_PREFIX } from '../serverVersion';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface ServerInstallerOptions {
  /** SSH exec function (from createSSH2Exec or createNodeSSHExec) */
  exec: ExecFunction;

  /** SFTP upload function (from createSSH2Upload or createNodeSSHUpload) */
  upload: UploadFunction;

  /** Absolute local path to the bundled JAR file */
  localJarPath: string;

  /** Semver string of the bundled JAR, e.g. "2.3.5" */
  version: string;

  /** Expected SHA-256 hex digest of the bundled JAR (from JAR_SHA256 in serverVersion.ts).
   *  If empty string, SHA-256 verification is skipped. */
  jarSha256: string;

  /** Override for the remote install directory.
   *  Defaults to $HOME/.mapepire on the remote IBM i system. */
  remoteInstallDir?: string;
}

// ---------------------------------------------------------------------------
// Internal semver helpers
// ---------------------------------------------------------------------------

interface SemVer { major: number; minor: number; patch: number; }

/** Parse "mapepire-server-X.Y.Z.jar" → SemVer, or null if unrecognised */
function parseVersionFromFilename(filename: string): SemVer | null {
  const m = new RegExp(`${SERVER_FILE_PREFIX}(\\d+)\\.(\\d+)\\.(\\d+)\\.jar$`).exec(filename);
  if (!m) return null;
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]) };
}

/** Parse "X.Y.Z" → SemVer, throws if malformed */
function parseSemVer(version: string): SemVer {
  const parts = version.split('.').map(Number);
  if (parts.length !== 3 || parts.some(isNaN)) {
    throw new Error(`Invalid semver string: "${version}"`);
  }
  return { major: parts[0], minor: parts[1], patch: parts[2] };
}

/** Returns true if a < b */
function semVerLessThan(a: SemVer, b: SemVer): boolean {
  if (a.major !== b.major) return a.major < b.major;
  if (a.minor !== b.minor) return a.minor < b.minor;
  return a.patch < b.patch;
}

// ---------------------------------------------------------------------------
// Remote helpers — each runs one SSH command via exec, returns stdout
// ---------------------------------------------------------------------------

/**
 * Run a simple command that is expected to succeed (exit code 0).
 * Returns trimmed stdout. Throws on non-zero exit.
 */
async function runCommand(exec: ExecFunction, command: string): Promise<string> {
  return new Promise((resolve, reject) => {
    exec(command)
      .then(channel => {
        let stdout = '';
        let stderr = '';

        channel.stdout.on('data', (chunk: Buffer) => { stdout += chunk.toString('utf8'); });
        channel.stderr.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf8'); });

        channel.onExit((code) => {
          channel.close();
          if (code !== 0) {
            reject(new Error(`Command "${command}" exited with code ${code}: ${stderr.trim()}`));
          } else {
            resolve(stdout.trim());
          }
        });
      })
      .catch(reject);
  });
}

/** Step 1: Resolve $HOME on the remote system via SSH exec. */
async function resolveHomeDir(exec: ExecFunction): Promise<string> {
  const home = await runCommand(exec, 'echo $HOME');
  if (!home) {
    throw new Error('Could not resolve $HOME on remote system');
  }
  return home;
}

/**
 * Step 3: Find all mapepire-server-*.jar files in known install locations.
 * Searches both $HOME/.mapepire (our location) and $HOME/.vscode (vscode-ibmi location)
 * in a single find call so existing vscode-ibmi installs are reused without re-uploading.
 */
async function checkRemoteVersions(
  exec: ExecFunction,
  homeDir: string,
  installDir: string
): Promise<Array<{ semver: SemVer; fullPath: string }>> {
  const vscodePath = path.posix.join(homeDir, '.vscode');
  let stdout: string;
  try {
    stdout = await runCommand(
      exec,
      `/QOpenSys/usr/bin/find "${installDir}" "${vscodePath}" -type f -name "${SERVER_FILE_PREFIX}*.jar" 2>/dev/null`
    );
  } catch {
    // Directories don't exist or find failed — treat as no files found
    return [];
  }

  return stdout
    .split('\n')
    .map(line => line.trim())
    .filter(line => line.length > 0)
    .map(fullPath => {
      const filename = path.posix.basename(fullPath);
      const semver = parseVersionFromFilename(filename);
      return semver ? { semver, fullPath } : null;
    })
    .filter((x): x is { semver: SemVer; fullPath: string } => x !== null);
}

/** Step 6a: Ensure the remote install directory exists */
async function ensureRemoteDir(exec: ExecFunction, installDir: string): Promise<void> {
  await runCommand(exec, `mkdir -p "${installDir}"`);
}

/** Step 6b+c: Upload the JAR and make it executable */
async function uploadJar(
  exec: ExecFunction,
  upload: UploadFunction,
  localPath: string,
  remotePath: string
): Promise<void> {
  await upload(localPath, remotePath);
  await runCommand(exec, `chmod +x "${remotePath}"`);
}

/**
 * Step 7: Verify the remote JAR's SHA-256 hash via openssl.
 */
async function verifySha256(
  exec: ExecFunction,
  remotePath: string,
  expectedSha256: string
): Promise<void> {
  const output = await runCommand(exec, `openssl dgst -sha256 "${remotePath}"`);
  // openssl output: "SHA256(filename)= <hex>"  — take the last token
  const actual = output.split(' ').pop()?.toLowerCase() ?? '';
  if (actual !== expectedSha256.toLowerCase()) {
    throw new Error(
      `Remote JAR SHA-256 mismatch — possible tampering.\n` +
      `  expected: ${expectedSha256}\n` +
      `  actual:   ${actual}`
    );
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Ensure the correct version of mapepire-server is installed on the remote system.
 * Installs to $HOME/.mapepire/ if not already present or if outdated.
 *
 * @returns The confirmed absolute remote path to the JAR.
 */
export async function ensureServerInstalled(options: ServerInstallerOptions): Promise<string> {
  const { exec, upload, localJarPath, version, jarSha256 } = options;

  // 1. Resolve home dir
  const homeDir = await resolveHomeDir(exec);

  // 2. Build install directory path
  const installDir = options.remoteInstallDir
    ? options.remoteInstallDir
    : path.posix.join(homeDir, '.mapepire');

  const remoteJarName = `${SERVER_FILE_PREFIX}${version}.jar`;
  const remoteJarPath = path.posix.join(installDir, remoteJarName);

  const bundledVersion = parseSemVer(version);

  // 3–4. Check what's already on the remote
  const found = await checkRemoteVersions(exec, homeDir, installDir);

  const needsUpload =
    found.length === 0 ||
    found.every(({ semver }) => semVerLessThan(semver, bundledVersion));

  if (needsUpload) {
    // 6. Upload the bundled JAR.
    await ensureRemoteDir(exec, installDir);
    await uploadJar(exec, upload, localJarPath, remoteJarPath);

    // 7. Verify the JAR we just uploaded against the known bundled hash.
    //    Skipped only when jarSha256 is empty (e.g. pre-build dev run).
    //    We do NOT verify pre-existing remote JARs — JAR_SHA256 is specific
    //    to the bundled version and cannot vouch for any other version's bytes.
    if (jarSha256) {
      await verifySha256(exec, remoteJarPath, jarSha256);
    }

    return remoteJarPath;
  }

  // Installed: at least one found version >= bundled.
  // Return the highest found version's actual path.
  const best = found.reduce((a, b) => semVerLessThan(a.semver, b.semver) ? b : a);
  return best.fullPath;
}
