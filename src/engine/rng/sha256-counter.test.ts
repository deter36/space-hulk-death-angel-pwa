import { describe, expect, it } from "vitest";
import { Sha256CounterRng } from "./sha256-counter";

describe("v1.4 deterministic RNG compatibility vector", () => {
  it("reproduces the canonical shuffle, rolls, counter, and offset", () => {
    const rng = new Sha256CounterRng("DA-v1.3-regression");

    expect(rng.shuffle(["A", "B", "C", "D", "E", "F", "G", "H", "I", "J"]))
      .toEqual(["A", "G", "F", "C", "E", "B", "H", "J", "I", "D"]);
    expect(rng.snapshot()).toMatchObject({ nextCounter: "2", byteOffset: 4 });

    expect(Array.from({ length: 12 }, () => rng.rollCombatDie())).toEqual([
      { value: 5, skull: false }, { value: 4, skull: false },
      { value: 3, skull: true }, { value: 1, skull: true },
      { value: 3, skull: true }, { value: 5, skull: false },
      { value: 0, skull: false }, { value: 0, skull: false },
      { value: 4, skull: false }, { value: 0, skull: false },
      { value: 4, skull: false }, { value: 1, skull: true },
    ]);
    expect(rng.snapshot()).toMatchObject({ nextCounter: "3", byteOffset: 20 });
  });

  it("continues identically after restoring a partially consumed digest", () => {
    const original = new Sha256CounterRng("save-and-restore");
    original.shuffle([1, 2, 3, 4, 5, 6, 7]);
    original.rollCombatDie();
    const restored = Sha256CounterRng.restore(original.snapshot());
    expect(Array.from({ length: 20 }, () => restored.rollCombatDie()))
      .toEqual(Array.from({ length: 20 }, () => original.rollCombatDie()));
    expect(restored.snapshot()).toEqual(original.snapshot());
  });
});
