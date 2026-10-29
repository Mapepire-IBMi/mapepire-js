import { beforeAll, expect, test } from "vitest";
import { SQLJob } from "../src";
import { getRootCertificate } from "../src/tls";
import { CLCommandResult, DaemonServer, SqlCLCommandResult } from "../src/types";
import { ENV_CREDS } from "./env";

let creds: DaemonServer = { ...ENV_CREDS };

beforeAll(async () => {
  creds.ca = await getRootCertificate(creds);
});

test("Run CL Command Successfully", async () => {
  const job = new SQLJob();
  await job.connect(creds);
  const resultCL = await job.rcclcommand("CHKOBJ OBJ(QSYS) OBJTYPE(*LIB)");
  const resultSQL = await job.clcommand("CHKOBJ OBJ(QSYS) OBJTYPE(*LIB)");
  await job.close();
  const checkResults = (result: CLCommandResult) => {
    expect(result.success).toBe(true);
    expect(result.data).toBeDefined();
    expect(result.data.length).toBe(0);
  }
  checkResults(resultCL);
  checkResults(resultSQL);
});

test("Invalid CL command", async () => {
  const job = new SQLJob();
  await job.connect(creds);
  const resultCL = await job.rcclcommand("SNDMSG");
  const resultSQL = await job.clcommand("SNDMSG");
  await job.close();
  const checkResults = (result: CLCommandResult | SqlCLCommandResult) => {
    expect(result.data.length).toBeGreaterThanOrEqual(2);
    expect(result.success).toBe(false);
    expect(result.data.some(m => m.id === 'CPD0033')).toBeDefined();
    expect(result.data.some(m => m.id === 'CPF0001')).toBeDefined();
  }
  checkResults(resultCL);

  checkResults(resultSQL);
  expect(resultSQL.sql_rc).toBe(-443);
  expect(resultSQL.sql_state).toBe("38501");
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

test("Get valid CL command definition XML", async () => {
  const job = new SQLJob();
  await job.connect(creds);
  const res = await job.getCmdXml("/QSYS.LIB/CRTLIB.CMD");
  await job.close();
  expect(res.success).toBe(true);
  expect(res.xml.includes("QcdCLCmd")).toBeTruthy();
});

test("Get invalid CL command definition XML", async () => {
  const job = new SQLJob();
  await job.connect(creds);
  await expect(job.getCmdXml("/QSYS.LIB/INVALID.CMD")).rejects.toThrow("CPF9801 Object INVALID in library QSYS not found.");
  await job.close();
});
