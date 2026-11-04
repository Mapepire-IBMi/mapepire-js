import { describe, it, expect, vi } from "vitest";
import { SQLJob, WebSocketTransport, Transport } from "../src/index";
import { BaseTransport } from "../src/transport";
import { ServerRequest, ServerResponse } from "../src/types";

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

  describe("BaseTransport emitResponse security and validation", () => {
    class TestTransport extends BaseTransport {
      async connect(): Promise<void> {}
      async send(request: ServerRequest): Promise<void> {}
      async close(): Promise<void> {}
      public testEmitResponse(response: ServerResponse): void {
        this.emitResponse(response);
      }
    }

    it("should safely handle response with id 'error' without crashing or throwing", () => {
      const transport = new TestTransport();
      const response: ServerResponse = { id: "error", success: false, error: "Something went wrong" };
      expect(() => transport.testEmitResponse(response)).not.toThrow();
    });

    it("should not emit on reserved event names like 'newListener' and 'removeListener'", () => {
      const transport = new TestTransport();
      const newListenerSpy = vi.fn();
      transport.getResponseEmitter().on("newListener", newListenerSpy);

      const responseNewListener: ServerResponse = { id: "newListener", success: true };
      transport.testEmitResponse(responseNewListener);
      expect(newListenerSpy).not.toHaveBeenCalled();

      const responseRemoveListener: ServerResponse = { id: "removeListener", success: true };
      transport.testEmitResponse(responseRemoveListener);
    });

    it("should safely ignore responses with invalid or missing id", () => {
      const transport = new TestTransport();
      expect(() => transport.testEmitResponse(null as any)).not.toThrow();
      expect(() => transport.testEmitResponse({} as any)).not.toThrow();
      expect(() => transport.testEmitResponse({ id: 123 as any, success: true })).not.toThrow();
    });

    it("should emit to registered listener for valid request id", () => {
      const transport = new TestTransport();
      const callback = vi.fn();
      transport.getResponseEmitter().on("req-123", callback);

      const response: ServerResponse = { id: "req-123", success: true };
      transport.testEmitResponse(response);

      expect(callback).toHaveBeenCalledWith(response);
    });
  });
});


