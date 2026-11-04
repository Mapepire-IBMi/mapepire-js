/**
 * Build-time script: download the pinned Mapepire server JAR from GitHub Releases
 * and verify its SHA-256 digest against the pinned JAR_SHA256 constant.
 *
 * Run automatically via the "prepare" npm script before `npm pack` / `npm publish`.
 * Skipped when the package is installed as a dependency (consumer machines).
 *
 * Usage:
 *   Normal build (verifies against pinned hash):
 *     npx tsx scripts/downloadServer.ts
 *
 *   Upgrade to a new server version (updates VERSION and JAR_SHA256 in src/serverVersion.ts):
 *     npm run bump-server <version>
 *     npx tsx scripts/downloadServer.ts --bump <version>
 *
 *   Re-pin the hash for the current VERSION (updates only JAR_SHA256):
 *     npx tsx scripts/downloadServer.ts --update-hash
 */

import { Octokit } from '@octokit/rest';
import { createHash } from 'crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'fs';
import path from 'path';
import { JAR_SHA256, SERVER_FILE_PREFIX, VERSION } from '../src/serverVersion';

const OWNER = 'Mapepire-IBMi';
const REPO  = 'mapepire-server';

const distDirectory = path.join('.', 'dist');
const serverVersionSrc = path.join('.', 'src', 'serverVersion.ts');

async function downloadFile(url: string, outputPath: string): Promise<Buffer> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download ${url}: ${response.status} ${response.statusText}`);
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  writeFileSync(outputPath, buffer);
  return buffer;
}

function computeSha256(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}

function patchVersionAndSha256InSource(version: string, sha256: string): void {
  let src = readFileSync(serverVersionSrc, 'utf8');
  const versionRegex = /^export\s+const\s+VERSION\s*=\s*[`'"][^`'"]*[`'"];?/m;
  const shaRegex = /^export\s+const\s+JAR_SHA256\s*=\s*[`'"][^`'"]*[`'"];?/m;

  if (!versionRegex.test(src) || !shaRegex.test(src)) {
    throw new Error(`Could not find VERSION or JAR_SHA256 constants in ${serverVersionSrc} to patch`);
  }

  src = src.replace(versionRegex, `export const VERSION = \`${version}\`;`);
  src = src.replace(shaRegex, `export const JAR_SHA256 = \`${sha256}\`;`);
  writeFileSync(serverVersionSrc, src, 'utf8');
  console.log(`Patched VERSION (${version}) and JAR_SHA256 (${sha256}) in ${serverVersionSrc}`);
}

function patchSha256InSource(sha256: string): void {
  const src = readFileSync(serverVersionSrc, 'utf8');
  const regex = /^export\s+const\s+JAR_SHA256\s*=\s*[`'"][^`'"]*[`'"];?/m;
  if (!regex.test(src)) {
    throw new Error(`Could not find JAR_SHA256 constant in ${serverVersionSrc} to patch`);
  }
  const patched = src.replace(regex, `export const JAR_SHA256 = \`${sha256}\`;`);
  if (patched !== src) {
    writeFileSync(serverVersionSrc, patched, 'utf8');
    console.log(`Patched JAR_SHA256 in ${serverVersionSrc}`);
  }
}

async function work(): Promise<void> {
  const args = process.argv.slice(2);
  let bumpVersion: string | undefined;

  const bumpIndex = args.indexOf('--bump');
  if (bumpIndex !== -1) {
    const rawVal = args[bumpIndex + 1];
    if (!rawVal || rawVal.startsWith('--')) {
      console.error('Error: Please specify the version to bump to. Example: npm run bump-server 2.5.2');
      process.exit(1);
    }
    bumpVersion = rawVal.replace(/^v/, '');
  } else if (args.includes('--update-hash')) {
    bumpVersion = VERSION;
  }

  const isUpgrade = Boolean(bumpVersion);
  const targetVersion = bumpVersion || VERSION;
  const targetTag = `v${targetVersion}`;
  const targetFile = `${SERVER_FILE_PREFIX}${targetVersion}.jar`;
  const targetPath = path.join(distDirectory, targetFile);
  const tempPath = `${targetPath}.tmp`;

  // Ensure dist/ exists
  if (!existsSync(distDirectory)) {
    mkdirSync(distDirectory, { recursive: true });
  }

  // Normal build mode: skip download if JAR is already present and matches expected hash
  if (!isUpgrade && existsSync(targetPath) && statSync(targetPath).size > 0) {
    const buffer = readFileSync(targetPath);
    const sha256 = computeSha256(buffer);
    if (sha256 === JAR_SHA256) {
      console.log(`Server JAR already present and verified: ${targetFile}`);
      console.log(`SHA-256: ${sha256}`);
      return;
    }
    console.log(`Cached JAR hash mismatch (expected ${JAR_SHA256}, got ${sha256}), re-downloading…`);
  }

  const octokit = new Octokit();

  try {
    if (existsSync(tempPath)) {
      rmSync(tempPath, { force: true });
    }

    console.log(`Fetching release ${targetTag} from ${OWNER}/${REPO}…`);
    const result = await octokit.request(
      'GET /repos/{owner}/{repo}/releases/tags/{tag}',
      { owner: OWNER, repo: REPO, tag: targetTag,
        headers: { 'X-GitHub-Api-Version': '2022-11-28' } }
    );

    // Releases publish the plain "mapepire-server.jar" (plus .tar.gz/.zip archives).
    // A versioned "mapepire-server-X.Y.Z.jar" asset is preferred if one ever appears.
    const asset =
      result.data.assets.find((a: any) => a.name.startsWith(SERVER_FILE_PREFIX) && a.name.endsWith('.jar')) ||
      result.data.assets.find((a: any) => a.name === 'mapepire-server.jar');

    if (!asset) {
      throw new Error(`No .jar asset found in release ${targetTag}`);
    }

    console.log(`Downloading ${asset.name} from ${asset.browser_download_url}…`);
    const buffer = await downloadFile(asset.browser_download_url, tempPath);
    const sha256 = computeSha256(buffer);
    console.log(`Computed SHA-256: ${sha256}`);

    if (isUpgrade) {
      patchVersionAndSha256InSource(targetVersion, sha256);
      renameSync(tempPath, targetPath);
      console.log(`Successfully upgraded server to ${targetVersion} (${targetFile})`);
    } else if (!JAR_SHA256) {
      // Bootstrap case: no hash pinned yet
      patchSha256InSource(sha256);
      renameSync(tempPath, targetPath);
      console.log(`Saved and bootstrapped JAR_SHA256 to ${targetPath}`);
    } else if (sha256 !== JAR_SHA256) {
      rmSync(tempPath, { force: true });
      throw new Error(
        `SHA-256 mismatch for ${targetFile}!\n` +
        `  Expected: ${JAR_SHA256}\n` +
        `  Actual:   ${sha256}\n` +
        `Integrity verification failed. If you intended to upgrade the server version, run:\n` +
        `  npm run bump-server <version>`
      );
    } else {
      // Normal build: verification passed
      renameSync(tempPath, targetPath);
      console.log(`Verified and saved to ${targetPath}`);
    }
  } catch (e) {
    if (existsSync(tempPath)) {
      rmSync(tempPath, { force: true });
    }
    console.error('downloadServer failed:', e);
    process.exit(1);
  }
}

work();
