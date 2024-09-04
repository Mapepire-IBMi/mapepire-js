import { SQLJob } from "./sqlJob";
import { QueryOptions, QueryResult, ServerResponse } from "./types";

/**
 * Represents the possible states of a query execution.
 */
export enum QueryState {
  /**
   * Indicates that the query has not yet been run.
   */
  NOT_YET_RUN = 1,

  /**
   * Indicates that the query has been executed, and more data is available for retrieval.
   */
  RUN_MORE_DATA_AVAILABLE = 2,

  /**
   * Indicates that the query has been successfully executed and all data has been retrieved.
   */
  RUN_DONE = 3,

  /**
   * Indicates that an error occurred during the query execution.
   */
  ERROR = 4
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
   * The number of rows to fetch in each execution.
   */
  private rowsToFetch: number = 100;

  /**
   * Indicates if the query is a CL command.
   */
  private isCLCommand: boolean;

  /**
   * The current state of the query execution.
   */
  private state: QueryState = QueryState.NOT_YET_RUN;

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
    opts: QueryOptions = { isClCommand: false, parameters: undefined }
  ) {
    if (typeof query !== "string") {
      throw new TypeError("Query must be of type string");
    }
    this.job = job;
    this.isPrepared = undefined !== opts.parameters;
    this.parameters = opts.parameters;
    this.sql = query;
    this.isCLCommand = opts.isClCommand;
    this.isTerseResults = opts.isTerseResults;

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
          q.getState() === QueryState.NOT_YET_RUN ||
          q.getState() === QueryState.RUN_MORE_DATA_AVAILABLE
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
      if (
        query.getState() === QueryState.RUN_DONE ||
        query.getState() === QueryState.ERROR
      ) {
        closePromises.push(query.close());
      }
    }

    await Promise.all(closePromises);

    // Automatically remove any queries done and dusted. They're useless.
    this.globalQueryList = this.globalQueryList.filter(
      (q) => q.getState() !== QueryState.RUN_DONE
    );
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
      case QueryState.RUN_MORE_DATA_AVAILABLE:
        throw new Error("Statement has already been run");
      case QueryState.RUN_DONE:
        throw new Error("Statement has already been fully run");
    }
    let queryObject;
    if (this.isCLCommand) {
      queryObject = {
        id: SQLJob.getNewUniqueId(`clcommand`),
        type: `cl`,
        terse: this.isTerseResults,
        cmd: this.sql,
      };
    } else {
      queryObject = {
        id: SQLJob.getNewUniqueId(`query`),
        type: this.isPrepared ? `prepare_sql_execute` : `sql`,
        sql: this.sql,
        terse: this.isTerseResults,
        rows: rowsToFetch,
        parameters: this.parameters,
      };
    }
    this.rowsToFetch = rowsToFetch;
    let queryResult = await this.job.send<QueryResult<T>>(queryObject);

    this.state = queryResult.is_done
      ? QueryState.RUN_DONE
      : QueryState.RUN_MORE_DATA_AVAILABLE;

    if (queryResult.success !== true && !this.isCLCommand) {
      this.state = QueryState.ERROR;

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
      case QueryState.NOT_YET_RUN:
        throw new Error("Statement has not yet been run");
      case QueryState.RUN_DONE:
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

    this.state = queryResult.is_done
      ? QueryState.RUN_DONE
      : QueryState.RUN_MORE_DATA_AVAILABLE;

    if (queryResult.success !== true) {
      this.state = QueryState.ERROR;
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
    if (this.correlationId && this.state !== QueryState.RUN_DONE) {
      this.state = QueryState.RUN_DONE;
      let queryObject = {
        id: SQLJob.getNewUniqueId(`sqlclose`),
        cont_id: this.correlationId,
        type: `sqlclose`,
      };

      return this.job.send<ServerResponse>(queryObject);
    } else if (undefined === this.correlationId) {
      this.state = QueryState.RUN_DONE;
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
   * @returns The current state as a QueryState.
   */
  public getState(): QueryState {
    return this.state;
  }
}
