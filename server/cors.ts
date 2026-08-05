import type { RequestHandler } from "express";

import { ApiError } from "./errors";

export function createCorsMiddleware(allowedOrigins: readonly string[]): RequestHandler {
  const allowed = new Set(allowedOrigins.map((origin) => origin.replace(/\/$/, "")));

  return (request, response, next) => {
    const origin = request.header("origin")?.replace(/\/$/, "");
    if (origin && !allowed.has(origin)) {
      next(new ApiError(403, "ORIGIN_NOT_ALLOWED", "This frontend origin is not allowed."));
      return;
    }

    if (origin) {
      response.setHeader("Access-Control-Allow-Origin", origin);
      response.setHeader("Vary", "Origin");
    }
    response.setHeader("Access-Control-Allow-Methods", "GET,POST,PATCH,DELETE,HEAD,OPTIONS");
    response.setHeader("Access-Control-Allow-Headers", "Authorization,Content-Type,Range");
    response.setHeader(
      "Access-Control-Expose-Headers",
      "Accept-Ranges,Content-Disposition,Content-Length,Content-Range"
    );
    response.setHeader("Access-Control-Max-Age", "86400");

    if (request.method === "OPTIONS") {
      response.sendStatus(204);
      return;
    }
    next();
  };
}
