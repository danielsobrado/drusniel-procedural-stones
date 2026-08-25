/**
 * Deterministic random source for stone recipes and placement.
 *
 * Mulberry32 streams forked by *label* rather than by consumption order: a
 * child stream's seed depends only on the root seed and the label, so adding a
 * random draw in one domain (say, an extra cut) can never shift the values
 * another domain resolves. That is what keeps a stone's silhouette stable when
 * unrelated recipe fields gain parameters.
 */

const STONE_RANDOM_DOMAIN = 0x53544f4e;
const FNV_OFFSET_BASIS = 0x811c9dc5;
const FNV_PRIME = 0x01000193;
const MULBERRY_INCREMENT = 0x6d2b79f5;

export function mixStoneUint32(value: number): number {
  let mixed = value >>> 0;
  mixed = Math.imul(mixed ^ (mixed >>> 16), 0x7feb352d);
  mixed = Math.imul(mixed ^ (mixed >>> 15), 0x846ca68b);
  return (mixed ^ (mixed >>> 16)) >>> 0;
}

export function hashStoneLabel(label: string): number {
  let hash = FNV_OFFSET_BASIS;
  for (let index = 0; index < label.length; index += 1) {
    // Labels are ASCII by construction; charCodeAt keeps this dependency-free.
    hash = Math.imul(hash ^ label.charCodeAt(index), FNV_PRIME) >>> 0;
  }
  return hash >>> 0;
}

/** World-space lattice hash shared by placement and clearance sampling. */
export function hashStoneCell(x: number, z: number, seed: number): number {
  let value = Math.imul(x, 374761393) ^ Math.imul(z, 668265263) ^ seed;
  value = Math.imul(value ^ (value >>> 13), 1274126177);
  return (value ^ (value >>> 16)) >>> 0;
}

export class StoneRandom {
  private state: number;

  private constructor(private readonly rootSeed: number) {
    this.state = rootSeed >>> 0;
  }

  static fromSeed(seed: number): StoneRandom {
    return new StoneRandom(mixStoneUint32((seed >>> 0) ^ STONE_RANDOM_DOMAIN));
  }

  fork(label: string): StoneRandom {
    return new StoneRandom(
      mixStoneUint32(this.rootSeed ^ hashStoneLabel(label) ^ STONE_RANDOM_DOMAIN),
    );
  }

  nextUint32(): number {
    this.state = (this.state + MULBERRY_INCREMENT) >>> 0;
    let value = this.state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return (value ^ (value >>> 14)) >>> 0;
  }

  next(): number {
    return this.nextUint32() / 4294967296;
  }

  range(minimum: number, maximum: number): number {
    return minimum + (maximum - minimum) * this.next();
  }

  integer(minimumInclusive: number, maximumInclusive: number): number {
    return (
      minimumInclusive +
      Math.floor(this.next() * (maximumInclusive - minimumInclusive + 1))
    );
  }

  signed(magnitude: number): number {
    return (this.next() * 2 - 1) * magnitude;
  }

  chance(probability: number): boolean {
    return this.next() < probability;
  }
}
