import { defineConfig } from 'vitest/config';
import { loadEnv } from 'vite';

export default defineConfig(({ mode }) => ({
  test: {
    env: loadEnv(mode, process.cwd(), ''),
    // Integration tests that launch the mapepire-server JAR over SSH need
    // more than the default 5000ms — 60s covers cold JVM startup on IBM i.
    testTimeout: 60000,
  },
}));
