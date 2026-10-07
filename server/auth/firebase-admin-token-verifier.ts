import {
  applicationDefault,
  cert,
  getApps,
  initializeApp,
  type App
} from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";

import type { FirebaseAdminConfig } from "../config";
import { ApiError, ConfigurationError } from "../errors";
import type { TokenVerifier } from "./token-verifier";

export class FirebaseAdminTokenVerifier implements TokenVerifier {
  private app?: App;

  constructor(private readonly config: FirebaseAdminConfig) {}

  private getApp() {
    if (this.app) {
      return this.app;
    }
    const existing = getApps()[0];
    if (existing) {
      this.app = existing;
      return existing;
    }
    if (!this.config.projectId) {
      throw new ConfigurationError(
        "FIREBASE_ADMIN_NOT_CONFIGURED",
        "Firebase Admin is not configured. Set FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, and FIREBASE_PRIVATE_KEY."
      );
    }

    const hasServiceAccount = Boolean(this.config.clientEmail && this.config.privateKey);
    const hasPartialServiceAccount = Boolean(this.config.clientEmail || this.config.privateKey);
    if (hasPartialServiceAccount && !hasServiceAccount) {
      throw new ConfigurationError(
        "FIREBASE_ADMIN_NOT_CONFIGURED",
        "FIREBASE_CLIENT_EMAIL and FIREBASE_PRIVATE_KEY must both be configured."
      );
    }
    if (!hasServiceAccount && !this.config.useApplicationDefaultCredential) {
      throw new ConfigurationError(
        "FIREBASE_ADMIN_NOT_CONFIGURED",
        "Set FIREBASE_CLIENT_EMAIL and FIREBASE_PRIVATE_KEY, or configure GOOGLE_APPLICATION_CREDENTIALS."
      );
    }
    this.app = initializeApp({
      projectId: this.config.projectId,
      credential: hasServiceAccount
        ? cert({
            projectId: this.config.projectId,
            clientEmail: this.config.clientEmail!,
            privateKey: this.config.privateKey!
          })
        : applicationDefault()
    });
    return this.app;
  }

  async verifyIdToken(idToken: string) {
    try {
      const decoded = await getAuth(this.getApp()).verifyIdToken(idToken, true);
      return {
        firebaseUid: decoded.uid,
        ...(typeof decoded.email === "string" ? { email: decoded.email } : {}),
        ...(typeof decoded.name === "string" ? { displayName: decoded.name } : {}),
        ...(typeof decoded.picture === "string" ? { photoURL: decoded.picture } : {})
      };
    } catch (error) {
      if (error instanceof ConfigurationError) {
        throw error;
      }
      throw new ApiError(401, "INVALID_ID_TOKEN", "The Firebase ID token is invalid or expired.");
    }
  }
}
