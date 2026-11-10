import { describe, it, expect, vi } from "vitest";
import { SQLJob, WebSocketTransport, SSHSingleTransport, LocalSingleTransport, Transport } from "../src/index";

describe("Transport Abstraction", () => {
  it("SQLJob should use WebSocketTransport by default", () => {
    const job = new SQLJob();
    const transport = job.getTransport();
    expect(transport).toBeInstanceOf(WebSocketTransport);
  });

  it("SQLJob should accept custom transport", () => {
    class MockTransport extends WebSocketTransport {
      // Mock implementation
    }
    
    const customTransport = new MockTransport();
    const job = new SQLJob({}, customTransport);
    const transport = job.getTransport();
    expect(transport).toBe(customTransport);
  });

  it("getSocket() should return WebSocket for WebSocketTransport", () => {
    const job = new SQLJob();
    // Socket will be undefined until connected, but method should exist
    expect(job.getSocket).toBeDefined();
    expect(typeof job.getSocket).toBe("function");
  });

  it("Transport interface should be properly exported", () => {
    expect(WebSocketTransport).toBeDefined();
    expect(typeof WebSocketTransport).toBe("function");
  });
});

describe("SQLJob.withConfig transport auto-inference", () => {
    it("should infer ssh-single transport when sshSingle config is provided without transport flag", () => {
      const job = SQLJob.withConfig({
        sshSingle: {
          exec: vi.fn(),
        },
      });
      expect(job.getTransport()).toBeInstanceOf(SSHSingleTransport);
    });

    it("should infer local-single transport when localSingle config is provided without transport flag", () => {
      const job = SQLJob.withConfig({
        localSingle: {},
      });
      expect(job.getTransport()).toBeInstanceOf(LocalSingleTransport);
    });

    it("should default to websocket transport when only daemon config is provided", () => {
      const job = SQLJob.withConfig({
        daemon: { host: "example.com", user: "USER", password: "PASSWORD" },
      });
      expect(job.getTransport()).toBeInstanceOf(WebSocketTransport);
    });

    it("should respect explicit transport flag even if other configs are present", () => {
      const job = SQLJob.withConfig({
        transport: "websocket",
        sshSingle: { exec: vi.fn() },
      });
      expect(job.getTransport()).toBeInstanceOf(WebSocketTransport);
    });
  });


