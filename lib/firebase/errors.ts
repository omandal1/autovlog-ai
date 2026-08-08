import { FirebaseError } from "firebase/app";

const messages: Record<string, string> = {
  "auth/email-already-in-use": "An account already exists for this email. Try signing in instead.",
  "auth/invalid-credential": "That email or password was not recognized.",
  "auth/invalid-email": "Enter a valid email address.",
  "auth/missing-password": "Enter your password.",
  "auth/popup-blocked": "Your browser blocked the Google sign-in window. Allow popups and try again.",
  "auth/popup-closed-by-user": "Google sign-in was closed before it finished.",
  "auth/too-many-requests": "Too many attempts. Wait a moment, then try again.",
  "auth/weak-password": "Use a password with at least six characters."
};

export function readableAuthError(error: unknown) {
  if (error instanceof FirebaseError) {
    return messages[error.code] || "Authentication could not be completed. Please try again.";
  }
  return error instanceof Error ? error.message : "Authentication could not be completed.";
}
