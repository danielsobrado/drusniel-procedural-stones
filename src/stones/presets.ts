import type { StoneArchetypeId } from '../world/stones/StoneRecipe';
import type { StonePaletteKey } from '../world/stones/StonePalette';
import type { StoneStageKind } from './StoneStages';

export interface StonePresetStageOverride {
  readonly enabled?: boolean;
  readonly params?: Record<string, number>;
}

export interface StonePreset {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly tags: readonly string[];
  readonly archetype: StoneArchetypeId;
  readonly paletteKey: StonePaletteKey;
  readonly seed: number;
  readonly valueScale?: number;
  readonly stages?: Partial<Record<StoneStageKind, StonePresetStageOverride>>;
}

export const STONE_PRESETS: readonly StonePreset[] = [
  {
    id: 'meadow-boulder',
    name: 'Meadow boulder',
    description: 'Weathered sage-toned boulder with a broad tilted crown.',
    tags: ['boulder', 'meadow', 'mossy'],
    archetype: 'boulder',
    paletteKey: 'meadowSage',
    seed: 5,
    stages: {
      'moss-lichen': { enabled: true, params: { moss: 0.55, mossCoverage: 0.3, lichen: 0 } }
    }
  },
  {
    id: 'mossy-river-boulder',
    name: 'Mossy river boulder',
    description: 'Deep moss and a wet waterline, as if pulled from a stream.',
    tags: ['boulder', 'moss', 'wet', 'river'],
    archetype: 'boulder',
    paletteKey: 'mossy',
    seed: 913,
    stages: {
      'moss-lichen': { enabled: true, params: { moss: 0.85, mossCoverage: 0.55, lichen: 0.1 } },
      wetness: { enabled: true, params: { waterline: 0.38, strength: 1 } }
    }
  },
  {
    id: 'granite-shard',
    name: 'Granite shard',
    description: 'Sharp leaning splinter of cold grey granite.',
    tags: ['shard', 'granite', 'sharp'],
    archetype: 'shard',
    paletteKey: 'graniteGrey',
    seed: 274,
    stages: {
      'moss-lichen': { enabled: true, params: { moss: 0.1, mossCoverage: 0, lichen: 0.35 } },
      weathering: { enabled: true, params: { strength: 0.7, edgeWearScale: 1.2, bias: -0.1 } }
    }
  },
  {
    id: 'desert-slab',
    name: 'Desert slab',
    description: 'Low tan slab, dry and dusted, with strong bedding seams.',
    tags: ['slab', 'steppe', 'dry'],
    archetype: 'slab',
    paletteKey: 'steppeTan',
    seed: 88,
    stages: {
      'moss-lichen': { enabled: false },
      weathering: { enabled: true, params: { strength: 1.35, edgeWearScale: 1, bias: 0.2 } },
      grain: { enabled: true, params: { strength: 0.12, normalStrength: 0.08, size: 2.2, growthDetail: 0.4 } }
    }
  },
  {
    id: 'capstone-outcrop',
    name: 'Capstone outcrop',
    description: 'Wide anchored outcrop with a flat geological cap.',
    tags: ['outcrop', 'capstone', 'anchor'],
    archetype: 'outcrop',
    paletteKey: 'graniteGrey',
    seed: 421,
    stages: {
      shape: { params: { heightScale: 0.9, depthScale: 1.25, taperScale: 1, topScale: 1.15, topTiltScale: 0.8, leanScale: 1, embedScale: 1.3 } },
      'moss-lichen': { enabled: true, params: { moss: 0.35, mossCoverage: 0.2, lichen: 0.2 } }
    }
  },
  {
    id: 'garden-pebble',
    name: 'Garden pebble',
    description: 'Small rounded pebble, softly jittered and lightly worn.',
    tags: ['pebble', 'small', 'smooth'],
    archetype: 'pebble',
    paletteKey: 'meadowSage',
    seed: 12,
    stages: {
      cuts: { enabled: false },
      indentation: { enabled: false },
      weathering: { enabled: true, params: { strength: 0.5, edgeWearScale: 0.6, bias: 0 } },
      'moss-lichen': { enabled: true, params: { moss: 0.25, mossCoverage: 0.1, lichen: 0 } }
    }
  },
  {
    id: 'quarry-block',
    name: 'Quarry block',
    description: 'Blocky cut mass with fresh fracture planes and chips.',
    tags: ['block', 'cut', 'masonry'],
    archetype: 'block',
    paletteKey: 'steppeTan',
    seed: 733,
    stages: {
      cuts: { enabled: true, params: { extraCuts: 1, depthScale: 1.3 } },
      chips: { enabled: true, params: { extraChips: 2, depthScale: 1.4 } },
      'moss-lichen': { enabled: false },
      weathering: { enabled: true, params: { strength: 0.4, edgeWearScale: 1.5, bias: -0.25 } }
    }
  },
  {
    id: 'lichen-block',
    name: 'Lichen block',
    description: 'Old block crusted with pale lichen colonies.',
    tags: ['block', 'lichen', 'old'],
    archetype: 'block',
    paletteKey: 'graniteGrey',
    seed: 156,
    stages: {
      'moss-lichen': { enabled: true, params: { moss: 0.1, mossCoverage: 0, lichen: 0.7 } },
      weathering: { enabled: true, params: { strength: 1.5, edgeWearScale: 1, bias: 0.3 } }
    }
  }
];
