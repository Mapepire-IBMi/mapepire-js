import tls from 'tls';
import { DaemonServer } from './types';
import { DEFAULT_PORT } from './sqlJob';

/**
 * Retrieves the SSL/TLS certificate from a specified DB2 server.
 *
 * This function establishes a secure connection to the server and retrieves the peer certificate
 * information, which includes details about the server's SSL/TLS certificate.
 *
 * @param server - An object containing the server details, including the host and port.
 * @returns A promise that resolves to the detailed peer certificate information.
 * @throws An error if the connection fails or if there is an issue retrieving the certificate.
 */
export function getCertificate(server: DaemonServer): Promise<tls.DetailedPeerCertificate> {
  return new Promise((resolve, reject) => {
    const socket = tls.connect(server.port || DEFAULT_PORT, server.host, {
      rejectUnauthorized: false
    });

    socket.once('secureConnect', () => {
      const cert = socket.getPeerCertificate(true);
      socket.end();
      resolve(cert);
    });

    socket.once('error', (err) => {
      reject(err);
    });
  });
}