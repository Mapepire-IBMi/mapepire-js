import { SQLJob } from "./sqlJob";
import { BindingValue, DaemonServer, JDBCOptions, JobStatus, QueryOptions } from "./types";

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

const INVALID_STATES = [JobStatus.Ended, JobStatus.NotStarted];

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
        j.getStatus() === JobStatus.Busy || j.getStatus() === JobStatus.Ready
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

    if (newSqlJob.getStatus() === JobStatus.NotStarted) {
      await newSqlJob.connect(this.options.creds);
    }

    return newSqlJob;
  }

  /**
   * Retrieves a ready job from the pool.
   *
   * @returns The first ready job found, or undefined if none are ready.
   */
  private getReadyJob() {
    return this.jobs.find((j) => j.getStatus() === JobStatus.Ready);
  }

  /**
   * Retrieves the index of a ready job in the pool.
   *
   * @returns The index of the first ready job, or -1 if none are ready.
   */
  private getReadyJobIndex() {
    return this.jobs.findIndex((j) => j.getStatus() === JobStatus.Ready);
  }

  /**
   * Returns a job as fast as possible. It will either be a ready job
   * or the job with the least requests on the queue. Will spawn new jobs
   * if the pool is not full but all jobs are busy.
   * @returns The retrieved job.
   */
  getJob() {
    const job = this.getReadyJob();
    if (!job) {
      // This code finds a job that is busy, but has the least requests on the queue
      const busyJobs = this.jobs.filter(
        (j) => j.getStatus() === JobStatus.Busy
      );
      const freeist = busyJobs.sort(
        (a, b) => a.getRunningCount() - b.getRunningCount()
      )[0];
      // If this job is busy, and the pool is not full, add a new job for later
      if (this.hasSpace() && freeist.getRunningCount() > 2) {
        this.addJob();
      }
      return freeist;
    }

    return job;
  }

  /**
   * Waits for a job to become available. It will return a ready job if one exists,
   * otherwise, it may create a new job if the pool is not full.
   *
   * @param useNewJob - If true, a new job will be created even if the pool is full.
   * @returns A promise that resolves to a ready job.
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
