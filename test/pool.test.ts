import { beforeAll, expect, test, vi } from "vitest";
import { Pool } from "../src/pool";
import { ENV_CREDS } from "./env";
import { SQLJob, getCertificate } from "../src";
import { DaemonServer, QueryResult } from "../src/types";
import { JobStatus } from "../src/states";

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
});

test(`Pool tagged function`, async () => {
  const pool = new Pool({ creds, maxSize: 1, startingSize: 1 });
  
  await pool.init();

  const baseSalary = 1000;

  const result = await pool.sql`
    select * from sample.employee where salary > ${baseSalary}
  `;

  expect(result.has_results).toBe(true);
  expect(result.data.length).toBeGreaterThan(0);

  await pool.end();
});

test("Starting size greater than max size", async () => {
  const pool = new Pool({ creds, maxSize: 1, startingSize: 10 });
  await expect(() => pool.init()).rejects.toThrowError(
    "Max size must be greater than or equal to starting size"
  );
});

test("Max size of 0", async () => {
  const pool = new Pool({ creds, maxSize: 0, startingSize: 10 });
  await expect(() => pool.init()).rejects.toThrowError(
    "Max size must be greater than 0"
  );
});

test("Starting size of 0", async () => {
  const pool = new Pool({ creds, maxSize: 5, startingSize: 0 });
  await expect(() => pool.init()).rejects.toThrowError(
    "Starting size must be greater than 0"
  );
});

test("Performance test", async () => {
  let pool = new Pool({ creds, maxSize: 5, startingSize: 5 });

  // Pool 1
  await pool.init();
  const startPool1 = Date.now();
  let queries = [];
  for (let i = 0; i < 20; i++) {
    queries.push(pool.execute("select * FROM SAMPLE.SYSCOLUMNS"));
  }
  let results: QueryResult<any>[] = await Promise.all(queries);
  const endPool1 = Date.now();
  pool.end();

  results.forEach((res) => expect(res.has_results).toBe(true));

  // Pool 2
  pool = new Pool({ creds, maxSize: 1, startingSize: 1 });
  await pool.init();
  const startPool2 = Date.now();
  queries = [];
  for (let i = 0; i < 20; i++) {
    queries.push(pool.execute("select * FROM SAMPLE.SYSCOLUMNS"));
  }
  results = await Promise.all(queries);

  const endPool2 = Date.now();

  pool.end();
  results.forEach((res) => expect(res.has_results).toBe(true));

  // Compare
  const multiJobPoolTime = endPool1 - startPool1;
  const singleJobPoolTime = endPool2 - startPool2;

  // Expect singlejob to be slower than multi job
  expect(singleJobPoolTime).toBeGreaterThan(multiJobPoolTime);
}, 30000);

test("Pop jobs returns free job", async () => {
  let pool = new Pool({ creds, maxSize: 5, startingSize: 5 });
  await pool.init();
  expect(pool.getActiveJobCount()).toBe(5);
  // Initiate a bunch of jobs
  const executedPromises = [
    pool.execute("select * FROM SAMPLE.SYSCOLUMNS"),
    pool.execute("select * FROM SAMPLE.SYSCOLUMNS"),
  ];
  const job = await pool.popJob();
  expect(job.getUniqueId()).toMatch(/sqljob/);
  expect(job.getStatus()).toBe(JobStatus.READY);
  expect(job.getRunningCount()).toBe(0);
  expect(pool.getActiveJobCount()).toBe(4);
  await Promise.all(executedPromises);
  await pool.end();
});

test("Pop job with pool ignore", async () => {
  let pool = new Pool({ creds, maxSize: 1, startingSize: 1 });
  await pool.init();
  expect(pool.getActiveJobCount()).toBe(1);
  const executedPromises = [pool.execute("select * FROM SAMPLE.SYSCOLUMNS")];
  // Since all the jobs are busy, expect that a new job should be created.
  // Since no job was removed from the pool, and none was added, pool size shouldn't
  // change
  const job = await pool.popJob();
  expect(job.getStatus()).toBe(JobStatus.READY);
  expect(pool.getActiveJobCount()).toBe(1);
  await Promise.all(executedPromises);
  await pool.end();
});

test("Pool with no space, no ready job doesn't increase pool size", async () => {
  let pool = new Pool({ creds, maxSize: 1, startingSize: 1 });
  await pool.init();
  const addJobSpy = vi.spyOn(pool as any, "addJob");
  expect(pool.getActiveJobCount()).toBe(1);
  // Initiate a bunch of jobs
  const executedPromises = [
    pool.execute("select * FROM SAMPLE.SYSCOLUMNS"),
    pool.execute("select * FROM SAMPLE.SYSCOLUMNS"),
    pool.execute("select * FROM SAMPLE.SYSCOLUMNS"),
  ];
  const job = pool.getJob();
  expect(job.getStatus()).toBe(JobStatus.BUSY);
  expect(job.getRunningCount()).toBe(3);
  await Promise.all(executedPromises);
  expect(addJobSpy).not.toHaveBeenCalled();
  expect(pool.getActiveJobCount()).toBe(1);
  await pool.end();
});

test("Pool with no space but ready job returns ready job", async () => {
  let pool = new Pool({ creds, maxSize: 2, startingSize: 2 });
  await pool.init();
  expect(pool.getActiveJobCount()).toBe(2);
  const addJobSpy = vi.spyOn(pool as any, "addJob");
  const executedPromise = [pool.execute("select * FROM SAMPLE.SYSCOLUMNS")];
  const job = pool.getJob();
  expect(job.getStatus()).toBe(JobStatus.READY);
  expect(job.getRunningCount()).toBe(0);
  await Promise.all(executedPromise);
  expect(addJobSpy).not.toHaveBeenCalled();
  await pool.end();
});

test("Pool with space but no ready job, adds job to pool", async () => {
  const pool = new Pool({ creds, maxSize: 2, startingSize: 1 });
  await pool.init();
  const addJobSpy = vi.spyOn(pool as any, "addJob");
  expect(pool.getActiveJobCount()).toBe(1);

  // Initiate a bunch of jobs
  const executedPromises = [
    pool.execute("select * FROM SAMPLE.SYSCOLUMNS"),
    pool.execute("select * FROM SAMPLE.SYSCOLUMNS"),
    pool.execute("select * FROM SAMPLE.SYSCOLUMNS"),
    pool.execute("select * FROM SAMPLE.SYSCOLUMNS"),
    pool.execute("select * FROM SAMPLE.SYSCOLUMNS"),
  ];
  const job = pool.getJob();
  expect(job.getStatus()).toBe(JobStatus.BUSY);
  expect(job.getRunningCount()).toBe(5);
  await Promise.all(executedPromises);

  expect(addJobSpy).toHaveBeenCalled();
  await pool.end();
});

test("Freeist job is returned", async () => {
  const pool = new Pool({ creds, maxSize: 3, startingSize: 3 });
  await pool.init();

  // Initiate a bunch of jobs
  const executedPromises = [
    pool.execute("select * FROM SAMPLE.SYSCOLUMNS"),
    pool.execute("select * FROM SAMPLE.SYSCOLUMNS"),
    pool.execute("select * FROM SAMPLE.SYSCOLUMNS"),
    pool.execute("select * FROM SAMPLE.SYSCOLUMNS"),
    pool.execute("select * FROM SAMPLE.SYSCOLUMNS"),
    pool.execute("select * FROM SAMPLE.SYSCOLUMNS"),
    pool.execute("select * FROM SAMPLE.SYSCOLUMNS"),
    pool.execute("select * FROM SAMPLE.SYSCOLUMNS"),
  ];
  const job = pool.getJob();
  expect(job.getStatus()).toBe(JobStatus.BUSY);
  expect(job.getRunningCount()).toBe(2);
  await Promise.all(executedPromises);
  await pool.end();
});
