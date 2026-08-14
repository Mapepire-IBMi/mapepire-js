/**
 * Build-time script: download the pinned Mapepire server JAR from GitHub Releases,
 * compute its SHA-256 digest, and write it back into src/serverVersion.ts.
 *
 * Mirrors vscode-ibmi/tools/downloadMapepire.ts with SHA-256 patch-back added.
 *
 * Run automatically via the "prepack" npm script before `npm pack` / `npm publish`.
 * Never runs on the consumer's machine — the JAR ships inside the npm tarball.
 *
 * Usage:
 *   npx tsx scripts/downloadServer.ts
 */

import { Octokit } from '@octokit/rest';
import { createHash } from 'crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import path from 'path';
import { SERVER_FILE_PREFIX, SERVER_VERSION_FILE, SERVER_VERSION_TAG } from '../src/serverVersion';

const OWNER = 'Mapepire-IBMi';
const REPO  = 'mapepire-server';

const distDirectory  = path.join('.', 'dist');
const serverFilePath = path.join(distDirectory, SERVER_VERSION_FILE);
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

function patchSha256InSource(sha256: string): void {
  const src = readFileSync(serverVersionSrc, 'utf8');
  const patched = src.replace(
    /^export const JAR_SHA256 = `[^`]*`;/m,
    `export const JAR_SHA256 = \`${sha256}\`;`
  );
  if (patched === src) {
    throw new Error(`Could not find JAR_SHA256 constant in ${serverVersionSrc} to patch`);
  }
  writeFileSync(serverVersionSrc, patched, 'utf8');
  console.log(`Patched JAR_SHA256 in ${serverVersionSrc}`);
}

async function work(): Promise<void> {
  // Ensure dist/ exists
  if (!existsSync(distDirectory)) {
    mkdirSync(distDirectory, { recursive: true });
  }

  // Idempotent: skip download if JAR already present
  if (existsSync(serverFilePath)) {
    console.log(`Server JAR already present: ${SERVER_VERSION_FILE}`);
    // Still compute and patch SHA256 in case it was cleared
    const buffer = readFileSync(serverFilePath);
    const sha256 = computeSha256(buffer);
    patchSha256InSource(sha256);
    console.log(`SHA-256: ${sha256}`);
    return;
  }

  const octokit = new Octokit();

  try {
    console.log(`Fetching release ${SERVER_VERSION_TAG} from ${OWNER}/${REPO}…`);
    const result = await octokit.request(
      'GET /repos/{owner}/{repo}/releases/tags/{tag}',
      { owner: OWNER, repo: REPO, tag: SERVER_VERSION_TAG,
        headers: { 'X-GitHub-Api-Version': '2022-11-28' } }
    );

    // Prefer versioned name (e.g. mapepire-server-2.3.6.jar) if present,
    // fall back to the plain mapepire-server.jar used in most releases.
    const asset =
      result.data.assets.find((a: any) => a.name.startsWith(SERVER_FILE_PREFIX) && a.name.endsWith('.jar')) ||
      result.data.assets.find((a: any) => a.name === 'mapepire-server.jar');

    if (!asset) {
      throw new Error(`No .jar asset found in release ${SERVER_VERSION_TAG}`);
    }

    console.log(`Downloading ${asset.name} from ${asset.browser_download_url}…`);
    const buffer = await downloadFile(asset.browser_download_url, serverFilePath);
    console.log(`Saved to ${serverFilePath}`);

    const sha256 = computeSha256(buffer);
    console.log(`SHA-256: ${sha256}`);

    patchSha256InSource(sha256);

  } catch (e) {
    console.error('downloadServer failed:', e);
    process.exit(1);
  }
}

work();
