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
  await query.close();
  await job.close();
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
  await query.close();
  await job.close();

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
  await query.close();
  await job.close();

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
    throw new Error("Exception not hit");
  } catch (error) {
    expect(error.message).toContain("*FILE not found.");
  } finally {
    await query.close();
    await job.close();
  }
});

test("Run an SQL Query with Edge Case Inputs", async () => {
  const job = new SQLJob();
  await job.connect(creds);
  let query = await job.query<any>("");

  try {
    await query.execute(1);
    throw new Error("Exception not hit");
  } catch (error) {
    expect(error.message).toContain(
      "A string parameter value with zero length was detected."
    );
  }

  try {
    query = await job.query<string>(666);
    await query.execute(1);
    throw new Error("Exception not hit");
  } catch (error) {
    expect(error.message).toContain("Query must be of type string");
  }

  try {
    query = await job.query<any>("a");
    await query.execute(1);
    throw new Error("Exception not hit");
  } catch (error) {
    expect(error.message).toContain("Token A was not valid.");
  }

  try {
    query = await job.query<any>(
      "aeriogfj304tq34projqwe'fa;sdfaSER90Q243RSDASDAFQ#4dsa12$$$YSfaeriogfj304tq34projqwe'fa;sdfaSER90Q243RSDASDAFQ#4dsa12$$$YSfaeriogfj304tq34projqwe'fa;sdfaSER90Q243RSDASDAFQ#4dsa12$$$YSfaeriogfj304tq34projqwe'fa;sdfaSER90Q243RSDASDAFQ#4dsa12$$$YSfaeriogfj304tq34projqwe'fa;sdfaSER90Q243RSDASDAFQ#4dsa12$$$YSfaeriogfj304tq34projqwe'fa;sdfaSER90Q243RSDASDAFQ#4dsa12$$$YSfaeriogfj304tq34projqwe'fa;sdfaSER90Q243RSDASDAFQ#4dsa12$$$YSfaeriogfj304tq34projqwe'fa;sdfaSER90Q243RSDASDAFQ#4dsa12$$$YSfaeriogfj304tq34projqwe'fa;sdfaSER90Q243RSDASDAFQ#4dsa12$$$YSfaeriogfj304tq34projqwe'fa;sdfaSER90Q243RSDASDAFQ#4dsa12$$$YSfaeriogfj304tq34projqwe'fa;sdfaSER90Q243RSDASDAFQ#4dsa12$$$YSfaeriogfj304tq34projqwe'fa;sdfaSER90Q243RSDASDAFQ#4dsa12$$$YSfaeriogfj304tq34projqwe'fa;sdfaSER90Q243RSDASDAFQ#4dsa12$$$YSfaeriogfj304tq34projqwe'fa;sdfaSER90Q243RSDASDAFQ#4dsa12$$$YSfaeriogfj304tq34projqwe'fa;sdfaSER90Q243RSDASDAFQ#4dsa12$$$YSfaeriogfj304tq34projqwe'fa;sdfaSER90Q243RSDASDAFQ#4dsa12$$$YSfaeriogfj304tq34projqwe'fa;sdfaSER90Q243RSDASDAFQ#4dsa12$$$YSfaeriogfj304tq34projqwe'fa;sdfaSER90Q243RSDASDAFQ#4dsa12$$$YSfaeriogfj304tq34projqwe'fa;sdfaSER90Q243RSDASDAFQ#4dsa12$$$YSfaeriogfj304tq34projqwe'fa;sdfaSER90Q243RSDASDAFQ#4dsa12$$$YSfaeriogfj304tq34projqwe'fa;sdfaSER90Q243RSDASDAFQ#4dsa12$$$YSfaeriogfj304tq34projqwe'fa;sdfaSER90Q243RSDASDAFQ#4dsa12$$$YSfaeriogfj304tq34projqwe'fa;sdfaSER90Q243RSDASDAFQ#4dsa12$$$YSfaeriogfj304tq34projqwe'fa;sdfaSER90Q243RSDASDAFQ#4dsa12$$$YSfaeriogfj304tq34projqwe'fa;sdfaSER90Q243RSDASDAFQ#4dsa12$$$YSfaeriogfj304tq34projqwe'fa;sdfaSER90Q243RSDASDAFQ#4dsa12$$$YSfaeriogfj304tq34projqwe'fa;sdfaSER90Q243RSDASDAFQ#4dsa12$$$YSfaeriogfj304tq34projqwe'fa;sdfaSER90Q243RSDASDAFQ#4dsa12$$$YSfaeriogfj304tq34projqwe'fa;sdfaSER90Q243RSDASDAFQ#4dsa12$$$YSfaeriogfj304tq34projqwe'fa;sdfaSER90Q243RSDASDAFQ#4dsa12$$$YSfaeriogfj304tq34projqwe'fa;sdfaSER90Q243RSDASDAFQ#4dsa12$$$YSfaeriogfj304tq34projqwe'fa;sdfaSER90Q243RSDASDAFQ#4dsa12$$$YSfaeriogfj304tq34projqwe'fa;sdfaSER90Q243RSDASDAFQ#4dsa12$$$YSfaeriogfj304tq34projqwe'fa;sdfaSER90Q243RSDASDAFQ#4dsa12$$$YSfaeriogfj304tq34projqwe'fa;sdfaSER90Q243RSDASDAFQ#4dsa12$$$YSfaeriogfj304tq34projqwe'fa;sdfaSER90Q243RSDASDAFQ#4dsa12$$$YSf"
    );
    await query.execute(1);
    throw new Error("Exception not hit");
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
    throw new Error("Exception not hit");
  } catch (error) {
    expect(error.message).toEqual("rowsToFetch must be greater than 0");
  }

  try {
    query = await job.query<any>("select * from sample.department");
    await query.execute("s");
    throw new Error("Exception not hit");
  } catch (error) {
    expect(error.message).toEqual("rowsToFetch must be a number");
  }

  try {
    query = await job.query<any>("select * from sample.department");
    const res = await query.execute(-1);
    throw new Error("Exception not hit");
  } catch (error) {
    expect(error.message).toEqual("rowsToFetch must be greater than 0");
  }
  await query.close();
  await job.close();
});

test("Drop table", async () => {
  const job = new SQLJob();
  await job.connect(creds);
  const query = await job.query<any>("drop table sample.delete if exists");
  const res = await query.execute();
  expect(res.has_results).toEqual(false);
});

test("Fetch remaining", async () => {
  const job = new SQLJob();
  await job.connect(creds);
  const query = await job.query<any>("select * FROM SAMPLE.SYSCOLUMNS");
  let res = await query.execute();
  while (!res.is_done) {
    res = await query.fetchMore(300);
    expect(res.data.length).not.toBe(0);
  }
  await query.close();
  await job.close();
  expect(res.is_done).toEqual(true);
});

test(
  "Fetch remaining with prepared",
  async () => {
    const job = new SQLJob();
    await job.connect(creds);
    const query = await job.query<any>("select * FROM SAMPLE.SYSCOLUMNS", {
      parameters: [],
    });
    let res = await query.execute();
    while (!res.is_done) {
      res = await query.fetchMore(300);
      expect(res.data.length).not.toBe(0);
    }
    await query.close();
    await job.close();
    expect(res.is_done).toEqual(true);
  },
  { timeout: 999999 }
);

test("Prepared Statement", async () => {
  const job = new SQLJob();
  await job.connect(creds);
  const query = await job.query<any>(
    "select * FROM SAMPLE.SYSCOLUMNS WHERE COLUMN_NAME = ?",
    {
      parameters: ["LONG_COMMENT"],
    }
  );
  const res = await query.execute(10);
  await query.close();
  await job.close();
  expect(res.success).toBe(true);
  expect(res.data.length).toBeGreaterThan(0);
});

test("Prepare SQL Statement in Terse Format", async () => {
  const job = new SQLJob();
  await job.connect(creds);
  const query = await job.query<any>(
    "select * FROM SAMPLE.SYSCOLUMNS WHERE COLUMN_NAME = ?",
    {
      parameters: ["LONG_COMMENT"],
      isTerseResults: true,
    }
  );
  const res = await query.execute();
  await query.close();
  await job.close();

  expect(res.success).toBe(true);
  expect(res.metadata).toBeDefined();
});

test("Prepare an Invalid SQL Statement", async () => {
  const job = new SQLJob();
  await job.connect(creds);
  let error;
  try {
    const query = await job.query<any>("select * FROM MAPEPIRE.FAKETABLE", {
      parameters: [],
      isTerseResults: false,
    });
    await query.execute();
  } catch (err) {
    error = err;
  } finally {
    await job.close();
  }

  expect(error).toBeDefined();
  expect(error.message).toEqual(
    `[SQL0204] FAKETABLE in MAPEPIRE type *FILE not found., 42704, -204`
  );
});

test("Prepare SQL Statement with No Terse Option Provided", async () => {
  const job = new SQLJob();
  await job.connect(creds);
  const query = await job.query<any>(
    "SELECT * FROM SAMPLE.SYSCOLUMNS WHERE COLUMN_NAME = ?",
    {
      parameters: ["Value"],
    }
  );
  const res = await query.execute();
  await query.close();
  await job.close();

  expect(res.success).toBe(true);
  expect(res.metadata).toBeDefined();
});

test("Prepare an SQL Statement with multiple parameters", async () => {
  const job = new SQLJob();
  await job.connect(creds);
  const query = await job.query<any>(
    `SELECT * FROM SAMPLE.SYSCOLUMNS WHERE COLUMN_NAME IN (?, ?, ?)`,
    {
      isTerseResults: false,
      parameters: ["LONG_COMMENT", "?", "CONSTRAINT_NAME"],
    }
  );
  const res = await query.execute();
  await query.close();
  await job.close();

  expect(res.success).toBe(true);
  expect(res.metadata).toBeDefined();
});

test("Prepare SQL with Edge Case Inputs", async () => {
  const job = new SQLJob();
  await job.connect(creds);
  let error;
  let query;
  try {
    query = await job.query<any>("", {
      isTerseResults: false,
      parameters: [],
    });
    await query.execute();
  } catch (err) {
    error = err;
  }
  expect(error).toBeDefined();
  expect(error.message).toEqual(
    "A string parameter value with zero length was detected., 43617, -99999"
  );

  try {
    query = await job.query<any>(
      "SELECT * FROM SAMPLE.SYSCOLUMNS WHERE COLUMN_NAME = ?",
      {
        isTerseResults: false,
        parameters: 99,
      }
    );
    await query.execute();
  } catch (err) {
    error = err;
  }

  expect(error).toBeDefined();
  expect(error.message).toEqual("Not a JSON Array: 99");

  try {
    query = await job.query<any>(
      "SELECT * FROM SAMPLE.SYSCOLUMNS WHERE COLUMN_NAME = ?",
      {
        isTerseResults: false,
        parameters: [],
      }
    );
    await query.execute();
  } catch (err) {
    error = err;
  }

  expect(error).toBeDefined();
  expect(error.message).toEqual(
    "The number of parameter values set or registered does not match the number of parameters., 07001, -99999"
  );

  try {
    const query = await job.query<any>(
      "SELECT * FROM SAMPLE.SYSCOLUMNS WHERE COLUMN_NAME = ?",
      {
        isTerseResults: false,
        parameters: [1, "a"],
      }
    );
    await query.execute();
  } catch (err) {
    error = err;
  }

  expect(error).toBeDefined();
  expect(error.message).toEqual(
    "Descriptor index not valid. (2>1), 07009, -99999"
  );

  try {
    const query = await job.query<any>(
      "SELECT * FROM SAMPLE.SYSCOLUMNS WHERE COLUMN_NAME = ?",
      {
        isTerseResults: false,
        parameters: [{ name: "asdf" }],
      }
    );
    await query.execute();
  } catch (err) {
    error = err;
  }

  expect(error).toBeDefined();
  expect(error.message).toEqual("JsonObject");

  try {
    const query = await job.query<any>(
      "SELECT * FROM SAMPLE.SYSCOLUMNS WHERE COLUMN_NAME = ?",
      {
        isTerseResults: false,
        parameters: [[]],
      }
    );
    await query.execute();
  } catch (err) {
    error = err;
  }

  await query.close();
  await job.close();

  expect(error).toBeDefined();
  expect(error.message).toEqual("Internal Error: IllegalStateException");
});

test("Execute directly from sql job", async () => {
  const job = new SQLJob();
  await job.connect(creds);
  const res = await job.execute<any>("select * from sample.department");
  await job.close();
  expect(res.data.length).toBeGreaterThanOrEqual(13);
  expect(res.success).toBe(true);
  expect(res.is_done).toBe(true);
  expect(res.has_results).toBe(true);
  expect(res.update_count).toBe(-1);
});

test(`Multiple statements, one job`, async () => {
  const job = new SQLJob();
  await job.connect(creds);

  const resultA = await job
    .query<any[]>(`select * from sample.department`)
    .execute();
  expect(resultA.is_done).toBe(true);

  const resultB = await job
    .query<any[]>(`select * from sample.employee`)
    .execute();
  expect(resultB.is_done).toBe(true);

  await job.close();
});

test(`Multiple statements parallel, one job`, async () => {
  const job = new SQLJob();
  await job.connect(creds);

  const results = await Promise.all([
    job.query<any[]>(`select * from sample.department`).execute(),
    job.query<any[]>(`select * from sample.employee`).execute(),
  ]);

  expect(results[0].is_done).toBe(true);
  expect(results[1].is_done).toBe(true);

  await job.close();
});