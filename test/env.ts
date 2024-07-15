import { DaemonServer } from "../src/types";

console.log(creds);
console.log(process.env);

export const ENV_CREDS: DaemonServer = {
  host: process.env.VITE_SERVER || `localhost`,
  port: Number(process.env.VITE_PORT) || 8085,
  user: process.env.VITE_DB_USER,
  password: process.env.VITE_DB_PASS
}
