/**
 * BLOB support tests for mapepire-js in daemon mode.
 *
 * Mirrors the scenarios in mapepire-server/scripts/test-blob-daemon.js:
 *
 *  1. INSERT a BLOB via prepared-statement parameter (Base64 encoded)
 *  2. SELECT the BLOB column — expect a BlobRef {blob_url, size} in the result
 *  3. fetchBlob() with correct credentials — returns the raw bytes
 *  4. fetchBlob() a second time on the same token — throws (single-use, 404)
 *  5. Direct HTTP GET with wrong credentials — throws with 401 message
 *  6. SELECT a NULL BLOB — result cell is null
 *  7. INSERT a large BLOB (>1 MB), SELECT returns BlobRef quickly (async spool),
 *     fetchBlob() returns all bytes with correct content
 *
 * Prerequisites (run once on the server):
 *   CREATE TABLE <user>.TEMPBLOB ( JBLOB BLOB(100) )
 *
 * Test 7 creates and drops its own table (<user>.TEMPBLOB_LARGE) so no
 * manual DDL is required for the large-blob scenario.
 */

import https from "https";
import { beforeAll, afterAll, describe, expect, test } from "vitest";
import { BlobRef, DaemonServer, QueryResult } from "../src/types";
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

// ---------------------------------------------------------------------------
// Row shape helpers
// ---------------------------------------------------------------------------

interface TempBlobRow {
  JBLOB: BlobRef | null;
}

// ---------------------------------------------------------------------------
// Shared state
// ---------------------------------------------------------------------------

let creds: DaemonServer;
let job: SQLJob;

/** Schema derived from the connected user (upper-cased). */
let schema: string;

const SMALL_TABLE = () => `${schema}.TEMPBLOB`;
const LARGE_TABLE = () => `${schema}.TEMPBLOB_LARGE`;

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeAll(async () => {
  creds = { ...ENV_CREDS };
  creds.ca = await getRootCertificate(creds);

  job = new SQLJob();
  await job.connect(creds);

  schema = (creds.user as string).toUpperCase();

  // Clean up any rows left over from a previous failed run (ignore if table is empty or missing)
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
 * Execute a raw HTTPS GET to the mapepire server using a different password.
 * Returns the HTTP status code.
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
      // Drain the response so the socket closes cleanly
      res.resume();
      res.on("end", () => resolve(res.statusCode ?? -1));
    });
    req.on("error", () => resolve(-1));
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
});
