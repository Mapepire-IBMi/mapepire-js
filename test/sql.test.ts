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
  expect(res.data.length).toEqual(13);
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
