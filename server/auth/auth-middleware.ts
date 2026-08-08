import type { Request, RequestHandler } from "express";

import { ApiError } from "../errors";
import type { UserRecord } from "../models";
import type { AutoVlogRepository } from "../repository";
import type { TokenVerifier } from "./token-verifier";

export interface AuthContext {
  idToken: string;
  user: UserRecord;
}

type RequestWithAuth = Request & { authContext?: AuthContext };

export function getAuthContext(request: Request): AuthContext {
  const context = (request as RequestWithAuth).authContext;
  if (!context) {
    throw new ApiError(401, "AUTH_REQUIRED", "Sign in to access this resource.");
  }
  return context;
}

export function createAuthMiddleware(
  verifier: TokenVerifier,
  repository: AutoVlogRepository
): RequestHandler {
  return (request, _response, next) => {
    void (async () => {
      const authorization = request.header("authorization");
      if (!authorization) {
        throw new ApiError(401, "AUTH_REQUIRED", "Send a Firebase ID token as a Bearer token.");
      }
      const match = /^Bearer\s+([^\s]+)$/i.exec(authorization);
      if (!match) {
        throw new ApiError(401, "INVALID_AUTH_HEADER", "Use Authorization: Bearer <Firebase ID token>.");
      }

      const identity = await verifier.verifyIdToken(match[1]);
      const user = await repository.upsertUser(identity);
      (request as RequestWithAuth).authContext = {
        idToken: match[1],
        user
      };
      next();
    })().catch(next);
  };
}
