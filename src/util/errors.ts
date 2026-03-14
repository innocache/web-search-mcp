/**
 * Typed internal errors for the MCP server.
 * Never leak raw stack traces to MCP clients.
 */

export type ExtractionErrorCode =
  | 'INVALID_URL'
  | 'LOAD_TIMEOUT'
  | 'NAVIGATION_FAILED'
  | 'READABILITY_EMPTY'
  | 'SERP_PARSE_FAILED'
  | 'SERP_BLOCKED'
  | 'SERP_NO_RESULTS'
  | 'STDIO_DISCONNECTED'
  | 'INTERNAL_ERROR';

export class ExtractionError extends Error {
  readonly code: ExtractionErrorCode;

  constructor(code: ExtractionErrorCode, message: string, cause?: unknown) {
    super(message);
    this.name = 'ExtractionError';
    this.code = code;
    if (cause) {
      this.cause = cause;
    }
  }

  /**
   * Return a sanitized error message safe for MCP clients.
   * Never includes stack traces or internal details.
   */
  toClientMessage(): string {
    return `[${this.code}] ${this.message}`;
  }
}

/**
 * Wrap unknown errors into ExtractionError with INTERNAL_ERROR code.
 */
export function wrapError(err: unknown): ExtractionError {
  if (err instanceof ExtractionError) {
    return err;
  }
  const message =
    err instanceof Error ? err.message : 'An unexpected error occurred';
  return new ExtractionError('INTERNAL_ERROR', message, err);
}
