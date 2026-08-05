import { randomUUID } from "crypto";

function shortUuid(length = 10) {
  return randomUUID().replace(/-/g, "").slice(0, length);
}

export function createId(prefix: string, length = 10) {
  return `${prefix}_${shortUuid(length)}`;
}

export function createToken(length = 6) {
  return shortUuid(length);
}
