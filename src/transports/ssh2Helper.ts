/**
 * SSH2 Helper for Mapepire SSH Single Transport
 *
 * This module provides ready-made utilities for using the ssh2 library with Mapepire.
 * Pass your connected ssh2 Client instance to get an exec or upload function.
 */

import type { Client } from 'ssh2';
import type { ExecFunction, ExecChannel, UploadFunction, SSHSingleConfig } from '../types';

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
