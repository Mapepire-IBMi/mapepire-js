/**
 * Pinned Mapepire server version constants.
 * Single source of truth — imported by the build script, ServerInstaller, and tests.
 *
 * JAR_SHA256 is written back by scripts/downloadServer.ts at build/prepack time.
 * It starts as an empty string and must NOT be edited by hand.
 */

export const VERSION = `2.3.6`;
export const SERVER_VERSION_TAG = `v${VERSION}`;
export const SERVER_FILE_PREFIX = `mapepire-server-`;
export const SERVER_VERSION_FILE = `${SERVER_FILE_PREFIX}${VERSION}.jar`;

/**
 * SHA-256 hex digest of the bundled JAR file.
 * Populated automatically by scripts/downloadServer.ts — do not edit manually.
 */
export const JAR_SHA256 = `6371d64f5684fcbee96f27107512f712fc1676ffded00726f2752dcfc30977b7`;
