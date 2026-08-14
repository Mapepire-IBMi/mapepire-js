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
Launch mapepire-server in single mode via SSH. No daemon required. The simplest path uses
`createSSH2Connection` which enables private install automatically — no pre-installed server needed.

```typescript
import { Client } from 'ssh2';
import { SQLJob, createSSH2Connection } from '@ibm/mapepire-js';

const client = new Client();
// ... connect client ...

const job = SQLJob.withConfig({
  transport: 'ssh-single',
  sshSingle: createSSH2Connection(client),  // private install enabled automatically
});

await job.connect();  // installs JAR to $HOME/.mapepire if needed, then connects
const result = await job.execute('SELECT * FROM QIWS.QCUSTCDT');
await job.close();
client.end();
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

## SSH Helpers

Built-in helpers for ssh2 and node-ssh libraries:

| Function | Returns | Use when |
|---|---|---|
| `createSSH2Connection(client)` | `{ exec, upload }` | **Default** — private install enabled automatically |
| `createNodeSSHConnection(ssh)` | `{ exec, upload }` | **Default** — node-ssh variant |
| `createSSH2Exec(client)` | `ExecFunction` | Advanced — you supply `serverPath` explicitly |
| `createSSH2Upload(client)` | `UploadFunction` | Advanced — compose `exec` + `upload` manually |
| `createNodeSSHExec(ssh)` | `ExecFunction` | Advanced — you supply `serverPath` explicitly |
| `createNodeSSHUpload(ssh)` | `UploadFunction` | Advanced — compose `exec` + `upload` manually |

### Default usage (recommended)

Pass the result of `createSSH2Connection` / `createNodeSSHConnection` directly to `sshSingle`.
Private install is enabled automatically — no extra options required.

**ssh2:**
```typescript
import { Client } from 'ssh2';
import { SQLJob, createSSH2Connection } from '@ibm/mapepire-js';

const client = new Client();
// ... connect client ...

const job = SQLJob.withConfig({
  transport: 'ssh-single',
  sshSingle: createSSH2Connection(client),
});
await job.connect();
```

**node-ssh:**
```typescript
import { NodeSSH } from 'node-ssh';
import { SQLJob, createNodeSSHConnection } from '@ibm/mapepire-js';

const ssh = new NodeSSH();
await ssh.connect({ host: 'ibmi.example.com', username: 'user', password: 'pass' });

const job = SQLJob.withConfig({
  transport: 'ssh-single',
  sshSingle: createNodeSSHConnection(ssh),
});
await job.connect();
```

Need extra options (`javaPath`, `startupTimeout`, etc.)? Spread the connection:

```typescript
sshSingle: {
  ...createSSH2Connection(client),   // or createNodeSSHConnection(ssh)
  javaPath: '/QOpenSys/QIBM/ProdData/JavaVM/jdk17/64bit/bin/java',
  startupTimeout: 20000,
}
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

## Quick Comparison

| Feature | WebSocket | SSH Single |
|---------|-----------|------------|
| **Setup** | Requires daemon | No daemon needed |
| **Connection** | Network socket | SSH tunnel |
| **Use Case** | Production servers | Development, SSH-only access |
| **Requirements** | Daemon server running | SSH access, JAR on system |
| **Performance** | Fast | Slightly slower startup |
