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

interface ReqRespFmt {
  id: string;
}

const TransactionCountQuery = [
  `select count(*) as thecount`,
  `  from qsys2.db_transaction_info`,
  `  where JOB_NAME = qsys2.job_name and`,
  `    (local_record_changes_pending = 'YES' or local_object_changes_pending = 'YES')`,
].join(`\n`);

export class SQLJob {
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

  public static getNewUniqueId(prefix: string = `id`): string {
    return prefix + ++SQLJob.uniqueIdCounter;
  }

  constructor(public options: JDBCOptions = {}) {}
  private getChannel(db2Server: DaemonServer): Promise<WebSocket> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(
        `wss://${db2Server.host}:${db2Server.port}/db/`,
        {
          headers: {
            authorization: `Basic ${Buffer.from(
              `${db2Server.user}:${db2Server.password}`
            ).toString("base64")}`,
          },
          ca: db2Server.ca,
          timeout: 5000,
          rejectUnauthorized: db2Server.ca ? false : true, //This allows a self-signed certificate to be used
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

  getStatus() {
    return this.getRunningCount() > 0 ? JobStatus.Busy : this.status;
  }

  getRunningCount() {
    return this.responseEmitter.eventNames().length;
  }

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
      //technique: (getInstance().getConnection().qccsid === 65535 || this.options["database name"]) ? `tcp` : `cli`, //TODO: investigate why QCCSID 65535 breaks CLI and if there is any workaround
      technique: `tcp`, // TODO: DOVE does not work in cli mode
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

  query<T>(sql: string, opts?: QueryOptions): Query<T> {
    return new Query(this, sql, opts);
  }

  async execute<T>(sql: string, opts?: QueryOptions) {
    const query = this.query<T>(sql, opts);
    const result = await query.execute();
    await query.close();

    if (result.error) {
      throw new Error(result.error);
    }

    return result;
  }

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

  getTraceFilePath(): string | undefined {
    return this.traceFile;
  }

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

  clcommand(cmd: string): Query<any> {
    return new Query(this, cmd, { isClCommand: true });
  }

  underCommitControl() {
    return (
      this.options["transaction isolation"] &&
      this.options["transaction isolation"] !== `none`
    );
  }

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

  getUniqueId() {
    return this.uniqueId;
  }

  async close() {
    this.dispose();
  }

  dispose() {
    if (this.socket) {
      this.socket.close();
    }
    this.status = JobStatus.Ended;
  }
}

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
