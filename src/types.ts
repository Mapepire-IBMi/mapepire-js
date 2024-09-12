/**
 * Represents a DB2 server daemon with connection details.
 */
export interface DaemonServer {
  /** The hostname or IP address of the server. */
  host: string;
  
  /** The port number to connect to (optional, defaults to 8076). */
  port?: number;
  
  /** The username for authentication. */
  user: string;
  
  /** The password for authentication. */
  password: string;
  
  /** Always ignore unauthorized certificates (optional). */
  ignoreUnauthorized?: boolean;
  
  /** Certificate authority (CA) for validating the server's certificate (optional). */
  ca?: string | Buffer;
}

/** Interface representing a standard server response. */
export interface ServerResponse {
  /** Unique identifier for the request. */
  id: string;
  
  /** Indicates whether the request was successful. */
  success: boolean;
  
  /** Error message, if any. */
  error?: string;
  
  /** SQL return code. */
  sql_rc: number;
  
  /** SQL state code. */
  sql_state: string;
}

export interface ServerRequest {
  id: string;
  type: string;
}

/** Interface representing the result of a connection request. */
export interface ConnectionResult extends ServerResponse {
  /** Unique job identifier for the connection. */
  job: string;
}

/** Interface representing the result of a version check. */
export interface VersionCheckResult extends ServerResponse {
  /** The build date of the version. */
  build_date: string;
  
  /** The version string. */
  version: string;
}

/** Interface representing the results of an explain request. */
export interface ExplainResults<T> extends QueryResult<T> {
  /** Metadata about the query execution. */
  vemetadata: QueryMetaData;

  /** Data returned from the explain request. */
  vedata: any;
}

/** Interface representing the result of a trace data request. */
export interface GetTraceDataResult extends ServerResponse {
  /** The retrieved trace data as a string. */
  tracedata: string;
}

/** Type representing the levels of server tracing. */
export type ServerTraceLevel = "OFF" | "ON" | "ERRORS" | "DATASTREAM";

/** Type representing the possible destinations for server trace data. */
export type ServerTraceDest = "FILE" | "IN_MEM";

export type BindingValue = string | number | (string|number)[];

/** Interface representing options for query execution. */
export interface QueryOptions {
  /** Whether to return terse results. */
  isTerseResults?: boolean;
  
  /** Whether the command is a CL command. */
  isClCommand?: boolean;
  
  /** Parameters for the query. */
  parameters?: BindingValue[];
}

/** Interface representing the result of a configuration set request. */
export interface SetConfigResult extends ServerResponse {
  /** Destination for trace data. */
  tracedest: ServerTraceDest;
  
  /** Level of tracing set on the server. */
  tracelevel: ServerTraceLevel;
}

export interface ParameterDetail {
  type: string;
  mode: "IN"| "OUT" | "INOUT";
  precision: number;
  scale?: number;
  name: string;
}

export interface ParameterResult {
  index: number;
  type: string;
  precision: number;
  scale?: number;
  name: string;

  /** CCSID of the parameter result */
  ccsid?: number;

  /** Value is only available for OUT/INOUT */
  value?: any;
}

/** Interface representing a standard query result. */
export interface QueryResult<T> extends ServerResponse {
  /** Metadata about the query results. */
  metadata: QueryMetaData;
  
  /** Indicates if the query execution is complete. */
  is_done: boolean;
  
  /** Indicates if results were returned. */
  has_results: boolean;
  
  /** Number of rows affected by the query. */
  update_count: number;
  
  /** Data returned from the query. */
  data: T[];

  /** Number of parameters in the prepared statement. */
  parameter_count?: number;

  /** Parameters returned from the query. */
  output_parms?: ParameterResult[];
}

/** Interface representing a log entry from a job. */
export interface JobLogEntry {
  /** Unique message identifier. */
  MESSAGE_ID: string;
  
  /** Severity level of the message. */
  SEVERITY: string;
  
  /** Timestamp when the message was generated. */
  MESSAGE_TIMESTAMP: string;
  
  /** Library from which the message originated. */
  FROM_LIBRARY: string;
  
  /** Program from which the message originated. */
  FROM_PROGRAM: string;
  
  /** Type of message. */
  MESSAGE_TYPE: string;
  
  /** Main text of the message. */
  MESSAGE_TEXT: string;
  
  /** Second level text of the message, if available. */
  MESSAGE_SECOND_LEVEL_TEXT: string;
}

/** Interface representing the result of a CL command execution. */
export interface CLCommandResult extends ServerResponse {
  /** Log entries generated during the execution of the job. */
  joblog: JobLogEntry[];
}

/** Interface representing metadata about a query. */
export interface QueryMetaData {
  /** Number of columns returned by the query. */
  column_count?: number;
  
  /** Metadata for each column. */
  columns?: ColumnMetaData[];
  
  parameters?: ParameterDetail[];
  
  /** Unique job identifier for the query. */
  job?: string;
}

/** Interface representing metadata for a single column in a query result. */
export interface ColumnMetaData {
  /** Display size of the column. */
  display_size: number;
  
  /** Label of the column. */
  label: string;
  
  /** Name of the column. */
  name: string;
  
  /** Type of the column. */
  type: string;

  /** Precision/length of the column. */
  precision: number;

  /** Scale of the column. */
  scale: number;
}

/** Type representing a collection of rows returned from a query. */
export type Rows = { [column: string]: string | number | boolean }[];

/** Interface representing JDBC options for establishing a connection. */
export interface JDBCOptions {
  // Format properties
  "naming"?: "sql" | "system";
  "date format"?:
    | "mdy"
    | "dmy"
    | "ymd"
    | "usa"
    | "iso"
    | "eur"
    | "jis"
    | "julian";
  "date separator"?: "/" | "-" | "." | "," | "b";
  "decimal separator"?: "." | ",";
  "time format"?: "hms" | "usa" | "iso" | "eur" | "jis";
  "time separator"?: ":" | "." | "," | "b";

  // Other properties
  "full open"?: boolean;
  "access"?: "all" | "read call" | "read only";
  "autocommit exception"?: boolean;
  "bidi string type"?: "4" | "5" | "6" | "7" | "8" | "9" | "10" | "11";
  "bidi implicit reordering"?: boolean;
  "bidi numeric ordering"?: boolean;
  "data truncation"?: boolean;
  "driver"?: "toolbox" | "native";
  "errors"?: "full" | "basic";
  "extended metadata"?: boolean;
  "hold input locators"?: boolean;
  "hold statements"?: boolean;
  "ignore warnings"?: string;
  "keep alive"?: boolean;
  "key ring name"?: string;
  "key ring password"?: string;
  "metadata source"?: "0" | "1";
  "proxy server"?: string;
  "remarks"?: "sql" | "system";
  "secondary URL"?: string;
  "secure"?: boolean;
  "server trace"?: "0" | "2" | "4" | "8" | "16" | "32" | "64";
  "thread used"?: boolean;
  "toolbox trace"?:
    | ""
    | "none"
    | "datastream"
    | "diagnostic"
    | "error"
    | "warning"
    | "conversion"
    | "jdbc"
    | "pcml"
    | "all"
    | "proxy"
    | "thread"
    | "information";
  "trace"?: boolean;
  "translate binary"?: boolean;
  "translate boolean"?: boolean;

  // System Properties
  "libraries"?: string[];
  "auto commit"?: boolean;
  "concurrent access resolution"?: "1" | "2" | "3";
  "cursor hold"?: boolean;
  "cursor sensitivity"?: "asensitive" | "insensitive" | "sensitive";
  "database name"?: string;
  "decfloat rounding mode"?:
    | "half even"
    | "half up"
    | "down"
    | "ceiling"
    | "floor"
    | "up"
    | "half down";
  "maximum precision"?: "31" | "63";
  "maximum scale"?: string;
  "minimum divide scale"?:
    | "0"
    | "1"
    | "2"
    | "3"
    | "4"
    | "5"
    | "6"
    | "7"
    | "8"
    | "9";
  "package ccsid"?: "1200" | "13488" | "system";
  "transaction isolation"?:
    | "none"
    | "read uncommitted"
    | "read committed"
    | "repeatable read"
    | "serializable";
  "translate hex"?: "character" | "binary";
  "true autocommit"?: boolean;
  "XA loosely coupled support"?: "0" | "1";

  // Performance Properties
  "big decimal"?: boolean;
  "block criteria"?: "0" | "1" | "2";
  "block size"?: "0" | "8" | "16" | "32" | "64" | "128" | "256" | "512";
  "data compression"?: boolean;
  "extended dynamic"?: boolean;
  "lazy close"?: boolean;
  "lob threshold"?: string;
  "maximum blocked input rows"?: string;
  "package"?: string;
  "package add"?: boolean;
  "package cache"?: boolean;
  "package criteria"?: "default" | "select";
  "package error"?: "exception" | "warning" | "none";
  "package library"?: string;
  "prefetch"?: boolean;
  "qaqqinilib"?: string;
  "query optimize goal"?: "0" | "1" | "2";
  "query timeout mechanism"?: "qqrytimlmt" | "cancel";
  "query storage limit"?: string;
  "receive buffer size"?: string;
  "send buffer size"?: string;
  "vairiable field compression"?: boolean;

  // Sort Properties
  "sort"?: "hex" | "language" | "table";
  "sort language"?: string;
  "sort table"?: string;
  "sort weight"?: "shared" | "unique";
}
