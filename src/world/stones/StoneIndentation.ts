import { hashStoneCell, hashStoneLabel } from "./StoneRandom";
import type { StoneRecipe } from "./StoneRecipe";
import type { StonePolygon, StoneVec3 } from "./StoneClipper";
import { STONE_INDENTATION_MINIMUM_AREA } from "./StoneGeometryTuning";
import { calculateStonePolygonAreaAndNormal } from "./StoneMeshTopology";

const STONE_INDENTATION_CHANCE = 0.14;
const STONE_INDENTATION_INSET_MIN = 0.78;
const STONE_INDENTATION_INSET_RANGE = 0.1;
const STONE_INDENTATION_DEPTH_MIN = 0.018;
const STONE_INDENTATION_DEPTH_RANGE = 0.025;

/**
 * Add an occasional shallow fracture scar to a broad side face.
 *
 * Earlier notches replaced large top/side faces with deep recessed panels. At
 * gameplay distance those read as caves or open mouths rather than geology.
 * Major shape breaks already come from clipping planes and split formations;
 * this pass only adds a sparse secondary recess to support that structure.
 */
export interface StoneIndentationOverrides {
  /** Activation chance; defaults to the shipped sparse tuning. */
  readonly chance?: number;
  /** Multiplier on the recess depth. */
  readonly depthScale?: number;
}

export function addStoneIndentation(
  polygons: StonePolygon[],
  recipe: StoneRecipe,
  overrides?: StoneIndentationOverrides,
): StonePolygon[] {
  if (recipe.archetype === "pebble" || recipe.archetype === "shard") {
    return polygons;
  }
  // A formation fragment already carries the largest shape break the body will
  // ever have. A second recess on top of it competes with that read, and -- since
  // the two halves choose their host face independently -- can bite into one
  // half's break outline and not the other's.
  if (recipe.fracture) {
    return polygons;
  }
  const chance = overrides?.chance ?? STONE_INDENTATION_CHANCE;
  if (chance <= 0) {
    return polygons;
  }
  const roll =
    hashStoneCell(recipe.seed, hashStoneLabel(recipe.archetype), 0x4e6f7463) /
    4294967296;
  if (roll >= chance) {
    return polygons;
  }
  return addSingleStoneIndentation(polygons, recipe, overrides?.depthScale ?? 1);
}

function addSingleStoneIndentation(
  polygons: StonePolygon[],
  recipe: StoneRecipe,
  depthScale: number,
): StonePolygon[] {
  const candidates = polygons
    .map((polygon, index) => ({
      polygon,
      index,
      area: calculateStonePolygonAreaAndNormal(polygon)[0],
    }))
    .filter(
      ({ polygon, area }) =>
        polygon.role === "side" &&
        polygon.points.length >= 4 &&
        area >= STONE_INDENTATION_MINIMUM_AREA,
    )
    .sort((left, right) => right.area - left.area)
    .slice(0, 4);
  if (candidates.length === 0) return polygons;

  const choice = hashStoneCell(recipe.seed, 0, 0x496e6465) % candidates.length;
  const selected = candidates[choice];
  const face = selected.polygon;
  let centerX = 0;
  let centerY = 0;
  let centerZ = 0;
  for (const point of face.points) {
    centerX += point.x;
    centerY += point.y;
    centerZ += point.z;
  }
  centerX /= face.points.length;
  centerY /= face.points.length;
  centerZ /= face.points.length;

  const [, normalX, normalY, normalZ] =
    calculateStonePolygonAreaAndNormal(face);
  const detailRoll = hashStoneCell(recipe.seed, 0, 0x44657074) / 4294967296;
  const insetScale =
    STONE_INDENTATION_INSET_MIN + detailRoll * STONE_INDENTATION_INSET_RANGE;
  const depth =
    (STONE_INDENTATION_DEPTH_MIN + detailRoll * STONE_INDENTATION_DEPTH_RANGE) *
    depthScale;
  const inner = face.points.map((point, corner) => {
    const variation =
      hashStoneCell(recipe.seed, corner, 0x496e7365) / 4294967296;
    const scale = insetScale * (0.94 + variation * 0.1);
    const cornerDepth = depth * (0.88 + variation * 0.22);
    return {
      x: centerX + (point.x - centerX) * scale - normalX * cornerDepth,
      y: centerY + (point.y - centerY) * scale - normalY * cornerDepth,
      z: centerZ + (point.z - centerZ) * scale - normalZ * cornerDepth,
    };
  });
  const floorCenter: StoneVec3 = {
    x: centerX - normalX * depth,
    y: centerY - normalY * depth,
    z: centerZ - normalZ * depth,
  };

  const replacement: StonePolygon[] = [];
  for (let index = 0; index < face.points.length; index += 1) {
    const next = (index + 1) % face.points.length;
    const outerA = face.points[index];
    const outerB = face.points[next];
    const innerA = inner[index];
    const innerB = inner[next];
    replacement.push(
      {
        planeId: `notch-wall:0:${face.planeId}:${index}:0`,
        role: "cut",
        points: [outerA, outerB, innerB],
      },
      {
        planeId: `notch-wall:0:${face.planeId}:${index}:1`,
        role: "cut",
        points: [outerA, innerB, innerA],
      },
      {
        planeId: `notch-floor:0:${face.planeId}:${index}`,
        role: "cut",
        points: [innerA, innerB, floorCenter],
      },
    );
  }

  return [
    ...polygons.slice(0, selected.index),
    ...replacement,
    ...polygons.slice(selected.index + 1),
  ];
}
