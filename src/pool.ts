import { SQLJob } from "./sqlJob";
import { DaemonServer, JDBCOptions, JobStatus, QueryOptions } from "./types";

export interface PoolOptions {
  creds: DaemonServer,
  opts?: JDBCOptions,
  maxSize: number,
  startingSize: number
}

export class Pool {
  private jobs: SQLJob[] = [];
  constructor(private options: PoolOptions) {
  }

  init() {
    let promises: Promise<SQLJob>[] = [];
    for (let i = 0; i < this.options.startingSize; i++) {
      promises.push(this.addJob());
    }

    return Promise.all(promises);
  }

  getActiveJobCount() {
    return this.jobs.filter(j => j.getStatus() === JobStatus.Busy || j.getStatus() === JobStatus.Ready).length;
  }

  cleanup() {
    for (let i = this.jobs.length - 1; i >= 0; i--) {
      if (this.jobs[i].getStatus() === JobStatus.Ended) {
        this.jobs.splice(i, 1);
      }
    }
  }

  async addJob() {
    const newSqlJob = new SQLJob(this.options.opts);
    this.jobs.push(newSqlJob);
    await newSqlJob.connect(this.options.creds);
    return newSqlJob;
  }

  getFreeJob() {
    const job = this.jobs.find(j => j.getStatus() === JobStatus.Ready);
    if (!job) {

      // This code finds a job that is busy, but has the least requests on the queue
      const busyJobs = this.jobs.filter(j => j.getStatus() === JobStatus.Busy);
      const freeist = busyJobs.sort((a, b) => a.getRunningCount() - b.getRunningCount())[0];

      // If this job is busy, and the pool is not full, add a new job
      if (this.jobs.length < this.options.maxSize && freeist.getRunningCount() > 2) {
        this.addJob();
      }

      return freeist;
    }

    return job;
  }

  query(sql: string, opts?: QueryOptions) {
    const job = this.getFreeJob();
    return job.query(sql, opts);
  }

  // TODO needs test cases
  async execute<T>(sql: string, opts?: QueryOptions) {
    const job = this.getFreeJob();
    const query = await job.query<T>(sql, opts);
    const result = await query.execute();
    await query.close();
    
    if (result.error) {
      throw new Error(result.error);
    }

    return result;
  }

  end() {
    this.jobs.forEach(j => j.close());
  }
  
}