import {
  JDBCOptions,
  ConnectionResult,
  Rows,
  QueryResult,
  JobLogEntry,
  CLCommandResult,
  VersionCheckResult,
  GetTraceDataResult,
  ServerTraceDest,
  ServerTraceLevel,
  SetConfigResult,
  QueryOptions,
  ExplainResults,
  DaemonServer,
  ExplainType,
  JobStatus,
  TransactionEndType,
} from "./types";
import { Query } from "./query";
import { EventEmitter } from "stream";
import WebSocket from "ws";
import { X509Certificate } from "crypto"

interface ReqRespFmt {
  id: string;
}

const TransactionCountQuery = [
  `select count(*) as thecount`,
  `  from qsys2.db_transaction_info`,
  `  where JOB_NAME = qsys2.job_name and`,
  `    (local_record_changes_pending = 'YES' or local_object_changes_pending = 'YES')`,
].join(`\n`);

export const DEFAULT_PORT = 8076;

/**
 * Represents a SQL job that manages connections and queries to a database.
 */
export class SQLJob {
  /**
   * A counter to generate unique IDs for each SQLJob instance.
   */
  private static uniqueIdCounter: number = 0;
  private socket: WebSocket;
  private responseEmitter: EventEmitter = new EventEmitter();
  private status: JobStatus = JobStatus.NotStarted;

  private traceFile: string | undefined;
  private isTracingChannelData: boolean = false;

  //currently unused but we will inevitably need a unique ID assigned to each instance
  // since server job names can be reused in some circumstances
  private uniqueId = SQLJob.getNewUniqueId(`sqljob`);

  id: string | undefined;

  /**
   * Generates a new unique ID with an optional prefix.
   *
   * @param prefix - An optional prefix for the unique ID.
   * @returns A unique ID string.
   */
  public static getNewUniqueId(prefix: string = `id`): string {
    return prefix + ++SQLJob.uniqueIdCounter;
  }

  /**
   * Constructs a new SQLJob instance with the specified options.
   *
   * @param options - The options for configuring the SQL job.
   */
  constructor(public options: JDBCOptions = {}) {}

  /**
   * Establishes a WebSocket connection to the specified DB2 server.
   *
   * @param db2Server - The server details for the connection.
   * @returns A promise that resolves to the WebSocket instance.
   */
  private getChannel(db2Server: DaemonServer): Promise<WebSocket> {
    // Handle the scenario that server is not configured properly with full chain certificates
    // In this scenario, the obtained CA certificate is the server certificate, not the expected root CA certificate,
    // So the certificate verification cannot pass, should set rejectUnauthorized to false.
    let rejectUnauthorized = true;
    
    if (db2Server.ca) {
      const x509Cert = new X509Certificate(db2Server.ca);
      rejectUnauthorized = x509Cert.subject === x509Cert.issuer;
    }

    return new Promise((resolve, reject) => {
      const ws = new WebSocket(
        `wss://${db2Server.host}:${db2Server.port || DEFAULT_PORT}/db/`,
        {
          headers: {
            authorization: `Basic ${Buffer.from(
              `${db2Server.user}:${db2Server.password}`
            ).toString("base64")}`,
          },
          ca: db2Server.ca,
          timeout: 5000,
          rejectUnauthorized: rejectUnauthorized,
        }
      );

      ws.on("error", (err: Error) => {
        console.log(err);
        reject(err);
      });

      ws.on("message", (data: Buffer) => {
        const asString = data.toString();
        if (this.isTracingChannelData) {
          console.log(asString);
        }
        try {
          let response: ReqRespFmt = JSON.parse(asString);
          this.responseEmitter.emit(response.id, asString);
        } catch (e: any) {
          console.log(`Error: ` + e);
        }
      });

      ws.once(`open`, () => {
        resolve(ws);
      });
    });
  }

  /**
   * Sends a message to the connected database server.
   *
   * @param content - The message content to send.
   * @returns A promise that resolves to the server's response.
   */
  async send(content: string): Promise<string> {
    if (this.isTracingChannelData) console.log(content);

    let req: ReqRespFmt = JSON.parse(content);
    this.socket.send(content);
    return new Promise((resolve, reject) => {
      this.responseEmitter.on(req.id, (x: string) => {
        this.responseEmitter.removeAllListeners(req.id);
        resolve(x);
      });
    });
  }

  /**
   * Retrieves the current status of the job.
   *
   * @returns The current status of the job.
   */
  getStatus() {
    return this.getRunningCount() > 0 ? JobStatus.Busy : this.status;
  }

  /**
   * Gets the count of ongoing requests for the job.
   *
   * @returns The number of ongoing requests.
   */
  getRunningCount() {
    return this.responseEmitter.eventNames().length;
  }

  /**
   * Connects to the specified DB2 server and initializes the SQL job.
   *
   * @param db2Server - The server details for the connection.
   * @returns A promise that resolves to the connection result.
   */
  async connect(db2Server: DaemonServer): Promise<ConnectionResult> {
    this.status = JobStatus.Connecting;
    this.socket = await this.getChannel(db2Server);

    this.socket.on(`error`, (err) => {
      console.log(err);
      this.dispose();
    });

    this.socket.on(`close`, () => {
      this.dispose();
    });

    const props = Object.keys(this.options)
      .map((prop) => {
        if (Array.isArray(this.options[prop])) {
          return `${prop}=${(this.options[prop] as string[]).join(`,`)}`;
        } else {
          return `${prop}=${this.options[prop]}`;
        }
      })
      .join(`;`);

    const connectionObject = {
      id: SQLJob.getNewUniqueId(),
      type: `connect`,
      technique: "tcp",
      application: `Node.js client`,
      props: props.length > 0 ? props : undefined,
    };

    const result = await this.send(JSON.stringify(connectionObject));

    const connectResult: ConnectionResult = JSON.parse(result);

    if (connectResult.success === true) {
      this.status = JobStatus.Ready;
    } else {
      this.dispose();
      this.status = JobStatus.NotStarted;
      throw new Error(connectResult.error || `Failed to connect to server.`);
    }

    this.id = connectResult.job;
    this.isTracingChannelData = false;

    return connectResult;
  }

  /**
   * Creates a query object for the specified SQL statement.
   *
   * @param sql - The SQL statement to query.
   * @param opts - Optional settings for the query.
   * @returns A new Query instance.
   */
  query<T>(sql: string, opts?: QueryOptions): Query<T> {
    return new Query(this, sql, opts);
  }

  /**
   * Executes an SQL command and returns the result.
   *
   * @param sql - The SQL command to execute.
   * @param opts - Optional settings for the command.
   * @returns A promise that resolves to the command execution result.
   */
  async execute<T>(sql: string, opts?: QueryOptions) {
    const query = this.query<T>(sql, opts);
    const result = await query.execute();
    await query.close();

    if (result.error) {
      throw new Error(result.error);
    }

    return result;
  }

  /**
   * Retrieves the version information from the database server.
   *
   * @returns A promise that resolves to the version check result.
   */
  async getVersion(): Promise<VersionCheckResult> {
    const verObj = {
      id: SQLJob.getNewUniqueId(),
      type: `getversion`,
    };

    const result = await this.send(JSON.stringify(verObj));

    const version: VersionCheckResult = JSON.parse(result);

    if (version.success !== true) {
      throw new Error(version.error || `Failed to get version from backend`);
    }

    return version;
  }

  /**
   * Explains a SQL statement and returns the results.
   * @param statement - The SQL statement to explain.
   * @param type - The type of explain to perform (default is ExplainType.Run).
   * @returns A promise that resolves to the explain results.
   */
  async explain(
    statement: string,
    type: ExplainType = ExplainType.Run
  ): Promise<ExplainResults<any>> {
    const explainRequest = {
      id: SQLJob.getNewUniqueId(),
      type: `dove`,
      sql: statement,
      run: type === ExplainType.Run,
    };

    const result = await this.send(JSON.stringify(explainRequest));

    const explainResult: ExplainResults<any> = JSON.parse(result);

    if (explainResult.success !== true) {
      throw new Error(explainResult.error || `Failed to explain.`);
    }

    return explainResult;
  }

  /**
   * Retrieves the file path of the trace file, if available.
   *
   * @returns The trace file path or undefined.
   */
  getTraceFilePath(): string | undefined {
    return this.traceFile;
  }

  /**
   * Retrieves trace data from the backend.
   *
   * @returns A promise that resolves to the trace data result.
   */
  async getTraceData(): Promise<GetTraceDataResult> {
    const tracedataReqObj = {
      id: SQLJob.getNewUniqueId(),
      type: `gettracedata`,
    };

    const result = await this.send(JSON.stringify(tracedataReqObj));

    const rpy: GetTraceDataResult = JSON.parse(result);

    if (rpy.success !== true) {
      throw new Error(rpy.error || `Failed to get trace data from backend`);
    }

    return rpy;
  }

  /**
   * Configures the trace options on the backend.
   *
   * @param dest - The destination for the trace data.
   * @param level - The level of tracing to apply.
   * @returns A promise that resolves to the result of the configuration.
   */
  async setTraceConfig(
    dest: ServerTraceDest,
    level: ServerTraceLevel
  ): Promise<SetConfigResult> {
    const reqObj = {
      id: SQLJob.getNewUniqueId(),
      type: `setconfig`,
      tracedest: dest,
      tracelevel: level,
    };

    this.isTracingChannelData = true;

    const result = await this.send(JSON.stringify(reqObj));

    const rpy: SetConfigResult = JSON.parse(result);

    if (rpy.success !== true) {
      throw new Error(rpy.error || `Failed to set trace options on backend`);
    }

    this.traceFile =
      rpy.tracedest && rpy.tracedest[0] === `/` ? rpy.tracedest : undefined;

    return rpy;
  }

  /**
   * Creates a command-line SQL query.
   *
   * @param cmd - The command-line SQL command to execute.
   * @returns A new Query instance for the command.
   */
  clcommand(cmd: string): Query<any> {
    return new Query(this, cmd, { isClCommand: true });
  }

  /**
   * Checks if the job is under commit control based on the transaction isolation level.
   *
   * @returns A boolean indicating if the job is under commit control.
   */
  underCommitControl() {
    return (
      this.options["transaction isolation"] &&
      this.options["transaction isolation"] !== `none`
    );
  }

  /**
   * Retrieves the count of pending transactions.
   *
   * @returns A promise that resolves to the count of pending transactions.
   */
  async getPendingTransactions() {
    const rows = await this.query<{ THECOUNT: number }>(
      TransactionCountQuery
    ).execute(1);

    if (
      rows.success &&
      rows.data &&
      rows.data.length === 1 &&
      rows.data[0].THECOUNT
    )
      return rows.data[0].THECOUNT;
    return 0;
  }

  /**
   * Ends the current transaction by committing or rolling back.
   *
   * @param type - The type of transaction ending (commit or rollback).
   * @returns A promise that resolves to the result of the transaction operation.
   */
  async endTransaction(type: TransactionEndType) {
    let query;
    switch (type) {
      case TransactionEndType.COMMIT:
        query = `COMMIT`;
        break;
      case TransactionEndType.ROLLBACK:
        query = `ROLLBACK`;
        break;
      default:
        throw new Error(`TransactionEndType ${type} not valid`);
    }

    return this.query<JobLogEntry>(query).execute();
  }

  /**
   * Retrieves the unique ID assigned to this SQLJob instance.
   *
   * @returns The unique ID.
   */
  getUniqueId() {
    return this.uniqueId;
  }

  /**
   * Closes the SQL job and cleans up resources.
   */
  async close() {
    this.dispose();
  }

  /**
   * Disposes of the resources associated with the SQL job.
   */
  dispose() {
    if (this.socket) {
      this.socket.close();
    }
    this.status = JobStatus.Ended;
  }
}

/**
 * Converts a database URI into a DaemonServer object.
 *
 * @param uri - The URI representing the database connection details.
 * @returns A DaemonServer object containing the parsed details.
 * @throws An error if the URI has an invalid protocol or missing required fields.
 */
export function UrlToDaemon(uri: string): DaemonServer {
  const url = new URL(uri);

  if (url.protocol !== `db2i:`) {
    throw new Error(
      `Invalid protocol ${url.protocol}. Only db2i is supported.`
    );
  }

  const requiredFields = [`username`, `password`, `hostname`];

  for (let field of requiredFields) {
    if (!url[field]) {
      throw new Error(`Missing required field ${field}.`);
    }
  }

  const baseOfPassword = Buffer.from(url.password, "base64").toString();
  const [password, pfx] = baseOfPassword.split(`:`);

  return {
    host: url.hostname,
    port: parseInt(url.port || `8076`),
    user: url.username,
    password: password,
  };
}
