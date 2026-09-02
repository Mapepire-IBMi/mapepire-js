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
Launch mapepire-server in single mode via SSH. No daemon required.

```typescript
import { Client } from 'ssh2';
import { SQLJob, createSSH2Exec } from '@ibm/mapepire-js';

// 1. Connect SSH client
const client = new Client();

// 2. Create job with helper - no manual exec function needed!
const job = SQLJob.withConfig({
  transport: 'ssh-single',
  sshSingle: {
    exec: createSSH2Exec(client),
    serverPath: '/path/to/mapepire-server.jar'
  }
});

// 3. Use normally
await job.connect();
const result = await job.execute('SELECT * FROM QIWS.QCUSTCDT');
await job.close();
client.end();
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

## SSH Helpers

Built-in helpers for ssh2 and node-ssh libraries simplify SSH integration:

### ssh2 Helper
```typescript
import { createSSH2Exec } from '@ibm/mapepire-js';

const exec = createSSH2Exec(connectedClient);
```

### node-ssh Helper
```typescript
import { createNodeSSHExec } from '@ibm/mapepire-js';

const exec = createNodeSSHExec(connectedSSH);
```

**Key Principle:** You manage SSH connections, we handle protocol mapping.

## Configuration

### Options

See [`SSHSingleConfig`](../types.ts) and [`LocalSingleConfig`](../types.ts) in `src/types.ts` for the full option definitions including defaults.

> **Note:** Required IBM i stdio env vars (`QIBM_JAVA_STDIO_CONVERT=N`, `QIBM_PASE_DESCRIPTOR_STDIO=B`,
> `QIBM_USE_DESCRIPTOR_STDIO=Y`, `QIBM_MULTI_THREADED=Y`) are always set last and cannot be overridden.
> They prevent the JVM/PASE layer from corrupting the JSON protocol stream.

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
