/**
 * SSH2 Helper for Mapepire SSH Single Transport
 *
 * This module provides ready-made utilities for using the ssh2 library with Mapepire.
 * Pass your connected ssh2 Client instance to get an exec or upload function.
 */

import type { Client, ConnectConfig } from 'ssh2';
import type { ExecFunction, ExecChannel, UploadFunction, SSHSingleConfig, MapepireConfig } from '../types';

/**
 * Creates an exec function from a connected ssh2 Client instance.
 *
 * The user is responsible for:
 * - Installing the ssh2 library: `npm install ssh2`
 * - Creating and connecting the ssh2 Client
 * - Managing the client lifecycle (closing when done)
 *
 * @param client - Connected ssh2 Client instance
 * @returns ExecFunction that can be used with SSHSingleTransport
 *
 * @example
 * ```typescript
 * import { Client } from 'ssh2';
 * import { SQLJob, createSSH2Exec } from '@ibm/mapepire-js';
 *
 * const client = new Client();
 * // ... connect client ...
 *
 * const job = SQLJob.withConfig({
 *   transport: 'ssh-single',
 *   sshSingle: {
 *     exec: createSSH2Exec(client),
 *     serverPath: '/path/to/mapepire-server.jar'
 *   }
 * });
 *
 * await job.connect();
 * // ... use job ...
 * await job.close();
 * client.end();
 * ```
 */
export function createSSH2Exec(client: Client): ExecFunction {
  return async function exec(command: string): Promise<ExecChannel> {
    return new Promise((resolve, reject) => {
      client.exec(command, (err, stream) => {
        if (err) {
          reject(err);
          return;
        }

        const channel: ExecChannel = {
          stdin: stream.stdin,
          stdout: stream,
          stderr: stream.stderr,

          close() {
            stream.close();
          },

          onExit(callback) {
            stream.on('close', (code, signal) => {
              callback(code, signal);
            });
          }
        };

        resolve(channel);
      });
    });
  };
}

/**
 * Creates an upload function from a connected ssh2 Client instance.
 * Uses SFTP fastPut for efficient binary transfer.
 *
 * The user is responsible for:
 * - The ssh2 Client being connected before calling this
 * - Closing the client when done
 *
 * @param client - Connected ssh2 Client instance
 * @returns UploadFunction that can be used with SSHSingleConfig.upload
 *
 * @example
 * ```typescript
 * import { Client } from 'ssh2';
 * import { SQLJob, createSSH2Exec, createSSH2Upload } from '@ibm/mapepire-js';
 *
 * const job = SQLJob.withConfig({
 *   transport: 'ssh-single',
 *   sshSingle: {
 *     exec: createSSH2Exec(client),
 *     upload: createSSH2Upload(client),  // enables private install
 *   }
 * });
 * ```
 */
export function createSSH2Upload(client: Client): UploadFunction {
  return async function upload(localPath: string, remotePath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      client.sftp((err, sftp) => {
        if (err) { reject(err); return; }
        sftp.fastPut(localPath, remotePath, (putErr) => {
          // Close SFTP session so the remote end flushes the file before we return.
          sftp.end();
          if (putErr) { reject(putErr); } else { resolve(); }
        });
      });
    });
  };
}

/**
 * Convenience wrapper: returns both `exec` and `upload` from a single connected ssh2 Client.
 * Spread the result directly into `sshSingle` to enable private install with one call.
 *
 * @param client - Connected ssh2 Client instance
 * @returns `{ exec, upload }` ready to spread into SSHSingleConfig
 *
 * @example
 * ```typescript
 * import { Client } from 'ssh2';
 * import { SQLJob, createSSH2Connection } from '@ibm/mapepire-js';
 *
 * const client = new Client();
 * // ... connect client ...
 *
 * const job = SQLJob.withConfig({
 *   transport: 'ssh-single',
 *   sshSingle: createSSH2Connection(client),  // private install enabled automatically
 * });
 *
 * await job.connect();
 * // ... use job ...
 * await job.close();
 * client.end();
 * ```
 */
export function createSSH2Connection(client: Client): Pick<SSHSingleConfig, 'exec' | 'upload'> {
  return {
    exec:   createSSH2Exec(client),
    upload: createSSH2Upload(client),
  };
}

/**
 * Promisifies the ssh2 Client connect lifecycle.
 * Returns the connected Client — pass it straight to `createSSH2Connection`.
 * You are responsible for calling `client.end()` when done.
 *
 * @param options - ssh2 ConnectConfig (host, username, password / privateKey, port, …)
 * @returns Connected ssh2 Client instance
 *
 * @example
 * ```typescript
 * import { SQLJob, connectSSH2, createSSH2Connection } from '@ibm/mapepire-js';
 *
 * const client = await connectSSH2({ host: 'ibmi.example.com', username: 'USER', password: 'PASS' });
 *
 * const job = SQLJob.withConfig({
 *   transport: 'ssh-single',
 *   sshSingle: createSSH2Connection(client),
 * });
 *
 * await job.connect();
 * // ... use job ...
 * await job.close();
 * client.end();
 * ```
 */
export function connectSSH2(options: ConnectConfig): Promise<Client> {
  return new Promise((resolve, reject) => {
    const { Client: SSH2Client } = require('ssh2') as typeof import('ssh2');
    const client = new SSH2Client();
    client.on('ready', () => resolve(client));
    client.on('error', reject);
    client.connect(options);
  });
}

/**
 * Creates a MapepireConfig suitable for use with Pool when using ssh2.
 *
 * Bundles `exec` and `upload` from the shared SSH client so the Pool can
 * run private install once and then start all N jobs in parallel.
 * `teardown` is intentionally absent — the Pool does not own the SSH client.
 * The caller must call `client.end()` after `pool.end()` returns.
 *
 * @param client - Connected ssh2 Client (shared across all pool jobs)
 * @param extraOptions - Any SSHSingleConfig fields except exec, upload, and teardown
 * @returns MapepireConfig ready to pass as `Pool({ config: ... })`
 *
 * @example
 * ```typescript
 * import { connectSSH2, createSSH2PoolConfig, Pool } from '@ibm/mapepire-js';
 *
 * const client = await connectSSH2({ host: 'ibm-i.example.com', username: 'USER', password: 'PASS' });
 * const pool = new Pool({
 *   config: createSSH2PoolConfig(client),
 *   maxSize: 5,
 *   startingSize: 5,  // pre-warm all jobs — JVM boot is expensive
 * });
 * await pool.init();
 * // ... use pool ...
 * await pool.end();
 * client.end();  // caller closes SSH client after pool
 * ```
 */
export function createSSH2PoolConfig(
  client: Client,
  extraOptions?: Omit<SSHSingleConfig, 'exec' | 'upload' | 'teardown'>
): MapepireConfig {
  const sshSingle: SSHSingleConfig = {
    ...createSSH2Connection(client),
    ...extraOptions,
  };
  return { transport: 'ssh-single', sshSingle };
}
