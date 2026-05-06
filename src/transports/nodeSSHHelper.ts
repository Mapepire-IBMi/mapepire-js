/**
 * node-ssh Helper for Mapepire SSH Single Transport
 *
 * This module provides a ready-made utility for using node-ssh library with Mapepire.
 * Simply pass your connected NodeSSH instance to get a configured exec function.
 */

import type { NodeSSH } from 'node-ssh';
import type { ExecFunction, ExecChannel } from '../types';

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
 * // User manages SSH connection
 * const ssh = new NodeSSH();
 * await ssh.connect({
 *   host: 'your-host.com',
 *   username: 'user',
 *   password: 'pass'
 * });
 *
 * // Pass connected client to Mapepire
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
 *
 * // User closes SSH connection
 * ssh.dispose();
 * ```
 */
export function createNodeSSHExec(ssh: NodeSSH): ExecFunction {
  return async function exec(command: string): Promise<ExecChannel> {
    // Get the underlying ssh2 client from node-ssh
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
