/**
 * node-ssh Helper for Mapepire SSH Single Transport
 *
 * This module provides ready-made utilities for using node-ssh library with Mapepire.
 * Pass your connected NodeSSH instance to get an exec or upload function.
 */

import type { NodeSSH, Config as NodeSSHConfig } from 'node-ssh';
import type { ExecFunction, ExecChannel, UploadFunction, SSHSingleConfig, MapepireConfig } from '../types';

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

/**
 * Connects a NodeSSH instance using the given options and returns it.
 * Pass the result straight to `createNodeSSHConnection`.
 * You are responsible for calling `ssh.dispose()` when done.
 *
 * @param options - node-ssh Config (host, username, password / privateKey, port, …)
 * @returns Connected NodeSSH instance
 *
 * @example
 * ```typescript
 * import { SQLJob, connectNodeSSH, createNodeSSHConnection } from '@ibm/mapepire-js';
 *
 * const ssh = await connectNodeSSH({ host: 'ibmi.example.com', username: 'USER', password: 'PASS' });
 *
 * const job = SQLJob.withConfig({
 *   transport: 'ssh-single',
 *   sshSingle: createNodeSSHConnection(ssh),
 * });
 *
 * await job.connect();
 * // ... use job ...
 * await job.close();
 * ssh.dispose();
 * ```
 */
export function connectNodeSSH(options: NodeSSHConfig): Promise<NodeSSH> {
  const { NodeSSH: NodeSSHClass } = require('node-ssh') as typeof import('node-ssh');
  const ssh = new NodeSSHClass();
  return ssh.connect(options).then(() => ssh);
}

/**
 * Creates a MapepireConfig suitable for use with Pool when using node-ssh.
 *
 * Bundles `exec` and `upload` from the shared NodeSSH instance so the Pool can
 * run private install once and then start all N jobs in parallel.
 * `teardown` is intentionally absent — the Pool does not own the SSH connection.
 * The caller must call `ssh.dispose()` after `pool.end()` returns.
 *
 * @param ssh - Connected NodeSSH instance (shared across all pool jobs)
 * @param extraOptions - Any SSHSingleConfig fields except exec, upload, and teardown
 * @returns MapepireConfig ready to pass as `Pool({ config: ... })`
 *
 * @example
 * ```typescript
 * import { connectNodeSSH, createNodeSSHPoolConfig, Pool } from '@ibm/mapepire-js';
 *
 * const ssh = await connectNodeSSH({ host: 'ibm-i.example.com', username: 'USER', password: 'PASS' });
 * const pool = new Pool({
 *   config: createNodeSSHPoolConfig(ssh),
 *   maxSize: 5,
 *   startingSize: 5,  // pre-warm all jobs — JVM boot is expensive
 * });
 * await pool.init();
 * // ... use pool ...
 * await pool.end();
 * ssh.dispose();  // caller closes SSH connection after pool
 * ```
 */
export function createNodeSSHPoolConfig(
  ssh: NodeSSH,
  extraOptions?: Omit<SSHSingleConfig, 'exec' | 'upload' | 'teardown'>
): MapepireConfig {
  const sshSingle: SSHSingleConfig = {
    ...createNodeSSHConnection(ssh),
    ...extraOptions,
  };
  return { transport: 'ssh-single', sshSingle };
}
