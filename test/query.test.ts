import { beforeAll, expect, test } from "vitest";
import { DaemonServer } from "../src/types";
import { SQLJob, getRootCertificate } from "../src";
import { Query } from "../src/query";
import { ENV_CREDS } from "./env";

let creds: DaemonServer = { ...ENV_CREDS };

beforeAll(async () => {
  creds.ca = await getRootCertificate(creds);
});

/**
 * Reads the private static `Query.globalQueryList`.
 *
 * The cast to `any` is intentional: these are white-box tests that verify the
 * internal retention behaviour of `Query`, so we deliberately reach past the
 * `private static` access modifier to observe the raw list contents. This is
 * required because `Query.getOpenIds()` filters to open states
 * ("NOT_YET_RUN" / "RUN_MORE_DATA_AVAILABLE") and therefore would not reveal
 * whether closed ("RUN_DONE") queries linger in the raw list.
 */
function getGlobalQueryList(): Query<any>[] {
  return (Query as any).globalQueryList as Query<any>[];
}

const QUERY_COUNT = 50;

test("close() removes the query from globalQueryList", { timeout: 60000 }, async () => {
  // Clean slate so counts below are attributable to this test only.
  await Query.cleanup();

  const job = new SQLJob();
  await job.connect(creds);

  const startLen = getGlobalQueryList().length;

  const created: Query<any>[] = [];
  for (let i = 0; i < QUERY_COUNT; i++) {
    const query = job.query<any>("values (1)");
    created.push(query);
    await query.execute();
    await query.close();
  }

  const list = getGlobalQueryList();

  // close() now self-removes each query from the global list, so the list is
  // not permanently grown by running-and-closing queries. This prevents the
  // unbounded leak where every query ever run (and its SQLJob + socket) was
  // retained for the lifetime of the process.
  expect(list.length).toBe(startLen);
  for (const q of created) {
    expect(list).not.toContain(q);
    expect(q.getState()).toBe("RUN_DONE");
  }

  // getOpenIds filters to open states; after closing everything there are no
  // open queries for this job.
  expect(Query.getOpenIds(job).length).toBe(0);

  await job.close();
});

test("cleanup() still releases any remaining completed queries", { timeout: 60000 }, async () => {
  await Query.cleanup();

  const job = new SQLJob();
  await job.connect(creds);

  for (let i = 0; i < QUERY_COUNT; i++) {
    const query = job.query<any>("values (1)");
    await query.execute();
    await query.close();
  }

  await Query.cleanup();

  const remaining = getGlobalQueryList();
  expect(remaining.every((q) => q.getState() !== "RUN_DONE")).toBe(true);
  expect(Query.getOpenIds(job).length).toBe(0);

  await job.close();
});

test("closed queries no longer retain their SQLJob via the global list", async () => {
  await Query.cleanup();

  const job = new SQLJob();
  await job.connect(creds);

  const query = job.query<any>("values (1)");
  await query.execute();
  await query.close();
  await job.close();

  // The query is gone from the global list once closed, so it no longer keeps
  // the (now closed) SQLJob and that job's WebSocket alive.
  const list = getGlobalQueryList();
  expect(list).not.toContain(query);

  await Query.cleanup();
});

test("close() removes an unfinished query from globalQueryList", async () => {
  await Query.cleanup();
  const job = new SQLJob();
  await job.connect(creds);

  // Multi-row result, fetch only 1 → server can't know it's exhausted →
  // is_done false → state stays RUN_MORE_DATA_AVAILABLE
  const query = job.query<any>("select * from qsys2.systables");
  const result = await query.execute(1);
  expect(result.is_done).toBe(false);
  // The query is still registered in the global list while it's open
  expect(getGlobalQueryList()).toContain(query);

  await query.close();
  // close() self-removes the query from the global list, so it no longer retains
  expect(getGlobalQueryList()).not.toContain(query);

  await job.close();
});

test("a failed query is removed from globalQueryList", async () => {
  await Query.cleanup();
  const job = new SQLJob();
  await job.connect(creds);

  const query = job.query<any>("select * from qsys2.thistabledoesnotexist");
  await expect(query.execute()).rejects.toThrow();
  expect(query.getState()).toBe("ERROR");
  expect(getGlobalQueryList()).not.toContain(query);

  await job.close();
});
