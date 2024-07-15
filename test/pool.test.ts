import { expect, test } from 'vitest';
import { Pool } from '../src/pool';
import { ENV_CREDS } from './env';

test(`Simple pool`, async () => {
  const pool = new Pool({ creds: ENV_CREDS, maxSize: 5, startingSize: 3 });
  let jobNames: string[];

  await pool.init();

  const resultsA = await Promise.all([
    pool.query(`values (job_name)`).run(),
    pool.query(`values (job_name)`).run(),
    pool.query(`values (job_name)`).run(),
  ])

  jobNames = resultsA.map(res => res.data[0]['00001']);

  console.log(jobNames);

  expect(jobNames.length).toBe(3);
  expect(pool.getActiveJobCount()).toBe(3);

  const resultsB = await Promise.all([
    pool.query(`values (job_name)`).run(),
    pool.query(`values (job_name)`).run(),
    pool.query(`values (job_name)`).run(),
    pool.query(`values (job_name)`).run(),
    pool.query(`values (job_name)`).run(),
    pool.query(`values (job_name)`).run(),
    pool.query(`values (job_name)`).run(),
    pool.query(`values (job_name)`).run(),
    pool.query(`values (job_name)`).run(),
    pool.query(`values (job_name)`).run(),
    pool.query(`values (job_name)`).run(),
    pool.query(`values (job_name)`).run(),
    pool.query(`values (job_name)`).run(),
    pool.query(`values (job_name)`).run(),
    pool.query(`values (job_name)`).run(),
  ])

  jobNames = resultsB.map(res => res.data[0]['00001']);

  console.log(jobNames);

  expect(jobNames.length).toBe(15);
  expect(pool.getActiveJobCount()).toBe(5);

  pool.end();
}, 1000000);