import { beforeAll, expect, test, vi } from "vitest";
import { Pool } from "../src/pool";
import { ENV_CREDS } from "./env";
import { SQLJob, getCertificate } from "../src";
import { DaemonServer, JobStatus, QueryResult } from "../src/types";

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
  const startPool1 = Date.now();
  let pool = new Pool({ creds, maxSize: 5, startingSize: 5 });
  await pool.init();
  let queries = [];

  for (let i = 0; i < 20; i++) {
    queries.push(pool.execute("select * FROM SAMPLE.SYSCOLUMNS"));
  }

  let results: QueryResult<any>[] = await Promise.all(queries);
  const endPool1 = Date.now();
  await pool.end();
  results.forEach((res) => expect(res.has_results).toBe(true));

  const startPool2 = Date.now();
  pool = new Pool({ creds, maxSize: 1, startingSize: 1 });
  await pool.init();
  queries = [];

  for (let i = 0; i < 20; i++) {
    queries.push(pool.execute("select * FROM SAMPLE.SYSCOLUMNS"));
  }

  results = await Promise.all(queries);
  const endPool2 = Date.now();
  await pool.end();
  results.forEach((res) => expect(res.has_results).toBe(true));

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

test("Pop jobs returns free job", async () => {
  let pool = new Pool({ creds, maxSize: 5, startingSize: 5 });
  await pool.init();
  expect(pool.getActiveJobCount()).toBe(5);
  const res = await Promise.all([
    pool.execute("select * FROM SAMPLE.SYSCOLUMNS"),
    pool.execute("select * FROM SAMPLE.SYSCOLUMNS"),
    pool.popJob(),
  ]);
  const job = res[2] as SQLJob;
  expect(job.getUniqueId()).toMatch(/sqljob/);
  expect(pool.getActiveJobCount()).toBe(4);
  await pool.end();
});

test("Pop job with pool ignore", async () => {
  let pool = new Pool({ creds, maxSize: 1, startingSize: 1 });
  await pool.init();
  expect(pool.getActiveJobCount()).toBe(1);
  const res = await Promise.all([
    pool.execute("select * FROM SAMPLE.SYSCOLUMNS"),
    pool.popJob(),
  ]);
  // Since all the jobs are busy, expect that a new job should be created.
  // Since no job was removed from the pool, and none was added, pool size shouldn't
  // change
  const job: SQLJob = res[1];
  expect(job.getStatus()).toBe(JobStatus.Ready);
  expect(pool.getActiveJobCount()).toBe(1);
  await pool.end();
});

test("Pool with no space, no ready job doesn't increase pool size", async () => {
  let pool = new Pool({ creds, maxSize: 1, startingSize: 1 });
  await pool.init();
  const addJobSpy = vi.spyOn(pool as any, "addJob");
  expect(pool.getActiveJobCount()).toBe(1);
  await Promise.all([
    pool.execute("select * FROM SAMPLE.SYSCOLUMNS"),
    pool.execute("select * FROM SAMPLE.SYSCOLUMNS"),
    pool.execute("select * FROM SAMPLE.SYSCOLUMNS"),
  ]);
  expect(addJobSpy).not.toHaveBeenCalled();
  expect(pool.getActiveJobCount()).toBe(1);
  await pool.end();
});

test("Pool with no space but ready job returns ready job", async () => {
  let pool = new Pool({ creds, maxSize: 2, startingSize: 2 });
  await pool.init();
  expect(pool.getActiveJobCount()).toBe(2);
  const addJobSpy = vi.spyOn(pool as any, "addJob");
  const res = await Promise.all([
    pool.execute("select * FROM SAMPLE.SYSCOLUMNS"),
    pool.getJob(),
  ]);
  const job: SQLJob = res[1];
  expect(job.getStatus()).toBe(JobStatus.Ready);
  expect(addJobSpy).not.toHaveBeenCalled();
  await pool.end();
});

test("Pool with space but no ready job, adds job to pool", async () => {
  const pool = new Pool({ creds, maxSize: 2, startingSize: 1 });
  await pool.init();
  const addJobSpy = vi.spyOn(pool as any, "addJob");
  expect(pool.getActiveJobCount()).toBe(1);
  await Promise.all([
    pool.execute("select * FROM SAMPLE.SYSCOLUMNS"),
    pool.execute("select * FROM SAMPLE.SYSCOLUMNS"),
    pool.execute("select * FROM SAMPLE.SYSCOLUMNS"),
    pool.execute("select * FROM SAMPLE.SYSCOLUMNS"),
    pool.execute("select * FROM SAMPLE.SYSCOLUMNS"),
    pool.getJob(),
  ]);
  expect(addJobSpy).toHaveBeenCalled();
  await pool.end();
});
