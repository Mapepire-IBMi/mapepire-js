import { DaemonServer } from "../src/types";

/**
 * Default credentials for connecting to the daemon server, 
 * loaded from environment variables.
 */
export const ENV_CREDS: DaemonServer = {
  host: process.env.VITE_SERVER || `localhost`,
  port: Number(process.env.VITE_PORT) || 8076,
  user: process.env.VITE_DB_USER,
  password: process.env.VITE_DB_PASS
}