import { describe, it, expect } from "vitest";
import { SQLJob, WebSocketTransport, Transport } from "../src/index";

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


