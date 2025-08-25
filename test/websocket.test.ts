// 1️⃣ Mock 'ws' at the very top
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
import { getRootCertificate } from "../src/tls";
import { DaemonServer, ServerTraceDest, ServerTraceLevel } from "../src/types";
import { ENV_CREDS } from "./env";
import WebSocket from "ws"; // <- This will now be your mocked vi.fn

let creds: DaemonServer = { ...ENV_CREDS };

beforeAll(async () => {
  creds.rejectUnauthorized = false;
    
});

// test(`connection doesn't timeout in one minute`,{timeout:70000}, async () => {

//     const job = new SQLJob();
//     const res = await job.connect(creds);
//     await new Promise<void>((resolve, reject)=>{
//       setTimeout(async ()=>{
//       const query = await job.query<any>("SELECT * FROM SAMPLE.SYSCOLUMNS", {
//         isTerseResults: false,
//       });
//       const res = await query.execute(50);
//       await query.close();
//       expect(res.success).toBe(true);
//       await job.close();
//       resolve()
//     }, 60000)

//     })
// });

// test("should call callback when message is received", async () => {
//   const sqlJob = new SQLJob();

//   // Simulate a message being received
//   const testData = { foo: "bar" };
//   const ws = await (sqlJob as any).getChannel(creds);
//   ws.onmessage({ data: JSON.stringify(testData) } as MessageEvent);

// });

// Fake WebSocket class that behaves like 'ws'

import { SQLJob } from "../src";

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

    expect(continuedReturn).toEqual([
      {
        rowId: 0,
        colNameLength: 4,
        colName: "blob",
        blobLength: 5,
        blobStartByte: 19,
        blobEndByteExclusive: 24,
      },
    ]);

    expect(wsInstance).toBe(ws);
  });

  it("binary message multiple blobs multiple rows", async () => {
    const creds = { host: "localhost", port: 1234 };

    // getChannel resolves after "open"
    const channelPromise = (sqlJob as any).getChannel(creds);

    // grab the first instance created
    const ws = (WebSocket as vi.Mock).mock.results[0].value;

    // simulate open to resolve promise
    ws.emit("open");
    const wsInstance = await channelPromise;

    const buffer = new Uint8Array([
      5, 
      49, 50, 51, 52, 53, 
      0,0,0,0, 
      4, 98, 108, 111, 98,
      0,0,0,5, 1, 2, 3, 4, 5,
      0,0,0,1, 
      4, 98, 108, 111, 98, 
      0,0,0,3, 6, 7, 8
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

    expect(continuedReturn).toEqual([
      {
        rowId: 0,
        colNameLength: 4,
        colName: "blob",
        blobLength: 5,
        blobStartByte: 19,
        blobEndByteExclusive: 24,
      },
       {
        rowId: 1,
        colNameLength: 4,
        colName: "blob",
        blobLength: 3,
        blobStartByte: 37,
        blobEndByteExclusive: 40,
      },

    ]);

    expect(wsInstance).toBe(ws);
  });


  it("single row multiple blobs", async () => {
    const creds = { host: "localhost", port: 1234 };

    // getChannel resolves after "open"
    const channelPromise = (sqlJob as any).getChannel(creds);

    // grab the first instance created
    const ws = (WebSocket as vi.Mock).mock.results[0].value;

    // simulate open to resolve promise
    ws.emit("open");
    const wsInstance = await channelPromise;

    const buffer = new Uint8Array([
     3, 49,50,51, 
                0,0,0,0,          
                1, 97,         
                0,0,0,2, 10, 11,    
                 0,0,0,0,              // rowId
                2, 98, 98,     // colName "bb"
                0,0,0,3, 20, 21, 22   // blob  
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

    expect(initialReturn).toStrictEqual({ queryIdLength: 3, queryId: "123" });

    expect(continuedReturn).toEqual([
      {
        rowId: 0,
        colNameLength: 1,
        colName: "a",
        blobLength: 2,
        blobStartByte: 14,
        blobEndByteExclusive: 16,
      },
       {
        rowId: 0,
        colNameLength: 2,
        colName: "bb",
        blobLength: 3,
        blobStartByte: 27,
        blobEndByteExclusive: 30,
      },

    ]);

    expect(wsInstance).toBe(ws);
  });
});
