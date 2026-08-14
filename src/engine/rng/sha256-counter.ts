import { bytesToHex, hexToBytes, sha256 } from "../crypto/sha256";
import type { RngState } from "../state/game-state";

export type DieFace = { value: 0 | 1 | 2 | 3 | 4 | 5; skull: boolean };

const DIE_FACES: DieFace[] = [
  { value: 0, skull: false },
  { value: 1, skull: true },
  { value: 2, skull: true },
  { value: 3, skull: true },
  { value: 4, skull: false },
  { value: 5, skull: false },
];

export class Sha256CounterRng {
  readonly seed: Uint8Array<ArrayBufferLike>;
  private nextCounter = BigInt(0);
  private block: Uint8Array<ArrayBufferLike> = new Uint8Array();
  private offset = 0;
  private operationSeq = 0;

  constructor(seed: string | Uint8Array) {
    this.seed = typeof seed === "string" ? new TextEncoder().encode(seed) : new Uint8Array(seed);
  }

  static restore(state: RngState): Sha256CounterRng {
    if (state.algorithm !== "SHA256_COUNTER_V1") throw new TypeError(`Unsupported RNG: ${state.algorithm}`);
    const rng = new Sha256CounterRng(hexToBytes(state.seedHex));
    rng.nextCounter = BigInt(state.nextCounter);
    rng.block = state.currentDigestHex === null ? new Uint8Array() : hexToBytes(state.currentDigestHex);
    if (rng.block.length !== 0 && rng.block.length !== 32) throw new TypeError("RNG digest block must be 32 bytes");
    if (!Number.isSafeInteger(state.byteOffset) || state.byteOffset < 0 || state.byteOffset > rng.block.length) {
      throw new TypeError("Invalid RNG byte offset");
    }
    rng.offset = state.byteOffset;
    rng.operationSeq = state.operationSeq;
    return rng;
  }

  private refill(): void {
    const counter = new Uint8Array(8);
    new DataView(counter.buffer).setBigUint64(0, this.nextCounter, false);
    const input = new Uint8Array(this.seed.length + counter.length);
    input.set(this.seed);
    input.set(counter, this.seed.length);
    this.block = sha256(input);
    this.nextCounter += BigInt(1);
    this.offset = 0;
  }

  private uint32(): number {
    if (this.block.length === 0 || this.offset + 4 > this.block.length) this.refill();
    const view = new DataView(this.block.buffer, this.block.byteOffset + this.offset, 4);
    const result = view.getUint32(0, false);
    this.offset += 4;
    return result;
  }

  uniformInt(maxExclusive: number): number {
    if (!Number.isSafeInteger(maxExclusive) || maxExclusive <= 0 || maxExclusive > 0x1_0000_0000) {
      throw new RangeError("maxExclusive must be an integer in [1, 2^32]");
    }
    const limit = Math.floor(0x1_0000_0000 / maxExclusive) * maxExclusive;
    let candidate = this.uint32();
    while (candidate >= limit) candidate = this.uint32();
    return candidate % maxExclusive;
  }

  shuffle<T>(input: readonly T[]): T[] {
    this.operationSeq += 1;
    const result = [...input];
    for (let index = result.length - 1; index >= 1; index -= 1) {
      const swapWith = this.uniformInt(index + 1);
      [result[index], result[swapWith]] = [result[swapWith], result[index]];
    }
    return result;
  }

  rollCombatDie(): DieFace {
    this.operationSeq += 1;
    return { ...DIE_FACES[this.uniformInt(6)] };
  }

  recordDraw(): void {
    this.operationSeq += 1;
  }

  snapshot(): RngState {
    return {
      algorithm: "SHA256_COUNTER_V1",
      seedHex: bytesToHex(this.seed),
      nextCounter: this.nextCounter.toString(),
      currentDigestHex: this.block.length ? bytesToHex(this.block) : null,
      byteOffset: this.offset,
      operationSeq: this.operationSeq,
    };
  }
}
