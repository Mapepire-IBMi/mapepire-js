/**
 * Transport abstraction for mapepire-js
 * Defines the interface for different transport mechanisms (WebSocket, HTTP, etc.)
 */

import { EventEmitter } from "stream";
import { DaemonServer, ServerRequest, ServerResponse } from "./types";

/**
 * Transport connection options
 */
export interface TransportOptions {
  /** Connection timeout in milliseconds */
  timeout?: number;
  
  /** Whether to reject unauthorized certificates */
  rejectUnauthorized?: boolean;
  
  /** Certificate authority for validating server certificates */
  ca?: string | Buffer;

  /** Working directory for spawned or remote process execution */
  cwd?: string;

  /** Environment variables for spawned or remote process execution */
  env?: NodeJS.ProcessEnv;
}

/**
 * Transport interface that all transport implementations must follow
 */
export interface Transport {
  /**
   * Establishes a connection to the server
   * @param server - Server connection details
   * @param options - Transport-specific options
   * @returns Promise that resolves when connection is established
   */
  connect(server: DaemonServer, options?: TransportOptions): Promise<void>;

  /**
   * Sends a request to the server
   * @param request - The request to send
   * @returns Promise that resolves when the message is sent
   */
  send(request: ServerRequest): Promise<void>;

  /**
   * Closes the transport connection
   * @returns Promise that resolves when connection is closed
   */
  close(): Promise<void>;

  /**
   * Gets the event emitter for receiving responses
   * @returns EventEmitter that emits server responses
   */
  getResponseEmitter(): EventEmitter;

  /**
   * Checks if the transport is currently connected
   * @returns true if connected, false otherwise
   */
  isConnected(): boolean;

  /**
   * Enables local tracing of transport data
   */
  enableTrace(): void;

  /**
   * Disables local tracing of transport data
   */
  disableTrace(): void;
}

/**
 * Base abstract class for transport implementations
 * Provides common functionality for all transports
 */
export abstract class BaseTransport implements Transport {
  protected responseEmitter: EventEmitter = new EventEmitter();
  protected connected: boolean = false;
  protected isTracing: boolean = false;

  abstract connect(server: DaemonServer, options?: TransportOptions): Promise<void>;
  abstract send(request: ServerRequest): Promise<void>;
  abstract close(): Promise<void>;

  getResponseEmitter(): EventEmitter {
    return this.responseEmitter;
  }

  isConnected(): boolean {
    return this.connected;
  }

  enableTrace(): void {
    this.isTracing = true;
  }

  disableTrace(): void {
    this.isTracing = false;
  }

  /**
   * Logs trace data if tracing is enabled
   * @param data - Data to log
   */
  protected trace(data: any): void {
    if (this.isTracing) {
      console.log(data);
    }
  }

  /**
   * Emits a response to listeners
   * @param response - The server response to emit
   */
  protected emitResponse(response: ServerResponse): void {
    this.responseEmitter.emit(response.id, response);
  }

  /**
   * Emits a connection failure event
   * @param requestId - The request ID that failed
   * @param error - The error that occurred
   */
  protected emitConnectionFailure(requestId: string, error: Error): void {
    this.responseEmitter.emit(`${requestId}_conn_fail`, error);
  }

  /**
   * Notifies all pending requests of connection failure
   * @param code - Connection close code
   * @param reason - Connection close reason
   */
  protected notifyConnectionFailure(code: number, reason: string): void {
    const events = this.responseEmitter.eventNames().filter(
      el => typeof el === "string" && el.endsWith("_conn_fail")
    );
    for (const event of events) {
      const message = `Connection failed with code ${code}` + 
        (reason.length > 0 ? `: ${reason}` : "");
      this.responseEmitter.emit(event, new Error(message));
    }
    this.responseEmitter.removeAllListeners();
  }
}


