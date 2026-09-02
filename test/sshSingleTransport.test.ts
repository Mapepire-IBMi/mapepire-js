import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SSHSingleTransport } from '../src/transports/sshSingleTransport';
import { ExecChannel, DaemonServer, ExecFunction } from '../src/types';
import { Readable, Writable } from 'stream';

/**
 * Mock ExecChannel implementation for testing
 */
class MockExecChannel implements ExecChannel {
  stdin: Writable & { write: any };
  stdout: Readable;
  stderr: Readable;
  private exitCallback?: (code: number | null, signal?: string) => void;
  private _closed = false;

  constructor() {
    // Create a proper writable stream
    const originalWrite = (chunk: any, encoding: any, callback: any) => {
      if (typeof callback === 'function') {
        callback();
      }
      return true;
    };
    
    this.stdin = new Writable({
      write: originalWrite
    }) as Writable & { write: any };
    
    // Spy on the write method while preserving functionality
    const boundWrite = this.stdin.write.bind(this.stdin);
    this.stdin.write = vi.fn((...args: any[]) => {
      return boundWrite(...args);
    });
    
    this.stdout = new Readable({
      read() {}
    });
    this.stderr = new Readable({
      read() {}
    });
    
    // Clear any buffered data immediately
    this.stdout.read();
    this.stderr.read();
  }

  close(): void {
    this._closed = true;
    // End the streams to prevent further data emission
    this.stdout.push(null);
    this.stderr.push(null);
    if (this.exitCallback) {
      this.exitCallback(0);
    }
  }

  onExit(cb: (code: number | null, signal?: string) => void): void {
    this.exitCallback = cb;
  }

  get closed(): boolean {
    return this._closed;
  }

  // Test helper methods
  emitStdout(data: string): void {
    if (!this._closed) {
      this.stdout.push(data);
    }
  }

  emitStderr(data: string): void {
    if (!this._closed) {
      this.stderr.push(data);
    }
  }

  emitExit(code: number, signal?: string): void {
    if (this.exitCallback) {
      this.exitCallback(code, signal);
    }
  }
}

// Test timeout constants
const TEST_HANDSHAKE_DELAY_MS = 10;
const TEST_ERROR_HANDLING_WAIT_MS = 50;
const TEST_SHORT_STARTUP_TIMEOUT_MS = 100;
const TEST_PARTIAL_MESSAGE_DELAY_MS = 5;

/**
 * Helper function to simulate successful handshake
 */
function simulateHandshake(channel: MockExecChannel, delayMs: number = TEST_HANDSHAKE_DELAY_MS): NodeJS.Timeout {
  return setTimeout(() => {
    channel.emitStdout(JSON.stringify({
      id: 'handshake',
      success: true,
      job: '123456/USER/QZDASOINIT'
    }) + '\n');
  }, delayMs);
}

/**
 * Helper function to create and connect a fresh transport for isolated tests
 */
async function createConnectedTransport(): Promise<{
  transport: SSHSingleTransport;
  channel: MockExecChannel;
  exec: ExecFunction;
}> {
  const transport = new SSHSingleTransport();
  const channel = new MockExecChannel();
  const exec = vi.fn().mockResolvedValue(channel) as unknown as ExecFunction;
  
  const server: DaemonServer = {
    host: 'localhost',
    user: '*CURRENT',
    password: ''
  };

  const options = {
    exec,
    serverPath: '/path/to/server.jar'
  };

  simulateHandshake(channel);
  await transport.connect(server, options);

  return { transport, channel, exec };
}

describe('SSHSingleTransport', () => {
  let transport: SSHSingleTransport;
  let mockChannel: MockExecChannel;
  let mockExecRaw: ReturnType<typeof vi.fn>;
  let mockExec: ExecFunction;

  beforeEach(() => {
    transport = new SSHSingleTransport();
    mockChannel = new MockExecChannel();
    mockExecRaw = vi.fn().mockResolvedValue(mockChannel);
    mockExec = mockExecRaw as unknown as ExecFunction;
  });

  afterEach(async () => {
    if (transport) {
      try {
        await transport.close();
      } catch (e) {
        // Ignore errors during cleanup
      }
    }
    // Ensure streams are fully closed and cleaned up
    if (mockChannel) {
      // Destroy the streams to prevent any further data emission
      mockChannel.stdout.destroy();
      mockChannel.stderr.destroy();
      mockChannel.stdout.removeAllListeners();
      mockChannel.stderr.removeAllListeners();
    }
  });

  describe('connect', () => {
    it('should successfully connect with minimal config', async () => {
      const server: DaemonServer = {
        host: 'localhost',
        user: '*CURRENT',
        password: ''
      };

      const options = {
        exec: mockExec,
        serverPath: '/path/to/mapepire-server.jar'
      };

      // Simulate successful handshake
      simulateHandshake(mockChannel);

      await transport.connect(server, options);

      expect(mockExec).toHaveBeenCalledWith(
        expect.stringContaining('-jar')
      );
      const command = mockExecRaw.mock.calls[0][0];
      expect(command).toContain('/path/to/mapepire-server.jar');
      expect(command).toContain('--single');
    });

    it('should throw error if exec function is not provided', async () => {
      const server: DaemonServer = {
        host: 'localhost',
        user: '*CURRENT',
        password: ''
      };

      await expect(
        transport.connect(server, { serverPath: '/path/to/server.jar' } as any)
      ).rejects.toThrow('SSH single transport requires an exec function');
    });

    it('should use default serverPath when not provided', async () => {
      const server: DaemonServer = {
        host: 'localhost',
        user: '*CURRENT',
        password: ''
      };

      simulateHandshake(mockChannel);

      await transport.connect(server, { exec: mockExec } as any);

      const command = mockExecRaw.mock.calls[0][0];
      expect(command).toContain('/opt/mapepire/lib/mapepire/mapepire-server.jar');
    });

    it('should include custom javaPath in command', async () => {
      const server: DaemonServer = {
        host: 'localhost',
        user: '*CURRENT',
        password: ''
      };

      const options = {
        exec: mockExec,
        serverPath: '/path/to/server.jar',
        javaPath: '/custom/java/bin/java'
      };

      simulateHandshake(mockChannel);

      await transport.connect(server, options);

      expect(mockExec).toHaveBeenCalledWith(
        expect.stringContaining('/custom/java/bin/java')
      );
    });

    it('should include JVM args in command', async () => {
      const server: DaemonServer = {
        host: 'localhost',
        user: '*CURRENT',
        password: ''
      };

      const options = {
        exec: mockExec,
        serverPath: '/path/to/server.jar',
        jvmArgs: ['-Xmx512m', '-Dfile.encoding=UTF-8']
      };

      simulateHandshake(mockChannel);

      await transport.connect(server, options);

      const command = mockExecRaw.mock.calls[0][0];
      expect(command).toContain('-Xmx512m');
      expect(command).toContain('-Dfile.encoding=UTF-8');
    });

    it('should include server args in command', async () => {
      const server: DaemonServer = {
        host: 'localhost',
        user: '*CURRENT',
        password: ''
      };

      const options = {
        exec: mockExec,
        serverPath: '/path/to/server.jar',
        serverArgs: ['--trace', '--verbose']
      };

      simulateHandshake(mockChannel);

      await transport.connect(server, options);

      const command = mockExecRaw.mock.calls[0][0];
      expect(command).toContain('--trace');
      expect(command).toContain('--verbose');
    });

    it('should handle handshake timeout', async () => {
      const server: DaemonServer = {
        host: 'localhost',
        user: '*CURRENT',
        password: ''
      };

      const options = {
        exec: mockExec,
        serverPath: '/path/to/server.jar',
        startupTimeout: TEST_SHORT_STARTUP_TIMEOUT_MS
      };

      // Don't send handshake response

      await expect(
        transport.connect(server, options)
      ).rejects.toThrow('Server startup timeout');
    });

    it('should handle exec function errors', async () => {
      const server: DaemonServer = {
        host: 'localhost',
        user: '*CURRENT',
        password: ''
      };

      const failingExec = vi.fn().mockRejectedValue(new Error('SSH connection failed')) as unknown as ExecFunction;

      const options = {
        exec: failingExec,
        serverPath: '/path/to/server.jar'
      };

      await expect(
        transport.connect(server, options)
      ).rejects.toThrow('SSH connection failed');
    });

    it('should handle stderr output during startup', async () => {
      const server: DaemonServer = {
        host: 'localhost',
        user: '*CURRENT',
        password: ''
      };

      const options = {
        exec: mockExec,
        serverPath: '/path/to/server.jar'
      };

      // Track stderr data
      let stderrData = '';
      const originalHandleStderr = (mockChannel as any).stderr.on;
      
      setTimeout(() => {
        mockChannel.emitStderr('Warning: Some Java warning\n');
        simulateHandshake(mockChannel, 0);
      }, TEST_HANDSHAKE_DELAY_MS);

      await transport.connect(server, options);

      // Verify stderr was emitted (connection succeeded despite stderr)
      expect(mockExec).toHaveBeenCalled();
    });
  });

  describe('send', () => {
    beforeEach(async () => {
      const server: DaemonServer = {
        host: 'localhost',
        user: '*CURRENT',
        password: ''
      };

      const options = {
        exec: mockExec,
        serverPath: '/path/to/server.jar'
      };

      simulateHandshake(mockChannel);

      await transport.connect(server, options);
    });

    it('should send request and receive response', async () => {
      const request = {
        id: 'test-1',
        type: 'query',
        sql: 'SELECT * FROM QIWS.QCUSTCDT'
      };

      const sendPromise = transport.send(request);

      // Simulate server response
      setTimeout(() => {
        mockChannel.emitStdout(JSON.stringify({
          id: 'test-1',
          success: true,
          data: []
        }) + '\n');
      }, TEST_HANDSHAKE_DELAY_MS);

      await sendPromise;

      // Verify request was written to stdin
      expect(mockChannel.stdin.write).toHaveBeenCalled();
    });

    it('should handle multiple concurrent requests', async () => {
      const request1 = { id: 'test-1', type: 'query', sql: 'SELECT 1' };
      const request2 = { id: 'test-2', type: 'query', sql: 'SELECT 2' };

      const promise1 = transport.send(request1);
      const promise2 = transport.send(request2);

      setTimeout(() => {
        mockChannel.emitStdout(JSON.stringify({
          id: 'test-1',
          success: true,
          data: []
        }) + '\n');
        mockChannel.emitStdout(JSON.stringify({
          id: 'test-2',
          success: true,
          data: []
        }) + '\n');
      }, TEST_HANDSHAKE_DELAY_MS);

      await Promise.all([promise1, promise2]);
    });

    it('should handle partial JSON messages', async () => {
      const request = {
        id: 'test-1',
        type: 'query',
        sql: 'SELECT * FROM QIWS.QCUSTCDT'
      };

      const sendPromise = transport.send(request);

      // Simulate partial message delivery
      setTimeout(() => {
        const response = JSON.stringify({
          id: 'test-1',
          success: true,
          data: []
        });
        
        // Send in chunks
        mockChannel.emitStdout(response.substring(0, 20));
        setTimeout(() => {
          mockChannel.emitStdout(response.substring(20) + '\n');
        }, TEST_PARTIAL_MESSAGE_DELAY_MS);
      }, TEST_HANDSHAKE_DELAY_MS);

      await sendPromise;
      
      // Wait for all timeouts to complete before test ends
      await new Promise(resolve => setTimeout(resolve, TEST_HANDSHAKE_DELAY_MS + TEST_PARTIAL_MESSAGE_DELAY_MS + 10));
    });
  });

  describe('close', () => {
    it('should close the channel', async () => {
      const server: DaemonServer = {
        host: 'localhost',
        user: '*CURRENT',
        password: ''
      };

      const options = {
        exec: mockExec,
        serverPath: '/path/to/server.jar'
      };

      const handshakeTimeout = simulateHandshake(mockChannel);

      await transport.connect(server, options);
      
      // Small delay to ensure handshake is fully processed
      await new Promise(resolve => setTimeout(resolve, 20));
      
      await transport.close();
      clearTimeout(handshakeTimeout);

      expect(mockChannel.closed).toBe(true);
    });

    it('should handle close when not connected', async () => {
      await expect(transport.close()).resolves.not.toThrow();
    });

    it('should handle multiple close calls', async () => {
      const server: DaemonServer = {
        host: 'localhost',
        user: '*CURRENT',
        password: ''
      };

      const options = {
        exec: mockExec,
        serverPath: '/path/to/server.jar'
      };

      const handshakeTimeout = simulateHandshake(mockChannel);

      await transport.connect(server, options);
      
      // Small delay to ensure handshake is fully processed
      await new Promise(resolve => setTimeout(resolve, 20));
      
      await transport.close();
      await transport.close(); // Second close should not throw
      clearTimeout(handshakeTimeout);

      expect(mockChannel.closed).toBe(true);
    });
  });

  describe('error handling', () => {
    it('should handle channel exit during operation', async () => {
      const { transport: testTransport, channel: testChannel } = await createConnectedTransport();

      // Simulate channel exit
      testChannel.emitExit(1, 'SIGTERM');

      // Wait a bit for error handling
      await new Promise(resolve => setTimeout(resolve, TEST_ERROR_HANDLING_WAIT_MS));
      
      // Verify transport is no longer connected
      expect(testTransport['connected']).toBe(false);
      
      await testTransport.close();
    });

    it('should handle malformed JSON responses', async () => {
      const { transport: testTransport, channel: testChannel } = await createConnectedTransport();

      // Send malformed JSON
      testChannel.emitStdout('{ invalid json }\n');

      await new Promise(resolve => setTimeout(resolve, TEST_ERROR_HANDLING_WAIT_MS));

      // Malformed JSON is logged but doesn't crash the transport
      expect(testTransport['connected']).toBe(true);
      
      await testTransport.close();
    });
  });

  describe('command building', () => {
    it('should properly escape paths with spaces', async () => {
      const server: DaemonServer = {
        host: 'localhost',
        user: '*CURRENT',
        password: ''
      };

      const options = {
        exec: mockExec,
        serverPath: '/path with spaces/server.jar',
        javaPath: '/java path/bin/java'
      };

      simulateHandshake(mockChannel);

      await transport.connect(server, options);

      const command = mockExecRaw.mock.calls[0][0];
      expect(command).toContain("'/java path/bin/java'");
      expect(command).toContain("'/path with spaces/server.jar'");
    });

    it('should handle cwd option', async () => {
      const server: DaemonServer = {
        host: 'localhost',
        user: '*CURRENT',
        password: ''
      };

      const options = {
        exec: mockExec,
        serverPath: './server.jar',
        cwd: '/home/user/mapepire'
      };

      simulateHandshake(mockChannel);

      await transport.connect(server, options);

      const command = mockExecRaw.mock.calls[0][0];
      expect(command).toContain('cd');
      expect(command).toContain('/home/user/mapepire');
    });

    it('should handle env option', async () => {
      const server: DaemonServer = {
        host: 'localhost',
        user: '*CURRENT',
        password: ''
      };

      const options = {
        exec: mockExec,
        serverPath: '/path/to/server.jar',
        env: {
          JAVA_HOME: '/opt/java',
          PATH: '/opt/java/bin:/usr/bin'
        }
      };

      simulateHandshake(mockChannel);

      await transport.connect(server, options);

      const command = mockExecRaw.mock.calls[0][0];
      expect(command).toContain('JAVA_HOME');
      expect(command).toContain('/opt/java');
      expect(command).toContain('PATH');
      expect(command).toContain('/opt/java/bin:/usr/bin');
    });
  });
});


