import { beforeAll, expect, test } from "vitest";
import { DaemonServer } from "../src/types";
import { SQLJob } from "../src";
import { getCertificate } from "../src/tls";
import { ENV_CREDS } from "./env";

let creds: DaemonServer = { ...ENV_CREDS };

const TEST_SCHEMA = `mapepire_test`;

beforeAll(async () => {
  const ca = await getCertificate(creds);
  creds.ca = ca.raw;

  const job = new SQLJob();
  await job.connect(creds);

  const schemaQuery = job.query<any[]>(`create schema ${TEST_SCHEMA}`);

  try {
    await schemaQuery.execute();
  } catch (e) {
    // ignore
  } finally {
    await schemaQuery.close();
  }
});

test(`IN, OUT, INOUT number parameters`, async () => {
  const job = new SQLJob();
  await job.connect(creds);

  const testProc = `
    create or replace procedure ${TEST_SCHEMA}.procedure_test(
      in p1 integer,
      inout p2 integer,
      out p3 integer
    )
    BEGIN
      set p3 = p1 + p2;
      set p2 = 0;
    END
  `;

  const queryA = job.query<any[]>(testProc);
  await queryA.execute();
  await queryA.close();

  const queryB = job.query<any[]>(
    `call ${TEST_SCHEMA}.procedure_test(?, ?, ?)`,
    { parameters: [6, 4, 0] }
  );
  const result = await queryB.execute();
  await queryB.close();

  expect(result.metadata.parameters).toBeDefined();
  const inParmNames = result.metadata.parameters.map((p) => p.name);
  const inParmTypes = result.metadata.parameters.map((p) => p.type);
  expect(inParmNames).toEqual(["P1", "P2", "P3"]);
  expect(inParmTypes).toEqual(["INTEGER", "INTEGER", "INTEGER"]);

  expect(result.success).toBe(true);
  expect(result.parameter_count).toBe(3);
  expect(result.update_count).toBe(0);
  expect(result.has_results).toBe(false);
  expect(result.data.length).toBe(0);

  expect(result.output_parms).toBeDefined();
  expect(result.output_parms.length).toBe(3);
  const outParmNames = result.output_parms.map((p) => p.name);
  const outParmTypes = result.output_parms.map((p) => p.type);
  const outParmValues = result.output_parms.map((p) => p.value);

  expect(outParmNames).toEqual(["P1", "P2", "P3"]);
  expect(outParmTypes).toEqual(["INTEGER", "INTEGER", "INTEGER"]);
  expect(outParmValues).toEqual([undefined, 0, 10]);

  await job.close();
});

test(`IN, OUT, INOUT char parameters`, async () => {
  const job = new SQLJob();
  await job.connect(creds);

  const testProc = `
    create or replace procedure ${TEST_SCHEMA}.procedure_test_char(
      in p1 char(5),
      inout p2 char(6),
      out p3 char(7)
    )
    BEGIN
      set p3 = rtrim(p1) concat rtrim(p2);
      set p2 = '';
    END
  `;

  const queryA = job.query<any[]>(testProc);
  await queryA.execute();
  await queryA.close();

  const queryB = job.query<any[]>(
    `call ${TEST_SCHEMA}.procedure_test_char(?, ?, ?)`,
    { parameters: ["a", "b", ""] }
  );
  const result = await queryB.execute();
  await queryB.close();

  expect(result.metadata.parameters).toBeDefined();
  const inParmNames = result.metadata.parameters.map((p) => p.name);
  const inParmTypes = result.metadata.parameters.map((p) => p.type);
  const inPrecisions = result.metadata.parameters.map((p) => p.precision);
  expect(inParmNames).toEqual(["P1", "P2", "P3"]);
  expect(inParmTypes).toEqual(["CHAR", "CHAR", "CHAR"]);
  expect(inPrecisions).toEqual([5, 6, 7]);

  expect(result.success).toBe(true);
  expect(result.parameter_count).toBe(3);
  expect(result.update_count).toBe(0);
  expect(result.has_results).toBe(false);
  expect(result.data.length).toBe(0);

  expect(result.output_parms).toBeDefined();
  expect(result.output_parms.length).toBe(3);
  const outParmNames = result.output_parms.map((p) => p.name);
  const outParmTypes = result.output_parms.map((p) => p.type);
  const outParmPrecisions = result.output_parms.map((p) => p.precision);
  const outParmValues = result.output_parms.map((p) => p.value);

  expect(outParmNames).toEqual(["P1", "P2", "P3"]);
  expect(outParmTypes).toEqual(["CHAR", "CHAR", "CHAR"]);
  expect(outParmPrecisions).toEqual([5, 6, 7]);
  expect(outParmValues).toEqual([undefined, "", "ab"]);

  await job.close();
});

test(`IN, OUT, INOUT varchar parameters`, { timeout: 15000 }, async () => {
  const job = new SQLJob();
  await job.connect(creds);

  const testProc = `
    create or replace procedure ${TEST_SCHEMA}.procedure_test_varchar(
      in p1 varchar(5),
      inout p2 varchar(6),
      out p3 varchar(7)
    )
    BEGIN
      set p3 = p1 concat p2;
      set p2 = '';
    END
  `;

  const queryA = job.query<any[]>(testProc);
  await queryA.execute();
  await queryA.close();

  const queryB = job.query<any[]>(
    `call ${TEST_SCHEMA}.procedure_test_varchar(?, ?, ?)`,
    { parameters: ["a", "b", ""] }
  );
  const result = await queryB.execute();
  await queryB.close();

  expect(result.metadata.parameters).toBeDefined();
  const inParmNames = result.metadata.parameters.map((p) => p.name);
  const inParmTypes = result.metadata.parameters.map((p) => p.type);
  const inPrecisions = result.metadata.parameters.map((p) => p.precision);
  expect(inParmNames).toEqual(["P1", "P2", "P3"]);
  expect(inParmTypes).toEqual(["VARCHAR", "VARCHAR", "VARCHAR"]);
  expect(inPrecisions).toEqual([5, 6, 7]);

  expect(result.success).toBe(true);
  expect(result.parameter_count).toBe(3);
  expect(result.update_count).toBe(0);
  expect(result.has_results).toBe(false);
  expect(result.data.length).toBe(0);

  expect(result.output_parms).toBeDefined();
  expect(result.output_parms.length).toBe(3);
  const outParmNames = result.output_parms.map((p) => p.name);
  const outParmTypes = result.output_parms.map((p) => p.type);
  const outParmPrecisions = result.output_parms.map((p) => p.precision);
  const outParmValues = result.output_parms.map((p) => p.value);

  expect(outParmNames).toEqual(["P1", "P2", "P3"]);
  expect(outParmTypes).toEqual(["VARCHAR", "VARCHAR", "VARCHAR"]);
  expect(outParmPrecisions).toEqual([5, 6, 7]);
  expect(outParmValues).toEqual([undefined, "", "ab"]);

  await job.close();
});
