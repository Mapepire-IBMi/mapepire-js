/**
 * Line buffer utility for parsing newline-delimited JSON from streams
 * Handles chunked data and incomplete messages
 */

export class LineBuffer {
  private buffer: string = '';
  private onLine?: (line: string) => void;
  private onError?: (error: Error, data: string) => void;
  private trace?: (message: string) => void;

  constructor(options?: {
    onLine?: (line: string) => void;
    onError?: (error: Error, data: string) => void;
    trace?: (message: string) => void;
  }) {
    this.onLine = options?.onLine;
    this.onError = options?.onError;
    this.trace = options?.trace;
  }

  /**
   * Adds data to the buffer and returns complete lines
   * @param chunk - Data chunk to add to the buffer
   * @returns Array of complete lines (without newline characters)
   */
  push(chunk: string): string[] {
    this.buffer += chunk;
    const lines: string[] = [];
    
    let newlineIndex: number;
    while ((newlineIndex = this.buffer.indexOf('\n')) !== -1) {
      const line = this.buffer.substring(0, newlineIndex);
      this.buffer = this.buffer.substring(newlineIndex + 1);
      
      if (line.trim().length > 0) {
        if (this.trace) this.trace(line);
        
        if (this.onLine) {
          try {
            this.onLine(line);
          } catch (e: any) {
            if (this.onError) {
              const contextError = new Error(`Line processing failed: ${e.message || e}`);
              contextError.stack = e.stack;
              this.onError(contextError, line);
            } else {
              // If no error handler, log to console to avoid silent failures
              console.error('LineBuffer: Unhandled error processing line:', e, 'Line:', line);
            }
          }
        }
        lines.push(line);
      }
    }
    
    return lines;
  }

  /**
   * Gets any remaining buffered data
   * @returns The remaining buffer content
   */
  getRemaining(): string {
    return this.buffer;
  }

  /**
   * Clears the buffer
   */
  clear(): void {
    this.buffer = '';
  }

  /**
   * Checks if the buffer has any data
   * @returns true if buffer is not empty
   */
  hasData(): boolean {
    return this.buffer.length > 0;
  }
}
