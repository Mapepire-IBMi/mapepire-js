import { beforeAll, expect, test } from "vitest";
import { DaemonServer } from "../src/types";
import { SQLJob } from "../src";
import { getRootCertificate } from "../src/tls";
import { ENV_CREDS } from "./env";

let creds: DaemonServer = { ...ENV_CREDS };

beforeAll(async () => {
  creds.ca = await getRootCertificate(creds);
});

test("Run CL Command Successfully", async () => {
  const job = new SQLJob();
  await job.connect(creds);
  const query = await job.clcommand("WRKACTJOB");
  const res = await query.execute();
  await job.close();
  expect(res.data.length).toBeGreaterThanOrEqual(1);
  expect(res.success).toBe(true);
});

test("Invalid CL command", async () => {
  const job = new SQLJob();
  await job.connect(creds);
  const query = await job.clcommand("INVALIDCOMMAND");
  const res = await query.execute();
  await job.close();
  expect(res.data.length).toBeGreaterThanOrEqual(1);
  expect(res.success).toBe(false);
  expect(res.error).toContain("[CPF0006] Errors occurred in command.");
  expect(res.id).toBeDefined();
  expect(res.is_done).toBe(true);
  expect(res.sql_rc).toEqual(-443);
  expect(res.sql_state).toEqual("38501");
});

test("Get valid CL command documentation", async () => {
  const job = new SQLJob();
  await job.connect(creds);
  const res = await job.getClDoc("/QSYS.LIB/CRTLIB.CMD");
  await job.close();
  expect(res.success).toBe(true);
  expect(res.html.includes("<title>Create Library  (CRTLIB)</title>")).toBeTruthy();
  expect(res.uim.includes("Help for command CRTLIB")).toBeTruthy();
});

test("Get invalid CL command documentation", async () => {
  const job = new SQLJob();
  await job.connect(creds);
  await expect(job.getClDoc("/QSYS.LIB/INVALID.CMD")).rejects.toThrow("CPF9801 Object INVALID in library QSYS not found.");
  await job.close();
});
