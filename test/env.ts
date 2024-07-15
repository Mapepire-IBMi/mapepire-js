import { DaemonServer } from "../src/types";

console.log(process.env);

// Hello world

export const ENV_CREDS: DaemonServer = {
  host: process.env.VITE_SERVER || `localhost`,
  port: Number(process.env.VITE_PORT) || 8085,
  user: process.env.VITE_DB_USER,
  password: process.env.VITE_DB_PASS
}

console.log(ENV_CREDS);
