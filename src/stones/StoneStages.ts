import { LAB_CONFIG, type ControlRange } from '../config/labConfig';

/**
 * The stone pipeline expressed as a fixed-order stack of stages.
 *
 * Unlike the texture lab's freely ordered material layers, a stone's stages
 * have an inherent order (a chip is cut out of a shape that already exists),
 * so the dock toggles and parametrizes them without reordering.
 */
export type StoneStageKind =
  | 'shape'
  | 'cuts'
  | 'chips'
  | 'indentation'
  | 'fracture-relief'
  | 'weathering'
  | 'moss-lichen'
  | 'wetness'
  | 'grain';

export const STONE_STAGE_ORDER: readonly StoneStageKind[] = [
  'shape',
  'cuts',
  'chips',
  'indentation',
  'fracture-relief',
  'weathering',
  'moss-lichen',
  'wetness',
  'grain'
];

export interface StoneStageDefinition {
  readonly kind: StoneStageKind;
  readonly label: string;
  readonly icon: string;
  readonly description: string;
  /** Parameter keys in display order; ranges come from config/lab.yaml. */
  readonly params: readonly { key: string; label: string }[];
  /** Stages that cannot be disabled (a stone always has a shape). */
  readonly locked?: boolean;
  /** Enabled state for a fresh project. */
  readonly defaultEnabled: boolean;
}

export const STONE_STAGE_DEFINITIONS: Record<StoneStageKind, StoneStageDefinition> = {
  shape: {
    kind: 'shape',
    label: 'Shape',
    icon: '⬠',
    description: 'Archetype profile: footprint, belly, crown, lean and embed.',
    locked: true,
    defaultEnabled: true,
    params: [
      { key: 'heightScale', label: 'Height' },
      { key: 'depthScale', label: 'Depth' },
      { key: 'taperScale', label: 'Taper' },
      { key: 'topScale', label: 'Crown width' },
      { key: 'topTiltScale', label: 'Crown tilt' },
      { key: 'leanScale', label: 'Lean' },
      { key: 'embedScale', label: 'Embed' }
    ]
  },
  cuts: {
    kind: 'cuts',
    label: 'Cuts',
    icon: '◪',
    description: 'Broad structural fracture planes clipped from the body.',
    defaultEnabled: true,
    params: [
      { key: 'extraCuts', label: 'Extra cuts' },
      { key: 'depthScale', label: 'Cut depth' }
    ]
  },
  chips: {
    kind: 'chips',
    label: 'Chips',
    icon: '◬',
    description: 'Sparse corner breaks carried by close-range geometry.',
    defaultEnabled: true,
    params: [
      { key: 'extraChips', label: 'Extra chips' },
      { key: 'depthScale', label: 'Chip depth' }
    ]
  },
  indentation: {
    kind: 'indentation',
    label: 'Indent',
    icon: '◔',
    description: 'Occasional shallow fracture scar on a broad side face.',
    defaultEnabled: true,
    params: [
      { key: 'chance', label: 'Chance' },
      { key: 'depthScale', label: 'Depth' }
    ]
  },
  'fracture-relief': {
    kind: 'fracture-relief',
    label: 'Relief',
    icon: '〰',
    description: 'Wavy rims along cut and fracture edges.',
    defaultEnabled: true,
    params: [{ key: 'strength', label: 'Strength' }]
  },
  weathering: {
    kind: 'weathering',
    label: 'Weathering',
    icon: '▒',
    description: 'Crust, stain and edge wear across the surface.',
    defaultEnabled: true,
    params: [
      { key: 'strength', label: 'Strength' },
      { key: 'edgeWearScale', label: 'Edge wear' },
      { key: 'bias', label: 'Age bias' }
    ]
  },
  'moss-lichen': {
    kind: 'moss-lichen',
    label: 'Moss',
    icon: '❦',
    description: 'Moss and lichen colonies in sheltered corners.',
    defaultEnabled: true,
    params: [
      { key: 'moss', label: 'Moss' },
      { key: 'mossCoverage', label: 'Coverage' },
      { key: 'lichen', label: 'Lichen' }
    ]
  },
  wetness: {
    kind: 'wetness',
    label: 'Wetness',
    icon: '≈',
    description: 'Waterline sheen and darkening up the body.',
    defaultEnabled: false,
    params: [
      { key: 'waterline', label: 'Waterline' },
      { key: 'strength', label: 'Strength' }
    ]
  },
  grain: {
    kind: 'grain',
    label: 'Grain',
    icon: '▦',
    description: 'Triplanar surface grain and close-range growth detail.',
    defaultEnabled: true,
    params: [
      { key: 'strength', label: 'Albedo grain' },
      { key: 'normalStrength', label: 'Normal grain' },
      { key: 'size', label: 'Grain size' },
      { key: 'growthDetail', label: 'Growth detail' }
    ]
  }
};

export interface StoneStage {
  readonly kind: StoneStageKind;
  enabled: boolean;
  params: Record<string, number>;
}

export function stageParamRange(kind: StoneStageKind, key: string): ControlRange {
  const range = LAB_CONFIG.stages[kind]?.[key];
  if (range === undefined) {
    throw new Error(`Missing control range for stage "${kind}" param "${key}".`);
  }
  return range;
}

export function createDefaultStage(kind: StoneStageKind): StoneStage {
  const definition = STONE_STAGE_DEFINITIONS[kind];
  const params: Record<string, number> = {};
  for (const param of definition.params) {
    params[param.key] = stageParamRange(kind, param.key).default;
  }
  return { kind, enabled: definition.defaultEnabled, params };
}

export function createDefaultStages(): StoneStage[] {
  return STONE_STAGE_ORDER.map(createDefaultStage);
}

/** Read a stage param with its configured default as fallback. */
export function stageParam(stage: StoneStage | undefined, key: string, kind: StoneStageKind): number {
  const value = stage?.params[key];
  if (value !== undefined && Number.isFinite(value)) {
    return value;
  }
  return stageParamRange(kind, key).default;
}
