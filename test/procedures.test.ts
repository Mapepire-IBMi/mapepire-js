import { afterAll, beforeAll, expect, test } from "vitest";
import { BlobRef, DaemonServer } from "../src/types";
import { SQLJob } from "../src";
import { getRootCertificate } from "../src/tls";
import { ENV_CREDS } from "./env";

let creds: DaemonServer = { ...ENV_CREDS };

const TEST_SCHEMA = `mapepire_test`;

beforeAll(async () => {
  creds.ca = await getRootCertificate(creds);

  const job = new SQLJob();
  await job.connect(creds);

  const schemaQuery = job.query<any[]>(`create schema ${TEST_SCHEMA}`);

  try {
    await schemaQuery.execute();
  } catch (e) {
    // ignore
  } finally {
    await schemaQuery.close();
    await job.close();
  }
});

afterAll(async () => {
  const job = new SQLJob();
  await job.connect(creds);

  const schemaQuery = job.query<any[]>(`drop schema ${TEST_SCHEMA} cascade`);

  try {
    await schemaQuery.execute();
  } catch (e) {
    // ignore
  } finally {
    await schemaQuery.close();
    await job.close();
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
  const inParmNames = result.metadata.parameters!.map((p) => p.name);
  const inParmTypes = result.metadata.parameters!.map((p) => p.type);
  expect(inParmNames).toEqual(["P1", "P2", "P3"]);
  expect(inParmTypes).toEqual(["INTEGER", "INTEGER", "INTEGER"]);

  expect(result.success).toBe(true);
  expect(result.parameter_count).toBe(3);
  expect(result.update_count).toBe(0);
  expect(result.has_results).toBe(false);
  expect(result.data.length).toBe(0);

  expect(result.output_parms).toBeDefined();
  expect(result.output_parms!.length).toBe(3);
  const outParmNames = result.output_parms!.map((p) => p.name);
  const outParmTypes = result.output_parms!.map((p) => p.type);
  const outParmValues = result.output_parms!.map((p) => p.value);

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
  const inParmNames = result.metadata.parameters!.map((p) => p.name);
  const inParmTypes = result.metadata.parameters!.map((p) => p.type);
  const inPrecisions = result.metadata.parameters!.map((p) => p.precision);
  expect(inParmNames).toEqual(["P1", "P2", "P3"]);
  expect(inParmTypes).toEqual(["CHAR", "CHAR", "CHAR"]);
  expect(inPrecisions).toEqual([5, 6, 7]);

  expect(result.success).toBe(true);
  expect(result.parameter_count).toBe(3);
  expect(result.update_count).toBe(0);
  expect(result.has_results).toBe(false);
  expect(result.data.length).toBe(0);

  expect(result.output_parms).toBeDefined();
  expect(result.output_parms!.length).toBe(3);
  const outParmNames = result.output_parms!.map((p) => p.name);
  const outParmTypes = result.output_parms!.map((p) => p.type);
  const outParmPrecisions = result.output_parms!.map((p) => p.precision);
  const outParmValues = result.output_parms!.map((p) => p.value);

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
  const inParmNames = result.metadata.parameters!.map((p) => p.name);
  const inParmTypes = result.metadata.parameters!.map((p) => p.type);
  const inPrecisions = result.metadata.parameters!.map((p) => p.precision);
  expect(inParmNames).toEqual(["P1", "P2", "P3"]);
  expect(inParmTypes).toEqual(["VARCHAR", "VARCHAR", "VARCHAR"]);
  expect(inPrecisions).toEqual([5, 6, 7]);

  expect(result.success).toBe(true);
  expect(result.parameter_count).toBe(3);
  expect(result.update_count).toBe(0);
  expect(result.has_results).toBe(false);
  expect(result.data.length).toBe(0);

  expect(result.output_parms).toBeDefined();
  expect(result.output_parms!.length).toBe(3);
  const outParmNames = result.output_parms!.map((p) => p.name);
  const outParmTypes = result.output_parms!.map((p) => p.type);
  const outParmPrecisions = result.output_parms!.map((p) => p.precision);
  const outParmValues = result.output_parms!.map((p) => p.value);

  expect(outParmNames).toEqual(["P1", "P2", "P3"]);
  expect(outParmTypes).toEqual(["VARCHAR", "VARCHAR", "VARCHAR"]);
  expect(outParmPrecisions).toEqual([5, 6, 7]);
  expect(outParmValues).toEqual([undefined, "", "ab"]);

  await job.close();
});

test(`IN, OUT clob parameters`, { timeout: 15000 }, async () => {
  const job = new SQLJob();
  await job.connect(creds);

  const queryA = job.query(`
    create or replace procedure ${TEST_SCHEMA}.procedure_test_clob(
      in in1 clob(1m),
      out out1 clob(1m)
    )
    begin
      set out1 = upper(in1);
    end
  `);
  await queryA.execute();
  await queryA.close();

  const param = "test".repeat(262144); // Create 1MB string
  const queryB = job.query(
    `call ${TEST_SCHEMA}.procedure_test_clob(?, ?)`,
    { parameters: [param, ""] }
  );
  const result = await queryB.execute();
  await queryB.close();

  expect(result.metadata.parameters).toBeDefined();
  const inParmNames = result.metadata.parameters!.map((p) => p.name);
  const inParmTypes = result.metadata.parameters!.map((p) => p.type);
  const inPrecisions = result.metadata.parameters!.map((p) => p.precision);
  expect(inParmNames).toEqual(["IN1", "OUT1"]);
  expect(inParmTypes).toEqual(["CLOB", "CLOB"]);
  expect(inPrecisions).toEqual([1048576, 1048576]);

  expect(result.success).toBe(true);
  expect(result.parameter_count).toBe(2);
  expect(result.update_count).toBe(0);
  expect(result.has_results).toBe(false);
  expect(result.data.length).toBe(0);

  expect(result.output_parms).toBeDefined();
  expect(result.output_parms!.length).toBe(2);
  const outParmNames = result.output_parms!.map((p) => p.name);
  const outParmTypes = result.output_parms!.map((p) => p.type);
  const outParmPrecisions = result.output_parms!.map((p) => p.precision);
  const outParmValues = result.output_parms!.map((p) => p.value);

  expect(outParmNames).toEqual(["IN1", "OUT1"]);
  expect(outParmTypes).toEqual(["CLOB", "CLOB"]);
  expect(outParmPrecisions).toEqual([1048576, 1048576]);
  expect(outParmValues).toEqual([undefined, param.toUpperCase()]);

  await job.close();
});

test(`IN, OUT blob parameters — output_parms BlobRef + fetchBlob`, { timeout: 15000 }, async () => {
  const job = new SQLJob();
  await job.connect(creds);

  // Create a procedure that accepts a BLOB in-param and echoes it back as an
  // OUT param so we can verify the full round-trip: Base64 in → BlobRef out →
  // fetchBlob() → original bytes.
  const queryA = job.query(`
    create or replace procedure ${TEST_SCHEMA}.procedure_test_blob(
      in  in1  blob(1048576),
      out out1 blob(1048576)
    )
    begin
      set out1 = in1;
    end
  `);
  await queryA.execute();
  await queryA.close();

  const originalText  = "BLOB output parameter test payload";
  const originalBytes = Buffer.from(originalText, "utf8");
  const base64Input   = originalBytes.toString("base64");

  // Pass empty string for the OUT slot — the server registers it as an OUT
  // parameter and ignores the placeholder value (same pattern as CLOB test).
  const queryB = job.query(
    `call ${TEST_SCHEMA}.procedure_test_blob(?, ?)`,
    { parameters: [base64Input, ""] }
  );
  const result = await queryB.execute();
  await queryB.close();

  // ── basic result shape ────────────────────────────────────────────────────
  expect(result.success).toBe(true);
  expect(result.parameter_count).toBe(2);
  expect(result.has_results).toBe(false);
  expect(result.data.length).toBe(0);

  // ── parameter metadata ────────────────────────────────────────────────────
  expect(result.metadata.parameters).toBeDefined();
  const parmTypes = result.metadata.parameters!.map((p) => p.type);
  expect(parmTypes).toEqual(["BLOB", "BLOB"]);

  // ── output_parms — the OUT BLOB should be a BlobRef, not a Base64 string ─
  expect(result.output_parms).toBeDefined();
  expect(result.output_parms!.length).toBe(2);

  // IN param has no value, OUT param has the BlobRef
  const outParm = result.output_parms![1];
  expect(outParm.type).toBe("BLOB");

  const blobRef = outParm.value as BlobRef;
  expect(blobRef).not.toBeNull();
  expect(typeof blobRef).toBe("object");
  expect(blobRef.blob_url).toMatch(/^\/blob\//);
  expect(blobRef.size).toBe(originalBytes.length);

  // ── fetchBlob() on the output param BlobRef ───────────────────────────────
  const buf = await job.fetchBlob(blobRef);
  expect(buf).toBeInstanceOf(Buffer);
  expect(buf.length).toBe(originalBytes.length);
  expect(buf.toString("utf8")).toBe(originalText);

  await job.close();
});
