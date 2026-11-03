/**
 * Logger interface for mapepire-js.
 * Any object matching this shape satisfies it — including `console`, pino, winston, bunyan, etc.
 * The library is silent by default (dummyLogger). Pass your own logger to capture output.
 */
export interface Logger {
  trace(message: any, ...args: any[]): void;
  debug(message: any, ...args: any[]): void;
  info(message: any,  ...args: any[]): void;
  warn(message: any,  ...args: any[]): void;
  error(message: any, ...args: any[]): void;
}

/**
 * Default no-op logger. Produces zero output.
 * This is the default used by SQLJob, Pool, and all transports when no logger is provided.
 */
export const dummyLogger: Logger = {
  trace: () => {},
  debug: () => {},
  info:  () => {},
  warn:  () => {},
  error: () => {},
};

/**
 * Convenience logger that routes to the global `console`.
 * Pass this during development for quick visibility:
 *   `new SQLJob({}, undefined, consoleLogger)`
 */
export const consoleLogger: Logger = console;
