import { createDefaultStages, type StoneStage } from '../stones/StoneStages';
import {
  STONE_PRESETS,
  type StonePreset,
  type StonePresetStageOverride
} from '../stones/presets';
import {
  normalizeStoneAssetRecipe,
  type StoneAssetRecipeV1
} from './StoneAssetRecipe';

export type StoneAssetRecipeOverrides = Partial<Omit<StoneAssetRecipeV1, 'version'>>;
export type { StonePreset, StonePresetStageOverride };

function clonePreset(preset: StonePreset): StonePreset {
  const stages = preset.stages === undefined
    ? undefined
    : Object.fromEntries(
        Object.entries(preset.stages).map(([kind, override]) => [
          kind,
          override === undefined
            ? undefined
            : {
                ...override,
                params: override.params === undefined ? undefined : { ...override.params }
              }
        ])
      ) as StonePreset['stages'];
  return {
    ...preset,
    tags: [...preset.tags],
    stages
  };
}

function applyStageOverrides(
  stages: readonly StoneStage[],
  overrides: StonePreset['stages']
): StoneStage[] {
  return stages.map((stage) => {
    const override = overrides?.[stage.kind];
    return {
      kind: stage.kind,
      enabled: override?.enabled ?? stage.enabled,
      params: { ...stage.params, ...override?.params }
    };
  });
}

export function listStonePresets(): readonly StonePreset[] {
  return STONE_PRESETS.map(clonePreset);
}

export function getStonePreset(id: string): StonePreset | undefined {
  const preset = STONE_PRESETS.find((candidate) => candidate.id === id);
  return preset === undefined ? undefined : clonePreset(preset);
}

export function createStoneRecipeFromPreset(
  id: string,
  overrides: StoneAssetRecipeOverrides = {}
): StoneAssetRecipeV1 {
  const preset = getStonePreset(id);
  if (preset === undefined) {
    throw new Error(`Unknown stone preset "${id}".`);
  }
  const stages = applyStageOverrides(createDefaultStages(), preset.stages);
  return normalizeStoneAssetRecipe({
    version: 1,
    archetype: preset.archetype,
    seed: preset.seed,
    quality: true,
    paletteKey: preset.paletteKey,
    valueScale: preset.valueScale ?? 1,
    stages,
    ...overrides
  });
}
