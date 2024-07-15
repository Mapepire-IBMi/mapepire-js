import tls from 'tls';
import { DaemonServer } from './types';

export function getCertificate(server: DaemonServer): Promise<tls.DetailedPeerCertificate> {
  return new Promise((resolve, reject) => {
    const socket = tls.connect(server.port, server.host, {
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