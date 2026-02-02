import { beforeAll, expect, test } from "vitest";
import { DaemonServer, JDBCOptions } from "../src/types";
import { SQLJob } from "../src";
import { getRootCertificate } from "../src/tls";
import { ENV_CREDS } from "./env";
import { ExplainType } from "../src/states";

let creds: DaemonServer = { ...ENV_CREDS };

beforeAll(async () => {
  creds.ca = await getRootCertificate(creds);
});

test("Explain with run", async () => {
  const job = new SQLJob();
  await job.connect(creds);
  const explain = await job.explain("select * from sample.department", ExplainType.RUN);
  await job.close();
  expect(explain.vedata.length).toBeGreaterThanOrEqual(1);
  expect(explain.success).toBe(true);
});

test("Explain with do not run", async () => {
  const job = new SQLJob();
  await job.connect(creds);
  const explain = await job.explain("select * from sample.department", ExplainType.DO_NOT_RUN);
  await job.close();
  expect(explain.vedata.length).toBeGreaterThanOrEqual(1);
  expect(explain.success).toBe(true);
});

test("Explain with translate binary", async () => {
  const options: JDBCOptions = {
    "naming": "system",
    "full open": false,
    "transaction isolation": "none",
    "query optimize goal": "1",
    "block size": "512",
    "date format": "iso",
    "extended metadata": true,
    "translate binary": true
  };
  const job = new SQLJob(options);
  await job.connect(creds);
  const explain = await job.explain("select * from sample.department", ExplainType.DO_NOT_RUN);
  await job.close();
  expect(explain.vedata.length).toBeGreaterThanOrEqual(1);
  expect(explain.success).toBe(true);
});