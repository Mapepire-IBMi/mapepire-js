import { beforeAll, expect, test } from 'vitest';
import { Pool } from '../src/pool';
import { ENV_CREDS } from './env';
import { SQLJob, getCertificate } from "../src";
import { DaemonServer } from "../src/types";

let creds: DaemonServer = { ...ENV_CREDS };

beforeAll(async () => {
  const ca = await getCertificate(creds);
  creds.ca = ca.raw;
});

test(`Simple pool (using pool#execute)`, async () => {
  const pool = new Pool({ creds, maxSize: 5, startingSize: 3 });
  let jobNames: string[];

  await pool.init();

  const resultsA = await Promise.all([
    pool.execute(`values (job_name)`),
    pool.execute(`values (job_name)`),
    pool.execute(`values (job_name)`),
  ]);

  jobNames = resultsA.map((res) => res.data[0]["00001"]);

  console.log(jobNames);

  expect(jobNames.length).toBe(3);
  expect(pool.getActiveJobCount()).toBe(3);

  const resultsB = await Promise.all([
    pool.execute(`values (job_name)`),
    pool.execute(`values (job_name)`),
    pool.execute(`values (job_name)`),
    pool.execute(`values (job_name)`),
    pool.execute(`values (job_name)`),
    pool.execute(`values (job_name)`),
    pool.execute(`values (job_name)`),
    pool.execute(`values (job_name)`),
    pool.execute(`values (job_name)`),
    pool.execute(`values (job_name)`),
    pool.execute(`values (job_name)`),
    pool.execute(`values (job_name)`),
    pool.execute(`values (job_name)`),
    pool.execute(`values (job_name)`),
    pool.execute(`values (job_name)`),
  ]);

  jobNames = resultsB.map((res) => res.data[0]["00001"]);

  console.log(jobNames);

  expect(jobNames.length).toBe(15);
  expect(pool.getActiveJobCount()).toBeGreaterThanOrEqual(3);
  expect(pool.getActiveJobCount()).toBeLessThanOrEqual(5);

  await pool.end();
}, 1000000);

test("Starting size greater than max size", async () => {
  const pool = new Pool({ creds, maxSize: 1, startingSize: 10 });
  await expect(() => pool.init()).rejects.toThrowError(
    "Max size must be greater than starting size"
  );
});

test("Max size of 0", async () => {
  const pool = new Pool({ creds, maxSize: 0, startingSize: 10 });
  await expect(() => pool.init()).rejects.toThrowError(
    "Max size must be greater than 0"
  );
});

test("Performance test", async () => {
  const startPool1 = Date.now();
  let pool = new Pool({ creds, maxSize: 5, startingSize: 5 });
  await pool.init();
  let queries = [];

  for (let i = 0; i < 20; i++) {
    queries.push(pool.execute("select * FROM SAMPLE.SYSCOLUMNS"));
  }

  await Promise.all(queries);
  const endPool1 = Date.now();
  await pool.end();

  const startPool2 = Date.now();
  pool = new Pool({ creds, maxSize: 1, startingSize: 1 });
  await pool.init();
  queries = [];

  for (let i = 0; i < 20; i++) {
    queries.push(pool.execute("select * FROM SAMPLE.SYSCOLUMNS"));
  }

  await Promise.all(queries);
  const endPool2 = Date.now();
  await pool.end();

  const noPoolStart = Date.now();
  for (let i = 0; i < 20; i++) {
    const job = new SQLJob();
    await job.connect(creds);
    await job.execute("select * FROM SAMPLE.SYSCOLUMNS");
    await job.close();
  }
  const noPoolEnd = Date.now();

  expect(endPool2 - startPool2).toBeGreaterThan(endPool1 - startPool1);
  expect(noPoolEnd - noPoolStart).toBeGreaterThan(endPool2 - startPool2);
}, 999999);