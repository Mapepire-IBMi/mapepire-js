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
      if (err.reason === "sslv3 alert handshake failure"){
        err.message += `. Please ensure the Mapepire server is being run with Java version >= 11.`
      }
      reject(err);
    });
  });
}

/**
 * This function returns the root certificate in the certificate chain which can be used 
 * as the trusted CA certificate when creating the secure connection.
 * 
 * It returns undefined when the root certificate is a publicly trusted CA. So it will not
 * override the default trusted CA certificate for secure connection to eliminate the potential
 * security attacks which are caused by always trusting the certificate returned by the server.
 * 
 * @param server - An object containing the server details, including the host and port.
 * @returns A promise that resolves to a X.509 certificate with PEM format
 */
export async function getRootCertificate(server: DaemonServer): Promise<string | undefined> {
  const peerCertificate = await getCertificate(server);
  let rootCertificate = peerCertificate;

  // When subject and issuer are the same, this should be the root certificate
  // It may be self-signed server certificate, trusted CA certificate or internal private CA certificate
  // If the server is not configured properly with full certificate chain, then peer certificate does not contain issuer certificate
  while (rootCertificate && 
            rootCertificate.issuerCertificate &&
            !isSameCertificate(rootCertificate.subject, rootCertificate.issuer)) {
    rootCertificate = rootCertificate.issuerCertificate;
  }

  const defaultCACerts = tls.rootCertificates;
  let certPEM = rootCertificate.raw.toString('base64');

  const lines = [];
  for (let i = 0; i < certPEM.length; i += 64) {
      lines.push(certPEM.substring(i, i + 64));
  }
  certPEM = "-----BEGIN CERTIFICATE-----\n" + lines.join('\n') + "\n-----END CERTIFICATE-----";

  for (let caCert of defaultCACerts) {
    if (caCert.replace(/\n/g, '') === certPEM.replace(/\n/g, '')) {
      return undefined;
    }
  }

  return certPEM;
}

export function isSameCertificate(subject: tls.Certificate, issuer: tls.Certificate) {
  const subjectKeys = Object.keys(subject);
  const issuerKeys = Object.keys(issuer);

  if (subjectKeys.length !== issuerKeys.length) {
    return false;
  }

  for (let key of subjectKeys) {
    if (!issuerKeys.includes(key) || subject[key] !== issuer[key]) {
        return false;
    }
  }

  return true;
}