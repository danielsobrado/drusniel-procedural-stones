import {
  resolveStoneRecipe,
  type StoneArchetypeId,
  type StoneCut,
  type StoneRecipe
} from '../world/stones/StoneRecipe';
import { resolveQualityStoneRecipe } from '../world/stones/StoneShapeQuality';
import {
  generateStoneMesh,
  type StoneMeshData,
  type StoneMeshOptions
} from '../world/stones/StoneGeometry';
import { StoneRandom } from '../world/stones/StoneRandom';
import type { StoneProfileRing } from '../world/stones/StoneProfile';
import type { StonePaletteKey } from '../world/stones/StonePalette';
import {
  stageParam,
  type StoneStage,
  type StoneStageKind
} from './StoneStages';

const GOLDEN_ANGLE = 2.399963229728653;

export interface StoneBuildSettings {
  readonly archetype: StoneArchetypeId;
  readonly seed: number;
  /** Pick the best silhouette among several candidate seeds. */
  readonly quality: boolean;
  readonly stages: readonly StoneStage[];
  readonly paletteKey: StonePaletteKey;
  readonly valueScale: number;
}

export function findStage(
  stages: readonly StoneStage[],
  kind: StoneStageKind
): StoneStage | undefined {
  return stages.find((stage) => stage.kind === kind);
}

function stageOn(stages: readonly StoneStage[], kind: StoneStageKind): boolean {
  return findStage(stages, kind)?.enabled ?? false;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

/** Scale every profile ring's radii; extra taper narrows the body with height. */
function reshapeProfileRings(
  rings: readonly StoneProfileRing[],
  taperScale: number,
  topScale: number
): readonly StoneProfileRing[] {
  if (taperScale === 1 && topScale === 1) {
    return rings;
  }
  return rings.map((ring) => {
    const taperFactor = clamp(1 - (taperScale - 1) * 0.35 * ring.height, 0.15, 2.2);
    const crownBlend = clamp((ring.height - 0.55) / 0.45, 0, 1);
    const crownFactor = clamp(1 + (topScale - 1) * crownBlend, 0.15, 1.9);
    const factor = taperFactor * crownFactor;
    if (factor === 1) {
      return ring;
    }
    return {
      ...ring,
      centerX: ring.centerX * factor,
      centerZ: ring.centerZ * factor,
      radii: ring.radii.map((radius) => radius * factor)
    };
  });
}

function synthesizeCuts(
  recipe: StoneRecipe,
  count: number,
  depthScale: number
): StoneCut[] {
  const random = StoneRandom.fromSeed(recipe.seed).fork('lab-extra-cuts');
  const axis = random.range(0, Math.PI * 2);
  const cuts: StoneCut[] = [];
  for (let index = 0; index < count; index += 1) {
    const stream = random.fork(`cut:${index}`);
    const normalY = stream.range(0.1, 0.6);
    const azimuth = axis + index * GOLDEN_ANGLE + stream.signed(0.5);
    const horizontal = Math.sqrt(Math.max(0, 1 - normalY * normalY));
    cuts.push({
      normalX: Math.cos(azimuth) * horizontal,
      normalY,
      normalZ: Math.sin(azimuth) * horizontal,
      depthFraction: clamp(stream.range(0.08, 0.2) * depthScale, 0.02, 0.5)
    });
  }
  return cuts;
}

function adjustCutList(
  recipe: StoneRecipe,
  cuts: readonly StoneCut[],
  extra: number,
  depthScale: number
): readonly StoneCut[] {
  let result = cuts.map((cut) => ({
    ...cut,
    depthFraction: clamp(cut.depthFraction * depthScale, 0.005, 0.5)
  }));
  if (extra < 0) {
    result = result.slice(0, Math.max(0, result.length + extra));
  } else if (extra > 0) {
    result = [...result, ...synthesizeCuts(recipe, extra, depthScale)];
  }
  return result;
}

/** Apply the enabled Lab stages to an already resolved recipe. */
export function applyStagesToRecipe(
  recipe: StoneRecipe,
  stages: readonly StoneStage[]
): StoneRecipe {
  if (recipe.inheritedSurface) {
    return recipe;
  }
  let result: StoneRecipe = recipe;

  const shape = findStage(stages, 'shape');
  if (shape) {
    const heightScale = stageParam(shape, 'heightScale', 'shape');
    const depthScale = stageParam(shape, 'depthScale', 'shape');
    const taperScale = stageParam(shape, 'taperScale', 'shape');
    const topScale = stageParam(shape, 'topScale', 'shape');
    const topTiltScale = stageParam(shape, 'topTiltScale', 'shape');
    const leanScale = stageParam(shape, 'leanScale', 'shape');
    const embedScale = stageParam(shape, 'embedScale', 'shape');
    result = {
      ...result,
      height: result.height * heightScale,
      depth: result.depth * depthScale,
      topScale: clamp(result.topScale * topScale, 0.05, 0.99),
      topTiltX: result.topTiltX * topTiltScale,
      topTiltZ: result.topTiltZ * topTiltScale,
      leanX: result.leanX * leanScale,
      leanZ: result.leanZ * leanScale,
      embed: clamp(result.embed * embedScale, 0, 0.6),
      profileRings: reshapeProfileRings(result.profileRings, taperScale, topScale)
    };
  }

  const cutsStage = findStage(stages, 'cuts');
  if (cutsStage === undefined || !cutsStage.enabled) {
    result = { ...result, cuts: [] };
  } else {
    result = {
      ...result,
      cuts: adjustCutList(
        result,
        result.cuts,
        Math.round(stageParam(cutsStage, 'extraCuts', 'cuts')),
        stageParam(cutsStage, 'depthScale', 'cuts')
      )
    };
  }

  const chipsStage = findStage(stages, 'chips');
  if (chipsStage === undefined || !chipsStage.enabled) {
    result = { ...result, chips: [] };
  } else {
    result = {
      ...result,
      chips: adjustCutList(
        result,
        result.chips,
        Math.round(stageParam(chipsStage, 'extraChips', 'chips')),
        stageParam(chipsStage, 'depthScale', 'chips')
      )
    };
  }

  const weathering = findStage(stages, 'weathering');
  if (weathering?.enabled) {
    result = {
      ...result,
      edgeWear: clamp(
        result.edgeWear * stageParam(weathering, 'edgeWearScale', 'weathering'),
        0,
        1.2
      )
    };
  } else {
    result = { ...result, edgeWear: 0 };
  }

  return result;
}

export function resolveStageMeshOptions(
  stages: readonly StoneStage[]
): StoneMeshOptions {
  const indentation = findStage(stages, 'indentation');
  const relief = findStage(stages, 'fracture-relief');
  return {
    indentation: {
      enabled: indentation?.enabled ?? false,
      chance: stageParam(indentation, 'chance', 'indentation'),
      depthScale: stageParam(indentation, 'depthScale', 'indentation')
    },
    fractureRelief: {
      enabled: relief?.enabled ?? false,
      strengthScale: stageParam(relief, 'strength', 'fracture-relief')
    }
  };
}

export function resolveLabRecipe(settings: StoneBuildSettings): StoneRecipe {
  const base = settings.quality
    ? resolveQualityStoneRecipe(settings.archetype, settings.seed)
    : resolveStoneRecipe(settings.archetype, settings.seed);
  return applyStagesToRecipe(base, settings.stages);
}

export function generateLabStoneMesh(
  recipe: StoneRecipe,
  settings: StoneBuildSettings
): StoneMeshData {
  const includeChips = stageOn(settings.stages, 'chips');
  return generateStoneMesh(recipe, includeChips, resolveStageMeshOptions(settings.stages));
}
