import { expect, test } from 'vitest';
import { DaemonServer } from '../src/types';
import { SQLJob } from '../src';
import { getCertificate } from '../src/tls';
import { ENV_CREDS } from './env';

let creds: DaemonServer = {...ENV_CREDS};

test(`Simple test`, async () => {
  const ca = await getCertificate(creds);
  const job = new SQLJob();

  creds.ca = ca.raw;
  await job.connect(creds);

  const query = job.query<any[]>(`select * from sample.department`);
  const result = await query.run();

  expect(result.is_done).toBe(true);
  expect(result.data.length).not.toBe(0);

  job.close();
});

test(`Paging test`, async () => {
  const job = new SQLJob();
  await job.connect(creds);

  const query = job.query<any[]>(`select * from sample.department`);
  let result = await query.run(5)
  while (true) {
    expect(result.data.length).not.toBe(0);

    if (result.is_done) {
      break;
    }

    result = await query.fetchMore(5);
  }

  expect(true).toBeTruthy();
  job.close();
});

test(`error test`, async () => {
  const job = new SQLJob();
  await job.connect(creds);

  const query = job.query<any[]>(`select * from scooby`);

  try {
    await query.run();
    expect(true).toBe(false);
  } catch (e) {
    console.log(e.message);
    
    expect(e.message).toBe(`[SQL0204] SCOOBY in LIAMA type *FILE not found., 42704, -204`);
  }
  job.close();
});

test(`Multiple statements, one job`, async () => {
  const job = new SQLJob();
  await job.connect(creds);

  const resultA = await job.query<any[]>(`select * from sample.department`).run();
  expect(resultA.is_done).toBe(true);

  const resultB = await job.query<any[]>(`select * from sample.employee`).run();
  expect(resultB.is_done).toBe(true);
  job.close();
});

test(`Multiple statements parallel, one job`, async () => {
  const job = new SQLJob();
  await job.connect(creds);

  const results = await Promise.all([
    job.query<any[]>(`select * from sample.department`).run(),
    job.query<any[]>(`select * from sample.employee`).run()
  ]);

  expect(results[0].is_done).toBe(true);
  expect(results[1].is_done).toBe(true);
  
  job.close();
});