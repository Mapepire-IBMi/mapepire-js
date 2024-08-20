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
  
  job.enableLocalTrace();

  const queryB = job.query<any[]>(`call ${TEST_SCHEMA}.procedure_test(?, ?, ?)`, {parameters: [6, 4, 0]});
  const result = await queryB.execute();
  await queryB.close();

  expect(result.is_done).toBe(true);

  // TODO: check output values

  await job.close();
});

// TODO: test case for char parmaeters
// TODO: test case for varchar parmaeters