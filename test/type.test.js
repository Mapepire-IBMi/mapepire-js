import { beforeAll, expect, test } from "vitest";
import { SQLJob } from "../src";
import { getRootCertificate } from "../src/tls";
import { ENV_CREDS } from "./env";

let creds = { ...ENV_CREDS };
let invalidCreds = {
  ...ENV_CREDS,
  user: "fakeuser",
  password: "fakepassword",
};

beforeAll(async () => {
  const ca = await getRootCertificate(creds);
  creds.ca = ca;
  invalidCreds.ca = ca;
});

test("Bad inputs for job.query", async () => {
  const job = new SQLJob();
  await job.connect(creds);
  let error;

  try {
    const query = await job.query(
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
    query = await job.query(666);
    await query.execute(1);
    throw new Error("Exception not hit");
  } catch (error) {
    expect(error.message).toContain("Query must be of type string");
  }
  await job.close();
});
