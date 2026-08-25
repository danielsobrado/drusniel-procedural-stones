import { LAB_CONFIG } from '../config/labConfig';
import {
  STONE_STAGE_DEFINITIONS,
  STONE_STAGE_ORDER,
  createDefaultStages,
  stageParamRange,
  type StoneStage
} from '../stones/StoneStages';
import { STONE_PALETTES, type StonePaletteKey } from '../world/stones/StonePalette';
import {
  STONE_ARCHETYPE_IDS,
  type StoneArchetypeId
} from '../world/stones/StoneRecipe';

export const STONE_ASSET_RECIPE_VERSION = 1 as const;

export class UnsupportedStoneAssetRecipeVersionError extends Error {
  public readonly version: unknown;

  public constructor(version: unknown) {
    super(`Unsupported stone asset recipe version "${String(version)}".`);
    this.name = 'UnsupportedStoneAssetRecipeVersionError';
    this.version = version;
  }
}

export interface StoneAssetRecipeV1 {
  readonly version: 1;
  readonly archetype: StoneArchetypeId;
  readonly seed: number;
  readonly quality: boolean;
  readonly paletteKey: StonePaletteKey;
  readonly valueScale: number;
  readonly stages: readonly StoneStage[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function normalizeStages(raw: unknown): StoneStage[] {
  const defaults = createDefaultStages();
  if (!Array.isArray(raw)) {
    return defaults;
  }

  return STONE_STAGE_ORDER.map((kind) => {
    const fallback = defaults.find((stage) => stage.kind === kind);
    if (fallback === undefined) {
      throw new Error(`Missing default stage "${kind}".`);
    }
    const source = raw.find((entry) => isRecord(entry) && entry.kind === kind);
    if (!isRecord(source)) {
      return fallback;
    }

    const definition = STONE_STAGE_DEFINITIONS[kind];
    const stage: StoneStage = {
      kind,
      enabled: definition.locked
        ? true
        : typeof source.enabled === 'boolean'
          ? source.enabled
          : fallback.enabled,
      params: { ...fallback.params }
    };
    if (!isRecord(source.params)) {
      return stage;
    }

    for (const key of Object.keys(stage.params)) {
      const value = source.params[key];
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        continue;
      }
      const range = stageParamRange(kind, key);
      stage.params[key] = clamp(value, range.min, range.max);
    }
    return stage;
  });
}

export function createDefaultStoneAssetRecipe(): StoneAssetRecipeV1 {
  return {
    version: STONE_ASSET_RECIPE_VERSION,
    archetype: 'boulder',
    seed: LAB_CONFIG.stone.seed.default,
    quality: true,
    paletteKey: 'meadowSage',
    valueScale: LAB_CONFIG.stone.valueScale.default,
    stages: createDefaultStages()
  };
}

/** Coerce V1 serialized data into the deterministic recipe contract. */
export function normalizeStoneAssetRecipe(raw: unknown): StoneAssetRecipeV1 {
  const fallback = createDefaultStoneAssetRecipe();
  if (!isRecord(raw)) {
    return fallback;
  }
  if (raw.version !== undefined && raw.version !== STONE_ASSET_RECIPE_VERSION) {
    throw new UnsupportedStoneAssetRecipeVersionError(raw.version);
  }

  const archetype =
    typeof raw.archetype === 'string' &&
    (STONE_ARCHETYPE_IDS as readonly string[]).includes(raw.archetype)
      ? (raw.archetype as StoneArchetypeId)
      : fallback.archetype;
  const paletteKey =
    typeof raw.paletteKey === 'string' &&
    Object.prototype.hasOwnProperty.call(STONE_PALETTES, raw.paletteKey)
      ? (raw.paletteKey as StonePaletteKey)
      : fallback.paletteKey;
  const seed =
    typeof raw.seed === 'number' && Number.isFinite(raw.seed)
      ? Math.trunc(raw.seed)
      : fallback.seed;
  const valueRange = LAB_CONFIG.stone.valueScale;
  const valueScale =
    typeof raw.valueScale === 'number' && Number.isFinite(raw.valueScale)
      ? clamp(raw.valueScale, valueRange.min, valueRange.max)
      : fallback.valueScale;

  return {
    version: STONE_ASSET_RECIPE_VERSION,
    archetype,
    seed,
    quality: typeof raw.quality === 'boolean' ? raw.quality : fallback.quality,
    paletteKey,
    valueScale,
    stages: normalizeStages(raw.stages)
  };
}
