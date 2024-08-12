import { beforeAll, expect, test } from 'vitest';
import { DaemonServer } from '../src/types';
import { SQLJob } from '../src';
import { getCertificate } from '../src/tls';
import { ENV_CREDS } from './env';

let creds: DaemonServer = {...ENV_CREDS};
let invalidCreds: DaemonServer = {
    ...ENV_CREDS,
    user: "fakeuser",
    password: "fakepassword",
  };

beforeAll(async () => {
  const ca = await getCertificate(creds);
  creds.ca = ca.raw;
  invalidCreds.ca = ca.raw;
});

test('Run CL Command Successfully', async () => {
    const job = new SQLJob();
    await job.connect(creds);
    const query = await job.clcommand('WRKACTJOB')
    const res = await query.execute();
    await job.close();
    expect(res.data.length).toBeGreaterThanOrEqual(1)
    expect(res.success).toBe(true)
   
});


test('Invalid CL command', async () => {
  const job = new SQLJob();
  await job.connect(creds);
  const query = await job.clcommand('INVALIDCOMMAND')
  const res = await query.execute();
  await job.close();
  expect(res.data.length).toBeGreaterThanOrEqual(1)
  expect(res.success).toBe(false)
  expect(res.error).toContain("[CPF0006] Errors occurred in command.")
  expect(res.id).toBeDefined()
  expect(res.is_done).toBe(true)
  expect(res.sql_rc).toEqual(-443)
  expect(res.sql_state).toEqual('38501')
 
});

