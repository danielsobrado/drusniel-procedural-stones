export {
  DEFAULT_STONE_QUALITY,
  generateStone,
  generateStoneFromAssetRecipe,
  type GeneratedStone,
  type GeneratedStoneAsset,
  type GenerateStoneOptions
} from './generateStone';
export {
  STONE_ASSET_RECIPE_VERSION,
  UnsupportedStoneAssetRecipeVersionError,
  createDefaultStoneAssetRecipe,
  normalizeStoneAssetRecipe,
  type StoneAssetRecipeV1
} from './StoneAssetRecipe';
export {
  createStoneRecipeFromPreset,
  getStonePreset,
  listStonePresets,
  type StoneAssetRecipeOverrides,
  type StonePreset,
  type StonePresetStageOverride
} from './presets';
export { STONE_ARCHETYPE_IDS, type StoneArchetypeId } from '../world/stones/StoneRecipe';
export type { StoneMeshData, StoneMeshMetrics } from '../world/stones/StoneGeometry';
export type { StonePaletteKey } from '../world/stones/StonePalette';
export type { StoneStage, StoneStageKind } from '../stones/StoneStages';
export type { StoneSurfaceData } from '../stones/StoneSurface';
