import { EventEmitter } from "stream";
import { Query } from "./query";
import {
  ConnectionResult,
  DaemonServer,
  ExplainResults,
  GetTraceDataResult,
  JDBCOptions,
  JobLogEntry,
  QueryOptions,
  ServerTraceDest,
  ServerTraceLevel,
  SetConfigResult,
  ServerRequest,
  VersionCheckResult,
  ServerResponse,
  MapepireConfig
} from "./types";
import { ExplainType, JobStatus, TransactionEndType } from "./states";
import { Transport } from "./transport";
import { WebSocketTransport } from "./transports/websocket";
import { SSHSingleTransport } from "./transports/sshSingleTransport";
import { connectSSH2, createSSH2Connection } from "./transports/ssh2Helper";
import { connectNodeSSH, createNodeSSHConnection } from "./transports/nodeSSHHelper";
import type { ConnectConfig as SSH2ConnectConfig } from "ssh2";
import type { Config as NodeSSHConfig } from "node-ssh";

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
  protected static uniqueIdCounter: number = 0;
  private transport: Transport;
  protected responseEmitter: EventEmitter = new EventEmitter();
  protected status: JobStatus = JobStatus.NOT_STARTED;

  protected traceFile: string | undefined;
  protected isTracingChannelData: boolean = false;

  //currently unused but we will inevitably need a unique ID assigned to each instance
  // since server job names can be reused in some circumstances
  protected uniqueId = SQLJob.getNewUniqueId(`sqljob`);

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
   * @param transport - Optional custom transport implementation (defaults to WebSocketTransport)
   */
  constructor(public options: JDBCOptions = {}, transport?: Transport) {
    this.transport = transport || new WebSocketTransport();
  }

  /**
   * Creates a transport instance based on the provided configuration
   * @param config - Mapepire configuration
   * @returns Transport instance
   */
  private static createTransport(config: MapepireConfig): Transport {
    const transportType = config.transport || 'websocket';
    
    switch (transportType) {
      case 'websocket':
        return new WebSocketTransport();
      
      case 'ssh-single':
        return new SSHSingleTransport();
      
      default:
        throw new Error(`Unknown transport type: ${transportType}`);
    }
  }

  /**
   * Creates a new SQLJob instance with unified configuration
   * @param config - Mapepire configuration
   * @param options - JDBC options
   * @returns SQLJob instance
   */
  static withConfig(config: MapepireConfig, options: JDBCOptions = {}): SQLJob {
    const transport = SQLJob.createTransport(config);
    const job = new SQLJob(options, transport);
    
    // Store config for later use in connect
    (job as any)._mapepireConfig = config;
    
    return job;
  }

  /**
   * Creates a connected SQLJob using ssh2 credentials.
   * The SSH client is managed internally — no need to create, connect, or close it.
   * Call job.connect() with no arguments, then job.close() when done.
   *
   * @param creds  - ssh2 ConnectConfig (host, username, password / privateKey, port, …)
   * @param options - Optional JDBC options
   * @returns SQLJob instance ready for job.connect()
   *
   * @example
   * ```typescript
   * const job = await SQLJob.ssh2({ host: 'ibmi.example.com', username: 'USER', password: 'PASS' });
   * await job.connect();
   * const result = await job.execute('SELECT * FROM QIWS.QCUSTCDT');
   * await job.close();  // SSH client torn down automatically
   * ```
   */
  static async ssh2(creds: SSH2ConnectConfig, options: JDBCOptions = {}): Promise<SQLJob> {
    const client = await connectSSH2(creds);
    return SQLJob.withConfig({
      transport: 'ssh-single',
      sshSingle: {
        ...createSSH2Connection(client),
        teardown: () => client.end(),
      },
    }, options);
  }

  /**
   * Creates a connected SQLJob using node-ssh credentials.
   * The SSH instance is managed internally — no need to create, connect, or dispose it.
   * Call job.connect() with no arguments, then job.close() when done.
   *
   * @param creds  - node-ssh Config (host, username, password / privateKey, port, …)
   * @param options - Optional JDBC options
   * @returns SQLJob instance ready for job.connect()
   *
   * @example
   * ```typescript
   * const job = await SQLJob.nodeSSH({ host: 'ibmi.example.com', username: 'USER', password: 'PASS' });
   * await job.connect();
   * const result = await job.execute('SELECT * FROM QIWS.QCUSTCDT');
   * await job.close();  // SSH instance disposed automatically
   * ```
   */
  static async nodeSSH(creds: NodeSSHConfig, options: JDBCOptions = {}): Promise<SQLJob> {
    const ssh = await connectNodeSSH(creds);
    return SQLJob.withConfig({
      transport: 'ssh-single',
      sshSingle: {
        ...createNodeSSHConnection(ssh),
        teardown: () => ssh.dispose(),
      },
    }, options);
  }

  /**
   * Enables local tracing of the channel data.
   */
  enableLocalTrace() {
    this.isTracingChannelData = true;
    this.transport.enableTrace();
  }

  /**
   * Sends a message to the connected database server.
   *
   * @param content - The message content to send.
   * @returns A promise that resolves to the server's response.
   */
  async send<T>(content: ServerRequest): Promise<T> {
    return new Promise((resolve, reject) => {
      this.status = JobStatus.BUSY;
      const removeListeners = () => {
        this.responseEmitter.removeAllListeners(content.id);
        this.responseEmitter.removeAllListeners(`${content.id}_conn_fail`);
      };
      this.responseEmitter.on(content.id, (x: T) => {
        removeListeners();
        this.status = this.getRunningCount() === 0 ? JobStatus.READY : JobStatus.BUSY;
        resolve(x);
      });
      this.responseEmitter.on(`${content.id}_conn_fail`, (error: Error) => {
        removeListeners();
        reject(error);
      });
      
      // Send the request after registering listeners
      this.transport.send(content);
    });
  }

  /**
   * Retrieves the current status of the job.
   *
   * @returns The current status of the job.
   */
  getStatus() {
    return this.status;
  }

  /**
   * Gets the count of ongoing requests for the job.
   *
   * @returns The number of ongoing requests.
   */
  getRunningCount() {
    // Note that there are 2 events per request, 1 for the response and 1 for connection failure
    return this.responseEmitter.eventNames().length / 2;
  }

  /**
   * Connects to the specified DB2 server and initializes the SQL job.
   *
   * @param db2Server - The server details for the connection.
   * @returns A promise that resolves to the connection result.
   */
  async connect(db2Server?: DaemonServer): Promise<ConnectionResult> {
    this.status = JobStatus.CONNECTING;
    
    // Get config from stored config or use legacy daemon server
    const config = (this as any)._mapepireConfig as MapepireConfig | undefined;
    
    // Determine connection parameters based on transport type
    let connectionParams: any;
    let transportOptions: any;
    let technique: string;
    
    if (config) {
      // Using new config-based approach
      const transportType = config.transport || 'websocket';
      
      switch (transportType) {
        case 'websocket':
          if (!config.daemon) {
            throw new Error('daemon configuration is required for websocket transport');
          }
          connectionParams = config.daemon;
          technique = 'tcp';
          break;
        
        case 'ssh-single': {
          if (!config.sshSingle) {
            throw new Error('sshSingle configuration is required for ssh-single transport');
          }
          transportOptions = config.sshSingle;
          technique = 'cli'; // SSH single mode always uses CLI technique
          
          // For ssh-single, connection params are not used by the server.
          // The server uses the current SSH user and jdbc:default:connection.
          // We pass empty object to satisfy the transport.connect() signature.
          connectionParams = {};
          break;
        }
        
        default:
          throw new Error(`Unknown transport type: ${transportType}`);
      }
    } else {
      // Legacy mode: using daemon server directly
      if (!db2Server) {
        throw new Error('db2Server parameter is required when not using config-based initialization');
      }
      connectionParams = db2Server;
      technique = 'tcp';
    }
    
    // Connect the transport
    await this.transport.connect(connectionParams, transportOptions);
    
    // Wire up the response emitter from the transport
    this.responseEmitter = this.transport.getResponseEmitter();
    
    // Set up error handler for WebSocket transport (backward compatibility)
    if (this.transport instanceof WebSocketTransport) {
      this.transport.onError((err) => {
        console.error(err);
        this.dispose();
      });
    }

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
      technique: technique,
      application: `Node.js client`,
      props: props.length > 0 ? props : undefined,
    };

    const connectResult = await this.send<ConnectionResult>(connectionObject);

    if (connectResult.success === true) {
      this.status = JobStatus.READY;
    } else {
      this.dispose();
      this.status = JobStatus.CONNECTING;
      throw new Error(connectResult.error || `Failed to connect to server.`);
    }

    this.id = connectResult.job;
    this.isTracingChannelData = false;
    this.transport.disableTrace();

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

    const version = await this.send<VersionCheckResult>(verObj);

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
  async explain<T>(
    statement: string,
    type: ExplainType = ExplainType.RUN
  ): Promise<ExplainResults<T>> {
    const explainRequest = {
      id: SQLJob.getNewUniqueId(),
      type: `dove`,
      sql: statement,
      run: type === "run",
    };

    const explainResult = await this.send<ExplainResults<T>>(explainRequest);

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

    const rpy = await this.send<GetTraceDataResult>(tracedataReqObj);

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

    const rpy = await this.send<SetConfigResult>(reqObj);

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
      case TransactionEndType.ROLLBACK:
        query = type.toUpperCase();
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
    this.responseEmitter.removeAllListeners();
    this.dispose();
  }

  /**
   * Retrieves the WebSocket instance associated with the SQL job.
   * Normally the user should not access the socket directly,
   * but this is useful for testing scenarios like unexpected socket close, etc.
   *
   * @returns The WebSocket instance.
   * @deprecated Use getTransport() instead for transport-agnostic access
   */
  getSocket() {
    if (this.transport instanceof WebSocketTransport) {
      return this.transport.getSocket();
    }
    return undefined;
  }

  /**
   * Retrieves the transport instance associated with the SQL job.
   *
   * @returns The Transport instance.
   */
  getTransport(): Transport {
    return this.transport;
  }

  /**
   * Disposes of the resources associated with the SQL job.
   */
  private async dispose() {
    await this.transport.close();
    this.status = JobStatus.ENDED;
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
