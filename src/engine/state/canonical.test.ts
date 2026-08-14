import { describe, expect, it } from "vitest";
import { canonicalStringify, stateHash } from "./canonical";

describe("canonical state serialization", () => {
  it("uses the standard browser-compatible SHA-256 result", () => {
    expect(stateHash("abc")).toBe("6cc43f858fbb763301637b5af970e2a46b46f461f27e5a0f41e009c59b827b25");
  });

  it("sorts object keys recursively while retaining array order", () => {
    const left = { z: 1, nested: { b: 2, a: 1 }, cards: ["b", "a"] };
    const right = { cards: ["b", "a"], nested: { a: 1, b: 2 }, z: 1 };
    expect(canonicalStringify(left)).toBe(canonicalStringify(right));
    expect(stateHash(left)).toBe(stateHash(right));
    expect(stateHash({ ...right, cards: ["a", "b"] })).not.toBe(stateHash(left));
  });

  it("rejects undefined and non-finite values", () => {
    expect(() => canonicalStringify({ broken: undefined })).toThrow(/undefined/);
    expect(() => canonicalStringify({ broken: Number.NaN })).toThrow(/non-finite/);
  });
});
