import { SQLJob } from "./sqlJob";
import { BindingValue, DaemonServer, JDBCOptions, QueryOptions } from "./types";
import {JobStatus} from "./states";

/**
 * Represents the options for configuring a connection pool.
 */
export interface PoolOptions {
  /** The credentials required to connect to the daemon server. */
  creds: DaemonServer,

   /**
   * Optional JDBC options for configuring the connection.
   * These options may include settings such as connection timeout,
   * SSL settings, etc.
   */
  opts?: JDBCOptions,

  /**
   * The maximum number of connections allowed in the pool.
   * This defines the upper limit on the number of active connections.
   */
  maxSize: number,

  /**
   * The number of connections to create when the pool is initialized.
   * This determines the starting size of the connection pool.
   */
  startingSize: number
}

interface PoolAddOptions {
  /** An existing job to add to the pool */
  existingJob?: SQLJob,
  /** Don't add to the pool */
  poolIgnore?: boolean
}

const INVALID_STATES: JobStatus[] = [JobStatus.ENDED, JobStatus.NOT_STARTED];

/**
 * Represents a connection pool for managing SQL jobs.
 */
export class Pool {
  /**
   * An array of SQLJob instances managed by the pool.
   */
  private jobs: SQLJob[] = [];

  /**
   * Constructs a new Pool instance with the specified options.
   *
   * @param options - The options for configuring the connection pool.
   */
  constructor(private options: PoolOptions) {}

  /**
   * Initializes the pool by creating a number of SQL jobs defined by the starting size.
   *
   * @returns A promise that resolves when all jobs have been created.
   */
  init() {
    let promises: Promise<SQLJob>[] = [];

    if (this.options.maxSize <= 0) {
      return Promise.reject("Max size must be greater than 0");
    } else if (this.options.startingSize <= 0) {
      return Promise.reject("Starting size must be greater than 0");
    } else if (this.options.startingSize > this.options.maxSize) {
      return Promise.reject(
        "Max size must be greater than or equal to starting size"
      );
    }
    for (let i = 0; i < this.options.startingSize; i++) {
      promises.push(this.addJob());
    }

    return Promise.all(promises);
  }

  /**
   * Checks if there is space available in the pool for more jobs.
   *
   * @returns True if there is space; otherwise, false.
   */
  hasSpace() {
    return (
      this.jobs.filter((j) => !INVALID_STATES.includes(j.getStatus())).length <
      this.options.maxSize
    );
  }

  /**
   * Gets the count of active jobs that are either busy or ready.
   *
   * @returns The number of active jobs.
   */
  getActiveJobCount() {
    return this.jobs.filter(
      (j) =>
        j.getStatus() === "busy" || j.getStatus() === "ready"
    ).length;
  }

  /**
   * Cleans up the pool by removing jobs that are in invalid states.
   */
  cleanup() {
    for (let i = this.jobs.length - 1; i >= 0; i--) {
      if (INVALID_STATES.includes(this.jobs[i].getStatus())) {
        this.jobs.splice(i, 1);
      }
    }
  }

  /**
   * Adds a new job to the pool or reuses an existing job if specified.
   *
   * @param options - Optional parameters for adding a job.
   * @returns A promise that resolves to the added or existing SQL job.
   */
  private async addJob(options: PoolAddOptions = {}) {
    if (options.existingJob) {
      this.cleanup();
    }

    const newSqlJob = options.existingJob || new SQLJob(this.options.opts);

    if (options.poolIgnore !== true) {
      this.jobs.push(newSqlJob);
    }

    if (newSqlJob.getStatus() === "notStarted") {
      await newSqlJob.connect(this.options.creds);
    }

    return newSqlJob;
  }

  /**
   * Internal helper. Returns the first job currently in `ready` state, or
   * `undefined` if all jobs are busy or ended.
   *
   * This method is intentionally private. Callers outside the pool must use
   * {@link getJob} (synchronous, best-effort) or {@link waitForJob}
   * (async, guaranteed-ready) instead.
   */
  private getReadyJob() {
    return this.jobs.find((j) => j.getStatus() === "ready");
  }

  /**
   * Retrieves the index of a ready job in the pool.
   *
   * @returns The index of the first ready job, or -1 if none are ready.
   */
  private getReadyJobIndex() {
    return this.jobs.findIndex((j) => j.getStatus() === "ready");
  }

  /**
   * Returns a job as fast as possible. It will either be a ready job or the
   * job with the least requests on the queue. Will fire off a background job
   * creation if the pool has space and every job is heavily loaded.
   *
   * **Note:** this method is synchronous and best-effort. When all jobs are
   * busy it returns the least-loaded busy job rather than waiting. If you need
   * a guaranteed-ready job under concurrent load, use {@link waitForJob}
   * instead. Returns `undefined` when no jobs exist in a valid state (e.g.
   * all jobs have ended).
   *
   * @returns The retrieved job, or `undefined` if no valid job is available.
   */
  getJob() {
    const job = this.getReadyJob();
    if (!job) {
      // Find the busy job with the fewest in-flight requests
      const busyJobs = this.jobs.filter(
        (j) => j.getStatus() === "busy"
      );
      const freeist = busyJobs.sort(
        (a, b) => a.getRunningCount() - b.getRunningCount()
      )[0];
      // If every job is busy and the pool still has capacity, spin up a new
      // job in the background so it is ready for the next request.
      if (freeist && this.hasSpace() && freeist.getRunningCount() > 2) {
        this.addJob();
      }
      return freeist;
    }

    return job;
  }

  /**
   * Waits for a job to become available and guarantees a connected job is
   * returned. Prefer this over {@link getJob} for any concurrent or
   * high-throughput workload where all pool jobs may already be busy.
   *
   * - If a ready job exists it is returned immediately.
   * - If the pool has space a new job is created and returned.
   * - If the pool is full and `useNewJob` is `false`, the least-loaded busy
   *   job is returned via {@link getJob}.
   * - If `useNewJob` is `true`, a new job is created and returned even when
   *   the pool is already at `maxSize`.
   *
   * @param useNewJob - If `true`, a new job is created even when the pool is
   *   full. Useful under burst load when you must not queue behind busy jobs.
   * @returns A promise that resolves to a ready (or newly connected) job.
   */
  async waitForJob(useNewJob = false) {
    const job = this.getReadyJob();

    if (!job) {
      if (this.hasSpace() || useNewJob) {
        const newJob = await this.addJob();

        return newJob;
      } else {
        return this.getJob();
      }
    }

    return job;
  }

  /**
   * Pops a job from the pool if one is ready. If no jobs are ready, it will
   * create a new job and return that. The returned job should be added back to the pool.
   *
   * @returns A promise that resolves to a ready job or a new job.
   */
  async popJob() {
    const index = this.getReadyJobIndex();
    if (index > -1) {
      return this.jobs.splice(index, 1)[0];
    }

    const newJob = await this.addJob({ poolIgnore: true });
    return newJob;
  }

  /**
   * Executes an SQL query using a job from the pool.
   *
   * @param sql - The SQL query to execute.
   * @param opts - Optional settings for the query.
   * @returns A promise that resolves to the result of the query execution.
   */
  query(sql: string, opts?: QueryOptions) {
    const job = this.getJob();
    return job.query(sql, opts);
  }

  /**
   * Executes a SQL command using a job from the pool.
   *
   * @param sql - The SQL command to execute.
   * @param opts - Optional settings for the command.
   * @returns A promise that resolves to the result of the command execution.
   */
  execute<T>(sql: string, opts?: QueryOptions) {
    const job = this.getJob();
    return job.execute<T>(sql, opts);
  }

  sql<T>(statementParts: TemplateStringsArray, ...parameters: BindingValue[]) {
    const job = this.getJob();

    const statement = statementParts.join(`?`);

    return job.execute<T>(statement, {parameters});
  }

  /**
   * Closes all jobs in the pool and releases resources.
   */
  end() {
    this.jobs.forEach((j) => j.close());
  }
}
