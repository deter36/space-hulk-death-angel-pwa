export type CombatDieValue = 0 | 1 | 2 | 3 | 4 | 5;

export type CombatDieFace = {
  value: CombatDieValue;
  skull: boolean;
};

export const COMBAT_DIE_FACES: readonly CombatDieFace[] = [
  { value: 0, skull: false },
  { value: 1, skull: true },
  { value: 2, skull: true },
  { value: 3, skull: true },
  { value: 4, skull: false },
  { value: 5, skull: false },
];

export function combatDieFace(value: number): CombatDieFace {
  const face = COMBAT_DIE_FACES[value];
  if (!face || face.value !== value) throw new RangeError(`Invalid combat die value: ${value}`);
  return face;
}
