# AGENTS.md

This file provides guidance to agents when working with code in this repository.

## Mandatory: Read Before Making Any Change

- **`strict: false` and `noImplicitAny: false` are intentional** — never change these. IBM i JavaScript interop and the `allowJs: true` flag require relaxed settings.
- **`tsconfig.json` excludes `test/` and `scripts/`** — the TS compiler only covers `src/**/*`. Tests run via vitest's own TypeScript transform.
- **`ssh2` and `node-ssh` are `devDependencies` / webpack externals** — consumers install them separately. Never move them to `dependencies`.
- **Never manually edit `JAR_SHA256` in `src/serverVersion.ts`** — it is overwritten automatically by `scripts/downloadServer.ts`. To update the bundled server: change only `VERSION`, then run `npx tsx scripts/downloadServer.ts`.
- **All public symbols must be re-exported from `src/index.ts`** — if it's not there, consumers cannot import it.

---

## Build & Test Commands

```sh
npm ci                        # install
npm run webpack               # compile src/ → dist/ (required before publish, NOT before tests)
npm run webpack:dev            # same, unminified (useful for debugging)
npm run test                   # vitest run --bail 5 (stops after 5 failures)
npx vitest run test/connect.test.ts          # single test file
npx vitest run -t "Connect to database"      # single test by name
```

> Tests import directly from `'../src'` — vitest transforms TypeScript itself. You do **not** need to run webpack before running tests.

---

## Architecture: How the Pieces Fit

```
SQLJob / Pool
   │
   └─► Transport interface (src/transport.ts)
         ├── WebSocketTransport   (default — daemon mode)
         ├── SSHSingleTransport   (no daemon; launches JAR over SSH)
         └── LocalSingleTransport (IBM i only; spawns JAR as child process)
```

- **`new SQLJob(jdbcOpts?, transport?)`** — WebSocket transport by default. Pass `JDBCOptions` as first arg.
- **`SQLJob.withConfig(MapepireConfig, jdbcOpts?)`** — preferred for SSH Single / Local Single. Sets `_mapepireConfig`; transport is created from it.
- **`SQLJob.ssh2(creds)` / `SQLJob.nodeSSH(creds)`** — credential-first factories; manage SSH lifecycle internally via a `teardown` callback injected into `sshSingle`.
- **`job.connect(db2Server?, appName?)`** — for WebSocket jobs, pass `DaemonServer`. For `withConfig`-created jobs, call `connect()` with no args.
- **`Pool` is WebSocket-only** — `PoolOptions.creds` is a `DaemonServer`. SSH Single and Local Single are single-session and must never be used with `Pool`.

---

## Non-Obvious Patterns Agents Must Follow

### State / Enum Pattern
Never use TypeScript `enum`. All constants use the `const object + union type` pattern (see `src/states.ts`):
```ts
export const MyState = { FOO: "foo", BAR: "bar" } as const;
export type MyState = typeof MyState[keyof typeof MyState];
```
This was explicitly migrated away from `enum` (issue #52) to fix JS/TS interop for consumers.

### Query Lifecycle
- `query.execute()` throws if called when state is already `RUN_MORE_DATA_AVAILABLE` or `RUN_DONE` — you cannot re-execute a query object.
- `query.close()` must always be called — even on fully-read queries. The server retains prepared statement resources until `sqlclose` is received (bug #107 / PR #113 fixes this). Track with a separate `isClosed` boolean, not by checking `state`.
- `addToBatch(params)` requires a 2D array: `[['val1', 'val2']]` — a flat array throws.
- Default `rowsToFetch` is **100**. Pass `rowsToFetch` explicitly to `execute()` for large result sets.

### Pool
- `pool.getJob()` is **synchronous** — it returns a busy job when no ready jobs exist rather than waiting.
- `pool.waitForJob(useNewJob?)` is **async** — use this when you need a guaranteed connected job.
- `pool.getReadyJob()` is **private** — never call it from JS (returns `undefined` silently when all jobs are busy, which is the root cause of issue #60).
- `pool.sql\`SELECT ... ${val}\`` — joins template parts with `?` and passes values as parameters. Each interpolated value becomes one `?` placeholder.
- `pool.end()` calls `job.close()` on all jobs — it does **not** await them.

### Transport Interface
Any new transport must extend `BaseTransport` (`src/transport.ts`) and implement `connect`, `send`, and `close`. `getResponseEmitter`, `isConnected`, `enableTrace`, `disableTrace` are already provided by `BaseTransport`. Responses are dispatched via `this.responseEmitter.emit(response.id, response)`. Connection failures use the pattern `${requestId}_conn_fail`.

### Auto-Detection (Local Single)
On `process.platform === 'os400'` with no `user` credential, `SQLJob` automatically switches to `local-single` transport — both in `withConfig()` and `connect()`. This means tests running on IBM i without `.env` credentials will silently use local-single.

### webpack Externals
`ssh2` and `node-ssh` are excluded from the webpack bundle (`externals`). Any module that is a peer/optional dependency must be added to `externals` in `webpack.config.js` — otherwise the bundle breaks for consumers who didn't install it.
`bufferutil` and `utf-8-validate` are also explicitly ignored via `IgnorePlugin` — they are optional `ws` native addons.

---

## Testing Patterns

### Environment Setup
- WebSocket tests: `VITE_SERVER`, `VITE_PORT`, `VITE_DB_USER`, `VITE_DB_PASS` (from `.env`)
- SSH tests: `IBMI_HOST`, `IBMI_USER`, `IBMI_PASSWORD`, optionally `IBMI_PRIVATE_KEY_PATH`, `IBMI_PORT`, `IBMI_SERVER_PATH`, `IBMI_JAVA_PATH`
- Only `test/sshHelpers.test.ts` imports `dotenv/config` — all other test files rely on env vars being set in the shell or CI environment before vitest starts.
- Credentials are centralised in `test/env.ts` as `ENV_CREDS` — always spread this, never hardcode.

### Standard Test Structure
Every integration test file must call `getRootCertificate(creds)` in `beforeAll` and assign `creds.ca`:
```ts
beforeAll(async () => {
  const ca = await getRootCertificate(creds);
  creds.ca = ca;
});
```
Omitting this causes TLS failures against self-signed certs.

### Timeout
`vitest.config.ts` sets `testTimeout: 60000` globally — tests that launch the server JAR over SSH need this for cold JVM startup on IBM i. Never lower it.

---

## Code Style

- Commit messages follow **Conventional Commits**: `feat:`, `fix:`, `chore:`, `docs:`, `test:`, `refactor:` — keep this consistent.
- Branch names use prefixes: `fix/`, `feat/`, `docs/`, `test/`, `chore/`.
- JSDoc is required on all public exports (`src/index.ts` symbols). Use the existing style in `src/sqlJob.ts` as the reference.
- No linter is enforced via CI — follow the existing formatting in `src/` (2-space indentation, backtick template literals for SQL strings).
- `CHANGELOG.md` follows [Keep a Changelog](https://keepachangelog.com) with `Added`, `Fixed`, `Changed`, `Security` sections — update it before every PR.
