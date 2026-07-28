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

### SSH Single Options
```typescript
interface SSHSingleConfig {
  exec: ExecFunction;           // Required: SSH exec function
  serverPath?: string;          // Optional: Path to JAR on IBM i
                                //   default: /opt/mapepire/lib/mapepire/mapepire-server.jar
  javaPath?: string;            // Optional: Java path
                                //   default: /QOpenSys/QIBM/ProdData/JavaVM/jdk80/64bit/bin/java
  jvmArgs?: string[];           // Optional: Additional JVM arguments
  cwd?: string;                 // Optional: Working directory
  env?: NodeJS.ProcessEnv;      // Optional: Additional env vars (required IBM i vars are always set)
  startupTimeout?: number;      // Optional: Startup timeout (default: 10000ms)
}
```

## Files

- [`websocket.ts`](./websocket.ts) - WebSocket transport implementation
- [`sshSingleTransport.ts`](./sshSingleTransport.ts) - SSH single transport implementation
- [`ssh2Helper.ts`](./ssh2Helper.ts) - Helper for ssh2 library
- [`nodeSSHHelper.ts`](./nodeSSHHelper.ts) - Helper for node-ssh library
- [`lineBuffer.ts`](./lineBuffer.ts) - Line buffering utility for SSH

## Tests

Comprehensive test coverage available:
- [`test/sshHelpers.test.ts`](../../test/sshHelpers.test.ts) - SSH helper tests (15 test cases)
- [`test/sshSingleTransport.test.ts`](../../test/sshSingleTransport.test.ts) - Transport layer tests

## Quick Comparison

| Feature | WebSocket | SSH Single |
|---------|-----------|------------|
| **Setup** | Requires daemon | No daemon needed |
| **Connection** | Network socket | SSH tunnel |
| **Use Case** | Production servers | Development, SSH-only access |
| **Requirements** | Daemon server running | SSH access, JAR on system |
| **Performance** | Fast | Slightly slower startup |
