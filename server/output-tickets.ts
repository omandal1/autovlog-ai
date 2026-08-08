import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export type OutputTicketDisposition = "inline" | "attachment";

export interface OutputTicketClaims {
  userId: string;
  projectId: string;
  outputId: string;
  disposition: OutputTicketDisposition;
}

export interface IssuedOutputTicket {
  token: string;
  expiresAt: Date;
}

interface StoredOutputTicket extends OutputTicketClaims {
  expiresAtMs: number;
}

export class OutputTicketError extends Error {
  constructor(public readonly reason: "invalid" | "expired") {
    super(reason === "expired" ? "The output access ticket has expired." : "The output access ticket is invalid.");
    this.name = "OutputTicketError";
  }
}

const TOKEN_VERSION = "v1";
const TOKEN_PART = "[A-Za-z0-9_-]{43}";
const TOKEN_PATTERN = new RegExp(`^${TOKEN_VERSION}\\.(${TOKEN_PART})\\.(${TOKEN_PART})$`);

function assertClaim(value: string, name: string) {
  if (!value || value.length > 512) {
    throw new Error(`${name} is invalid.`);
  }
}

/**
 * Issues reusable, short-lived capability tickets for output streaming.
 *
 * Ticket claims stay in process memory, so the URL itself is opaque: it does
 * not expose Firebase credentials, database IDs, or local filesystem paths.
 * The HMAC prevents an attacker from manufacturing otherwise well-formed
 * random capabilities. Restarting the local backend invalidates all tickets.
 */
export class OutputTicketService {
  private readonly tickets = new Map<string, StoredOutputTicket>();
  private readonly secret: string;
  private readonly ttlMs: number;
  private readonly now: () => number;
  private readonly maxActiveTickets: number;

  constructor(input: {
    secret: string;
    ttlSeconds: number;
    now?: () => number;
    maxActiveTickets?: number;
  }) {
    if (Buffer.byteLength(input.secret, "utf8") < 32) {
      throw new Error("The output ticket secret must be at least 32 bytes.");
    }
    if (!Number.isSafeInteger(input.ttlSeconds) || input.ttlSeconds < 1 || input.ttlSeconds > 3600) {
      throw new Error("The output ticket TTL must be between 1 and 3600 seconds.");
    }
    const maxActiveTickets = input.maxActiveTickets ?? 10_000;
    if (!Number.isSafeInteger(maxActiveTickets) || maxActiveTickets < 1) {
      throw new Error("The active output ticket limit must be a positive integer.");
    }

    this.secret = input.secret;
    this.ttlMs = input.ttlSeconds * 1000;
    this.now = input.now ?? Date.now;
    this.maxActiveTickets = maxActiveTickets;
  }

  issue(claims: OutputTicketClaims): IssuedOutputTicket {
    assertClaim(claims.userId, "userId");
    assertClaim(claims.projectId, "projectId");
    assertClaim(claims.outputId, "outputId");
    if (claims.disposition !== "inline" && claims.disposition !== "attachment") {
      throw new Error("The output ticket disposition is invalid.");
    }

    const now = this.now();
    this.pruneExpired(now);
    while (this.tickets.size >= this.maxActiveTickets) {
      const oldest = this.tickets.keys().next().value as string | undefined;
      if (!oldest) break;
      this.tickets.delete(oldest);
    }

    let nonce: string;
    do {
      nonce = randomBytes(32).toString("base64url");
    } while (this.tickets.has(nonce));

    const expiresAtMs = now + this.ttlMs;
    this.tickets.set(nonce, { ...claims, expiresAtMs });
    return {
      token: this.sign(nonce),
      expiresAt: new Date(expiresAtMs)
    };
  }

  verify(token: string): OutputTicketClaims {
    if (token.length > 128) {
      throw new OutputTicketError("invalid");
    }
    const match = TOKEN_PATTERN.exec(token);
    if (!match) {
      throw new OutputTicketError("invalid");
    }

    const nonce = match[1]!;
    const suppliedSignature = Buffer.from(match[2]!, "ascii");
    const expectedSignature = Buffer.from(this.signature(nonce), "ascii");
    if (
      suppliedSignature.length !== expectedSignature.length ||
      !timingSafeEqual(suppliedSignature, expectedSignature)
    ) {
      throw new OutputTicketError("invalid");
    }

    const stored = this.tickets.get(nonce);
    if (!stored) {
      throw new OutputTicketError("invalid");
    }
    if (this.now() >= stored.expiresAtMs) {
      this.tickets.delete(nonce);
      throw new OutputTicketError("expired");
    }

    const { expiresAtMs: _expiresAtMs, ...claims } = stored;
    return claims;
  }

  private sign(nonce: string) {
    return `${TOKEN_VERSION}.${nonce}.${this.signature(nonce)}`;
  }

  private signature(nonce: string) {
    return createHmac("sha256", this.secret)
      .update(`${TOKEN_VERSION}.${nonce}`)
      .digest("base64url");
  }

  private pruneExpired(now: number) {
    for (const [nonce, ticket] of this.tickets) {
      if (now >= ticket.expiresAtMs) {
        this.tickets.delete(nonce);
      }
    }
  }
}
