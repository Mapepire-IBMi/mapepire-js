import { beforeAll, afterAll, expect, test, vi } from "vitest";
import { ColumnType, DaemonServer } from "../src/types";
import { SQLJob } from "../src";
import { getRootCertificate } from "../src/tls";
import { ENV_CREDS } from "./env";

beforeAll(async () => {
  const ca = await getRootCertificate(creds);
  creds.ca = ca;
});

let creds: DaemonServer = { ...ENV_CREDS };
const TEST_CLOB = "This is a small CLOB value for testing.";
const UNICODE_CLOB = `
    This is a much longer CLOB value.
    It spans multiple lines and includes special characters like:
    "quotes", newlines \n, and even some unicode like ❤️ or 中文字符.
    The goal is to test whether long textual content is preserved.
  `.trim();

const TableNames = ["SAMPLE.MY_CLOB_TABLE", "SAMPLE.UNICODE_CLOB_TABLE"];

beforeAll(async () => {
  const ca = await getRootCertificate(creds);
  creds.ca = ca;
});

afterAll(async () => {
  const job = new SQLJob();
  await job.connect(creds);
  for (const tableName of TableNames) {
    await job.execute(`DROP TABLE ${tableName} IF EXISTS`);
  }
});

const createTableOneClob = async (job: SQLJob) => {
  const TABLE_NAME = TableNames[0];
  await job.execute(`DROP TABLE ${TABLE_NAME} IF EXISTS`);

  await job.execute(`
    CREATE TABLE ${TABLE_NAME} (
      ID INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      DESCRIPTION CLOB(2G)
    )
  `);
  return TABLE_NAME;
};

const createTableUnicodeClob = async (job: SQLJob) => {
  const TABLE_NAME = TableNames[1];
  await job.execute(`DROP TABLE ${TABLE_NAME} IF EXISTS`);

  await job.execute(`
     CREATE TABLE ${TABLE_NAME} (
      ID INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      CONTENT CLOB(10000) CCSID 1208
    )
  `);
  return TABLE_NAME;
};

test("Selecting small CLOB literal", async () => {
  const job = new SQLJob();
  await job.connect(creds);

  const TABLE_NAME = await createTableOneClob(job);

  await job.execute<any>(`
    INSERT INTO ${TABLE_NAME} (DESCRIPTION)
    VALUES ('${TEST_CLOB}')
  `);

  const res = await job.execute<any>(`SELECT * FROM ${TABLE_NAME}`);
  expect(res.data[0].DESCRIPTION).toBe(TEST_CLOB);

  await job.close();
});

test(
  "Selecting long multi-line CLOB literal",
  async () => {
    const job = new SQLJob();
    await job.connect(creds);
    const TABLE_NAME = await createTableUnicodeClob(job);
    await job.execute(`
    INSERT INTO ${TABLE_NAME} (CONTENT)
    VALUES ('${UNICODE_CLOB}')
  `);

    const res = await job.execute<any>(`SELECT * FROM ${TABLE_NAME}`);
    expect(res.data[0].CONTENT.trim()).toBe(UNICODE_CLOB);

    await job.close();
  }
);

// test("Selecting large CLOB as prepared", { timeout: 80000 }, async () => {
//   const sizeInChars = 100 * 1024 * 1024; // 100 MB worth of characters
//   const value = "A";
//   const str = value.repeat(sizeInChars);

//   const job = new SQLJob();
//   await job.connect(creds);
//   const TABLE_NAME = await createTableOneClob(job);

//   const stmt1 = job.query<any[]>(
//     `
//     INSERT INTO ${TABLE_NAME} (DESCRIPTION)
//     VALUES (?)
//   `,
//     {
//       parameters: [str],
//       columnType: [ColumnType.CLOB],
//     }
//   );
//   await stmt1.execute();
//   await stmt1.close();

//   const res = await job.execute<any>(`SELECT * FROM ${TABLE_NAME}`);
//   expect(res.data[0].DESCRIPTION.substring(0, 100)).toStrictEqual(
//     str.substring(0, 100)
//   );
//   expect(res.data[0].DESCRIPTION.length).toEqual(sizeInChars);
//   await job.close();
// });
