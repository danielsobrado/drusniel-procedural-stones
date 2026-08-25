import {
  STONE_BOUNCE_HEIGHT,
  STONE_CAVITY_CREASE,
  STONE_CAVITY_UNDERCUT,
  STONE_CONTACT_SHADE_FLOOR,
  STONE_CONTACT_SHADE_HEIGHT,
  STONE_CREASE_SHADE,
  STONE_CRUST_PATCH_SIZE,
  STONE_CUT_ACCENT,
  STONE_FRACTURE_ACCENT,
  STONE_FRACTURE_EXPOSURE,
  STONE_FRACTURE_MOSS,
  STONE_FRACTURE_SLOT_CAVITY,
  STONE_FRACTURE_SLOT_HEIGHT,
  STONE_MINERAL_FACE_JITTER,
  STONE_MINERAL_PATCH_SIZE,
  STONE_MINERAL_REGION_PRIMARY_RATIO,
  STONE_MINERAL_REGION_SECONDARY_RATIO,
  STONE_MOSS_CLIMB,
  STONE_MOSS_SHELTER_REACH,
  STONE_MOSS_PATCH_SIZE,
  STONE_SOIL_STAIN_HEIGHT,
  STONE_SOIL_STAIN_STRENGTH,
  STONE_TONE_DOWNWARD_COMPRESSION,
  STONE_TONE_FLOOR,
  STONE_TONE_RANGE,
  STONE_WEATHERING_EXPOSURE_STRENGTH,
  STONE_WEATHERING_NOISE_STRENGTH,
} from "./StoneGeometryTuning";
import type { WorkingStoneFace } from "./StoneMeshTopology";
import { hashStoneCell, hashStoneLabel } from "./StoneRandom";
import type { StoneRecipe } from "./StoneRecipe";

const STONE_MINERAL_ZONE_SEED_XOR = 0x5a6f6e65;
const STONE_MINERAL_ZONE_DETAIL_SEED_XOR = 0x5265676e;
const STONE_WEATHERING_SEED_XOR = 0x57656174;

/** Baked per-corner surface signals used by the static render batches. */
export interface StoneVertexStreams {
  readonly positions: Float32Array;
  readonly normals: Float32Array;
  readonly tones: Float32Array;
  readonly wears: Float32Array;
  readonly bounces: Float32Array;
  readonly mosses: Float32Array;
  readonly minerals: Float32Array;
  readonly weatherings: Float32Array;
  readonly cavities: Float32Array;
}

/** Resolve the centre vertex of a centroid fan from its written corners. */
export function averageStoneFaceCorners(
  streams: StoneVertexStreams,
  baseVertex: number,
  corners: number,
  target: number,
): void {
  let x = 0;
  let y = 0;
  let z = 0;
  let normalX = 0;
  let normalY = 0;
  let normalZ = 0;
  let tone = 0;
  let wear = 0;
  let bounce = 0;
  let moss = 0;
  let mineral = 0;
  let weathering = 0;
  let cavity = 0;
  for (let corner = 0; corner < corners; corner += 1) {
    const vertex = baseVertex + corner;
    const offset = vertex * 3;
    x += streams.positions[offset];
    y += streams.positions[offset + 1];
    z += streams.positions[offset + 2];
    normalX += streams.normals[offset];
    normalY += streams.normals[offset + 1];
    normalZ += streams.normals[offset + 2];
    tone += streams.tones[vertex];
    wear += streams.wears[vertex];
    bounce += streams.bounces[vertex];
    moss += streams.mosses[vertex];
    mineral += streams.minerals[vertex];
    weathering += streams.weatherings[vertex];
    cavity += streams.cavities[vertex];
  }

  const inverse = 1 / corners;
  const targetOffset = target * 3;
  streams.positions[targetOffset] = x * inverse;
  streams.positions[targetOffset + 1] = y * inverse;
  streams.positions[targetOffset + 2] = z * inverse;
  const length = Math.hypot(normalX, normalY, normalZ);
  const normalScale = length > 1e-12 ? 1 / length : 0;
  streams.normals[targetOffset] = normalX * normalScale;
  streams.normals[targetOffset + 1] = normalY * normalScale;
  streams.normals[targetOffset + 2] = normalZ * normalScale;
  streams.tones[target] = tone * inverse;
  streams.wears[target] = wear * inverse;
  streams.bounces[target] = bounce * inverse;
  streams.mosses[target] = moss * inverse;
  streams.minerals[target] = mineral * inverse;
  streams.weatherings[target] = weathering * inverse;
  streams.cavities[target] = cavity * inverse;
}

export function smoothstep(
  value: number,
  minimum: number,
  maximum: number,
): number {
  if (value <= minimum) return 0;
  if (value >= maximum) return 1;
  const amount = (value - minimum) / (maximum - minimum);
  return amount * amount * (3 - 2 * amount);
}

export function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

/**
 * Stable per-plane residual tint plus structural break accents.
 *
 * The cross-facet mineral field owns spatial geology. Keeping spatial noise out
 * of this face term matters for mated fragments: clipping changes each half's
 * face centroid even though both pieces came from one parent surface.
 */
export function resolveFaceTint(
  face: WorkingStoneFace,
  recipe: StoneRecipe,
): number {
  const faceJitter =
    (hashStoneCell(recipe.seed, hashStoneLabel(face.planeId), 0x51f0a3) /
      4294967296 -
      0.5) *
    2 *
    STONE_MINERAL_FACE_JITTER;
  const breakAccent =
    face.role === "fracture"
      ? STONE_FRACTURE_ACCENT
      : face.role === "cut"
        ? STONE_CUT_ACCENT
        : 0;
  return faceJitter + breakAccent;
}

/** Height remains a shallow contact cue; orientation and lighting carry form. */
export function resolveCornerTone(
  faceTint: number,
  normalY: number,
  y: number,
  heightMetres: number,
  crease: number,
): number {
  const facing =
    normalY >= 0
      ? 0.5 + 0.5 * normalY
      : 0.5 + 0.5 * normalY * STONE_TONE_DOWNWARD_COMPRESSION;
  const exposure = Math.min(0.9, STONE_TONE_FLOOR + STONE_TONE_RANGE * facing);
  const heightShade = 0.88 + 0.12 * smoothstep(y, 0, heightMetres * 0.26);
  const contactShade =
    STONE_CONTACT_SHADE_FLOOR +
    (1 - STONE_CONTACT_SHADE_FLOOR) *
      smoothstep(y, 0, heightMetres * STONE_CONTACT_SHADE_HEIGHT);
  const creaseShade = 1 - STONE_CREASE_SHADE * crease;
  return clamp01(exposure * heightShade * contactShade * creaseShade + faceTint);
}

/** Turf bounce reaches the lower body, strongest where the surface faces down. */
export function resolveCornerBounce(
  y: number,
  heightMetres: number,
  normalY: number,
  crease: number,
): number {
  const climb =
    1 - smoothstep(y, 0, Math.max(1e-4, heightMetres * STONE_BOUNCE_HEIGHT));
  if (climb <= 0) return 0;
  const facing = 0.34 + 0.66 * clamp01(0.5 - normalY * 0.5);
  return clamp01(climb * facing * (1 - crease * 0.45));
}

/** Moss follows shelter and ground humidity rather than forming a height band. */
export function resolveMoss(
  x: number,
  y: number,
  z: number,
  normalY: number,
  heightMetres: number,
  recipe: StoneRecipe,
  broken = false,
  crease = 0,
): number {
  const climb = Math.max(
    1 - smoothstep(y, 0, heightMetres * STONE_MOSS_CLIMB),
    clamp01(crease) * STONE_MOSS_SHELTER_REACH,
  );
  if (climb <= 0) return 0;
  const facing = normalY >= 0 ? 0.45 + 0.55 * normalY : 0.45 + 0.3 * -normalY;
  const blotch =
    hashStoneCell(
      Math.round(x / STONE_MOSS_PATCH_SIZE) * 31 +
        Math.round(y / STONE_MOSS_PATCH_SIZE),
      Math.round(z / STONE_MOSS_PATCH_SIZE) * 17 -
        Math.round(y / STONE_MOSS_PATCH_SIZE),
      recipe.seed ^ 0x6d055,
    ) / 4294967296;
  const patch = smoothstep(climb * 1.35, blotch * 0.85, blotch * 0.85 + 0.3);
  const growth = clamp01(climb * facing * patch);
  return broken ? growth * STONE_FRACTURE_MOSS : growth;
}

/** Smooth low-frequency value noise in object space. */
function crustNoise(x: number, y: number, z: number, seed: number): number {
  const cellX = Math.floor(x);
  const cellY = Math.floor(y);
  const cellZ = Math.floor(z);
  const fractionX = x - cellX;
  const fractionY = y - cellY;
  const fractionZ = z - cellZ;
  const smoothX = fractionX * fractionX * (3 - 2 * fractionX);
  const smoothY = fractionY * fractionY * (3 - 2 * fractionY);
  const smoothZ = fractionZ * fractionZ * (3 - 2 * fractionZ);
  let value = 0;
  for (let corner = 0; corner < 8; corner += 1) {
    const offsetX = corner & 1;
    const offsetY = (corner >> 1) & 1;
    const offsetZ = (corner >> 2) & 1;
    const lattice =
      hashStoneCell(
        cellX + offsetX,
        cellZ + offsetZ,
        seed ^ ((cellY + offsetY) * 0x9e3779b1),
      ) / 4294967296;
    const weight =
      (offsetX ? smoothX : 1 - smoothX) *
      (offsetY ? smoothY : 1 - smoothY) *
      (offsetZ ? smoothZ : 1 - smoothZ);
    value += lattice * weight;
  }
  return value;
}

/**
 * Geological mineral identity, independent of height and face orientation.
 * Two body-relative fields make roughly 3-5 broad regions on a large stone and
 * keep their boundaries crossing polygon edges instead of following them.
 */
export function resolveCornerMineral(
  x: number,
  y: number,
  z: number,
  recipe: StoneRecipe,
): number {
  const extent = Math.max(recipe.width, recipe.height, recipe.depth, 1e-4);
  const primaryScale = Math.max(
    STONE_MINERAL_PATCH_SIZE * 0.45,
    extent * STONE_MINERAL_REGION_PRIMARY_RATIO,
  );
  const secondaryScale = Math.max(
    STONE_MINERAL_PATCH_SIZE * 0.28,
    extent * STONE_MINERAL_REGION_SECONDARY_RATIO,
  );
  const primary = crustNoise(
    (x + z * 0.17) / primaryScale,
    (y - x * 0.13) / (primaryScale * 0.91),
    (z - y * 0.11) / primaryScale,
    recipe.seed ^ STONE_MINERAL_ZONE_SEED_XOR,
  );
  const secondary = crustNoise(
    (x - z * 0.23) / secondaryScale,
    (y + z * 0.17) / (secondaryScale * 0.87),
    (z + x * 0.14) / secondaryScale,
    recipe.seed ^ STONE_MINERAL_ZONE_DETAIL_SEED_XOR,
  );
  return smoothstep(primary * 0.8 + secondary * 0.2, 0.16, 0.84);
}

/**
 * Weathering is deliberately secondary to mineral identity. It can crust an
 * exposed face or stain the soil-contact seam, but there is no broad height
 * term left to turn the whole stone into a light-top/dark-bottom gradient.
 */
export function resolveCornerWeathering(
  x: number,
  y: number,
  z: number,
  normalY: number,
  heightMetres: number,
  recipe: StoneRecipe,
  broken = false,
): number {
  const extent = Math.max(recipe.width, recipe.height, recipe.depth, 1e-4);
  const weatherScale = Math.max(STONE_CRUST_PATCH_SIZE, extent * 0.28);
  const weatherNoise = crustNoise(
    (x - z * 0.11) / weatherScale,
    (y + x * 0.07) / (weatherScale * 0.93),
    (z + y * 0.09) / weatherScale,
    recipe.seed ^ STONE_WEATHERING_SEED_XOR,
  );
  const exposure = clamp01(normalY);
  const soilContact =
    1 -
    smoothstep(y, heightMetres * 0.03, heightMetres * STONE_SOIL_STAIN_HEIGHT);
  const soilFacing = 0.55 + 0.45 * clamp01(1 - normalY);
  const field =
    0.5 +
    (weatherNoise - 0.5) * STONE_WEATHERING_NOISE_STRENGTH +
    (exposure - 0.5) * STONE_WEATHERING_EXPOSURE_STRENGTH +
    (broken
      ? STONE_FRACTURE_EXPOSURE
      : -soilContact * soilFacing * STONE_SOIL_STAIN_STRENGTH);
  return clamp01(field);
}

/** Warm dark in cracks and under overhangs. */
export function resolveCornerCavity(
  crease: number,
  normalY: number,
  broken = false,
  y = 0,
  heightMetres = 1,
): number {
  const undercut = clamp01(-normalY) * STONE_CAVITY_UNDERCUT;
  const base = crease * STONE_CAVITY_CREASE + undercut;
  if (!broken) return clamp01(base);
  const slot =
    1 -
    smoothstep(y, 0, Math.max(1e-4, heightMetres * STONE_FRACTURE_SLOT_HEIGHT));
  return clamp01(base + slot * STONE_FRACTURE_SLOT_CAVITY);
}

/** Ridge highlight and crease occlusion share one signed dihedral lookup. */
export function resolveCornerEdgeShading(
  face: WorkingStoneFace,
  corner: number,
  edgeSharpness: ReadonlyMap<string, number>,
  recipe: StoneRecipe,
  materialOffsetX = 0,
  materialOffsetZ = 0,
): { wear: number; crease: number } {
  const count = face.shared.length;
  const current = face.shared[corner];
  const previous = face.shared[(corner + count - 1) % count];
  const next = face.shared[(corner + 1) % count];
  const keyA =
    previous < current ? `${previous}:${current}` : `${current}:${previous}`;
  const keyB = current < next ? `${current}:${next}` : `${next}:${current}`;
  const sharpA = edgeSharpness.get(keyA) ?? 0;
  const sharpB = edgeSharpness.get(keyB) ?? 0;

  const crease = clamp01(Math.max(-sharpA, -sharpB));
  const ridge = Math.max(0, Math.max(sharpA, sharpB));
  if (ridge <= 0) return { wear: 0, crease };

  const point = face.points[corner];
  const materialX = point.x + materialOffsetX;
  const materialZ = point.z + materialOffsetZ;
  const alongJitter = Math.pow(
    hashStoneCell(
      Math.round(materialX * 37 + point.y * 91),
      Math.round(materialZ * 53 - point.y * 17),
      recipe.seed,
    ) / 4294967296,
    1.6,
  );
  const crownBias = 0.35 + 0.65 * clamp01(face.normalY * 0.5 + 0.62);
  return {
    wear: clamp01(
      Math.pow(ridge, 0.75) * alongJitter * crownBias * recipe.edgeWear,
    ),
    crease,
  };
}
