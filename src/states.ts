
export const JobStatus = {
  NOT_STARTED: "notStarted",
  CONNECTING: "connecting",
  READY: "ready",
  BUSY: "busy",
  ENDED: "ended",
} as const;

export type JobStatus = typeof JobStatus[keyof typeof JobStatus];

export const ExplainType = {
  RUN: "run",
  DO_NOT_RUN: "doNotRun",
} as const;

export type ExplainType = typeof ExplainType[keyof typeof ExplainType];

export const TransactionEndType = {
  COMMIT: "COMMIT",
  ROLLBACK: "ROLLBACK",
} as const;

export type TransactionEndType = typeof TransactionEndType[keyof typeof TransactionEndType];