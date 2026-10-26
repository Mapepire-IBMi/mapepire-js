# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.1.0] - 2026-10-26

### Added
- **`SQLJob.rcclcommand()`**: Runs a CL command in the dedicated remote command job instead of the SQL job, so repeated commands no longer slow down as the job log grows. Requires mapepire-server 2.5.0 or later.
- **`sshSingleTechnique` option**: Added to `MapepireConfig` to choose the connection technique (`'cli'` or `'tcp'`) for the `ssh-single` transport; defaults to `'cli'`. Use `'tcp'` to work around invalid data for CCSID 65535 columns.
- **CL command result types**: Added `CLCommandResult`, `SqlCLCommandResult` and `CLMessage` types.

### Fixed
- Sending `sqlclose` on `Query.close()` to prevent a server-side prepared statement leak.
- `Pool.getJob()` no longer throws when all jobs have ended; it returns `undefined`.
- `SQLJob.execute()`, `getPendingTransactions()` and `endTransaction()` now always close their underlying query, even on error.

### Changed
- **Breaking: `SQLJob.clcommand()` now returns `Promise<SqlCLCommandResult>`** instead of a `Query`. Replace `job.clcommand(cmd).execute()` with `await job.clcommand(cmd)`.
- **Breaking: `clcommand()` result shape**: `data` is now an array of `CLMessage` objects (`id`, `type`, `severity`, `text`, `help`, `time`, ...) rather than raw job log rows, and `metadata` / `is_done` are no longer returned. Failed commands still resolve with `success: false` instead of throwing.
- **Breaking: removed `QueryOptions.isClCommand`**.
- Updated the bundled mapepire-server from 2.3.6 to 2.5.1.
- `ServerResponse.sql_rc` and `sql_state` are now optional.

## [1.0.2] - 2026-10-22

### Added
- **SSH Single `privateInstall` & fallback**: Added `privateInstall` boolean option to `SSHSingleConfig` with automatic fallback to private install if `serverPath` is not present remotely.
- **`Pool.fetchBlob()` helper**: Added `fetchBlob` method to `Pool` to retrieve BLOB bytes directly without needing the underlying `SQLJob`.
- **`blob_as_url` column metadata**: Added `blob_as_url` boolean field to `ColumnMetadata`.
- **`UrlToDaemon` export**: Exported `UrlToDaemon` helper function from root package index.

### Fixed
- Converted internal enum definitions in `states.ts` to `const` objects with union types for better JS/TS interop.
- Resolved TypeScript strict-mode errors across test suites.

### Changed
- Upgraded TypeScript to `^5.0.0` and Vitest to `4.1.12`.
- Added Dependabot configuration for npm dependencies and GitHub Actions.

## [1.0.1] - 2026-10-01

### Added
- **Application name support**: Clients can now send a custom application name when connecting; defaults to `mapepire-js` if not provided.
- **BLOB support**: Read and write BLOB columns via `SQLJob`; includes auto-creation of `TEMPBLOB` staging table and additional BLOB test coverage.
- **CL command documentation fetching**: New `fetchCLCommandDocs` API to retrieve IBM i CL command documentation directly from the server.
- **`SQLJob.ssh2()` / `SQLJob.nodeSSH()` static factory helpers**: Credential-first factory methods for creating SSH Single jobs without manually constructing transport config.

## [1.0.0] - 2026-09-22

### Changed
- Updated documentation.

### Fixed
- Fixed truncation of large numbers by using strings instead of `BigInt` for `BIGINT`/`DECIMAL` columns.
- Fixed decimal truncation for numeric result values.
- Fixed BLOB support test setup: auto-creates `TEMPBLOB` table in `beforeAll` if missing.

## [0.6.3] - 2026-09-18

### Added
- **SSH Single Mode**: Library-agnostic SSH transport allowing connection execution via custom/user-provided SSH functions.
- **Local Single Mode**: Auth-free local single mode execution on IBM i environments.
- **Bundled Server Distribution**: Automated distribution and private install of bundled Mapepire server JAR over SSH with SHA-256 verification.
- Table column metadata enhancements.

### Fixed
- Webpack bundling errors by properly externalizing native binary modules (`ssh2`, `node-ssh`).
- Global query list cleanup on terminal query states.
- Type definitions: added `null` to `BindingValue` type.
- Fixed typo in JDBC options.
- Pinned and verified server JAR path resolution using `__dirname`.
- Resolved dependency vulnerabilities.

## [0.6.1] - 2026-06-02

### Added
- Test reproduction case for binary translation during explain queries.

### Fixed
- Updated dependencies to resolve security vulnerabilities.
- Switched npm release workflow to use OpenID Connect (OIDC) trusted publishing.
- Fixed build failures caused by TypeScript compiler checks.
- Fixed test runners.

## [0.6.0] - 2025-06-02

### Added
- Additional column metadata fields.

## [0.5.0] - 2025-03-06

### Added
- Export types in `index.ts`.
- Execution time tracking in `ServerResponse`.
- Test case for stored procedure call with CLOB input/output.
- Environment configuration to optionally disable SSL certificate verification during tests (`.env`).

### Fixed
- Promise rejection handling when connection drops while requests are in flight.

## [0.4.0] - 2025-01-31

### Added
- Batch execution tests.
- Precision and scale metadata for query columns.
- Test case for pool performance.

### Fixed
- User-friendly SSL handshake error messages.
- Self-signed certificate verification handling.
- Export and usage of enums.
- Documentation link fixes.

## [0.3.0] - 2024-09-04

### Changed
- Updated internal `QueryState` enum to string literal types.

## [0.2.0] - 2024-09-04

### Added
- API method to retrieve the active IBM i job for a query.

### Changed
- Replaced internal enums with string literal types.

## [0.1.0] - 2024-09-03

### Added
- `sql` tagged template literal function.

### Fixed
- Protected access for reusable fields.
- Fixed `ignoreUnauthorized` usage and JSON parameter passing.

## [0.0.1] - 2024-08-28

### Added
- Initial release of pure-JS client for Mapepire (Db2 for IBM i).
- WebSocket daemon connection support.
- Connection pool management.
