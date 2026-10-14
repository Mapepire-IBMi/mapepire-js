import { beforeAll, expect, test } from "vitest";
import { SQLJob } from "../src";
import { getRootCertificate } from "../src/tls";
import { DaemonServer } from "../src/types";
import { ENV_CREDS } from "./env";

let creds: DaemonServer = { ...ENV_CREDS };

beforeAll(async () => {
  creds.ca = await getRootCertificate(creds);
});

test("Run CL Command Successfully", async () => {
  const job = new SQLJob();
  await job.connect(creds);
  const result = await job.clcommand("WRKACTJOB");
  await job.close();
  expect(result.successful).toBe(true);
  expect(result.messages).toBeDefined();
  expect(result.messages.length).toBe(0);
});

test("Invalid CL command", async () => {
  const job = new SQLJob();
  await job.connect(creds);
  const result = await job.clcommand("INVALIDCOMMAND");
  await job.close();
  expect(result.messages.length).toBeGreaterThanOrEqual(1);
  expect(result.successful).toBe(false);
  expect(result.messages.some(m => m.id === 'CPD0033')).toBeDefined();
  expect(result.messages.some(m => m.id === 'CPF0006')).toBeDefined();
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
