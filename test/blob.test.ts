import { afterAll, beforeAll, beforeEach, expect, test, vi } from "vitest";
import { ColumnType, DaemonServer } from "../src/types";
import { SQLJob } from "../src";
import { getRootCertificate } from "../src/tls";
import { ENV_CREDS } from "./env";
import odbc from "odbc";

let creds: DaemonServer = { ...ENV_CREDS };
const TEXT = "HELLO";
const TEXT2 = "GOODBYE";
const TEXT3 = "GOODBYE123#@!&*";


// Step 1: Convert to a Uint8Array (binary representation)
const encoder = new TextEncoder(); // defaults to UTF-8
const BIN1 = encoder.encode(TEXT); // [72, 69, 76, 76, 79]
const BIN2 = encoder.encode(TEXT2); // [71, 79, 79, 68, 66, 89, 69 ]
const BIN3 = encoder.encode(TEXT2); // [71, 79, 79, 68, 66, 89, 69, 49, 50, 51, 35, 64, 33, 38, 42 ]

const TableNames = [
  "SAMPLE.MY_BLOB_TABLE",
  "SAMPLE.MY_BLOB_TABLE2",
]

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

const createTableOneBlob = async (job: SQLJob) => {
  const TABLE_NAME = TableNames[0];
  await job.execute(`DROP TABLE ${TABLE_NAME} IF EXISTS`);

  await job.execute(`
    CREATE TABLE ${TABLE_NAME} (
      ID INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      BIN_DATA BLOB(2G)
    )
  `);
  return TABLE_NAME;
};
const createTableTwoBlobs = async (job: SQLJob) => {
  const TABLE_NAME2 = TableNames[1];

  await job.execute(`DROP TABLE ${TABLE_NAME2} IF EXISTS`);
  await job.execute(`
      CREATE TABLE ${TABLE_NAME2} (
        ID INT,
        TEXT_COLUMN VARCHAR(100),
        BIN_DATA BLOB(1M),
        BIN_DATA2 BLOB(1M)
      )
    `);
  return TABLE_NAME2;
};

test("Selecting small BLOB literal", async () => {
  const SMALL_BLOB_HEX_BYTES = "48656C6C6F";
  const expectedBinary = new Uint8Array([72, 101, 108, 108, 111]);

  const job = new SQLJob();
  await job.connect(creds);

  const TABLE_NAME = await createTableOneBlob(job);

  const stmt = job.query<any[]>(`
    INSERT INTO ${TABLE_NAME} (BIN_DATA)
    VALUES (BLOB(X'${SMALL_BLOB_HEX_BYTES}')) 
  `);

  await stmt.execute();
  await stmt.close();

  const res = await job.execute<any>(`SELECT * FROM ${TABLE_NAME}`);
  expect(res.data[0].BIN_DATA).toStrictEqual(new Buffer(expectedBinary));
  await job.close();
});

test("Selecting large binary BLOB literal", async () => {
  const LARGE_BLOB_HEX = "AB".repeat(1000);
  const LARGE_BLOB_BYTES = new Uint8Array([
    171, 171, 171, 171, 171, 171, 171, 171, 171, 171,
  ]);

  const job = new SQLJob();
  await job.connect(creds);

  const TABLE_NAME = await createTableOneBlob(job);
  const stmt = job.query<any[]>(`
    INSERT INTO ${TABLE_NAME} (BIN_DATA)
    VALUES (BLOB(X'${LARGE_BLOB_HEX}'))
  `);

  await stmt.execute();
  await stmt.close();

  const res = await job.execute<any>(`SELECT * FROM ${TABLE_NAME}`);
  expect(res.data[0].BIN_DATA.length).toBe(1000);
  expect(res.data[0].BIN_DATA.slice(0, 10)).toStrictEqual(
    new Buffer(LARGE_BLOB_BYTES)
  );
  await job.close();
});

test("Selecting small BLOB as prepared", { timeout: 999999 }, async () => {
  const job = new SQLJob();
  await job.connect(creds);

  const TABLE_NAME = await createTableOneBlob(job);

  const stmt = job.query<any[]>(
    `
    INSERT INTO ${TABLE_NAME} (BIN_DATA)
    VALUES (?)
  `,
    { parameters: [[BIN1]], columnType: [ColumnType.BLOB] }
  );

  await stmt.execute();
  await stmt.close();

  const res = await job.execute<any>(`SELECT * FROM ${TABLE_NAME}`);
  expect(res.data[0].BIN_DATA).toStrictEqual(new Buffer(BIN1));
  await job.close();
});

test("Selecting large BLOB as prepared", { timeout: 999999 }, async () => {
  const sizeInBytes = 100 * 1024 * 1024;
  const value = 171;
  const arr = new Uint8Array(sizeInBytes).fill(value);

  const job = new SQLJob();
  await job.connect(creds);

  const TABLE_NAME = await createTableOneBlob(job);

  const stmt1 = job.query<any[]>(
    `
    INSERT INTO ${TABLE_NAME} (BIN_DATA)
    VALUES (?)
  `,
    { parameters: [arr], columnType: [ColumnType.BLOB] }
  );
  await stmt1.execute();
  await stmt1.close();

  const res = await job.execute<any>(`SELECT * FROM ${TABLE_NAME}`);
  expect(res.data[0].BIN_DATA.slice(0, 100)).toStrictEqual(
    new Buffer(arr.slice(0, 100))
  );
  expect(res.data[0].BIN_DATA.length).toEqual(sizeInBytes);
  await job.close();
});

test(
  "Selecting large BLOB as prepared (odbc)",
  { timeout: 30000 },
  async () => {
    const TABLE_NAME = "SAMPLE.MY_BLOB_TABLE";

    // prepare 100MB buffer
    const sizeInBytes = 100 * 1024 * 1024;
    const value = 171;
    const arr = new Uint8Array(sizeInBytes).fill(value);
    const buffer = Buffer.from(arr);

    // // connect
    const connectionString = [
      `DRIVER=IBM i Access ODBC Driver`,
      `SYSTEM=${creds.host}`,
      `UID=${creds.user}`,
      `Password=${creds.password}`,
      `Naming=1`,
    ].join(`;`);
    const connection = await odbc.connect(connectionString);

    // ^ replace with your DSN/connection string

    // cleanup & create table
    try {
      await connection.query(`DROP TABLE ${TABLE_NAME}`);
    } catch (e) {
      // ignore if not exists
    }

    await connection.query(`
    CREATE TABLE ${TABLE_NAME} (
      ID INT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      BIN_DATA BLOB(2G)
    )
  `);

    // insert as parameter
    const insertStmt = await connection.createStatement();
    await insertStmt.prepare(`
    INSERT INTO ${TABLE_NAME} (BIN_DATA) VALUES (?)
  `);
    await insertStmt.bind([buffer]);
    await insertStmt.execute();
    await insertStmt.close();

    // fetch back
    const result = await connection.query<any[]>(`SELECT * FROM ${TABLE_NAME}`);

    // verify first 100 bytes match
    expect(result[0].BIN_DATA.byteLength).toEqual(sizeInBytes);
    await connection.close();
  }
);

test(
  "inserting blob as prepared, only blob col",
  async () => {
    const job = new SQLJob();
    await job.connect(creds);

    const stmt = job.query<any[]>(
      `
    INSERT INTO TABLE_NAME (BIN_DATA)
    VALUES (?)
  `,
      { parameters: [BIN1], columnType: [ColumnType.BLOB] }
    );

    const spyInitial = vi.spyOn(stmt as any, "getBlobFrame");
    try {
      await stmt.execute();
      await stmt.close();
    } catch (e) {
    } finally {
      const initialReturn = spyInitial.mock.results[0].value;
      expect(initialReturn.length).toEqual(12);
      expect(initialReturn.slice(2)).toStrictEqual(
        new Uint8Array([1, 0, 0, 0, 5, 72, 69, 76, 76, 79])
      );
    }
  }
);

test(
  "inserting blob as prepared, multiple col",
  async () => {
    const job = new SQLJob();
    await job.connect(creds);

    const TABLE_NAME = await createTableTwoBlobs(job);
    const stmt = job.query<any[]>(
      `
    INSERT INTO ${TABLE_NAME} (ID, TEXT_COLUMN, BIN_DATA, BIN_DATA2)
    VALUES (?, 'text value', ?, ?)
  `,
      {
        parameters: [12, BIN1, BIN2],
        columnType: [ColumnType.INTEGER, ColumnType.BLOB, ColumnType.BLOB],
      }
    );

    const spyInitial = vi.spyOn(stmt as any, "getBlobFrame");
    try {
      await stmt.execute();
      await stmt.close();
    } catch (e) {
    } finally {
      const initialReturn = spyInitial.mock.results[0].value;
      const expectedBinary = new Uint8Array([
        2, 0, 0, 0, 5, 72, 69, 76, 76, 79, 3, 0, 0, 0, 7, 71, 79, 79, 68, 66,
        89, 69,
      ]);
      expect(initialReturn.length).toEqual(expectedBinary.length + 2);
      expect(initialReturn.slice(2)).toStrictEqual(expectedBinary);
    }

    const res = await job.execute<any>(`SELECT * FROM ${TABLE_NAME}`);
    expect(res.data[0].BIN_DATA).toStrictEqual(new Buffer(BIN1));
    expect(res.data[0].BIN_DATA2).toStrictEqual(new Buffer(BIN2));
    expect(res.data[0].rowId).toBeUndefined();
  }
);

test(
  "inserting blob as prepared, with null blob",
  async () => {
    const job = new SQLJob();
    await job.connect(creds);

    const TABLE_NAME = await createTableTwoBlobs(job);

    const stmt = job.query<any[]>(
      `
    INSERT INTO ${TABLE_NAME} (ID, TEXT_COLUMN, BIN_DATA)
    VALUES (?, 'text value', ?)
  `,
      {
        parameters: [12, BIN1],
        columnType: [ColumnType.INTEGER, ColumnType.BLOB],
      }
    );

    await stmt.execute();
    await stmt.close();
    const res = await job.execute<any>(`SELECT * FROM ${TABLE_NAME}`);
    expect(res.data[0].BIN_DATA).toStrictEqual(new Buffer(BIN1));
    expect(res.data[0].BIN_DATA2).toStrictEqual(null);
  }
);

test("Selecting small BLOB as prepared multiple rows", async () => {
  const job = new SQLJob();
  await job.connect(creds);
  const TABLE_NAME = await createTableOneBlob(job)

  const stmt = job.query<any[]>(
    `
    INSERT INTO ${TABLE_NAME} (BIN_DATA)
    VALUES (?)
  `,
    { parameters: [BIN1], columnType: [ColumnType.BLOB] }
  );

  const stmt2 = job.query<any[]>(
    `
    INSERT INTO ${TABLE_NAME} (BIN_DATA)
    VALUES (?)
  `,
    { parameters: [BIN3], columnType: [ColumnType.BLOB] }
  );

  await stmt.execute();
  await stmt.close();

  await stmt2.execute();
  await stmt.close();

  const res = await job.execute<any>(`SELECT * FROM ${TABLE_NAME}`);
  expect(res.data[0].BIN_DATA).toStrictEqual(new Buffer(BIN1));
  expect(res.data[1].BIN_DATA).toStrictEqual(new Buffer(BIN3));

  await job.close();
});
