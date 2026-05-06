# Mapepire Transport Layer

The transport layer provides flexible connection mechanisms to IBM i systems. Choose the transport that best fits your deployment scenario.

## Available Transports

### 🌐 WebSocket Transport (Traditional)

Connect to a running mapepire-server daemon via secure WebSocket.

**Best for:** Production environments, multiple concurrent users, shared server infrastructure

```typescript
import { SQLJob } from '@ibm/mapepire-js';

const job = SQLJob.withConfig({
  transport: 'websocket',
  daemon: {
    host: 'ibmi.example.com',
    port: 8076,
    user: 'myuser',
    password: 'mypassword'
  }
});

await job.connect();
const result = await job.query('SELECT * FROM QIWS.QCUSTCDT').execute();
await job.close();
```

**Requirements:**
- mapepire-server daemon running on IBM i
- Network port 8076 accessible
- TLS/SSL certificate configured

---

### 🔐 SSH Single Transport (New)

Launch mapepire-server on-demand via SSH, no daemon required.

**Best for:** Development, single-user scenarios, environments without daemon access

```typescript
import { Client } from 'ssh2';
import { SQLJob } from '@ibm/mapepire-js';

const ssh = new Client();
ssh.connect({ /* SSH config */ });

ssh.on('ready', async () => {
  const exec = (cmd) => new Promise((resolve, reject) => {
    ssh.exec(cmd, (err, stream) => {
      if (err) return reject(err);
      resolve({
        stdin: stream.stdin,
        stdout: stream,
        stderr: stream.stderr,
        close: () => stream.close(),
        onExit: (cb) => stream.on('close', cb)
      });
    });
  });

  const job = SQLJob.withConfig({
    transport: 'ssh-single',
    sshSingle: {
      exec,
      serverPath: '/path/to/mapepire-server.jar'
    }
  });

  await job.connect();
  const result = await job.query('SELECT * FROM QIWS.QCUSTCDT').execute();
  await job.close();
});
```

**Requirements:**
- SSH access to IBM i
- mapepire-server JAR file on IBM i
- Java runtime on IBM i
- SSH library (ssh2, node-ssh, etc.)


## Configuration Examples

### WebSocket with TLS

```typescript
const job = SQLJob.withConfig({
  transport: 'websocket',
  daemon: {
    host: 'ibmi.example.com',
    user: 'myuser',
    password: 'mypassword',
    ca: fs.readFileSync('/path/to/ca-cert.pem'),
    rejectUnauthorized: true
  }
});
```

### SSH Single with Custom Java

```typescript
const job = SQLJob.withConfig({
  transport: 'ssh-single',
  sshSingle: {
    exec,
    serverPath: '/home/myuser/mapepire-server.jar',
    javaPath: '/QOpenSys/pkgs/bin/java',
    jvmArgs: ['-Xmx512m'],
    cwd: '/home/myuser',
    startupTimeout: 15000
  }
});
```

---

## SSH Library Adapters

### Using ssh2

```typescript
import { Client } from 'ssh2';

const ssh = new Client();
const exec = (cmd) => new Promise((resolve, reject) => {
  ssh.exec(cmd, (err, stream) => {
    if (err) return reject(err);
    resolve({
      stdin: stream.stdin,
      stdout: stream,
      stderr: stream.stderr,
      close: () => stream.close(),
      onExit: (cb) => stream.on('close', cb)
    });
  });
});
```

### Using node-ssh

```typescript
import { NodeSSH } from 'node-ssh';

const ssh = new NodeSSH();
const exec = async (cmd) => {
  const stream = await ssh.exec(cmd, [], { stream: 'both' });
  return {
    stdin: stream.stdin,
    stdout: stream,
    stderr: stream.stderr,
    close: () => stream.close(),
    onExit: (cb) => stream.on('close', cb)
  };
};
```

---

## Troubleshooting

### WebSocket Issues

**Connection refused:**
```bash
# Check if daemon is running
WRKACTJOB SBS(QHTTPSVR)
```

**Certificate errors:**
```typescript
// For development only - accept self-signed certs
daemon: { rejectUnauthorized: false }
```

### SSH Single Issues

**Can't find mapepire-server.jar:**
```bash
# SSH into IBM i and search for the JAR file
ssh user@ibmi.example.com "find /home /opt /QOpenSys/opt -name 'mapepire-server*.jar' 2>/dev/null"

# Common locations:
# - /home/YOURUSER/mapepire-server.jar
# - /opt/mapepire/mapepire-server.jar
# - /QOpenSys/opt/mapepire/mapepire-server.jar

# If not found, download from GitHub releases:
# https://github.com/IBM/mapepire-server/releases
```

**Can't find Java:**
```bash
# Check if Java is installed
ssh user@ibmi.example.com "which java"

# Common Java locations:
# - /QOpenSys/pkgs/bin/java (recommended - open source)
# - /QOpenSys/QIBM/ProdData/JavaVM/jdk11/64bit/bin/java (IBM Java 11)
# - /QOpenSys/QIBM/ProdData/JavaVM/jdk80/64bit/bin/java (IBM Java 8)

# Install open source Java if needed:
# yum install openjdk-11
```

**Startup timeout:**
```typescript
// Increase timeout
sshSingle: { startupTimeout: 20000 }
```

**Enable debug logging:**
```bash
export MAPEPIRE_SSH_DEBUG=1
node your-script.js
```

---

## Migration Guide

### From Legacy API

**Before:**
```typescript
const job = new SQLJob(options);
await job.connect(daemonServer);
```

**After:**
```typescript
const job = SQLJob.withConfig({
  transport: 'websocket',
  daemon: daemonServer
}, options);
await job.connect();
```

Both APIs are fully supported and backward compatible.