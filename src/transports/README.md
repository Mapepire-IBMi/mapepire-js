# Transports

Mapepire-JS supports multiple transport mechanisms for connecting to IBM i systems.

## Available Transports

### 1. WebSocket Transport (Default)
Traditional daemon-based connection using WebSocket protocol.

```typescript
const job = new SQLJob();
await job.connect({
  host: 'ibmi.example.com',
  port: 8076,
  user: 'username',
  password: 'password'
});
```

### 2. SSH Single Transport
Launch mapepire-server in single mode via SSH. No daemon required. Private install is enabled
automatically — no pre-installed server needed.

**ssh2** (simplest):
```typescript
import { SQLJob, connectSSH2, createSSH2Connection } from '@ibm/mapepire-js';

const client = await connectSSH2({ host: 'ibmi.example.com', username: 'USER', password: 'PASS' });

const job = SQLJob.withConfig({
  transport: 'ssh-single',
  sshSingle: createSSH2Connection(client),
});

await job.connect();  // installs JAR to $HOME/.mapepire if needed, then connects
const result = await job.execute('SELECT * FROM QIWS.QCUSTCDT');
await job.close();
client.end();
```

**node-ssh** (simplest):
```typescript
import { SQLJob, connectNodeSSH, createNodeSSHConnection } from '@ibm/mapepire-js';

const ssh = await connectNodeSSH({ host: 'ibmi.example.com', username: 'USER', password: 'PASS' });

const job = SQLJob.withConfig({
  transport: 'ssh-single',
  sshSingle: createNodeSSHConnection(ssh),
});

await job.connect();
const result = await job.execute('SELECT * FROM QIWS.QCUSTCDT');
await job.close();
ssh.dispose();
```

Need extra options? Spread the connection alongside them:

```typescript
const job = SQLJob.withConfig({
  transport: 'ssh-single',
  sshSingle: {
    ...createSSH2Connection(client),
    javaPath: '/QOpenSys/QIBM/ProdData/JavaVM/jdk17/64bit/bin/java',
    startupTimeout: 20000,
  },
});
```

### Private Install — how it works

`createSSH2Connection` (and `createNodeSSHConnection`) bundles both `exec` and `upload` so
mapepire-js can manage the server JAR automatically:

1. Searches `$HOME/.mapepire` **and** `$HOME/.vscode` (vscode-ibmi's location) for any existing JAR
2. If a version **≥ bundled** is found → uses it as-is, no upload
3. If nothing usable is found → uploads the bundled JAR to `$HOME/.mapepire/`, verifies its
   SHA-256, then launches

SHA-256 is only verified on a JAR we just uploaded — not on a pre-existing remote JAR, because
`JAR_SHA256` is specific to the bundled version and cannot vouch for any other version's bytes.

If `serverPath` is explicitly set, private install is skipped entirely (caller manages the path).

## Pool with SSH Single

Use `Pool` for production SSH single workloads: it pre-warms N JVM processes at startup
so queries are served immediately without paying the 15–18 s JVM boot cost per request.

> **Sizing guidance:** Each pool job is a full JVM process on IBM i. The dominant cost
> is native PASE process RAM (~300 MB per job, fixed regardless of query load) — not
> Java heap, which stays small at idle. Set `startingSize === maxSize` to pre-warm all
> jobs upfront; dynamic scale-up triggers a JVM boot (~15–18 s) that cannot help a burst
> already in flight. A pool of 3–5 is right for most workloads. Unlike WebSocket pools
> (where adding jobs costs almost nothing), each SSH Single pool slot consumes real IBM i
> memory — size conservatively.

**Tier 1 — Ergonomic (recommended):**

```typescript
import { connectSSH2, createSSH2PoolConfig, Pool } from '@ibm/mapepire-js';

// One SSH connection, N JVM processes sharing it
const client = await connectSSH2({ host: 'ibm-i.example.com', username: 'USER', password: 'PASS' });

const pool = new Pool({
  config: createSSH2PoolConfig(client),
  maxSize: 5,
  startingSize: 5,  // pre-warm all — JVM boot is expensive
});
await pool.init();  // private install runs once here, then all 5 JVMs start in parallel

const result = await pool.execute('SELECT * FROM QIWS.QCUSTCDT');
await pool.end();
client.end();  // caller closes SSH client after pool
```

**node-ssh variant:**

```typescript
import { connectNodeSSH, createNodeSSHPoolConfig, Pool } from '@ibm/mapepire-js';

const ssh = await connectNodeSSH({ host: 'ibm-i.example.com', username: 'USER', password: 'PASS' });

const pool = new Pool({
  config: createNodeSSHPoolConfig(ssh),
  maxSize: 5,
  startingSize: 5,
});
await pool.init();
// ... use pool ...
await pool.end();
ssh.dispose();
```

**Tier 2 — Advanced (full manual control):**

```typescript
import { createSSH2Exec, createSSH2Upload, Pool } from '@ibm/mapepire-js';

const pool = new Pool({
  config: {
    transport: 'ssh-single',
    sshSingle: {
      exec: createSSH2Exec(client),
      upload: createSSH2Upload(client),
      javaPath: '/QOpenSys/QIBM/ProdData/JavaVM/jdk17/64bit/bin/java',
      // NOTE: no teardown — Pool does not own the SSH client
    },
  },
  maxSize: 5,
  startingSize: 5,
});
```

**SSH client lifecycle rules:**
- `pool.end()` closes all SQLJob instances (terminates exec channels + JVMs)
- The SSH client is **not** closed by `pool.end()` — caller must call `client.end()` / `ssh.dispose()` after
- **Never set `teardown`** on a config passed to Pool — it would close the shared SSH client when the first job closes

## SSH Helpers

Built-in helpers for ssh2 and node-ssh libraries:

| Function | Returns | Use when |
|---|---|---|
| `connectSSH2(options)` | `Promise<Client>` | **Recommended** — connect + get a ready Client in one call |
| `connectNodeSSH(options)` | `Promise<NodeSSH>` | **Recommended** — node-ssh variant |
| `createSSH2PoolConfig(client, opts?)` | `MapepireConfig` | **Pool** — shared client, no teardown, private install once |
| `createNodeSSHPoolConfig(ssh, opts?)` | `MapepireConfig` | **Pool** — node-ssh variant |
| `createSSH2Connection(client)` | `{ exec, upload }` | You already have a connected Client |
| `createNodeSSHConnection(ssh)` | `{ exec, upload }` | You already have a connected NodeSSH |
| `createSSH2Exec(client)` | `ExecFunction` | Advanced — you supply `serverPath` explicitly |
| `createSSH2Upload(client)` | `UploadFunction` | Advanced — compose `exec` + `upload` manually |
| `createNodeSSHExec(ssh)` | `ExecFunction` | Advanced — you supply `serverPath` explicitly |
| `createNodeSSHUpload(ssh)` | `UploadFunction` | Advanced — compose `exec` + `upload` manually |

### Already have a connected client?

Pass it straight to `createSSH2Connection` / `createNodeSSHConnection` — useful when you're
reusing an existing SSH connection across multiple jobs:

```typescript
sshSingle: createSSH2Connection(client)       // ssh2
sshSingle: createNodeSSHConnection(ssh)       // node-ssh
```

### Advanced usage — explicit exec + upload

Use `createSSH2Exec` / `createSSH2Upload` (or their node-ssh equivalents) directly when you need
to compose them separately — for example, to use a different upload mechanism or to opt out of
private install entirely by setting `serverPath`.

```typescript
import { createSSH2Exec, createSSH2Upload } from '@ibm/mapepire-js';

// Private install with manually composed helpers (equivalent to createSSH2Connection)
sshSingle: {
  exec:   createSSH2Exec(client),
  upload: createSSH2Upload(client),
}

// Opt out of private install — bring your own JAR path
sshSingle: {
  exec:       createSSH2Exec(client),
  serverPath: '/opt/mapepire/lib/mapepire/mapepire-server.jar',
}
```

**Key Principle:** You manage SSH connections, we handle protocol mapping.

## Configuration

### SSH Single Options
```typescript
interface SSHSingleConfig {
  exec: ExecFunction;           // Required: SSH exec function
  serverPath?: string;          // Optional: Path to JAR on IBM i
                                //   default: /opt/mapepire/lib/mapepire/mapepire-server.jar
  upload?: UploadFunction;      // Optional: enables private install (see above)
  privateInstallDir?: string;   // Optional: override install dir (default: $HOME/.mapepire)
  javaPath?: string;            // Optional: Java path
                                //   default: /QOpenSys/QIBM/ProdData/JavaVM/jdk80/64bit/bin/java
  jvmArgs?: string[];           // Optional: Additional JVM arguments
  cwd?: string;                 // Optional: Working directory
  env?: NodeJS.ProcessEnv;      // Optional: Additional env vars (required IBM i vars are always set)
  startupTimeout?: number;      // Optional: Startup timeout (default: 10000ms)
}
```

## Updating the Bundled Server Version

The bundled JAR version is pinned in [`src/serverVersion.ts`](../serverVersion.ts). To upgrade:

1. **Edit `VERSION`** in `src/serverVersion.ts`:
   ```typescript
   export const VERSION = `2.3.7`;  // bump to the new release tag
   ```
   Do **not** edit `JAR_SHA256` — the build script overwrites it automatically.

2. **Run the download script** (or just `npm run prepack`):
   ```sh
   npx tsx scripts/downloadServer.ts
   ```
   This fetches `mapepire-server-2.3.7.jar` from GitHub Releases, saves it to `dist/`, computes
   its SHA-256, and patches `JAR_SHA256` back into `src/serverVersion.ts`.

3. **Commit both changed files** — `src/serverVersion.ts` and `dist/mapepire-server-X.Y.Z.jar` —
   then publish.

> The JAR ships inside the npm tarball. Consumers never run the download script; they get the
> pre-bundled JAR when they `npm install`.

## Files

- [`websocket.ts`](./websocket.ts) - WebSocket transport implementation
- [`sshSingleTransport.ts`](./sshSingleTransport.ts) - SSH single transport implementation
- [`ssh2Helper.ts`](./ssh2Helper.ts) - Helper for ssh2 library
- [`nodeSSHHelper.ts`](./nodeSSHHelper.ts) - Helper for node-ssh library
- [`lineBuffer.ts`](./lineBuffer.ts) - Line buffering utility for SSH

## Tests

Comprehensive test coverage available:
- [`test/sshHelpers.test.ts`](../../test/sshHelpers.test.ts) - SSH helper unit + integration tests
- [`test/sshSingleTransport.test.ts`](../../test/sshSingleTransport.test.ts) - Transport layer tests
- [`test/serverInstaller.test.ts`](../../test/serverInstaller.test.ts) - Private install logic (10 test cases)
- [`test/poolSshSingle.test.ts`](../../test/poolSshSingle.test.ts) - Pool + SSH Single unit tests (offline, mocked)
- [`test/pool.test.ts`](../../test/pool.test.ts) - Pool tests including SSH Single live IBM i section (env-gated)

## Quick Comparison

| Feature | WebSocket | SSH Single |
|---------|-----------|------------|
| **Setup** | Requires daemon | No daemon needed |
| **Connection** | Network socket | SSH tunnel |
| **Pool support** | Yes (`Pool({ creds })`) | Yes (`Pool({ config: createSSH2PoolConfig(client) })`) |
| **Use Case** | Production servers | Production / SSH-only access |
| **Requirements** | Daemon server running | SSH access, JAR on system |
| **Warm query latency** | ~280 ms | ~323 ms (essentially same) |
| **Pool startup cost** | ~1.85 s (WS handshakes) | ~15–18 s (JVM boots) |
