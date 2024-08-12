import { beforeAll, expect, test } from "vitest";
import { DaemonServer } from "../src/types";
import { SQLJob } from "../src";
import { getCertificate } from "../src/tls";
import { ENV_CREDS } from "./env";

let creds: DaemonServer = { ...ENV_CREDS };
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

test("Simple SQL query", async () => {
  const job = new SQLJob();
  await job.connect(creds);
  const query = await job.query<any>("select * from sample.department");
  const res = await query.execute();
  query.close();
  job.close();
  expect(res.data.length).toBeGreaterThanOrEqual(13);
  expect(res.success).toBe(true);
  expect(res.is_done).toBe(true);
  expect(res.has_results).toBe(true);
  expect(res.update_count).toBe(-1);
});

test("Run an SQL Query with Large Dataset", async () => {
  const job = new SQLJob();
  await job.connect(creds);
  const query = await job.query<any>("SELECT * FROM SAMPLE.SYSCOLUMNS", {
    isTerseResults: false,
  });
  const res = await query.execute(50);
  query.close();
  job.close();

  expect(res.data.length).toEqual(50);
  expect(res.is_done).toBe(false); // Expecting more rows available
  expect(res.success).toBe(true);
  expect(res.metadata).toBeDefined(); // Metadata should be present
});

test("Run an SQL Query in Terse Format", async () => {
  const job = new SQLJob();
  await job.connect(creds);
  const query = await job.query<any>("SELECT * FROM SAMPLE.SYSCOLUMNS", {
    isTerseResults: true,
  });
  const res = await query.execute(5);
  query.close();
  job.close();

  expect(res.data.length).toEqual(5);
  expect(res.is_done).toBe(false);
  expect(res.success).toBe(true);
  expect(res.metadata).toBeDefined();
});

test("Run an Invalid SQL Query", async () => {
  const job = new SQLJob();
  await job.connect(creds);
  const query = await job.query<any>("SELECT * FROM NON_EXISTENT_TABLE");

  try {
    await query.execute(10);
  } catch (error) {
    expect(error.message).toContain("*FILE not found.");
  } finally {
    query.close();
    job.close();
  }
});

test("Run an SQL Query with Edge Case Inputs", async () => {
  const job = new SQLJob();
  await job.connect(creds);
  let query = await job.query<any>("");

  try {
    await query.execute(1);
  } catch (error) {
    expect(error.message).toContain(
      "A string parameter value with zero length was detected."
    );
  }

  try {
    query = await job.query<string>(666);
    await query.execute(1);
  } catch (error) {
    expect(error.message).toContain("Query must be of type string");
  }

  try {
    query = await job.query<any>("a");
    await query.execute(1);
  } catch (error) {
    expect(error.message).toContain("Token A was not valid.");
  }

  try {
    query = await job.query<any>(
      "aeriogfj304tq34projqwe'fa;sdfaSER90Q243RSDASDAFQ#4dsa12$$$YSfaeriogfj304tq34projqwe'fa;sdfaSER90Q243RSDASDAFQ#4dsa12$$$YSfaeriogfj304tq34projqwe'fa;sdfaSER90Q243RSDASDAFQ#4dsa12$$$YSfaeriogfj304tq34projqwe'fa;sdfaSER90Q243RSDASDAFQ#4dsa12$$$YSfaeriogfj304tq34projqwe'fa;sdfaSER90Q243RSDASDAFQ#4dsa12$$$YSfaeriogfj304tq34projqwe'fa;sdfaSER90Q243RSDASDAFQ#4dsa12$$$YSfaeriogfj304tq34projqwe'fa;sdfaSER90Q243RSDASDAFQ#4dsa12$$$YSfaeriogfj304tq34projqwe'fa;sdfaSER90Q243RSDASDAFQ#4dsa12$$$YSfaeriogfj304tq34projqwe'fa;sdfaSER90Q243RSDASDAFQ#4dsa12$$$YSfaeriogfj304tq34projqwe'fa;sdfaSER90Q243RSDASDAFQ#4dsa12$$$YSfaeriogfj304tq34projqwe'fa;sdfaSER90Q243RSDASDAFQ#4dsa12$$$YSfaeriogfj304tq34projqwe'fa;sdfaSER90Q243RSDASDAFQ#4dsa12$$$YSfaeriogfj304tq34projqwe'fa;sdfaSER90Q243RSDASDAFQ#4dsa12$$$YSfaeriogfj304tq34projqwe'fa;sdfaSER90Q243RSDASDAFQ#4dsa12$$$YSfaeriogfj304tq34projqwe'fa;sdfaSER90Q243RSDASDAFQ#4dsa12$$$YSfaeriogfj304tq34projqwe'fa;sdfaSER90Q243RSDASDAFQ#4dsa12$$$YSfaeriogfj304tq34projqwe'fa;sdfaSER90Q243RSDASDAFQ#4dsa12$$$YSfaeriogfj304tq34projqwe'fa;sdfaSER90Q243RSDASDAFQ#4dsa12$$$YSfaeriogfj304tq34projqwe'fa;sdfaSER90Q243RSDASDAFQ#4dsa12$$$YSfaeriogfj304tq34projqwe'fa;sdfaSER90Q243RSDASDAFQ#4dsa12$$$YSfaeriogfj304tq34projqwe'fa;sdfaSER90Q243RSDASDAFQ#4dsa12$$$YSfaeriogfj304tq34projqwe'fa;sdfaSER90Q243RSDASDAFQ#4dsa12$$$YSfaeriogfj304tq34projqwe'fa;sdfaSER90Q243RSDASDAFQ#4dsa12$$$YSfaeriogfj304tq34projqwe'fa;sdfaSER90Q243RSDASDAFQ#4dsa12$$$YSfaeriogfj304tq34projqwe'fa;sdfaSER90Q243RSDASDAFQ#4dsa12$$$YSfaeriogfj304tq34projqwe'fa;sdfaSER90Q243RSDASDAFQ#4dsa12$$$YSfaeriogfj304tq34projqwe'fa;sdfaSER90Q243RSDASDAFQ#4dsa12$$$YSfaeriogfj304tq34projqwe'fa;sdfaSER90Q243RSDASDAFQ#4dsa12$$$YSfaeriogfj304tq34projqwe'fa;sdfaSER90Q243RSDASDAFQ#4dsa12$$$YSfaeriogfj304tq34projqwe'fa;sdfaSER90Q243RSDASDAFQ#4dsa12$$$YSfaeriogfj304tq34projqwe'fa;sdfaSER90Q243RSDASDAFQ#4dsa12$$$YSfaeriogfj304tq34projqwe'fa;sdfaSER90Q243RSDASDAFQ#4dsa12$$$YSfaeriogfj304tq34projqwe'fa;sdfaSER90Q243RSDASDAFQ#4dsa12$$$YSfaeriogfj304tq34projqwe'fa;sdfaSER90Q243RSDASDAFQ#4dsa12$$$YSfaeriogfj304tq34projqwe'fa;sdfaSER90Q243RSDASDAFQ#4dsa12$$$YSfaeriogfj304tq34projqwe'fa;sdfaSER90Q243RSDASDAFQ#4dsa12$$$YSf"
    );
    await query.execute(1);
  } catch (error) {
    expect(error.message).toContain(
      "Token AERIOGFJ304TQ34PROJQWE was not valid."
    );
  }

  try {
    query = await job.query<any>(
      "SELECT * FROM (SELECT * FROM SAMPLE.SYSCOLUMNS)"
    );
    await query.execute(0);
  } catch (error) {
    expect(error.message).toEqual("rowsToFetch must be greater than 0");
  }

  try {
    query = await job.query<any>("select * from sample.department");
    await query.execute("s");
  } catch (error) {
    expect(error.message).toEqual("rowsToFetch must be a number");
  }

  try {
    query = await job.query<any>("select * from sample.department");
    const res = await query.execute(-1);
  } catch (error) {
    expect(error.message).toEqual("rowsToFetch must be greater than 0");
  }
  query.close();
  job.close();
});
