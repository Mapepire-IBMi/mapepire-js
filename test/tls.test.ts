import { expect, test } from 'vitest';
import { DaemonServer } from '../src/types';
import { getRootCertificate } from '../src/tls';
import { ENV_CREDS } from './env';

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