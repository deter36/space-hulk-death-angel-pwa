import { describe, expect, it } from "vitest";
import { COMBAT_DIE_FACES, combatDieFace } from "./combat-die";

describe("combat die faces", () => {
  it("maps the six printed faces exactly", () => {
    expect(COMBAT_DIE_FACES).toEqual([
      { value: 0, skull: false },
      { value: 1, skull: true },
      { value: 2, skull: true },
      { value: 3, skull: true },
      { value: 4, skull: false },
      { value: 5, skull: false },
    ]);
  });

  it("rejects values that do not exist on the die", () => {
    expect(() => combatDieFace(-1)).toThrow(RangeError);
    expect(() => combatDieFace(6)).toThrow(RangeError);
  });
});
