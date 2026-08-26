import 'dotenv/config';
import { beforeAll, afterAll, describe, expect, test, vi } from "vitest";
import { Pool } from "../src/pool";
import { ENV_CREDS } from "./env";
import { SQLJob, getRootCertificate } from "../src";
import { DaemonServer, QueryResult } from "../src/types";
import { JobStatus } from "../src/states";
import { connectSSH2, createSSH2PoolConfig } from '../src/transports/ssh2Helper';
import { connectNodeSSH, createNodeSSHPoolConfig } from '../src/transports/nodeSSHHelper';
import type { Client } from 'ssh2';
import type { NodeSSH } from 'node-ssh';

let creds: DaemonServer = { ...ENV_CREDS };

beforeAll(async () => {
  creds.ca = await getRootCertificate(creds);
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

test("Pool is faster than single job", async () => {
  let pool = new Pool({ creds, maxSize: 5, startingSize: 5 });

  // Pool 1
  await pool.init();
  const startPool = performance.now();

  let queries = [];
  for (let i = 0; i < 20; i++) {
    queries.push(pool.execute("select * FROM SAMPLE.SYSCOLUMNS"));
  }
  let results: QueryResult<any>[] = await Promise.all(queries);

  const endPool = performance.now();

  pool.end();

  results.forEach((res) => expect(res.has_results).toBe(true));

  // SQL job
  const sqlJob = new SQLJob();
  await sqlJob.connect(creds);
  const startJob = performance.now();
  queries = [];
  for (let i = 0; i < 20; i++) {
    queries.push(sqlJob.execute("select * FROM SAMPLE.SYSCOLUMNS"));
  }
  results = await Promise.all(queries);

  const endJob = performance.now();

  sqlJob.close();

  results.forEach((res) => expect(res.has_results).toBe(true));

  // Compare
  const multiJobPoolTime = endPool - startPool;
  const singleJobTime = endJob - startJob;

  // Expect single job to be slower than multi job pool
  expect(singleJobTime).toBeGreaterThan(multiJobPoolTime);
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

// ---------------------------------------------------------------------------
// Pool + SSH Single (live IBM i) — skipped when IBMI_HOST/USER/PASSWORD absent
// ---------------------------------------------------------------------------

const IBMI_HOST     = process.env.IBMI_HOST;
const IBMI_USER     = process.env.IBMI_USER;
const IBMI_PASSWORD = process.env.IBMI_PASSWORD;
const IBMI_PORT     = process.env.IBMI_SSH_PORT ? Number(process.env.IBMI_SSH_PORT) : 22;
const haveSSH       = Boolean(IBMI_HOST && IBMI_USER && IBMI_PASSWORD);

describe.skipIf(!haveSSH)(`Pool + ssh-single (ssh2)`, () => {
  let client: Client;

  beforeAll(async () => {
    client = await connectSSH2({
      host: IBMI_HOST!,
      username: IBMI_USER!,
      password: IBMI_PASSWORD!,
      port: IBMI_PORT,
    });
  }, 30000);

  afterAll(() => { client?.end(); });

  test(`SSH pool init pre-warms all jobs`, async () => {
    const pool = new Pool({ config: createSSH2PoolConfig(client), maxSize: 3, startingSize: 3 });
    await pool.init();
    expect(pool.getActiveJobCount()).toBe(3);
    await pool.end();
  }, 60000);

  test(`SSH pool parallel execute returns results from distinct IBM i jobs`, async () => {
    const pool = new Pool({ config: createSSH2PoolConfig(client), maxSize: 3, startingSize: 3 });
    await pool.init();

    const results = await Promise.all([
      pool.execute<any>(`values (job_name)`),
      pool.execute<any>(`values (job_name)`),
      pool.execute<any>(`values (job_name)`),
    ]);
    const jobNames = results.map(r => r.data[0]['00001']);
    console.log('SSH Single pool job names:', jobNames);
    expect(new Set(jobNames).size).toBeGreaterThanOrEqual(2);

    await pool.end();
  }, 60000);

  test(`SSH pool 10 parallel queries all succeed`, async () => {
    const pool = new Pool({ config: createSSH2PoolConfig(client), maxSize: 5, startingSize: 5 });
    await pool.init();

    const queries: Promise<QueryResult<any>>[] = [];
    for (let i = 0; i < 10; i++) {
      queries.push(pool.execute(`select * from QIWS.QCUSTCDT`));
    }
    const results = await Promise.all(queries);
    results.forEach(r => expect(r.has_results).toBe(true));

    await pool.end();
  }, 120000);

  test(`SSH pool is faster than single ssh job for parallel queries`, async () => {
    const pool = new Pool({ config: createSSH2PoolConfig(client), maxSize: 5, startingSize: 5 });
    await pool.init();

    const startPool = Date.now();
    const poolQueries: Promise<QueryResult<any>>[] = [];
    for (let i = 0; i < 10; i++) {
      poolQueries.push(pool.execute(`select * from QIWS.QCUSTCDT`));
    }
    await Promise.all(poolQueries);
    const poolTime = Date.now() - startPool;
    await pool.end();

    const singleJob = await SQLJob.ssh2({
      host: IBMI_HOST!, username: IBMI_USER!, password: IBMI_PASSWORD!, port: IBMI_PORT,
    });
    await singleJob.connect();
    const startSingle = Date.now();
    const singleQueries: Promise<QueryResult<any>>[] = [];
    for (let i = 0; i < 10; i++) {
      singleQueries.push(singleJob.execute(`select * from QIWS.QCUSTCDT`));
    }
    await Promise.all(singleQueries);
    const singleTime = Date.now() - startSingle;
    await singleJob.close();

    console.log(`Pool: ${poolTime}ms  Single: ${singleTime}ms`);
    expect(poolTime).toBeLessThan(singleTime);
  }, 180000);

  test(`SSH pool tagged template sql works`, async () => {
    const pool = new Pool({ config: createSSH2PoolConfig(client), maxSize: 2, startingSize: 2 });
    await pool.init();

    const minBal = 1000;
    const result = await pool.sql`select CUSNUM from QIWS.QCUSTCDT where BALDUE > ${minBal}`;
    expect(result.has_results).toBe(true);

    await pool.end();
  }, 60000);

  test(`SSH pool popJob returns a ready job`, async () => {
    const pool = new Pool({ config: createSSH2PoolConfig(client), maxSize: 3, startingSize: 3 });
    await pool.init();

    const job = await pool.popJob();
    expect(job.getStatus()).toBe(JobStatus.READY);
    expect(pool.getActiveJobCount()).toBe(2);

    await job.close();
    await pool.end();
  }, 60000);
});

describe.skipIf(!haveSSH)(`Pool + ssh-single (node-ssh)`, () => {
  let ssh: NodeSSH;

  beforeAll(async () => {
    ssh = await connectNodeSSH({
      host: IBMI_HOST!,
      username: IBMI_USER!,
      password: IBMI_PASSWORD!,
      port: IBMI_PORT,
    });
  }, 30000);

  afterAll(() => { ssh?.dispose(); });

  test(`nodeSSH pool init and parallel execute`, async () => {
    const pool = new Pool({ config: createNodeSSHPoolConfig(ssh), maxSize: 3, startingSize: 3 });
    await pool.init();
    expect(pool.getActiveJobCount()).toBe(3);

    const results = await Promise.all([
      pool.execute<any>(`values (job_name)`),
      pool.execute<any>(`values (job_name)`),
      pool.execute<any>(`values (job_name)`),
    ]);
    results.forEach(r => expect(r.data.length).toBeGreaterThan(0));

    await pool.end();
  }, 60000);
});

