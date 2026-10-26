# Mapepire JS Client

<div align="center">

[![npm](https://img.shields.io/npm/v/@ibm/mapepire-js)](https://www.npmjs.com/package/@ibm/mapepire-js)
[![License](https://img.shields.io/github/license/Mapepire-IBMi/mapepire-js)](LICENSE)

</div>

`mapepire-js` is the pure TypeScript/JavaScript client for connecting to Db2 for IBM i. It supports three transport modes and provides both single-job and connection-pool APIs.

📖 [Documentation](https://mapepire-ibmi.github.io/guides/usage/nodejs/) &nbsp;·&nbsp; 🐛 [Report a bug](https://github.com/Mapepire-IBMi/mapepire-js/issues/new/choose) &nbsp;·&nbsp; 🚀 [Changelog](CHANGELOG.md)

---

## Installation

```sh
npm install @ibm/mapepire-js
```

## Quick Start

```ts
import { SQLJob } from '@ibm/mapepire-js';

const job = new SQLJob();
await job.connect({
  host: process.env.DB2_HOST,
  user: process.env.DB2_USER,
  password: process.env.DB2_PASS,
  // Server uses a self-signed certificate? See "Secure Connections" in the docs.
});

const result = await job.execute<{ CURRENT_USER: string }>('values current user');
console.log(result.data);

await job.close();
```

## Transport Modes

| Transport | How it connects | Requires |
|---|---|---|
| **WebSocket** (default) | Persistent WebSocket to the Mapepire daemon | Daemon running on IBM i |
| **SSH Single** | Launches the server in single mode over SSH | SSH access; no daemon needed |
| **Local Single** | Spawns the server as a child process | Node.js running directly on IBM i; no credentials |

Examples and configuration options for each transport are in the [transports guide](src/transports/README.md).

## Learn More

The [Node.js usage guide](https://mapepire-ibmi.github.io/guides/usage/nodejs/) covers queries, parameters, paging, pooling, JDBC options, secure connections, and the rest of the API.

For end-to-end examples, see the [mapepire-samples](https://github.com/Mapepire-IBMi/samples/tree/main/typescript) repository.

## Contributing

See [CONTRIBUTING.md](.github/CONTRIBUTING.md) for setup, testing, and pull request guidelines.
