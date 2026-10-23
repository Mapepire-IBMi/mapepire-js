/**
 * Pinned Mapepire server version constants.
 * Single source of truth — imported by the build script, ServerInstaller, and tests.
 *
 * JAR_SHA256 is written back by scripts/downloadServer.ts at build/prepack time.
 * It starts as an empty string and must NOT be edited by hand.
 */

export const VERSION = `2.5.1`;
export const SERVER_VERSION_TAG = `v${VERSION}`;
export const SERVER_FILE_PREFIX = `mapepire-server-`;
export const SERVER_VERSION_FILE = `${SERVER_FILE_PREFIX}${VERSION}.jar`;

/**
 * SHA-256 hex digest of the bundled JAR file.
 * Populated automatically by scripts/downloadServer.ts — do not edit manually.
 */
export const JAR_SHA256 = `e7fe8d4840b1fc6e830ff00622c8245a3d70b342333749aabbe513f0b146562b`;
