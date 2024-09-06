
export enum JobStatus {
  NOT_STARTED = "notStarted",
  CONNECTING = "connecting",
  READY = "ready",
  BUSY = "busy",
  ENDED = "ended",
}

export enum ExplainType {
  RUN = "run",
  DO_NOT_RUN = "doNotRun",
}

export enum TransactionEndType {
  COMMIT = "COMMIT",
  ROLLBACK = "ROLLBACK",
}