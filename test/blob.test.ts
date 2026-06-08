/**
 * BLOB support tests for mapepire-js in daemon mode.
 *
 * Mirrors and extends the scenarios in mapepire-server/scripts/test-blob-daemon.js:
 *
 *  1.  INSERT a BLOB via prepared-statement parameter (Base64 encoded)
 *  2.  SELECT the BLOB column — expect a BlobRef {blob_url, size} in the result
 *  3.  fetchBlob() with correct credentials — returns the raw bytes
 *  4.  fetchBlob() a second time on the same token — throws (single-use, 404)
 *  5.  Direct HTTP GET with wrong credentials — throws with 401 message
 *  6.  SELECT a NULL BLOB — result cell is null
 *  7.  INSERT a large BLOB (>1 MB), SELECT returns BlobRef quickly (async spool),
 *      fetchBlob() returns all bytes with correct content
 *  8.  Binary fidelity — round-trip of all 256 byte values (0x00–0xFF)
 *  9.  Multiple rows in a single SELECT — each row has a distinct blob_url token
 *  10. Concurrent fetchBlob() of two tokens at the same time — both succeed
 *  11. Column metadata reports the column type as BLOB
 *  12. UPDATE BLOB value — SELECT after UPDATE returns new content
 *  13. fetchBlob() on an unconnected job — throws with "not connected" error
 *  14. HTTP GET with a completely bogus token — returns 404
 *  15. blob_url path format — token portion is a valid UUID (RFC 4122)
 *  16. Terse-results mode — BlobRef is still returned when isTerseResults=true
 *
 * Prerequisites (run once on the server):
 *   CREATE TABLE <user>.TEMPBLOB ( ID INTEGER GENERATED ALWAYS AS IDENTITY,
 *                                  JBLOB BLOB(100) )
 *
 * NOTE: the pre-existing TEMPBLOB table must have an ID column so that
 * individual rows can be targeted for UPDATE tests.  If your existing table
 * only has JBLOB, drop it and recreate with the DDL above before running.
 *
 * Test 7 creates and drops its own table (<user>.TEMPBLOB_LARGE) so no
 * manual DDL is required for the large-blob scenario.
 *
 * Test 8 creates and drops its own table (<user>.TEMPBLOB_BINARY) so no
 * manual DDL is required for the binary-fidelity scenario.
 */

import https from "https";
import { beforeAll, afterAll, describe, expect, test } from "vitest";
import { BlobRef, DaemonServer } from "../src/types";
import { SQLJob } from "../src";
import { getRootCertificate } from "../src/tls";
import { ENV_CREDS } from "./env";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TEST_STRING = "Hello from daemon mode";
const TEST_BASE64 = Buffer.from(TEST_STRING, "utf8").toString("base64");

/** 2 MB of repeating 0x41 ('A') — above the 1 MB async-spool threshold */
const LARGE_BLOB_SIZE = 2 * 1024 * 1024;
const LARGE_BLOB_BASE64 = Buffer.alloc(LARGE_BLOB_SIZE, 0x41).toString("base64");

/** All 256 byte values in sequence (0x00, 0x01, …, 0xFF, repeated) */
const BINARY_BUF = Buffer.from(Array.from({ length: 256 }, (_, i) => i));
const BINARY_BASE64 = BINARY_BUF.toString("base64");

/** RFC 4122 UUID pattern (version 1–5) */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// ---------------------------------------------------------------------------
// Row shape helpers
// ---------------------------------------------------------------------------

interface TempBlobRow {
  JBLOB: BlobRef | null;
}

interface TempBlobWithIdRow {
  ID: number;
  JBLOB: BlobRef | null;
}

// ---------------------------------------------------------------------------
// Shared state
// ---------------------------------------------------------------------------

let creds: DaemonServer;
let job: SQLJob;

/** Schema derived from the connected user (upper-cased). */
let schema: string;

const SMALL_TABLE   = () => `${schema}.TEMPBLOB`;
const LARGE_TABLE   = () => `${schema}.TEMPBLOB_LARGE`;
const BINARY_TABLE  = () => `${schema}.TEMPBLOB_BINARY`;
const UPDATE_TABLE  = () => `${schema}.TEMPBLOB_UPDATE`;

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeAll(async () => {
  creds = { ...ENV_CREDS };
  creds.ca = await getRootCertificate(creds);

  job = new SQLJob();
  await job.connect(creds);

  schema = (creds.user as string).toUpperCase();

  // Clean up any rows left over from a previous failed run (ignore if table is missing)
  await job.execute(`DELETE FROM ${SMALL_TABLE()}`).catch(() => {});
});

afterAll(async () => {
  if (job) {
    await job.close();
  }
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Execute a raw HTTPS GET to the mapepire server, optionally overriding the
 * password. Returns the HTTP status code.
 */
function httpGetStatus(
  server: DaemonServer,
  path: string,
  password: string
): Promise<number> {
  return new Promise((resolve) => {
    const auth = Buffer.from(`${server.user}:${password}`).toString("base64");
    const options: https.RequestOptions = {
      hostname: server.host,
      port: server.port,
      path,
      method: "GET",
      rejectUnauthorized: false,
      headers: { Authorization: `Basic ${auth}` },
    };
    const req = https.request(options, (res) => {
      res.resume();
      res.on("end", () => resolve(res.statusCode ?? -1));
    });
    req.on("error", () => resolve(-1));
    req.end();
  });
}

/**
 * Execute a raw HTTPS GET using the correct credentials from `creds`.
 * Returns { status, body }.
 */
function httpGetRaw(
  server: DaemonServer,
  path: string
): Promise<{ status: number; body: Buffer }> {
  return new Promise((resolve) => {
    const auth = Buffer.from(`${server.user}:${server.password}`).toString("base64");
    const options: https.RequestOptions = {
      hostname: server.host,
      port: server.port,
      path,
      method: "GET",
      rejectUnauthorized: false,
      headers: { Authorization: `Basic ${auth}` },
    };
    const req = https.request(options, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (c: Buffer) => chunks.push(c));
      res.on("end", () =>
        resolve({ status: res.statusCode ?? -1, body: Buffer.concat(chunks as Uint8Array[]) })
      );
    });
    req.on("error", () => resolve({ status: -1, body: Buffer.alloc(0) }));
    req.end();
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("BLOB support (daemon mode)", () => {
  // ── Test 1 ────────────────────────────────────────────────────────────────
  test("1. INSERT BLOB via prepared-statement parameter", async () => {
    const res = await job.execute(
      `INSERT INTO ${SMALL_TABLE()} (JBLOB) VALUES (?)`,
      { parameters: [TEST_BASE64] }
    );

    expect(res.success).toBe(true);
    expect(res.update_count).toBe(1);
  });

  // ── Test 2 ────────────────────────────────────────────────────────────────
  test("2. SELECT BLOB column returns BlobRef with blob_url and size", async () => {
    const res = await job.execute<TempBlobRow>(
      `SELECT JBLOB FROM ${SMALL_TABLE()} WHERE JBLOB IS NOT NULL`,
      { parameters: [] }
    );

    expect(res.success).toBe(true);
    expect(res.data.length).toBeGreaterThanOrEqual(1);

    const blobField = res.data[0].JBLOB;
    expect(blobField).not.toBeNull();
    expect(typeof blobField).toBe("object");

    const ref = blobField as BlobRef;
    expect(ref.blob_url).toMatch(/^\/blob\//);
    expect(ref.size).toBe(TEST_STRING.length);
  });

  // ── Test 3 ────────────────────────────────────────────────────────────────
  test("3. fetchBlob() returns correct raw bytes", async () => {
    // Re-select to get a fresh single-use token
    const sel = await job.execute<TempBlobRow>(
      `SELECT JBLOB FROM ${SMALL_TABLE()} WHERE JBLOB IS NOT NULL`
    );
    const ref = sel.data[0].JBLOB as BlobRef;

    const buf = await job.fetchBlob(ref);

    expect(buf).toBeInstanceOf(Buffer);
    expect(buf.length).toBe(TEST_STRING.length);
    expect(buf.toString("utf8")).toBe(TEST_STRING);
  });

  // ── Test 4 ────────────────────────────────────────────────────────────────
  test("4. fetchBlob() a second time on the same token throws 404 (single-use)", async () => {
    // Re-select to get a fresh token
    const sel = await job.execute<TempBlobRow>(
      `SELECT JBLOB FROM ${SMALL_TABLE()} WHERE JBLOB IS NOT NULL`
    );
    const ref = sel.data[0].JBLOB as BlobRef;

    // First fetch — succeeds
    await job.fetchBlob(ref);

    // Second fetch — must throw with a 404 message
    await expect(job.fetchBlob(ref)).rejects.toThrow(/404/);
  });

  // ── Test 5 ────────────────────────────────────────────────────────────────
  test("5. HTTP GET with wrong password returns 401", async () => {
    // Re-select to obtain a fresh token
    const sel = await job.execute<TempBlobRow>(
      `SELECT JBLOB FROM ${SMALL_TABLE()} WHERE JBLOB IS NOT NULL`
    );
    const ref = sel.data[0].JBLOB as BlobRef;

    const status = await httpGetStatus(creds, ref.blob_url, "wrongpassword");
    expect(status).toBe(401);
  });

  // ── Test 6 ────────────────────────────────────────────────────────────────
  test("6. SELECT NULL BLOB column returns null", async () => {
    // Insert a NULL row
    await job.execute(`INSERT INTO ${SMALL_TABLE()} (JBLOB) VALUES (NULL)`);

    const res = await job.execute<TempBlobRow>(
      `SELECT JBLOB FROM ${SMALL_TABLE()} WHERE JBLOB IS NULL`
    );

    expect(res.success).toBe(true);
    expect(res.data.length).toBeGreaterThanOrEqual(1);

    const nullField = res.data[0].JBLOB;
    expect(nullField === null || nullField === undefined).toBe(true);
  });

  // ── Test 7 ────────────────────────────────────────────────────────────────
  test(
    "7. Large BLOB (>1 MB) — async spool: blob_url returned quickly, bytes correct",
    { timeout: 60_000 },
    async () => {
      // Create a dedicated table with a 10 MB BLOB column
      await job.execute(`DROP TABLE ${LARGE_TABLE()}`).catch(() => {
        /* ignore if it does not exist */
      });

      const createRes = await job.execute(
        `CREATE TABLE ${LARGE_TABLE()} ( JBLOB BLOB(10485760) )`
      );
      expect(createRes.success).toBe(true);

      try {
        // INSERT the large BLOB
        const insRes = await job.execute(
          `INSERT INTO ${LARGE_TABLE()} (JBLOB) VALUES (?)`,
          { parameters: [LARGE_BLOB_BASE64] }
        );
        expect(insRes.success).toBe(true);
        expect(insRes.update_count).toBe(1);

        // SELECT — the JSON response should arrive before all bytes are spooled
        const t0 = Date.now();
        const selRes = await job.execute<TempBlobRow>(
          `SELECT JBLOB FROM ${LARGE_TABLE()} WHERE JBLOB IS NOT NULL`
        );
        const selElapsed = Date.now() - t0;

        expect(selRes.success).toBe(true);
        expect(selRes.data.length).toBeGreaterThanOrEqual(1);

        const ref = selRes.data[0].JBLOB as BlobRef;
        expect(ref).not.toBeNull();
        expect(ref.blob_url).toMatch(/^\/blob\//);
        expect(ref.size).toBe(LARGE_BLOB_SIZE);

        // The SELECT response should be "quick" — under 10 s even with async spool
        expect(selElapsed).toBeLessThan(10_000);

        // Fetch the raw bytes — fetchBlob waits for spool to finish if needed
        const buf = await job.fetchBlob(ref);

        expect(buf.length).toBe(LARGE_BLOB_SIZE);
        // Verify every byte is 0x41 ('A')
        const allCorrect = [...buf].every((b) => b === 0x41);
        expect(allCorrect).toBe(true);
      } finally {
        // Always clean up the large-blob table
        await job.execute(`DROP TABLE ${LARGE_TABLE()}`).catch(() => {});
      }
    }
  );

  // ── Test 8 ────────────────────────────────────────────────────────────────
  test(
    "8. Binary fidelity — all 256 byte values (0x00–0xFF) round-trip correctly",
    async () => {
      // Use a dedicated table with a BLOB column large enough for 256 bytes
      await job.execute(`DROP TABLE ${BINARY_TABLE()}`).catch(() => {});
      await job.execute(
        `CREATE TABLE ${BINARY_TABLE()} ( JBLOB BLOB(1024) )`
      );

      try {
        // INSERT all 256 byte values
        const insRes = await job.execute(
          `INSERT INTO ${BINARY_TABLE()} (JBLOB) VALUES (?)`,
          { parameters: [BINARY_BASE64] }
        );
        expect(insRes.success).toBe(true);
        expect(insRes.update_count).toBe(1);

        // SELECT and fetch back
        const selRes = await job.execute<TempBlobRow>(
          `SELECT JBLOB FROM ${BINARY_TABLE()} WHERE JBLOB IS NOT NULL`
        );
        expect(selRes.success).toBe(true);
        expect(selRes.data.length).toBe(1);

        const ref = selRes.data[0].JBLOB as BlobRef;
        expect(ref).not.toBeNull();
        expect(ref.size).toBe(BINARY_BUF.length);

        const buf = await job.fetchBlob(ref);
        expect(buf.length).toBe(BINARY_BUF.length);

        // Verify every byte value 0x00–0xFF is preserved exactly
        for (let i = 0; i < 256; i++) {
          expect(buf[i]).toBe(i);
        }
      } finally {
        await job.execute(`DROP TABLE ${BINARY_TABLE()}`).catch(() => {});
      }
    }
  );

  // ── Test 9 ────────────────────────────────────────────────────────────────
  test("9. Multiple rows in a single SELECT — each row has a distinct blob_url", async () => {
    // Insert two additional rows with different content so we have ≥3 non-null rows
    const second = Buffer.from("second blob value", "utf8").toString("base64");
    const third  = Buffer.from("third blob value",  "utf8").toString("base64");

    await job.execute(`INSERT INTO ${SMALL_TABLE()} (JBLOB) VALUES (?)`, {
      parameters: [second],
    });
    await job.execute(`INSERT INTO ${SMALL_TABLE()} (JBLOB) VALUES (?)`, {
      parameters: [third],
    });

    const res = await job.execute<TempBlobRow>(
      `SELECT JBLOB FROM ${SMALL_TABLE()} WHERE JBLOB IS NOT NULL`
    );

    expect(res.success).toBe(true);
    expect(res.data.length).toBeGreaterThanOrEqual(3);

    // Every row must have a BlobRef with a non-empty blob_url
    const urls = res.data.map((row) => {
      const ref = row.JBLOB as BlobRef;
      expect(ref).not.toBeNull();
      expect(typeof ref.blob_url).toBe("string");
      expect(ref.blob_url.length).toBeGreaterThan(0);
      return ref.blob_url;
    });

    // All URLs must be unique (each is a single-use token)
    const uniqueUrls = new Set(urls);
    expect(uniqueUrls.size).toBe(urls.length);
  });

  // ── Test 10 ───────────────────────────────────────────────────────────────
  test("10. Concurrent fetchBlob() of two tokens — both succeed independently", async () => {
    // Obtain two fresh tokens from two separate SELECTs
    const [sel1, sel2] = await Promise.all([
      job.execute<TempBlobRow>(
        `SELECT JBLOB FROM ${SMALL_TABLE()} WHERE JBLOB IS NOT NULL FETCH FIRST 1 ROW ONLY`
      ),
      job.execute<TempBlobRow>(
        `SELECT JBLOB FROM ${SMALL_TABLE()} WHERE JBLOB IS NOT NULL FETCH FIRST 1 ROW ONLY`
      ),
    ]);

    const ref1 = sel1.data[0].JBLOB as BlobRef;
    const ref2 = sel2.data[0].JBLOB as BlobRef;

    // Two different tokens may point to the same logical blob but must be distinct URLs
    expect(ref1.blob_url).not.toEqual(ref2.blob_url);

    // Fetch both concurrently
    const [buf1, buf2] = await Promise.all([
      job.fetchBlob(ref1),
      job.fetchBlob(ref2),
    ]);

    expect(buf1).toBeInstanceOf(Buffer);
    expect(buf2).toBeInstanceOf(Buffer);
    expect(buf1.length).toBeGreaterThan(0);
    expect(buf2.length).toBeGreaterThan(0);
  });

  // ── Test 11 ───────────────────────────────────────────────────────────────
  test("11. Column metadata reports the BLOB column type correctly", async () => {
    const res = await job.execute<TempBlobRow>(
      `SELECT JBLOB FROM ${SMALL_TABLE()} WHERE JBLOB IS NOT NULL FETCH FIRST 1 ROW ONLY`
    );

    expect(res.success).toBe(true);
    expect(res.metadata).toBeDefined();
    expect(res.metadata.columns).toBeDefined();

    const col = res.metadata.columns![0];
    expect(col.name.toUpperCase()).toBe("JBLOB");

    // The JDBC type reported for a BLOB column is "BLOB" (or contains "BLOB")
    expect(col.type.toUpperCase()).toContain("BLOB");

    // Consume the token so it doesn't expire in the store
    await job.fetchBlob(res.data[0].JBLOB as BlobRef).catch(() => {});
  });

  // ── Test 12 ───────────────────────────────────────────────────────────────
  test("12. UPDATE BLOB value — SELECT after UPDATE returns new content", async () => {
    const origContent = "original blob content";
    const origBase64  = Buffer.from(origContent, "utf8").toString("base64");
    const newContent  = "updated blob content";
    const newBase64   = Buffer.from(newContent, "utf8").toString("base64");

    // Use a self-contained table with an identity key so we can target a specific row
    await job.execute(`DROP TABLE ${UPDATE_TABLE()}`).catch(() => {});
    await job.execute(
      `CREATE TABLE ${UPDATE_TABLE()} ( ID INTEGER GENERATED ALWAYS AS IDENTITY, JBLOB BLOB(1024) )`
    );

    try {
      // INSERT the original row
      await job.execute(
        `INSERT INTO ${UPDATE_TABLE()} (JBLOB) VALUES (?)`,
        { parameters: [origBase64] }
      );

      // Retrieve the auto-generated ID of the inserted row
      const idRes = await job.execute<{ ID: number }>(
        `SELECT ID FROM ${UPDATE_TABLE()} FETCH FIRST 1 ROW ONLY`
      );
      expect(idRes.success).toBe(true);
      const rowId = idRes.data[0].ID;

      // UPDATE the BLOB for that specific row
      const updRes = await job.execute(
        `UPDATE ${UPDATE_TABLE()} SET JBLOB = ? WHERE ID = ?`,
        { parameters: [newBase64, rowId] }
      );
      expect(updRes.success).toBe(true);
      expect(updRes.update_count).toBe(1);

      // SELECT the updated row and verify new content
      const selRes = await job.execute<TempBlobWithIdRow>(
        `SELECT ID, JBLOB FROM ${UPDATE_TABLE()} WHERE ID = ?`,
        { parameters: [rowId] }
      );
      expect(selRes.success).toBe(true);
      expect(selRes.data.length).toBe(1);

      const ref = selRes.data[0].JBLOB as BlobRef;
      expect(ref).not.toBeNull();
      expect(ref.size).toBe(newContent.length);

      const buf = await job.fetchBlob(ref);
      expect(buf.toString("utf8")).toBe(newContent);
    } finally {
      await job.execute(`DROP TABLE ${UPDATE_TABLE()}`).catch(() => {});
    }
  });

  // ── Test 13 ───────────────────────────────────────────────────────────────
  test("13. fetchBlob() on an unconnected job throws a 'not connected' error", async () => {
    const disconnectedJob = new SQLJob();
    // Do NOT call connect() — db2Server remains undefined

    const fakeRef: BlobRef = { blob_url: "/blob/fake-token", size: 1 };
    await expect(disconnectedJob.fetchBlob(fakeRef)).rejects.toThrow(
      /not connected/i
    );
  });

  // ── Test 14 ───────────────────────────────────────────────────────────────
  test("14. HTTP GET with a completely bogus token returns 404", async () => {
    const bogusPath = "/blob/00000000-0000-0000-0000-000000000000";
    const { status } = await httpGetRaw(creds, bogusPath);
    expect(status).toBe(404);
  });

  // ── Test 15 ───────────────────────────────────────────────────────────────
  test("15. blob_url token portion is a valid UUID (RFC 4122)", async () => {
    const sel = await job.execute<TempBlobRow>(
      `SELECT JBLOB FROM ${SMALL_TABLE()} WHERE JBLOB IS NOT NULL FETCH FIRST 1 ROW ONLY`
    );

    const ref = sel.data[0].JBLOB as BlobRef;
    expect(ref.blob_url).toMatch(/^\/blob\//);

    const token = ref.blob_url.replace(/^\/blob\//, "");
    expect(token).toMatch(UUID_RE);

    // Consume the token so it doesn't linger in the store
    await job.fetchBlob(ref).catch(() => {});
  });

  // ── Test 16 ───────────────────────────────────────────────────────────────
  test("16. BlobRef is returned correctly in terse-results mode", async () => {
    const res = await job.execute<TempBlobRow>(
      `SELECT JBLOB FROM ${SMALL_TABLE()} WHERE JBLOB IS NOT NULL FETCH FIRST 1 ROW ONLY`,
      { isTerseResults: true }
    );

    expect(res.success).toBe(true);
    expect(res.data.length).toBeGreaterThanOrEqual(1);

    // In terse mode data is an array of arrays, but the BlobRef shape should still be present
    const rowValue: any = Array.isArray(res.data[0])
      ? (res.data[0] as any[])[0]
      : res.data[0].JBLOB;

    expect(rowValue).not.toBeNull();
    expect(typeof rowValue).toBe("object");

    const ref = rowValue as BlobRef;
    expect(ref.blob_url).toMatch(/^\/blob\//);
    expect(typeof ref.size).toBe("number");
    expect(ref.size).toBeGreaterThan(0);

    // Consume the token
    await job.fetchBlob(ref).catch(() => {});
  });
});
