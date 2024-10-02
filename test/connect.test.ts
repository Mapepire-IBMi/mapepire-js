import { beforeAll, expect, test } from 'vitest';
import { SQLJob } from '../src';
import { getRootCertificate } from '../src/tls';
import { DaemonServer } from '../src/types';
import { ENV_CREDS } from './env';

let creds: DaemonServer = { ...ENV_CREDS };
let invalidCreds: DaemonServer = {
  ...ENV_CREDS,
  user: "fakeuser",
  password: "fakepassword",
};

beforeAll(async () => {
  const ca = await getRootCertificate(creds);
  creds.ca = ca;
  invalidCreds.ca = ca;
});

test(`Connect to database`, async () => {
  const job = new SQLJob();
  const res = await job.connect(creds);
  await job.close();
  expect(res.job).toContain("QZDASOINIT")

});

test('Connect to Database with Invalid Properties', async () => {
  const job = new SQLJob();
  try {
    await job.connect(invalidCreds);
  } catch (error) {
    expect(error.message).toContain('The application server rejected the connection. (User ID is not known.:FAKEUSER)');
  }
});

test('Implicit Disconnection on New Connect Request', async () => {
  const job = new SQLJob();

  // First connection
  const firstRes = await job.connect(creds);
  const firstJobId = firstRes.job;
  expect(firstJobId).toContain('QZDASOINIT');

  // Second connection
  const secondRes = await job.connect(creds);
  const secondJobId = secondRes.job;
  expect(secondJobId).toContain('QZDASOINIT');
  await job.close();

  // Ensure job IDs are different
  expect(firstJobId).not.toBe(secondJobId);
});

test('Allow empty CA and self-signed certificate', async () => {
    const noCACreds: DaemonServer = { ...ENV_CREDS, ca: undefined, rejectUnauthorized: false };
    const job = new SQLJob();
    await job.connect(noCACreds);
 
  // Connection fails because rejectUnauthorized is true
  try{
    noCACreds.rejectUnauthorized = true;
    const job = new SQLJob();
    await job.connect(noCACreds);
    throw new Error("Self signed certificate error not hit")
  } catch(error){
    expect(error.message).toContain('self-signed certificate');
  }

});