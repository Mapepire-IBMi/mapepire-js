import path from "path";
import { SQLJob } from "./sqlJob";
import { BindingValue, BlobRef, DaemonServer, JDBCOptions, MapepireConfig, QueryOptions } from "./types";
import { JobStatus } from "./states";
import { ensureServerInstalled } from "./transports/serverInstaller";
import { VERSION, SERVER_VERSION_FILE, JAR_SHA256 } from "./serverVersion";

/**
 * Represents the options for configuring a connection pool.
 */
export interface PoolOptions {
  /**
   * Credentials for connecting to the WebSocket daemon server.
   * Takes priority over `config` if both are supplied.
   */
  creds?: DaemonServer,

  /**
   * Unified transport configuration (e.g. ssh-single).
   * Used only when `creds` is not provided.
   * For ssh-single pools, omit `teardown` — the pool does not own the SSH client.
   */
  config?: MapepireConfig,

  /**
   * Optional JDBC options for configuring the connection.
   * These options may include settings such as connection timeout,
   * SSL settings, etc.
   */
  opts?: JDBCOptions,

  /**
   * The maximum number of connections allowed in the pool.
   * This defines the upper limit on the number of active connections.
   *
   * For ssh-single pools: each job is a full JVM process on IBM i. The
   * dominant cost is native PASE process RAM (~300 MB per job, fixed
   * regardless of query load) — not Java heap, which stays small at idle.
   * Keep maxSize at 3–5. Set startingSize === maxSize to pre-warm all
   * jobs at init() — dynamic scale-up triggers a JVM boot that cannot
   * help the burst already in flight.
   */
  maxSize: number,

  /**
   * The number of connections to create when the pool is initialized.
   * This determines the starting size of the connection pool.
   *
   * For ssh-single pools set this equal to maxSize to pre-warm all jobs.
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
   * Resolved server JAR path after a pool-level private install (ssh-single only).
   * Injected into each job's config so the per-job installer is skipped entirely.
   */
  private resolvedServerPath: string | undefined;

  /**
   * Constructs a new Pool instance with the specified options.
   *
   * @param options - The options for configuring the connection pool.
   */
  constructor(private options: PoolOptions) {}

  /**
   * Initializes the pool by creating a number of SQL jobs defined by the starting size.
   *
   * For ssh-single pools with private install enabled (upload provided, serverPath not set),
   * this method runs ensureServerInstalled() exactly once before spawning any jobs, then
   * starts all jobs in parallel with the resolved serverPath already injected — eliminating
   * the race condition of N jobs all trying to upload the JAR simultaneously.
   *
   * @returns A promise that resolves when all jobs have been created and connected.
   */
  async init() {
    if (this.options.maxSize <= 0) {
      return Promise.reject("Max size must be greater than 0");
    } else if (this.options.startingSize <= 0) {
      return Promise.reject("Starting size must be greater than 0");
    } else if (this.options.startingSize > this.options.maxSize) {
      return Promise.reject(
        "Max size must be greater than or equal to starting size"
      );
    }

    if (!this.options.creds && !this.options.config) {
      return Promise.reject("Either creds or config must be provided");
    }

    // Pre-install: for ssh-single with upload enabled and no explicit serverPath,
    // run ensureServerInstalled() once here so all jobs can start in parallel
    // without racing each other to upload the JAR.
    const cfg = this.options.config;
    if (
      !this.options.creds &&
      cfg?.transport === 'ssh-single' &&
      cfg.sshSingle?.upload &&
      !cfg.sshSingle?.serverPath
    ) {
      const localJarPath = path.join(__dirname, '..', 'dist', SERVER_VERSION_FILE);
      this.resolvedServerPath = await ensureServerInstalled({
        exec: cfg.sshSingle.exec,
        upload: cfg.sshSingle.upload,
        localJarPath,
        version: VERSION,
        jarSha256: JAR_SHA256,
        remoteInstallDir: cfg.sshSingle.privateInstallDir,
      });
    }

    const promises: Promise<SQLJob>[] = [];
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

    let newSqlJob: SQLJob;

    // Priority 1: creds present → WebSocket path (unchanged behaviour)
    // Priority 2: config present, no creds → config-based path (ssh-single etc.)
    if (this.options.creds) {
      newSqlJob = options.existingJob || new SQLJob(this.options.opts);
    } else {
      // Build effective config: if pre-install resolved a serverPath, inject it
      // so the per-job installer is skipped entirely.
      let effectiveConfig = this.options.config!;
      if (
        this.resolvedServerPath &&
        effectiveConfig.transport === 'ssh-single' &&
        effectiveConfig.sshSingle
      ) {
        effectiveConfig = {
          ...effectiveConfig,
          sshSingle: {
            ...effectiveConfig.sshSingle,
            serverPath: this.resolvedServerPath,
          },
        };
      }
      newSqlJob = options.existingJob || SQLJob.withConfig(effectiveConfig, this.options.opts);
    }

    if (options.poolIgnore !== true) {
      this.jobs.push(newSqlJob);
    }

    if (newSqlJob.getStatus() === "notStarted") {
      if (this.options.creds) {
        await newSqlJob.connect(this.options.creds);
      } else {
        await newSqlJob.connect();
      }
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
      // For ssh-single, dynamic scale-up launches a JVM (~15-18s boot) that cannot
      // help the burst already in flight. Suppress the addJob() call and let the
      // pool queue behind existing jobs. Pre-warm all jobs via startingSize === maxSize.
      const isSshSingle = !this.options.creds && this.options.config?.transport === 'ssh-single';
      if (freeist && !isSshSingle && this.hasSpace() && freeist.getRunningCount() > 2) {
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

  /**
   * Fetches the binary content of a BLOB from the server using any ready job
   * in the pool.
   *
   * When a query executed via the pool returns a BLOB column in daemon mode,
   * each cell value is a {@link BlobRef}. Pass that object here to retrieve
   * the raw bytes as a `Buffer` without having to obtain the underlying
   * {@link SQLJob} manually.
   *
   * @param blobRef - The `BlobRef` object returned in query result data.
   * @returns A promise that resolves to a `Buffer` containing the raw blob bytes.
   */
  fetchBlob(blobRef: BlobRef): Promise<Buffer> {
    const job = this.getJob();
    return job.fetchBlob(blobRef);
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
