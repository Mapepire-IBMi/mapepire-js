/**
 * Pinned Mapepire server version constants.
 * Single source of truth — imported by the build script, ServerInstaller, and tests.
 *
 * To bump to a new server version, run: `npm run bump-server <version>`
 */

export const VERSION = `2.5.1`;
export const SERVER_VERSION_TAG = `v${VERSION}`;
export const SERVER_FILE_PREFIX = `mapepire-server-`;
export const SERVER_VERSION_FILE = `${SERVER_FILE_PREFIX}${VERSION}.jar`;

/**
 * SHA-256 hex digest of the bundled JAR file.
 * Verified during builds; updated via `npm run bump-server <version>`.
 */
export const JAR_SHA256 = `e7fe8d4840b1fc6e830ff00622c8245a3d70b342333749aabbe513f0b146562b`;
