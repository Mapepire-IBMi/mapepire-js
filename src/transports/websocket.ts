/**
 * WebSocket transport implementation for mapepire-js
 */

import WebSocket from "ws";
import { BaseTransport, TransportOptions } from "../transport";
import { DaemonServer, ServerRequest, ServerResponse } from "../types";

export const DEFAULT_PORT = 8076;

/**
 * WebSocket-specific transport options
 */
export interface WebSocketTransportOptions extends TransportOptions {
  /** WebSocket connection timeout in milliseconds (default: 5000) */
  timeout?: number;
}

/**
 * WebSocket transport implementation
 * Handles communication with the mapepire server via WebSocket protocol
 */
export class WebSocketTransport extends BaseTransport {
  private socket: WebSocket | undefined;

  /**
   * Establishes a WebSocket connection to the server
   * @param server - Server connection details
   * @param options - WebSocket-specific options
   */
  async connect(server: DaemonServer, options: WebSocketTransportOptions = {}): Promise<void> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(
        `wss://${server.host}:${server.port || DEFAULT_PORT}/db/`,
        {
          headers: {
            authorization: `Basic ${Buffer.from(
              `${server.user}:${server.password}`
            ).toString("base64")}`,
          },
          ca: options.ca || server.ca,
          timeout: options.timeout || 5000,
          rejectUnauthorized: options.rejectUnauthorized ?? server.rejectUnauthorized
        }
      );

      ws.on("error", (err: Error) => {
        console.error(err);
        reject(err);
      });

      ws.on("message", (data: Buffer) => {
        const asString = data.toString();
        this.trace(asString);
        
        try {
          const response: ServerResponse = JSON.parse(asString);
          this.emitResponse(response);
        } catch (e: any) {
          console.error(`Error parsing response: ` + e);
        }
      });

      ws.on("close", (code, reason) => {
        this.connected = false;
        this.notifyConnectionFailure(code, reason.toString());
      });

      ws.once("open", () => {
        this.socket = ws;
        this.connected = true;
        resolve();
      });
    });
  }

  /**
   * Sends a request through the WebSocket connection
   * @param request - The request to send
   */
  async send(request: ServerRequest): Promise<void> {
    if (!this.socket || !this.connected) {
      throw new Error("WebSocket is not connected");
    }

    this.trace(request);
    this.socket.send(JSON.stringify(request));
  }

  /**
   * Closes the WebSocket connection
   */
  async close(): Promise<void> {
    if (this.socket) {
      this.socket.close();
      this.socket = undefined;
    }
    this.connected = false;
  }

  /**
   * Gets the underlying WebSocket instance
   * Useful for testing scenarios like unexpected socket close
   * @returns The WebSocket instance or undefined if not connected
   */
  getSocket(): WebSocket | undefined {
    return this.socket;
  }

  /**
   * Sets up error handler for the WebSocket
   * @param handler - Error handler function
   */
  onError(handler: (err: Error) => void): void {
    if (this.socket) {
      this.socket.on("error", handler);
    }
  }
}


