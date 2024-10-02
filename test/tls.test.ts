import { expect, test } from 'vitest';
import { DaemonServer } from '../src/types';
import { getRootCertificate } from '../src/tls';
import { ENV_CREDS } from './env';
import { SQLJob } from '../src';


let creds: DaemonServer = {...ENV_CREDS};

test(`Can get cert correctly`, async () => {
  const cert = await getRootCertificate(creds);

  expect(cert).toBeDefined();
});

test(`Will fail correctly`, async () => {
  try {
    const cert = await getRootCertificate({
      ...creds,
      host: `scooby`
    });

    expect(cert).toBe(undefined);
  } catch (e) {
    expect(e).toBeDefined();
  }
});

test(`Self signed cert should not be trusted when ca not provided`, async () => {
  let res;
  try {
    const job = new SQLJob();
    await job.connect(creds);    
    throw new Error("Self signed certificate was trusted when it shouldn't have been");
  } catch (e) {
    expect(e.message).toEqual('self-signed certificate');
  }
});

test(`Self signed certificate should not be trusted when providing not matching trusted cert`, async () => {
  const badCert = "-----BEGIN CERTIFICATE-----\n" +
"MIIDtjCCAp6gAwIBAgIUaZwqO1YXrSGUZ+j2YlefGD+Li3UwDQYJKoZIhvcNAQEL\n" +
"BQAwcjELMAkGA1UEBhMCZHIxCzAJBgNVBAgMAnNlMQwwCgYDVQQHDAN0eXUxDDAK\n" +
"BgNVBAoMA3NlcjELMAkGA1UECwwCaGYxDzANBgNVBAMMBmRyZnRnZzEcMBoGCSqG\n" +
"SIb3DQEJARYNbG9nQGdtYWlsLmNvbTAeFw0yNDEwMDIxODU3MDFaFw0yNTEwMDIx\n" +
"ODU3MDFaMHQxCzAJBgNVBAYTAkNBMQswCQYDVQQIDAJPTjEQMA4GA1UEBwwHVG9y\n" +
"b250bzEMMAoGA1UECgwDSUJNMQswCQYDVQQLDAJMTDEMMAoGA1UEAwwDSk9OMR0w\n" +
"GwYJKoZIhvcNAQkBFg5mYWtlQGdtYWlsLmNvbTCCASIwDQYJKoZIhvcNAQEBBQAD\n" +
"ggEPADCCAQoCggEBAI39BFoVAXIc0HFH7MgDAI53ExKgZkyBXGjFsooyzM/u215h\n" +
"QLtsfirmsFU8Kq2HOY1UaB1PRq4nrHYrwO7nYpmA14/9EgEXQsSRDH8LO18sSUQb\n" +
"hOX3622CunKDT77O7z5LakPuVvOsj1XBVTyFONTTzcuWW0mcnupj7j+WF+fldV3y\n" +
"Z64rfk/wJ2W1FjWNgxtm076KivVrV4RvL7DmGQH5sCENCx4eaGh2LGe1kb5yACQ3\n" +
"9zeC9aEwogEh2QRV8x3LzsroF3NR/IqzIm6L3kaiyWTsQkVlztmGpXY3WnFgfoBj\n" +
"e6IZOCRXzA9iTS1dRDGnFSzcRawf+PSIbP88LZ0CAwEAAaNCMEAwHQYDVR0OBBYE\n" +
"FH1B2+PDJmga5MwzswnukmSEt50OMB8GA1UdIwQYMBaAFPHGkLtIDz/tR3iBLgzU\n" +
"DjEK+tsoMA0GCSqGSIb3DQEBCwUAA4IBAQCnlEjRBF+IUNRfYVqOW4uHJriaBViu\n" +
"6zdXG+13pa7La+mAZ0BsoP1pLhrWjDul271MTOYsq429XBtlfxaNJiqHuPNjccKa\n" +
"wga2NFLAZriHYUvyP4Ld/H0IVAleIem4w2vwqHqayV2GeQCn5H+LknIaTzHKuRZ9\n" +
"fv6C/V5jBJFAJ29tYh79lioIRIZ6nzYLGWQIXbh9Y8uNIMbU3z4fqRQN65gKCkBB\n" +
"HaelrFfJI+UCGwOnr4qTKxkEB/lNz47O7kh4vmAk4mU3IsSWDMsydFHCTPLMg/Me\n" +
"TYn5iFqPQJhDoSiE8W0CeyAUXyhwWg7l9qiBaA+nI+t1Y307ld4T46x4\n" +
"-----END CERTIFICATE-----";
  try {
    const job = new SQLJob();
    creds.ca = badCert;
    await job.connect(creds); 
    throw new Error("Self signed certificate was trusted when it shouldn't have been");
  } catch (e) {
    expect(e.message).toEqual('self-signed certificate');
  }
});