/**
 * SSH2 Helper for Mapepire SSH Single Transport
 *
 * This module provides a ready-made utility for using ssh2 library with Mapepire.
 * Simply pass your connected ssh2 Client instance to get a configured exec function.
 */

import type { Client } from 'ssh2';
import type { ExecFunction, ExecChannel } from '../types';

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
 * // User manages SSH connection
 * const client = new Client();
 * await new Promise((resolve, reject) => {
 *   client.on('ready', resolve);
 *   client.on('error', reject);
 *   client.connect({
 *     host: 'your-host.com',
 *     port: 22,
 *     username: 'user',
 *     password: 'pass'
 *   });
 * });
 *
 * // Pass connected client to Mapepire
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
 *
 * // User closes SSH connection
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
