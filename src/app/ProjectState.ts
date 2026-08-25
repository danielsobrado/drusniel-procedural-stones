import { LAB_CONFIG } from '../config/labConfig';
import type { StoneArchetypeId } from '../world/stones/StoneRecipe';
import { STONE_PALETTES, type StonePaletteKey } from '../world/stones/StonePalette';
import {
  createDefaultStages,
  STONE_STAGE_ORDER,
  STONE_STAGE_DEFINITIONS,
  createDefaultStage,
  stageParamRange,
  type StoneStage,
  type StoneStageKind
} from '../stones/StoneStages';
import { STONE_ARCHETYPE_IDS } from '../world/stones/StoneRecipe';

export type LabMode = 'single' | 'cluster' | 'field';

export type EnvironmentPreset = 'meadow' | 'overcast' | 'studio';

export interface ClusterSettings {
  seed: number;
  budget: number;
  radius: number;
  aspect: number;
  formationChance: number;
}

export interface FieldSettings {
  seed: number;
  density: number;
  clusterChance: number;
  clusterSpacing: number;
  singletonChance: number;
  formationChance: number;
  radiusChunks: number;
  detailRadiusChunks: number;
  rollingHeight: number;
}

export interface ProjectState {
  version: 1;
  mode: LabMode;
  archetype: StoneArchetypeId;
  seed: number;
  quality: boolean;
  scale: number;
  paletteKey: StonePaletteKey;
  valueScale: number;
  /** Show the mated formation pair instead of the whole body, when it splits. */
  formationPair: boolean;
  stages: StoneStage[];
  selectedStageKind: StoneStageKind | null;
  environment: EnvironmentPreset;
  wireframe: boolean;
  turntable: boolean;
  cluster: ClusterSettings;
  field: FieldSettings;
}

function rangeDefault(table: 'stone' | 'cluster' | 'field', key: string): number {
  const range = LAB_CONFIG[table][key];
  if (range === undefined) {
    throw new Error(`Missing ${table} range "${key}" in lab.yaml.`);
  }
  return range.default;
}

export function createDefaultProject(): ProjectState {
  return {
    version: 1,
    mode: 'single',
    archetype: 'boulder',
    seed: rangeDefault('stone', 'seed'),
    quality: true,
    scale: rangeDefault('stone', 'scale'),
    paletteKey: 'meadowSage',
    valueScale: rangeDefault('stone', 'valueScale'),
    formationPair: false,
    stages: createDefaultStages(),
    selectedStageKind: 'shape',
    environment: 'meadow',
    wireframe: false,
    turntable: false,
    cluster: {
      seed: rangeDefault('cluster', 'seed'),
      budget: rangeDefault('cluster', 'budget'),
      radius: rangeDefault('cluster', 'radius'),
      aspect: rangeDefault('cluster', 'aspect'),
      formationChance: rangeDefault('cluster', 'formationChance')
    },
    field: {
      seed: rangeDefault('field', 'seed'),
      density: rangeDefault('field', 'density'),
      clusterChance: rangeDefault('field', 'clusterChance'),
      clusterSpacing: rangeDefault('field', 'clusterSpacing'),
      singletonChance: rangeDefault('field', 'singletonChance'),
      formationChance: rangeDefault('field', 'formationChance'),
      radiusChunks: rangeDefault('field', 'radiusChunks'),
      detailRadiusChunks: rangeDefault('field', 'detailRadiusChunks'),
      rollingHeight: rangeDefault('field', 'rollingHeight')
    }
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

function rangedNumberOr(
  value: unknown,
  fallback: number,
  table: 'stone' | 'cluster' | 'field',
  key: string
): number {
  const range = LAB_CONFIG[table][key];
  if (range === undefined) {
    throw new Error(`Missing ${table} range "${key}" in lab.yaml.`);
  }
  return clamp(numberOr(value, fallback), range.min, range.max);
}

function booleanOr(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

/** Coerce arbitrary JSON into a valid project, falling back to defaults. */
export function normalizeProject(raw: unknown): ProjectState {
  const base = createDefaultProject();
  if (!isRecord(raw)) {
    return base;
  }

  const archetype = raw.archetype;
  if (
    typeof archetype === 'string' &&
    (STONE_ARCHETYPE_IDS as readonly string[]).includes(archetype)
  ) {
    base.archetype = archetype as StoneArchetypeId;
  }
  const paletteKey = raw.paletteKey;
  if (
    typeof paletteKey === 'string' &&
    Object.prototype.hasOwnProperty.call(STONE_PALETTES, paletteKey)
  ) {
    base.paletteKey = paletteKey as StonePaletteKey;
  }
  const mode = raw.mode;
  if (mode === 'single' || mode === 'cluster' || mode === 'field') {
    base.mode = mode;
  }
  const environment = raw.environment;
  if (environment === 'meadow' || environment === 'overcast' || environment === 'studio') {
    base.environment = environment;
  }
  base.seed = Math.trunc(rangedNumberOr(raw.seed, base.seed, 'stone', 'seed'));
  base.quality = booleanOr(raw.quality, base.quality);
  base.scale = rangedNumberOr(raw.scale, base.scale, 'stone', 'scale');
  base.valueScale = rangedNumberOr(raw.valueScale, base.valueScale, 'stone', 'valueScale');
  base.formationPair = booleanOr(raw.formationPair, base.formationPair);
  base.wireframe = booleanOr(raw.wireframe, base.wireframe);
  base.turntable = booleanOr(raw.turntable, base.turntable);

  const selected = raw.selectedStageKind;
  if (selected === null) {
    base.selectedStageKind = null;
  } else if (
    typeof selected === 'string' &&
    (STONE_STAGE_ORDER as readonly string[]).includes(selected)
  ) {
    base.selectedStageKind = selected as StoneStageKind;
  }

  if (Array.isArray(raw.stages) || isRecord(raw.stages)) {
    const rawStages = raw.stages;
    base.stages = STONE_STAGE_ORDER.map((kind) => {
      const fallback = createDefaultStage(kind);
      const found = Array.isArray(rawStages)
        ? rawStages.find((entry) => isRecord(entry) && entry.kind === kind)
        : rawStages[kind];
      if (!isRecord(found)) {
        return fallback;
      }
      const definition = STONE_STAGE_DEFINITIONS[kind];
      const stage: StoneStage = {
        kind,
        enabled: definition.locked ? true : booleanOr(found.enabled, fallback.enabled),
        params: { ...fallback.params }
      };
      if (isRecord(found.params)) {
        for (const [key, value] of Object.entries(found.params)) {
          if (key in stage.params && typeof value === 'number' && Number.isFinite(value)) {
            const range = stageParamRange(kind, key);
            stage.params[key] = clamp(value, range.min, range.max);
          }
        }
      }
      return stage;
    });
  }

  if (isRecord(raw.cluster)) {
    for (const key of Object.keys(base.cluster) as (keyof ClusterSettings)[]) {
      const value = rangedNumberOr(raw.cluster[key], base.cluster[key], 'cluster', key);
      base.cluster[key] = key === 'seed' ? Math.trunc(value) : value;
    }
  }
  if (isRecord(raw.field)) {
    for (const key of Object.keys(base.field) as (keyof FieldSettings)[]) {
      const value = rangedNumberOr(raw.field[key], base.field[key], 'field', key);
      base.field[key] = key === 'seed' ? Math.trunc(value) : value;
    }
  }
  return base;
}
