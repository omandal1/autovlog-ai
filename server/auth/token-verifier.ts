import type { VerifiedIdentity } from "../models";

export interface TokenVerifier {
  verifyIdToken(idToken: string): Promise<VerifiedIdentity>;
}
