import { describe, test, expect, beforeAll, afterAll } from 'vitest';
import { Client } from 'ssh2';
import { NodeSSH } from 'node-ssh';
import { SQLJob, createSSH2Exec, createNodeSSHExec } from '../src';

/**
 * SSH Helper Tests
 * 
 * These tests verify that the SSH helper utilities (createSSH2Exec and createNodeSSHExec)
 * correctly map SSH client objects to ExecFunction interfaces that work with Mapepire.
 * 
 * Test Environment Variables:
 * - SSH_TEST_HOST: SSH hostname (required)
 * - SSH_TEST_PORT: SSH port (default: 22)
 * - SSH_TEST_USER: SSH username (required)
 * - SSH_TEST_PASS: SSH password (required)
 * - SSH_TEST_SERVER_PATH: Path to mapepire-server.jar (required)
 * - SSH_TEST_JAVA_PATH: Path to java executable (optional, defaults to 'java')
 */

// SSH credentials from environment
const SSH_CREDS = {
  host: process.env.SSH_TEST_HOST || 'localhost',
  port: Number(process.env.SSH_TEST_PORT) || 22,
  username: process.env.SSH_TEST_USER || 'testuser',
  password: process.env.SSH_TEST_PASS || 'testpass',
};

const SERVER_CONFIG = {
  serverPath: process.env.SSH_TEST_SERVER_PATH || 'mapepire-server.jar',
  javaPath: process.env.SSH_TEST_JAVA_PATH || 'java',
  startupTimeout: 30000,
};

// Skip tests if SSH credentials are not configured
const shouldSkip = !process.env.SSH_TEST_HOST || !process.env.SSH_TEST_USER;

describe('SSH Helper - createSSH2Exec', () => {
  if (shouldSkip) {
    test.skip('SSH tests skipped - set SSH_TEST_HOST and SSH_TEST_USER to enable', () => {});
    return;
  }

  let sshClient: Client | null = null;

  afterAll(() => {
    if (sshClient) {
      sshClient.end();
      sshClient = null;
    }
  });

  test('should create exec function from connected ssh2 client', async () => {
    // Connect SSH client
    sshClient = new Client();
    await new Promise<void>((resolve, reject) => {
      sshClient!.on('ready', () => resolve());
      sshClient!.on('error', (err) => reject(err));
      sshClient!.connect(SSH_CREDS);
    });

    // Create exec function using helper
    const exec = createSSH2Exec(sshClient);

    expect(exec).toBeDefined();
    expect(typeof exec).toBe('function');
  });

  test('should successfully connect to database using ssh single mode(ssh2)', async () => {
    // Connect SSH client
    sshClient = new Client();
    await new Promise<void>((resolve, reject) => {
      sshClient!.on('ready', () => resolve());
      sshClient!.on('error', (err) => reject(err));
      sshClient!.connect(SSH_CREDS);
    });

    // Create SQLJob with helper
    const job = SQLJob.withConfig({
      transport: 'ssh-single',
      sshSingle: {
        exec: createSSH2Exec(sshClient),
        serverPath: SERVER_CONFIG.serverPath,
        javaPath: SERVER_CONFIG.javaPath,
        startupTimeout: SERVER_CONFIG.startupTimeout,
      },
    });

    try {
      const result = await job.connect();
      expect(result).toBeDefined();
      expect(result.success).toBe(true);
      expect(result.job).toBeDefined();
      expect(result.job).toContain('QZDA');
    } finally {
      await job.close();
      sshClient.end();
      sshClient = null;
    }
  });

  test('should execute SQL query successfully with ssh single mode(ssh2)', async () => {
    // Connect SSH client
    sshClient = new Client();
    await new Promise<void>((resolve, reject) => {
      sshClient!.on('ready', () => resolve());
      sshClient!.on('error', (err) => reject(err));
      sshClient!.connect(SSH_CREDS);
    });

    const job = SQLJob.withConfig({
      transport: 'ssh-single',
      sshSingle: {
        exec: createSSH2Exec(sshClient),
        serverPath: SERVER_CONFIG.serverPath,
        javaPath: SERVER_CONFIG.javaPath,
      },
    });

    try {
      await job.connect();

      // Execute a simple query
      const result = await job.execute('SELECT * FROM QIWS.QCUSTCDT FETCH FIRST 5 ROWS ONLY');
      
      expect(result).toBeDefined();
      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect(Array.isArray(result.data)).toBe(true);
      expect(result.data.length).toBeGreaterThan(0);
      expect(result.data.length).toBeLessThanOrEqual(5);
    } finally {
      await job.close();
      sshClient.end();
      sshClient = null;
    }
  });

  test('should get server version with ssh single mode(ssh2)', async () => {
    sshClient = new Client();
    await new Promise<void>((resolve, reject) => {
      sshClient!.on('ready', () => resolve());
      sshClient!.on('error', (err) => reject(err));
      sshClient!.connect(SSH_CREDS);
    });

    const job = SQLJob.withConfig({
      transport: 'ssh-single',
      sshSingle: {
        exec: createSSH2Exec(sshClient),
        serverPath: SERVER_CONFIG.serverPath,
        javaPath: SERVER_CONFIG.javaPath,
      },
    });

    try {
      await job.connect();
      const version = await job.getVersion();
      
      expect(version).toBeDefined();
      expect(version.success).toBe(true);
      expect(version.build_date).toBeDefined();
      expect(version.version).toBeDefined();
    } finally {
      await job.close();
      sshClient.end();
      sshClient = null;
    }
  });

  test('should handle multiple queries in sequence with ssh single mode(ssh2)', async () => {
    sshClient = new Client();
    await new Promise<void>((resolve, reject) => {
      sshClient!.on('ready', () => resolve());
      sshClient!.on('error', (err) => reject(err));
      sshClient!.connect(SSH_CREDS);
    });

    const job = SQLJob.withConfig({
      transport: 'ssh-single',
      sshSingle: {
        exec: createSSH2Exec(sshClient),
        serverPath: SERVER_CONFIG.serverPath,
        javaPath: SERVER_CONFIG.javaPath,
      },
    });

    try {
      await job.connect();

      // Query 1
      const result1 = await job.execute('SELECT COUNT(*) as TOTAL FROM QIWS.QCUSTCDT');
      expect(result1.success).toBe(true);
      expect(result1.data).toBeDefined();
      if (result1.data && result1.data.length > 0) {
        expect((result1.data[0] as any).TOTAL).toBeGreaterThan(0);
      }

      // Query 2
      const result2 = await job.execute('SELECT CURRENT USER FROM SYSIBM.SYSDUMMY1');
      expect(result2.success).toBe(true);
      expect(result2.data).toBeDefined();
      if (result2.data && result2.data.length > 0) {
        expect((result2.data[0] as any)['CURRENT USER']).toBeDefined();
      }

      // Query 3 - Create temp table
      const result3 = await job.execute('CREATE TABLE QTEMP.SSH2TEST (ID INT, NAME VARCHAR(50))');
      expect(result3.success).toBe(true);
    } finally {
      await job.close();
      sshClient.end();
      sshClient = null;
    }
  });
});

describe('SSH Helper - createNodeSSHExec', () => {
  if (shouldSkip) {
    test.skip('SSH tests skipped - set SSH_TEST_HOST and SSH_TEST_USER to enable', () => {});
    return;
  }

  let ssh: NodeSSH | null = null;

  afterAll(() => {
    if (ssh) {
      ssh.dispose();
      ssh = null;
    }
  });

  test('should create exec function from connected node-ssh instance', async () => {
    // Connect node-ssh
    ssh = new NodeSSH();
    await ssh.connect(SSH_CREDS);

    // Create exec function using helper
    const exec = createNodeSSHExec(ssh);

    expect(exec).toBeDefined();
    expect(typeof exec).toBe('function');
  });

  test('should successfully connect to database using ssh single mode(node-ssh)', async () => {
    // Connect node-ssh
    ssh = new NodeSSH();
    await ssh.connect(SSH_CREDS);

    // Create SQLJob with helper
    const job = SQLJob.withConfig({
      transport: 'ssh-single',
      sshSingle: {
        exec: createNodeSSHExec(ssh),
        serverPath: SERVER_CONFIG.serverPath,
        javaPath: SERVER_CONFIG.javaPath,
        startupTimeout: SERVER_CONFIG.startupTimeout,
      },
    });

    try {
      const result = await job.connect();
      expect(result).toBeDefined();
      expect(result.success).toBe(true);
      expect(result.job).toBeDefined();
      expect(result.job).toContain('QZDA');
    } finally {
      await job.close();
      ssh.dispose();
      ssh = null;
    }
  });

  test('should execute SQL query successfully with ssh single mode(node-ssh)', async () => {
    // Connect node-ssh
    ssh = new NodeSSH();
    await ssh.connect(SSH_CREDS);

    const job = SQLJob.withConfig({
      transport: 'ssh-single',
      sshSingle: {
        exec: createNodeSSHExec(ssh),
        serverPath: SERVER_CONFIG.serverPath,
        javaPath: SERVER_CONFIG.javaPath,
      },
    });

    try {
      await job.connect();

      // Execute a simple query
      const result = await job.execute('SELECT * FROM QIWS.QCUSTCDT FETCH FIRST 3 ROWS ONLY');
      
      expect(result).toBeDefined();
      expect(result.success).toBe(true);
      expect(result.data).toBeDefined();
      expect(Array.isArray(result.data)).toBe(true);
      expect(result.data.length).toBeGreaterThan(0);
      expect(result.data.length).toBeLessThanOrEqual(3);
    } finally {
      await job.close();
      ssh.dispose();
      ssh = null;
    }
  });

  test('should get server version with ssh single mode(node-ssh)', async () => {
    ssh = new NodeSSH();
    await ssh.connect(SSH_CREDS);

    const job = SQLJob.withConfig({
      transport: 'ssh-single',
      sshSingle: {
        exec: createNodeSSHExec(ssh),
        serverPath: SERVER_CONFIG.serverPath,
        javaPath: SERVER_CONFIG.javaPath,
      },
    });

    try {
      await job.connect();
      const version = await job.getVersion();
      
      expect(version).toBeDefined();
      expect(version.success).toBe(true);
      expect(version.build_date).toBeDefined();
      expect(version.version).toBeDefined();
    } finally {
      await job.close();
      ssh.dispose();
      ssh = null;
    }
  });

  test('should handle multiple queries in sequence with ssh single mode(node-ssh)', async () => {
    ssh = new NodeSSH();
    await ssh.connect(SSH_CREDS);

    const job = SQLJob.withConfig({
      transport: 'ssh-single',
      sshSingle: {
        exec: createNodeSSHExec(ssh),
        serverPath: SERVER_CONFIG.serverPath,
        javaPath: SERVER_CONFIG.javaPath,
      },
    });

    try {
      await job.connect();

      // Query 1
      const result1 = await job.execute('SELECT COUNT(*) as TOTAL FROM QIWS.QCUSTCDT');
      expect(result1.success).toBe(true);
      expect(result1.data).toBeDefined();
      if (result1.data && result1.data.length > 0) {
        expect((result1.data[0] as any).TOTAL).toBeGreaterThan(0);
      }

      // Query 2
      const result2 = await job.execute('SELECT CURRENT TIMESTAMP FROM SYSIBM.SYSDUMMY1');
      expect(result2.success).toBe(true);
      expect(result2.data).toBeDefined();
      if (result2.data && result2.data.length > 0) {
        expect((result2.data[0] as any)['CURRENT TIMESTAMP']).toBeDefined();
      }

      // Query 3 - Create temp table
      const result3 = await job.execute('CREATE TABLE QTEMP.NODESSHTEST (ID INT, NAME VARCHAR(50))');
      expect(result3.success).toBe(true);
    } finally {
      await job.close();
      ssh.dispose();
      ssh = null;
    }
  });

  test('should throw error if NodeSSH instance is not connected', () => {
    // Create disconnected instance
    ssh = new NodeSSH();

    // Try to create exec function without connecting
    expect(() => createNodeSSHExec(ssh)).toThrow('NodeSSH instance is not connected');

    ssh.dispose();
    ssh = null;
  });
});

describe('SSH Helpers - Error Handling', () => {
  if (shouldSkip) {
    test.skip('SSH tests skipped - set SSH_TEST_HOST and SSH_TEST_USER to enable', () => {});
    return;
  }

  test('should handle SSH connection failure gracefully (ssh2)', async () => {
    const badCreds = {
      host: 'invalid-host-that-does-not-exist.example.com',
      port: 22,
      username: 'invalid',
      password: 'invalid',
    };

    const client = new Client();
    
    await expect(
      new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          client.end();
          reject(new Error('Connection timeout'));
        }, 5000);

        client.on('ready', () => {
          clearTimeout(timeout);
          resolve();
        });
        client.on('error', (err) => {
          clearTimeout(timeout);
          reject(err);
        });
        client.connect(badCreds);
      })
    ).rejects.toThrow();

    client.end();
  });

  test('should handle invalid server path gracefully', async () => {
    let sshClient: Client | null = null;

    try {
      sshClient = new Client();
      await new Promise<void>((resolve, reject) => {
        sshClient!.on('ready', () => resolve());
        sshClient!.on('error', (err) => reject(err));
        sshClient!.connect(SSH_CREDS);
      });

      const job = SQLJob.withConfig({
        transport: 'ssh-single',
        sshSingle: {
          exec: createSSH2Exec(sshClient),
          serverPath: '/invalid/path/to/nonexistent.jar',
          javaPath: SERVER_CONFIG.javaPath,
          startupTimeout: 5000,
        },
      });

      await expect(job.connect()).rejects.toThrow();
      
      await job.close();
    } finally {
      if (sshClient) {
        sshClient.end();
      }
    }
  });
});

describe('SSH Helpers - Integration Tests', () => {
  if (shouldSkip) {
    test.skip('SSH tests skipped - set SSH_TEST_HOST and SSH_TEST_USER to enable', () => {});
    return;
  }

  test('should work with custom JVM args (ssh2)', async () => {
    let sshClient: Client | null = null;

    try {
      sshClient = new Client();
      await new Promise<void>((resolve, reject) => {
        sshClient!.on('ready', () => resolve());
        sshClient!.on('error', (err) => reject(err));
        sshClient!.connect(SSH_CREDS);
      });

      const job = SQLJob.withConfig({
        transport: 'ssh-single',
        sshSingle: {
          exec: createSSH2Exec(sshClient),
          serverPath: SERVER_CONFIG.serverPath,
          javaPath: SERVER_CONFIG.javaPath,
          jvmArgs: ['-Xmx512m', '-Dfile.encoding=UTF-8'],
          startupTimeout: SERVER_CONFIG.startupTimeout,
        },
      });

      const result = await job.connect();
      expect(result.success).toBe(true);

      await job.close();
      sshClient.end();
    } finally {
      if (sshClient) {
        sshClient.end();
      }
    }
  });

  test('should work with custom working directory (node-ssh)', async () => {
    let ssh: NodeSSH | null = null;

    try {
      ssh = new NodeSSH();
      await ssh.connect(SSH_CREDS);

      const job = SQLJob.withConfig({
        transport: 'ssh-single',
        sshSingle: {
          exec: createNodeSSHExec(ssh),
          serverPath: SERVER_CONFIG.serverPath,
          javaPath: SERVER_CONFIG.javaPath,
          cwd: process.env.SSH_TEST_CWD || undefined,
          startupTimeout: SERVER_CONFIG.startupTimeout,
        },
      });

      const result = await job.connect();
      expect(result.success).toBe(true);

      await job.close();
      ssh.dispose();
    } finally {
      if (ssh) {
        ssh.dispose();
      }
    }
  });
});
