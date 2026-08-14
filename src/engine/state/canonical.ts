import { bytesToHex, sha256 } from "../crypto/sha256";

function normalize(value: unknown): unknown {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("Canonical state cannot contain non-finite numbers");
    return value;
  }
  if (Array.isArray(value)) return value.map(normalize);
  if (typeof value === "object") {
    const object = value as Record<string, unknown>;
    const result: Record<string, unknown> = {};
    for (const key of Object.keys(object).sort()) {
      if (object[key] === undefined) throw new TypeError(`Canonical state contains undefined at ${key}`);
      result[key] = normalize(object[key]);
    }
    return result;
  }
  throw new TypeError(`Unsupported canonical value: ${typeof value}`);
}

export function canonicalStringify(value: unknown): string {
  return JSON.stringify(normalize(value));
}

export function stateHash(value: unknown): string {
  return bytesToHex(sha256(new TextEncoder().encode(canonicalStringify(value))));
}
