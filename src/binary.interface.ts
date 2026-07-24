export interface BinaryMetadataInitialFrame {
  queryIdLength: number;
  queryId: string;
}

export interface BinaryDataContinuationFrames {
  rowId: number;
  colNameLength: number;
  colName: string;
  blobLength: number;
  blobStartByte: number;
  blobEndByteExclusive: number;
  data: Uint8Array;
}

export interface AllBlobData {
  initialFrameMetadata: BinaryMetadataInitialFrame;
  continuationFrames: BinaryDataContinuationFrames[];
}