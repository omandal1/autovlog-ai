import type { ErrorRequestHandler, RequestHandler } from "express";

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export class ConfigurationError extends ApiError {
  constructor(code: string, message: string) {
    super(503, code, message);
    this.name = "ConfigurationError";
  }
}

export function notFound(message = "Resource not found.") {
  return new ApiError(404, "NOT_FOUND", message);
}

export function asyncHandler(
  handler: (request: Parameters<RequestHandler>[0], response: Parameters<RequestHandler>[1]) => Promise<unknown>
): RequestHandler {
  return (request, response, next) => {
    void Promise.resolve(handler(request, response)).catch(next);
  };
}

function isDatabaseError(error: unknown) {
  if (!(error instanceof Error)) {
    return false;
  }
  return (
    error.name.startsWith("Mongo") ||
    /ECONNREFUSED|server selection|topology.+closed/i.test(error.message)
  );
}

export const notFoundHandler: RequestHandler = (_request, _response, next) => {
  next(new ApiError(404, "ROUTE_NOT_FOUND", "The requested API route does not exist."));
};

export const errorHandler: ErrorRequestHandler = (error, _request, response, _next) => {
  if (error instanceof ApiError) {
    response.status(error.status).json({
      error: {
        code: error.code,
        message: error.message,
        ...(error.details === undefined ? {} : { details: error.details })
      }
    });
    return;
  }

  if (isDatabaseError(error)) {
    response.status(503).json({
      error: {
        code: "DATABASE_UNAVAILABLE",
        message:
          "The local database is unavailable. Start MongoDB and verify DATABASE_URL."
      }
    });
    return;
  }

  if (
    error instanceof SyntaxError &&
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    error.status === 400
  ) {
    response.status(400).json({
      error: {
        code: "INVALID_JSON",
        message: "The request body contains invalid JSON."
      }
    });
    return;
  }

  if (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    error.name === "MulterError"
  ) {
    response.status(400).json({
      error: {
        code: "UPLOAD_REJECTED",
        message: error instanceof Error ? error.message : "The upload was rejected."
      }
    });
    return;
  }

  console.error("Unhandled API error", error);
  response.status(500).json({
    error: {
      code: "INTERNAL_ERROR",
      message: "The local AutoVlog API encountered an unexpected error."
    }
  });
};
