import {
  generateLabStoneMesh,
  resolveLabRecipe
} from '../stones/StoneGeneration';
import { buildStoneSurfaceData, type StoneSurfaceData } from '../stones/StoneSurface';
import {
  generateStoneMesh,
  type StoneMeshData
} from '../world/stones/StoneGeometry';
import { resolveQualityStoneRecipe } from '../world/stones/StoneShapeQuality';
import {
  resolveStoneRecipe,
  type StoneArchetypeId
} from '../world/stones/StoneRecipe';
import {
  normalizeStoneAssetRecipe,
  type StoneAssetRecipeV1
} from './StoneAssetRecipe';

export const DEFAULT_STONE_QUALITY = true as const;

export interface GenerateStoneOptions {
  readonly archetype: StoneArchetypeId;
  readonly seed: number;
  /** Pick the best silhouette among several deterministic candidate seeds. Defaults to true. */
  readonly quality?: boolean;
  readonly includeChips?: boolean;
}

export interface GeneratedStone {
  readonly mesh: StoneMeshData;
}

export interface GeneratedStoneAsset extends GeneratedStone {
  readonly assetRecipe: StoneAssetRecipeV1;
  readonly surface: StoneSurfaceData;
}

/** Generate renderer-neutral geometry without Lab surface settings or browser globals. */
export function generateStone(options: GenerateStoneOptions): GeneratedStone {
  const seed = Number.isFinite(options.seed) ? Math.trunc(options.seed) : 0;
  const quality = options.quality ?? DEFAULT_STONE_QUALITY;
  const recipe = quality
    ? resolveQualityStoneRecipe(options.archetype, seed)
    : resolveStoneRecipe(options.archetype, seed);
  return {
    mesh: generateStoneMesh(recipe, options.includeChips ?? true)
  };
}

/** Generate the geometry and renderer-neutral surface attributes described by a V1 asset recipe. */
export function generateStoneFromAssetRecipe(raw: unknown): GeneratedStoneAsset {
  const assetRecipe = normalizeStoneAssetRecipe(raw);
  const settings = {
    archetype: assetRecipe.archetype,
    seed: assetRecipe.seed,
    quality: assetRecipe.quality,
    stages: assetRecipe.stages,
    paletteKey: assetRecipe.paletteKey,
    valueScale: assetRecipe.valueScale
  };
  const resolvedRecipe = resolveLabRecipe(settings);
  const mesh = generateLabStoneMesh(resolvedRecipe, settings);
  return {
    assetRecipe,
    mesh,
    surface: buildStoneSurfaceData(mesh, settings)
  };
}
