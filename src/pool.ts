import { SQLJob } from "./sqlJob";
import { DaemonServer, JDBCOptions, JobStatus, QueryOptions } from "./types";

export interface PoolOptions {
  creds: DaemonServer,
  opts?: JDBCOptions,
  maxSize: number,
  startingSize: number
}

interface PoolAddOptions {
  /** An existing job to add to the pool */
  existingJob?: SQLJob,
  /** Don't add to the pool */
  poolIgnore?: boolean
}

const INVALID_STATES = [JobStatus.Ended, JobStatus.NotStarted];

export class Pool {
  private jobs: SQLJob[] = [];
  constructor(private options: PoolOptions) {}

  init() {
    let promises: Promise<SQLJob>[] = [];

    if (this.options.maxSize === 0) {
      return Promise.reject("Max size must be greater than 0");
    } else if (this.options.startingSize > this.options.maxSize) {
      return Promise.reject("Max size must be greater than starting size");
    }
    for (let i = 0; i < this.options.startingSize; i++) {
      promises.push(this.addJob());
    }

    return Promise.all(promises);
  }

  hasSpace() {
    return (
      this.jobs.filter((j) => !INVALID_STATES.includes(j.getStatus())).length <
      this.options.maxSize
    );
  }

  getActiveJobCount() {
    return this.jobs.filter(
      (j) =>
        j.getStatus() === JobStatus.Busy || j.getStatus() === JobStatus.Ready
    ).length;
  }

  cleanup() {
    for (let i = this.jobs.length - 1; i >= 0; i--) {
      if (INVALID_STATES.includes(this.jobs[i].getStatus())) {
        this.jobs.splice(i, 1);
      }
    }
  }

  // TODO: test cases with existingJob parameter
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

  private getReadyJob() {
    return this.jobs.find((j) => j.getStatus() === JobStatus.Ready);
  }

  private getReadyJobIndex() {
    return this.jobs.findIndex((j) => j.getStatus() === JobStatus.Ready);
  }

  /**
   * Returns a job as fast as possible. It will either be a ready job
   * or the job with the least requests on the queue. Will spawn new jobs
   * if the pool is not full but all jobs are busy.
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
   * Returns a ready job if one is available, otherwise it will add a new job.
   * If the pool is full, then it will find a job with the least requests on the queue.
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

  //TODO: needs test cases
  /**
   * Returns a job that is ready to be used. If no jobs are ready, it will
   * create a new job and return that. Use `addJob` to add back to the pool.
   */
  async popJob() {
    const index = this.getReadyJobIndex();
    if (index > -1) {
      return this.jobs.splice(index, 1)[0];
    }

    const newJob = await this.addJob({ poolIgnore: true });
    return newJob;
  }

  query(sql: string, opts?: QueryOptions) {
    const job = this.getJob();
    return job.query(sql, opts);
  }

  execute<T>(sql: string, opts?: QueryOptions) {
    const job = this.getJob();
    return job.execute<T>(sql, opts);
  }

  async end() {
    await Promise.all(this.jobs.map((j) => j.close()));
  }
}