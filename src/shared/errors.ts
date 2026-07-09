/**
 * Typed Param errors. Keep this small; most modules use these instead of raw
 * Error so that failures carry a stable `code`.
 */
export type ParamErrorCode =
  | "validation_failed"
  | "not_found"
  | "policy_denied"
  | "approval_required"
  | "unauthorized"
  | "conflict"
  | "runtime_unavailable"
  | "stale_output"
  | "internal";

export class ParamError extends Error {
  readonly code: ParamErrorCode;
  readonly details?: Record<string, unknown>;

  constructor(
    code: ParamErrorCode,
    message: string,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "ParamError";
    this.code = code;
    this.details = details;
  }
}

export function validationError(
  message: string,
  details?: Record<string, unknown>,
): ParamError {
  return new ParamError("validation_failed", message, details);
}

export function notFoundError(
  message: string,
  details?: Record<string, unknown>,
): ParamError {
  return new ParamError("not_found", message, details);
}

export function policyDeniedError(
  message: string,
  details?: Record<string, unknown>,
): ParamError {
  return new ParamError("policy_denied", message, details);
}

export function runtimeUnavailableError(
  message: string,
  details?: Record<string, unknown>,
): ParamError {
  return new ParamError("runtime_unavailable", message, details);
}

export function staleOutputError(
  message: string,
  details?: Record<string, unknown>,
): ParamError {
  return new ParamError("stale_output", message, details);
}

export function toErrorInfo(error: unknown): { code: string; message: string } {
  if (error instanceof ParamError) {
    return { code: error.code, message: error.message };
  }
  if (error instanceof Error) {
    return { code: "internal", message: error.message };
  }
  return { code: "internal", message: String(error) };
}
