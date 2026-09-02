/**
 * Shared constants and utilities for Mapepire single-mode transports
 * (SSH single transport and Local single transport).
 */

/** Default Java executable path on IBM i */
export const DEFAULT_JAVA_PATH = '/QOpenSys/QIBM/ProdData/JavaVM/jdk80/64bit/bin/java';

/** Default mapepire-server JAR path on IBM i (RPM package path) */
export const DEFAULT_SERVER_PATH = '/QOpenSys/pkgs/lib/mapepire/mapepire-server.jar';

/** Legacy default mapepire-server JAR path on IBM i (/opt package path) */
export const DEFAULT_OPT_SERVER_PATH = '/opt/mapepire/lib/mapepire/mapepire-server.jar';

/**
 * Required IBM i PASE/JVM stdio environment variables.
 * Prevents the JVM/PASE layer from converting character encodings and corrupting
 * the JSON protocol stream on stdout/stdin.
 */
export const REQUIRED_IBM_I_ENV: Record<string, string> = {
  QIBM_JAVA_STDIO_CONVERT: 'N',
  QIBM_PASE_DESCRIPTOR_STDIO: 'B',
  QIBM_USE_DESCRIPTOR_STDIO: 'Y',
  QIBM_MULTI_THREADED: 'Y',
};

/** Default JVM arguments required for single-mode transport execution */
export const DEFAULT_JVM_ARGS: string[] = [
  '-Djdbc.db2.restricted.local.connection.only=true',
  '-Dos400.stdio.convert=N',
];

/**
 * Ensures `--single` flag is present in server arguments.
 * @param serverArgs - Array of server arguments
 * @returns Array guaranteed to contain `--single`
 */
export function ensureSingleFlag(serverArgs: string[] = []): string[] {
  return serverArgs.includes('--single') ? serverArgs : [...serverArgs, '--single'];
}

/**
 * Escapes a string for POSIX shell execution.
 * @param arg - Raw argument string
 * @returns Single-quoted escaped string safe for shell execution
 */
export function shellEscape(arg: string): string {
  return `'${arg.replace(/'/g, "'\\''")}'`;
}
