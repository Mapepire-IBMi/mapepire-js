/**
 * node-ssh Helper for Mapepire SSH Single Transport
 *
 * This module provides ready-made utilities for using node-ssh library with Mapepire.
 * Pass your connected NodeSSH instance to get an exec or upload function.
 */

import type { NodeSSH } from 'node-ssh';
import type { ExecFunction, ExecChannel, UploadFunction, SSHSingleConfig } from '../types';

/**
 * Creates an exec function from a connected NodeSSH instance.
 *
 * The user is responsible for:
 * - Installing the node-ssh library: `npm install node-ssh`
 * - Creating and connecting the NodeSSH instance
 * - Managing the connection lifecycle (disposing when done)
 *
 * @param ssh - Connected NodeSSH instance
 * @returns ExecFunction that can be used with SSHSingleTransport
 *
 * @example
 * ```typescript
 * import { NodeSSH } from 'node-ssh';
 * import { SQLJob, createNodeSSHExec } from '@ibm/mapepire-js';
 *
 * const ssh = new NodeSSH();
 * await ssh.connect({ host: 'your-host.com', username: 'user', password: 'pass' });
 *
 * const job = SQLJob.withConfig({
 *   transport: 'ssh-single',
 *   sshSingle: {
 *     exec: createNodeSSHExec(ssh),
 *     serverPath: '/path/to/mapepire-server.jar'
 *   }
 * });
 *
 * await job.connect();
 * // ... use job ...
 * await job.close();
 * ssh.dispose();
 * ```
 */
export function createNodeSSHExec(ssh: NodeSSH): ExecFunction {
  // Validate eagerly so callers get an immediate error if passed a disconnected instance
  if (!ssh.connection) {
    throw new Error('NodeSSH instance is not connected');
  }

  return async function exec(command: string): Promise<ExecChannel> {
    const client = ssh.connection;

    if (!client) {
      throw new Error('NodeSSH instance is not connected');
    }

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
            // Note: We don't dispose the ssh connection here as the user manages it
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
 * Creates an upload function from a connected NodeSSH instance.
 * Uses node-ssh's built-in putFile for SFTP transfer.
 *
 * The user is responsible for:
 * - The NodeSSH instance being connected before calling this
 * - Disposing the connection when done
 *
 * @param ssh - Connected NodeSSH instance
 * @returns UploadFunction that can be used with SSHSingleConfig.upload
 *
 * @example
 * ```typescript
 * import { NodeSSH } from 'node-ssh';
 * import { SQLJob, createNodeSSHExec, createNodeSSHUpload } from '@ibm/mapepire-js';
 *
 * const job = SQLJob.withConfig({
 *   transport: 'ssh-single',
 *   sshSingle: {
 *     exec: createNodeSSHExec(ssh),
 *     upload: createNodeSSHUpload(ssh),  // enables private install
 *   }
 * });
 * ```
 */
export function createNodeSSHUpload(ssh: NodeSSH): UploadFunction {
  return async function upload(localPath: string, remotePath: string): Promise<void> {
    await ssh.putFile(localPath, remotePath);
  };
}

/**
 * Convenience wrapper: returns both `exec` and `upload` from a single connected NodeSSH instance.
 * Spread the result directly into `sshSingle` to enable private install with one call.
 *
 * @param ssh - Connected NodeSSH instance
 * @returns `{ exec, upload }` ready to spread into SSHSingleConfig
 *
 * @example
 * ```typescript
 * import { NodeSSH } from 'node-ssh';
 * import { SQLJob, createNodeSSHConnection } from '@ibm/mapepire-js';
 *
 * const ssh = new NodeSSH();
 * await ssh.connect({ host: 'your-host.com', username: 'user', password: 'pass' });
 *
 * const job = SQLJob.withConfig({
 *   transport: 'ssh-single',
 *   sshSingle: createNodeSSHConnection(ssh),  // private install enabled automatically
 * });
 *
 * await job.connect();
 * // ... use job ...
 * await job.close();
 * ssh.dispose();
 * ```
 */
export function createNodeSSHConnection(ssh: NodeSSH): Pick<SSHSingleConfig, 'exec' | 'upload'> {
  return {
    exec:   createNodeSSHExec(ssh),
    upload: createNodeSSHUpload(ssh),
  };
}
