# Mapepire JS Client

<div align="center">

[![npm](https://img.shields.io/npm/v/@ibm/mapepire-js)](https://www.npmjs.com/package/@ibm/mapepire-js)
[![License](https://img.shields.io/github/license/Mapepire-IBMi/mapepire-js)](LICENSE)

</div>

`mapepire-js` is the pure TypeScript/JavaScript client for connecting to Db2 for IBM i. It supports three transport modes and provides both single-job and connection-pool APIs.

📖 [Full documentation](https://mapepire-ibmi.github.io/guides/usage/nodejs/) &nbsp;·&nbsp; 🐛 [Report a bug](https://github.com/Mapepire-IBMi/mapepire-js/issues/new/choose) &nbsp;·&nbsp; 🚀 [Changelog](CHANGELOG.md)

---

## Requirements

- Node.js 18 or later
- A running `mapepire-server` daemon on the target IBM i **or** SSH access to IBM i (see [transport modes](#transport-modes))

## Installation

```sh
npm install @ibm/mapepire-js
```

---

## Quick Start

```ts
import { SQLJob } from '@ibm/mapepire-js';

const job = new SQLJob();
await job.connect({
  host: process.env.DB2_HOST,
  user: process.env.DB2_USER,
  password: process.env.DB2_PASS,
});

const result = await job.execute<{ CURRENT_USER: string }>('values current user');
console.log(result.data);

await job.close();
```

---

## Transport Modes

`mapepire-js` supports three transport modes. Pick the one that fits your environment:

| Transport | How it connects | Requires |
|---|---|---|
| **WebSocket** (default) | Persistent WebSocket to Mapepire daemon | Daemon running on IBM i |
| **SSH Single** | Launches server in single mode over SSH | SSH access; no daemon needed |
| **Local Single** | Spawns server as child process | Running directly on IBM i; no credentials |

### WebSocket (default)

```ts
import { SQLJob, DaemonServer, DEFAULT_PORT } from '@ibm/mapepire-js';

const creds: DaemonServer = {
  host: 'myibmi.example.com',
  port: DEFAULT_PORT, // 8076
  user: 'USER',
  password: 'PASS',
};

const job = new SQLJob();
await job.connect(creds);
```

### SSH Single

No daemon required. `mapepire-js` connects via SSH and launches the server JAR in single-session mode. A bundled JAR is uploaded automatically when none is found on the remote system (private install).

> **Install an SSH library first** — `ssh2` or `node-ssh`:
> ```sh
> npm install ssh2   # or: npm install node-ssh
> ```

**Recommended — credential-first (SSH lifecycle managed internally):**

```ts
import { SQLJob } from '@ibm/mapepire-js';

// ssh2
const job = await SQLJob.ssh2({ host: 'myibmi.example.com', username: 'USER', password: 'PASS' });
await job.connect();
const result = await job.execute('SELECT * FROM QIWS.QCUSTCDT');
await job.close(); // SSH client torn down automatically

// node-ssh
const job2 = await SQLJob.nodeSSH({ host: 'myibmi.example.com', username: 'USER', password: 'PASS' });
await job2.connect();
await job2.close();
```

**Bring your own SSH client** (reuse an existing connection):

```ts
import { SQLJob, connectSSH2, createSSH2Connection } from '@ibm/mapepire-js';

const client = await connectSSH2({ host: 'myibmi.example.com', username: 'USER', password: 'PASS' });
const job = SQLJob.withConfig({ transport: 'ssh-single', sshSingle: createSSH2Connection(client) });
await job.connect();
await job.close();
client.end(); // caller manages SSH client lifetime
```

📖 [Full SSH Single transport docs](src/transports/README.md)

### Local Single (IBM i only)

For Node.js code running **directly on IBM i**. No daemon, no SSH, no credentials — the current IBM i job's user profile is used automatically via `jdbc:default:connection`.

```ts
import { SQLJob } from '@ibm/mapepire-js';

const job = SQLJob.withConfig({ transport: 'local-single' });
await job.connect(); // spawns JVM as child process
const result = await job.execute('SELECT * FROM QIWS.QCUSTCDT');
await job.close();
```

**Auto-detection:** When running on IBM i (`process.platform === 'os400'`) with no credentials supplied, `mapepire-js` selects `local-single` automatically.

---

## Running Queries

### `job.execute()` — one-shot

Opens, runs, and closes the cursor in one call. Use this for most queries.

```ts
const result = await job.execute<{ OBJNAME: string; OBJTYPE: string }>(
  `SELECT OBJNAME, OBJTYPE FROM TABLE(QSYS2.OBJECT_STATISTICS('QGPL', '*ALL', '*ALLSIMPLE'))`
);
result.data.forEach(row => console.log(`${row.OBJNAME} (${row.OBJTYPE})`));
```

### `job.query()` — cursor-based

Use when paging through large result sets or controlling cursor lifetime manually.

```ts
const query = job.query<{ NAME: string }>('SELECT * FROM SAMPLE.SYSCOLUMNS');
let result = await query.execute(100);
while (!result.is_done) {
  result = await query.fetchMore(100);
  console.table(result.data);
}
await query.close();
```

### Parameters

```ts
// Single row
const result = await job.execute<any>(
  'SELECT * FROM SAMPLE.EMPLOYEE WHERE WORKDEPT = ?',
  { parameters: ['A00'] }
);

// Batch (INSERT / UPDATE with multiple rows)
const query = job.query<any>('UPDATE SAMPLE.EMPLOYEE SET PHONE = ? WHERE NAME = ?', {
  parameters: [
    ['789-678-6543', 'SANJULA'],
    ['222-456-1234', 'TONGKUN'],
  ],
});
await query.execute();
await query.close();
```

### CL Commands

```ts
const query = job.clcommand("CRTLIB LIB(MYLIB1) TEXT('My library')");
const result = await query.execute();
```

---

## Connection Pooling

`Pool` manages a set of persistent WebSocket connections and distributes queries across them. It is **WebSocket-only** — SSH Single and Local Single are single-session transports and do not support pooling.

```ts
import { Pool } from '@ibm/mapepire-js';

const pool = new Pool({ creds, maxSize: 5, startingSize: 3 });
await pool.init();

// Execute on the least-busy job
const result = await pool.execute('VALUES CURRENT_USER');

// Tagged template — safe inline parameters
const dept = 'A00';
const rows = await pool.sql`SELECT * FROM SAMPLE.EMPLOYEE WHERE WORKDEPT = ${dept}`;

// Cursor from pool
const query = pool.query('SELECT * FROM SAMPLE.SYSCOLUMNS');
const page = await query.execute(50);

// Close all connections
pool.end();
```

---

## JDBC Options

Pass JDBC options to control naming convention, library list, transaction isolation, and more:

```ts
import { SQLJob, JDBCOptions } from '@ibm/mapepire-js';

const opts: JDBCOptions = {
  naming: 'system',
  libraries: ['MYLIB1', 'MYLIB2'],
  'transaction isolation': 'none',
};

// Single job
const job = new SQLJob(opts);
await job.connect(creds);

// Pool
const pool = new Pool({ creds, opts, maxSize: 5, startingSize: 3 });
```

---

## Secure Connections

By default `mapepire-js` connects over TLS. For servers using a self-signed certificate, fetch and pin the root CA before connecting:

```ts
import { getRootCertificate, DaemonServer, Pool } from '@ibm/mapepire-js';

const creds: DaemonServer = { host: '...', user: '...', password: '...' };

const ca = await getRootCertificate(creds);
if (ca) creds.ca = ca; // only set when not a publicly trusted CA

const pool = new Pool({ creds, maxSize: 5, startingSize: 3 });
```

> ⚠️ Setting `rejectUnauthorized: false` skips certificate validation entirely — only use this for local development, never in production.

---

## Other APIs

| API | Description |
|-----|-------------|
| `job.explain(sql, type?)` | Visual Explain — `States.ExplainType.RUN` (default) or `DO_NOT_RUN` |
| `job.getClDoc(cmdPath)` | Fetch HTML/UIM documentation for a CL command |
| `job.fetchBlob(blobRef)` | Read BLOB column bytes into a `Buffer` |
| `UrlToDaemon(uri)` | Parse a `db2i://` connection URI into a `DaemonServer` (password must be base64-encoded) |
| `job.setTraceConfig(dest, level)` | Enable server-side tracing (`IN_MEM` or `FILE`) |
| `job.getTraceData()` | Read in-memory trace data back from the server |
| `job.connect(creds, appName)` | Pass a custom application name for connection tracking on IBM i |

---

## Development

```sh
git clone https://github.com/Mapepire-IBMi/mapepire-js.git
cd mapepire-js
npm install
cp .env.sample .env   # fill in your IBM i credentials
npm run webpack        # build
npm run test           # run integration tests (requires IBM i)
```

See [CONTRIBUTING.md](.github/CONTRIBUTING.md) for the full contributor guide, including how to run tests without IBM i access.

---

## Sample Applications

Browse end-to-end examples in the [mapepire-samples](https://github.com/Mapepire-IBMi/samples/tree/main/typescript) repository.
