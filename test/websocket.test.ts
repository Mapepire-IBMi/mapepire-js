// Mock 'ws' at the very top
vi.mock("ws", () => {
  const EventEmitter = require("events");

  // Create a mock constructor that tracks instances
  const MockWebSocket = vi.fn().mockImplementation(() => {
    const ws = new EventEmitter();
    ws.send = vi.fn();
    ws.close = vi.fn();
    return ws;
  });

  return { default: MockWebSocket };
});

import { beforeAll, test, describe, it, expect, vi, beforeEach } from "vitest";
import { DaemonServer } from "../src/types";
import { ENV_CREDS } from "./env";
import { SQLJob } from "../src";

import WebSocket from "ws"; // <- This will now be your mocked vi.fn

let creds: DaemonServer = { ...ENV_CREDS };

beforeAll(async () => {
  creds.rejectUnauthorized = false;
    
});


describe("SQLJob WebSocket handling", () => {
  let sqlJob: SQLJob;

  beforeEach(() => {
    vi.clearAllMocks();   // clears .mock.calls, .mock.results, .mock.instances
    sqlJob = new SQLJob();
  });

  it("Can correctly decode binary message", async () => {
    const creds = { host: "localhost", port: 1234 };

    // getChannel resolves after "open"
    const channelPromise = (sqlJob as any).getChannel(creds);

    // grab the first instance created
    const ws = (WebSocket as vi.Mock).mock.results[0].value;

    // simulate open to resolve promise
    ws.emit("open");
    const wsInstance = await channelPromise;

    const buffer = new Uint8Array([
      5, 49, 50, 51, 52, 53, 0, 0, 0, 0, 4, 98, 108, 111, 98, 0, 0, 0, 5, 1, 2,
      3, 4, 5,
    ]);
    const spyInitial = vi.spyOn(
      sqlJob as any,
      "getInitialMetadataFromBinaryFrame"
    );
    const spyContinued = vi.spyOn(
      sqlJob as any,
      "getContinuedDataFromBinaryFrame"
    );

    // simulate message
    ws.emit("message", buffer, true);
    const initialReturn = spyInitial.mock.results[0].value;
    const continuedReturn = spyContinued.mock.results[0].value;

    expect(initialReturn).toStrictEqual({ queryIdLength: 5, queryId: "12345" });

    expect(continuedReturn).toEqual(
      {
        rowId: 0,
        colNameLength: 4,
        colName: "blob",
        blobLength: 5,
        blobStartByte: 19,
        blobEndByteExclusive: 24,
        data: buffer
      },
    );

    expect(wsInstance).toBe(ws);
  });

});
