
export enum JobStatus {
  NOT_STARTED = "notStarted",
  CONNECTING = "connecting",
  READY = "ready",
  BUSY = "busy",
  ENDED = "ended",
}

export enum ExplainType {
  Run = "run",
  DoNotRun = "doNotRun",
}

export enum TransactionEndType {
  COMMIT = "COMMIT",
  ROLLBACK = "ROLLBACK",
}