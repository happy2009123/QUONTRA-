/** Typed application errors mapped to HTTP status codes by the API layer. */

export type ErrorCode =
  | 'VALIDATION_ERROR'
  | 'NOT_FOUND'
  | 'CONFLICT'
  | 'RATE_LIMITED'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'PROVIDER_UNAVAILABLE'
  | 'TIMEOUT'
  | 'INTERNAL_ERROR'
  | 'NOT_IMPLEMENTED';

const STATUS_BY_CODE: Record<ErrorCode, number> = {
  VALIDATION_ERROR: 400,
  NOT_FOUND: 404,
  CONFLICT: 409,
  RATE_LIMITED: 429,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  PROVIDER_UNAVAILABLE: 503,
  TIMEOUT: 504,
  INTERNAL_ERROR: 500,
  NOT_IMPLEMENTED: 501,
};

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details?: unknown;

  constructor(code: ErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = STATUS_BY_CODE[code];
    this.details = details;
  }
}

export function isAppError(err: unknown): err is AppError {
  return err instanceof AppError;
}

/** Field-level validation issue attached to VALIDATION_ERROR responses. */
export interface FieldIssue {
  field: string;
  message: string;
}

export function validationError(issues: FieldIssue[]): AppError {
  return new AppError('VALIDATION_ERROR', 'Request validation failed', { issues });
}
