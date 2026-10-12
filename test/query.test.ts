import { beforeAll, describe, expect, it, test, vi } from "vitest";
import { DaemonServer } from "../src/types";
import { SQLJob, getRootCertificate } from "../src";
import { Query } from "../src/query";
import { JobStatus } from "../src/states";
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

describe("Query.close() lifecycle and sqlclose dispatch", () => {
  it("sends sqlclose even when query is already in RUN_DONE state", async () => {
    const sentObjects: any[] = [];
    const mockJob = {
      send: vi.fn(async (obj: any) => {
        sentObjects.push(obj);
        return {
          id: "corr-123",
          success: true,
          is_done: true,
          data: [{ A: 1 }],
        };
      }),
      getStatus: vi.fn(() => JobStatus.READY),
    } as unknown as SQLJob;

    const query = new Query(mockJob, "SELECT 1 FROM SYSIBM.SYSDUMMY1");
    const result = await query.execute();
    expect(result.is_done).toBe(true);
    expect(query.getState()).toBe("RUN_DONE");

    await query.close();

    const closeObj = sentObjects.find((o) => o.type === "sqlclose");
    expect(closeObj).toBeDefined();
    expect(closeObj.cont_id).toBe("corr-123");
  });

  it("does not send duplicate sqlclose on multiple close calls", async () => {
    const sentObjects: any[] = [];
    const mockJob = {
      send: vi.fn(async (obj: any) => {
        sentObjects.push(obj);
        return {
          id: "corr-123",
          success: true,
          is_done: true,
          data: [{ A: 1 }],
        };
      }),
      getStatus: vi.fn(() => JobStatus.READY),
    } as unknown as SQLJob;

    const query = new Query(mockJob, "SELECT 1 FROM SYSIBM.SYSDUMMY1");
    await query.execute();

    await query.close();
    await query.close();

    const closeCalls = sentObjects.filter((o) => o.type === "sqlclose");
    expect(closeCalls.length).toBe(1);
  });

  it("does not send sqlclose for CL commands", async () => {
    const sentObjects: any[] = [];
    const mockJob = {
      send: vi.fn(async (obj: any) => {
        sentObjects.push(obj);
        return {
          id: "corr-123",
          success: true,
          is_done: true,
          data: [],
        };
      }),
      getStatus: vi.fn(() => JobStatus.READY),
    } as unknown as SQLJob;

    const query = new Query(mockJob, "DSPLIBL", { isClCommand: true });
    await query.execute();
    await query.close();

    const closeObj = sentObjects.find((o) => o.type === "sqlclose");
    expect(closeObj).toBeUndefined();
  });

  it("does not send sqlclose if query was never run (no correlationId)", async () => {
    const sentObjects: any[] = [];
    const mockJob = {
      send: vi.fn(async (obj: any) => {
        sentObjects.push(obj);
        return { success: true };
      }),
      getStatus: vi.fn(() => JobStatus.READY),
    } as unknown as SQLJob;

    const query = new Query(mockJob, "SELECT 1 FROM SYSIBM.SYSDUMMY1");
    await query.close();

    const closeObj = sentObjects.find((o) => o.type === "sqlclose");
    expect(closeObj).toBeUndefined();
  });

  it("does not send sqlclose if job status is ENDED", async () => {
    const sentObjects: any[] = [];
    const mockJob = {
      send: vi.fn(async (obj: any) => {
        sentObjects.push(obj);
        return {
          id: "corr-123",
          success: true,
          is_done: true,
          data: [{ A: 1 }],
        };
      }),
      getStatus: vi.fn(() => JobStatus.READY),
    } as unknown as SQLJob;

    const query = new Query(mockJob, "SELECT 1 FROM SYSIBM.SYSDUMMY1");
    await query.execute();

    (mockJob.getStatus as any).mockReturnValue(JobStatus.ENDED);
    await query.close();

    const closeObj = sentObjects.find((o) => o.type === "sqlclose");
    expect(closeObj).toBeUndefined();
  });

  it("retains correlationId on execute failure so close can clean it up", async () => {
    const sentObjects: any[] = [];
    const mockJob = {
      send: vi.fn(async (obj: any) => {
        sentObjects.push(obj);
        if (obj.type === "sql" || obj.type === "prepare_sql_execute") {
          return {
            id: "failed-corr-id",
            success: false,
            error: "Table not found",
            sql_state: "42704",
            sql_rc: -204,
          };
        }
        return { success: true };
      }),
      getStatus: vi.fn(() => JobStatus.READY),
    } as unknown as SQLJob;

    const query = new Query(mockJob, "SELECT * FROM NONEXISTENT");
    await expect(query.execute()).rejects.toThrow("Table not found");
    expect(query.getId()).toBe("failed-corr-id");

    await query.close();
    const closeObj = sentObjects.find((o) => o.type === "sqlclose");
    expect(closeObj).toBeDefined();
    expect(closeObj.cont_id).toBe("failed-corr-id");
  });

  it("SQLJob.execute() cleans up query even when execution fails", async () => {
    const job = new SQLJob();
    const sent: any[] = [];
    (job as any).send = vi.fn(async (obj: any) => {
      sent.push(obj);
      if (obj.type === "sql") {
        return {
          id: "job-exec-fail-id",
          success: false,
          error: "Syntax error",
          sql_state: "42000",
          sql_rc: -104,
        };
      }
      return { success: true };
    });
    (job as any).status = JobStatus.READY;

    await expect(job.execute("INVALID SQL")).rejects.toThrow("Syntax error");

    const closeObj = sent.find((o) => o.type === "sqlclose");
    expect(closeObj).toBeDefined();
    expect(closeObj.cont_id).toBe("job-exec-fail-id");
  });
});
