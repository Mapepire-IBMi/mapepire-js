import { b } from "vitest/dist/suite-BWgaIsVn";
import { SQLJob } from "./sqlJob";
import {
  BindingValue,
  ColumnType,
  QueryOptions,
  QueryResult,
  ServerResponse,
} from "./types";

/**
 * Represents the possible states of a query execution.
 */
export type QueryState =
  | "NOT_YET_RUN"
  | "RUN_MORE_DATA_AVAILABLE"
  | "RUN_DONE"
  | "ERROR";

interface Blob {
  data: Uint8Array;
  replacementIndex: number;
}

interface BlobFrameData {
  blobs: Blob[];
  blobQueryId: number;
}

/**
 * Represents a SQL query that can be executed and managed within a SQL job.
 *
 * @template T - The type of the result returned by the query.
 */
export class Query<T> {
  /**
   * List of all global queries that are currently open.
   */
  private static globalQueryList: Query<any>[] = [];

  /**
   * The correlation ID associated with the query.
   */
  private correlationId: string;

  /**
   * The SQL statement to be executed.
   */
  private sql: string;

  /**
   * Indicates if the query has been prepared.
   */
  private isPrepared: boolean = false;

  /**
   * The parameters to be used with the SQL query.
   */
  private parameters: any[] | undefined;

  /**
   * The column types of the parameters.
   */
  private columnTypes: ColumnType[] | undefined;

  /**
   * The number of rows to fetch in each execution.
   */
  private rowsToFetch: number = 100;

  /**
   * Indicates if the query is a CL command.
   */
  private isCLCommand: boolean;

  private isBlobCommand: boolean;
  private blobsNeeded: number;

  /**
   * The current state of the query execution.
   */
  private state: QueryState = "NOT_YET_RUN";

  /**
   * Indicates if the results should be terse.
   */
  private isTerseResults: boolean;

  /**
   * Constructs a new Query instance.
   *
   * @param job - The SQL job that this query will be executed within.
   * @param query - The SQL statement to execute.
   * @param opts - Optional settings for the query, such as parameters and command type.
   */
  constructor(
    private job: SQLJob,
    query: string,
    opts: QueryOptions = {
      isClCommand: false,
      parameters: undefined,
      columnType: undefined,
      blobsNeeded: 0,
    }
  ) {
    if (typeof query !== "string") {
      throw new TypeError("Query must be of type string");
    }
    this.job = job;
    this.isPrepared = undefined !== opts.parameters;
    this.parameters = opts.parameters;
    this.columnTypes = opts.columnType;
    this.sql = query;
    this.isCLCommand = opts.isClCommand;
    this.isBlobCommand = opts.columnType?.some(
      (columnType) => columnType === ColumnType.BLOB
    );
    this.isTerseResults = opts.isTerseResults;
    this.blobsNeeded = opts.blobsNeeded;

    Query.globalQueryList.push(this);
  }

  /**
   * Retrieves a Query instance by its correlation ID.
   *
   * @param id - The correlation ID of the query.
   * @returns The corresponding Query instance or undefined if not found.
   */
  public static byId(id: string) {
    return undefined === id || "" === id
      ? undefined
      : Query.globalQueryList.find((query) => query.correlationId === id);
  }

  /**
   * Retrieves a list of open correlation IDs for the specified job.
   *
   * @param forJob - Optional SQLJob to filter the queries by.
   * @returns An array of correlation IDs for open queries.
   */
  public static getOpenIds(forJob?: SQLJob) {
    return this.globalQueryList
      .filter((q) => q.job == forJob || forJob === undefined)
      .filter(
        (q) =>
          q.getState() === "NOT_YET_RUN" ||
          q.getState() === "RUN_MORE_DATA_AVAILABLE"
      )
      .map((q) => q.correlationId);
  }

  /**
   * Cleans up completed or erroneous queries from the global query list.
   *
   * @returns A promise that resolves when cleanup is complete.
   */
  public static async cleanup() {
    let closePromises = [];

    // First, let's check to see if we should also cleanup
    // any cursors that remain open, and we've been told to close
    for (const query of this.globalQueryList) {
      if (query.getState() === "RUN_DONE" || query.getState() === "ERROR") {
        closePromises.push(query.close());
      }
    }

    await Promise.all(closePromises);

    // Automatically remove any queries done and dusted. They're useless.
    this.globalQueryList = this.globalQueryList.filter(
      (q) => q.getState() !== "RUN_DONE"
    );
  }

  /**
   * Add sql statements to the batch only
   *
   * @returns The parameters for the batch
   */
  public addToBatch(parameters: BindingValue[]): BindingValue[] {
    this.parameters = this.parameters ?? [];
    if (!Array.isArray(parameters) || !parameters.every(Array.isArray)) {
      throw new Error(
        "Parameter 'parameters' must be a 2D array of parameters to the query"
      );
    }

    this.parameters.push(...parameters);

    this.isPrepared = true;
    return this.parameters;
  }

  private concatUint8Arrays(...arrays) {
    const totalLength = arrays.reduce((sum, arr) => sum + arr.length, 0);
    const result = new Uint8Array(totalLength);

    let offset = 0;
    for (const arr of arrays) {
      result.set(arr, offset);
      offset += arr.length;
    }

    return result;
  }

  private getNotBlobParams(): (string | number)[] {
    if (this.parameters[0] instanceof Array) {
      return this.parameters.map((parameter) =>
        parameter.filter((data) => !(data instanceof Uint8Array))
      );
    }
    return this.parameters.filter((data) => !(data instanceof Uint8Array));
  }

  private getBlobFrame(blobFrameData: BlobFrameData): Uint8Array {
    let blobFrame = new Uint8Array(2);
    const { blobQueryId, blobs } = blobFrameData;

    let hexString = blobQueryId.toString(16);
    if (hexString.length < 4) {
      hexString = hexString.padStart(4, "0");
    }

    const buffer = new ArrayBuffer(2); // Allocate 2 bytes
    // const blobIdBuf = new Uint8Array(buffer); // Create a Uint8Array view on the buffer

    // Parse the hex pairs and assign to Uint8Array
    blobFrame[0] = parseInt(hexString.substring(0, 2), 16);
    blobFrame[1] = parseInt(hexString.substring(2, 4), 16);
    for (const blob of blobs) {
      const { data, replacementIndex } = blob;

      const replacementIndexBuffer = new ArrayBuffer(1);
      const replacementIndexView = new DataView(replacementIndexBuffer);
      replacementIndexView.setUint8(0, replacementIndex);
      const replacementIndexArray = new Uint8Array(replacementIndexBuffer);

      const lenBuffer = new ArrayBuffer(4); // Allocate 2 bytes
      const lenView = new DataView(lenBuffer);
      lenView.setUint32(0, data.length, false);
      const lenUint8array = new Uint8Array(lenBuffer); // Create Uint8Array to view raw bytes

      blobFrame = this.concatUint8Arrays(
        blobFrame,
        replacementIndexArray,
        lenUint8array,
        data
      );
    }
    return blobFrame;
  }

  extractBlobsFromParameters(blobQueryId: number): BlobFrameData {
    const blobs: Blob[] = [];
    if (this.parameters[0] instanceof Array && this.parameters.length > 1) {
      throw new Error("Prepared statements involving blobs can not be batched");
    }

    for (let i = 0; i < this.parameters.length; i++) {
      if (this.columnTypes[i] === ColumnType.BLOB) {
        const blob: Blob = {
          replacementIndex: i + 1,
          data: this.parameters[i] instanceof Array ? this.parameters[0][i] : this.parameters[i],
        };
        blobs.push(blob);
      }
    }
    return { blobs, blobQueryId };
  }

  /**
   * Executes the SQL query and returns the results.
   *
   * @param rowsToFetch - The number of rows to fetch (defaults to the configured number).
   * @returns A promise that resolves to the query result.
   */
  public async execute(
    rowsToFetch: number = this.rowsToFetch
  ): Promise<QueryResult<T>> {
    if (typeof rowsToFetch !== "number") {
      throw new Error("rowsToFetch must be a number");
    } else if (rowsToFetch <= 0) {
      throw new Error("rowsToFetch must be greater than 0");
    }
    switch (this.state) {
      case "RUN_MORE_DATA_AVAILABLE":
        throw new Error("Statement has already been run");
      case "RUN_DONE":
        throw new Error("Statement has already been fully run");
    }
    let queryObject;
    let blobQueryId;
    if (this.isCLCommand) {
      queryObject = {
        id: SQLJob.getNewUniqueId(`clcommand`),
        type: `cl`,
        terse: this.isTerseResults,
        cmd: this.sql,
      };
    } else if (this.isBlobCommand) {
      blobQueryId = SQLJob.getUniqueBlobId();
      queryObject = {
        id: blobQueryId,
        type: `prepare_sql`,
        terse: this.isTerseResults,
        sql: this.sql,
        parameters: this.getNotBlobParams(),
        blobsNeeded: this.blobsNeeded,
      };
    } else {
      queryObject = {
        id: SQLJob.getNewUniqueId(`query`),
        type: this.isPrepared ? `prepare_sql_execute` : `sql`,
        sql: this.sql,
        terse: this.isTerseResults,
        rows: rowsToFetch,
        parameters: this.parameters,
        columnTypes: this.columnTypes,
      };
    }
    this.rowsToFetch = rowsToFetch;
    let queryResult = await this.job.send<QueryResult<T>>(queryObject);

    if (this.columnTypes?.includes(ColumnType.BLOB)) {
      const blobs = this.extractBlobsFromParameters(blobQueryId);
      const blobFrame = await this.getBlobFrame(blobs);
      // const queryResult = await this.job.send<QueryResult<T>>(blobFrame);
      this.job.send<QueryResult<T>>(blobFrame);
    }

    this.state = queryResult.is_done ? "RUN_DONE" : "RUN_MORE_DATA_AVAILABLE";

    if (queryResult.success !== true && !this.isCLCommand) {
      this.state = "ERROR";

      let errorList = [
        queryResult.error,
        queryResult.sql_state,
        queryResult.sql_rc,
      ].filter((e) => e !== undefined);

      if (errorList.length === 0) {
        errorList.push(`Failed to run query (unknown error)`);
      }

      throw new Error(errorList.join(", "));
    }
    this.correlationId = queryResult.id;

    return queryResult;
  }

  /**
   * Fetches more rows from the currently running query.
   *
   * @param rowsToFetch - The number of additional rows to fetch.
   * @returns A promise that resolves to the query result.
   */
  public async fetchMore(
    rowsToFetch: number = this.rowsToFetch
  ): Promise<QueryResult<T>> {
    switch (this.state) {
      case "NOT_YET_RUN":
        throw new Error("Statement has not yet been run");
      case "RUN_DONE":
        throw new Error("Statement has already been fully run");
    }
    let queryObject = {
      id: SQLJob.getNewUniqueId(`fetchMore`),
      cont_id: this.correlationId,
      type: `sqlmore`,
      sql: this.sql,
      rows: rowsToFetch,
    };

    this.rowsToFetch = rowsToFetch;
    let queryResult = await this.job.send<QueryResult<T>>(queryObject);

    this.state = queryResult.is_done ? "RUN_DONE" : "RUN_MORE_DATA_AVAILABLE";

    if (queryResult.success !== true) {
      this.state = "ERROR";
      throw new Error(
        queryResult.error || `Failed to run query (unknown error)`
      );
    }
    return queryResult;
  }

  /**
   * Closes the query and releases any associated resources.
   *
   * @returns A promise that resolves when the query is closed.
   */
  public async close() {
    if (this.correlationId && this.state !== "RUN_DONE") {
      this.state = "RUN_DONE";
      let queryObject = {
        id: SQLJob.getNewUniqueId(`sqlclose`),
        cont_id: this.correlationId,
        type: `sqlclose`,
      };

      return this.job.send<ServerResponse>(queryObject);
    } else if (undefined === this.correlationId) {
      this.state = "RUN_DONE";
    }
  }

  /**
   * Retrieves the SQL job that the query is running under.
   */
  public getHostJob(): SQLJob {
    return this.job;
  }

  /**
   * Retrieves the correlation ID of the query.
   *
   * @returns The correlation ID as a string.
   */
  public getId(): string {
    return this.correlationId;
  }

  /**
   * Retrieves the current state of the query.
   *
   * @returns The current state as a "
   */
  public getState(): QueryState {
    return this.state;
  }
}
