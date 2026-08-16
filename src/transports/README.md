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

### 3. Local Single Transport (Authentication-Free, IBM i only)
Launch mapepire-server as a local child process — no daemon, no SSH, no credentials.
The current IBM i job's user profile is used automatically via `jdbc:default:connection`.

**Requires:** Node.js running on IBM i (`process.platform === 'os400'`)

**Auto-Detection:** When running on IBM i (`process.platform === 'os400'`), if no `transport` and no user credentials (`daemon.user` or `db2Server.user`) are supplied, Mapepire-JS automatically selects `local-single` transport.

```typescript
import { SQLJob } from '@ibm/mapepire-js';

// Explicit config or auto-detection on IBM i when no user is provided:
const job = SQLJob.withConfig({
  // transport: 'local-single', // Optional on IBM i
  localSingle: {
    serverPath: '/QOpenSys/pkgs/lib/mapepire/mapepire-server.jar' // Optional, defaults to RPM path
  }
});

await job.connect();  // Spawns JVM as child process — no credentials needed
const result = await job.execute('SELECT * FROM QIWS.QCUSTCDT');
await job.close();    // Sends exit request and kills child JVM
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
| `connectSSH2(options)` | `Promise<Client>` | **Recommended** — connect + get a ready Client in one call |
| `connectNodeSSH(options)` | `Promise<NodeSSH>` | **Recommended** — node-ssh variant |
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

### Options

See [`SSHSingleConfig`](../types.ts) and [`LocalSingleConfig`](../types.ts) in `src/types.ts` for the full option definitions including defaults.

> **Note:** Required IBM i stdio env vars (`QIBM_JAVA_STDIO_CONVERT=N`, `QIBM_PASE_DESCRIPTOR_STDIO=B`,
> `QIBM_USE_DESCRIPTOR_STDIO=Y`, `QIBM_MULTI_THREADED=Y`) are always set last and cannot be overridden.
> They prevent the JVM/PASE layer from corrupting the JSON protocol stream.

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
- [`localSingleTransport.ts`](./localSingleTransport.ts) - Local single transport implementation
- [`ssh2Helper.ts`](./ssh2Helper.ts) - Helper for ssh2 library
- [`nodeSSHHelper.ts`](./nodeSSHHelper.ts) - Helper for node-ssh library
- [`lineBuffer.ts`](./lineBuffer.ts) - Line buffering utility for stdio transports

## Tests

Comprehensive test coverage available:
- [`test/sshHelpers.test.ts`](../../test/sshHelpers.test.ts) - SSH helper tests (15 test cases)
- [`test/sshSingleTransport.test.ts`](../../test/sshSingleTransport.test.ts) - SSH transport layer tests
- [`test/localSingleTransport.test.ts`](../../test/localSingleTransport.test.ts) - Local transport layer tests
- [`test/serverInstaller.test.ts`](../../test/serverInstaller.test.ts) - Private install logic (10 test cases)

## Quick Comparison

| Feature | WebSocket | SSH Single | Local Single |
|---------|-----------|------------|--------------|
| **Setup** | Requires daemon | No daemon needed | No daemon needed |
| **Connection** | Network socket | SSH tunnel | child_process.spawn |
| **Authentication** | username + password | SSH key/password | **None** |
| **Platform** | Any | Any client | IBM i only |
| **Use Case** | Production servers | Remote access | On-IBM-i apps |
| **Requirements** | Daemon server running | SSH access, JAR on system | JAR on system |
| **Performance** | Fast | Slight SSH overhead | Fast (local spawn) |
