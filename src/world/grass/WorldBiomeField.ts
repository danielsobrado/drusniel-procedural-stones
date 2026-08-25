/**
 * Lab shim for FluffyGrass's biome field.
 *
 * Stone placement uses the biome index to pick palettes and moss budgets
 * (three rows: damp meadow, dry steppe, alpine). The lab keeps the same
 * deterministic world-space behaviour with a low-frequency value noise split
 * into three regions and a soft dithered border.
 */
export interface GrassBiomeSample {
  /** Dominant biome row at this position. */
  indexA: number;
  /** Neighbouring row inside the border band; equals `indexA` outside it. */
  indexB: number;
  /** Fraction of blades that belong to `indexB`, in [0, 0.5]. */
  blend: number;
}

export function createGrassBiomeSample(): GrassBiomeSample {
  return { indexA: 0, indexB: 0, blend: 0 };
}

const BIOME_COUNT = 3;
const BIOME_REGION_SIZE = 130;
const BIOME_BORDER_WIDTH = 0.14;
const BIOME_PICK_SEED = 0x9e3779b9;

function hashLattice(x: number, z: number, seed: number): number {
  let value = Math.imul(x, 374761393) ^ Math.imul(z, 668265263) ^ seed;
  value = Math.imul(value ^ (value >>> 13), 1274126177);
  return ((value ^ (value >>> 16)) >>> 0) / 4294967296;
}

function positionHash(x: number, z: number, seed: number): number {
  return hashLattice(Math.round(x * 37), Math.round(z * 37), seed);
}

function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

/** Low-frequency value noise in [0, 1], continuous across the world. */
function uniformField(x: number, z: number): number {
  const gx = x / BIOME_REGION_SIZE;
  const gz = z / BIOME_REGION_SIZE;
  const cellX = Math.floor(gx);
  const cellZ = Math.floor(gz);
  const fx = smooth(gx - cellX);
  const fz = smooth(gz - cellZ);
  const a = hashLattice(cellX, cellZ, 71);
  const b = hashLattice(cellX + 1, cellZ, 71);
  const c = hashLattice(cellX, cellZ + 1, 71);
  const d = hashLattice(cellX + 1, cellZ + 1, 71);
  return a + (b - a) * fx + (c - a) * fz + (a - b - c + d) * fx * fz;
}

export function sampleGrassBiome(
  x: number,
  z: number,
  target: GrassBiomeSample = createGrassBiomeSample(),
): GrassBiomeSample {
  const field = uniformField(x, z);
  const scaled = Math.min(field * BIOME_COUNT, BIOME_COUNT - 1e-6);
  const indexA = Math.floor(scaled);
  const fraction = scaled - indexA;
  target.indexA = indexA;
  target.indexB = indexA;
  target.blend = 0;
  if (fraction < BIOME_BORDER_WIDTH && indexA > 0) {
    target.indexB = indexA - 1;
    target.blend = 0.5 * (1 - fraction / BIOME_BORDER_WIDTH);
  } else if (fraction > 1 - BIOME_BORDER_WIDTH && indexA < BIOME_COUNT - 1) {
    target.indexB = indexA + 1;
    target.blend = 0.5 * ((fraction - (1 - BIOME_BORDER_WIDTH)) / BIOME_BORDER_WIDTH);
  }
  return target;
}

export function pickGrassBiomeIndex(
  x: number,
  z: number,
  sample: GrassBiomeSample,
): number {
  if (sample.blend <= 0 || sample.indexA === sample.indexB) {
    return sample.indexA;
  }
  return positionHash(x, z, BIOME_PICK_SEED) < sample.blend
    ? sample.indexB
    : sample.indexA;
}
