import type { StoneMeshData } from '../world/stones/StoneGeometry';
import {
  colorizeStoneVertices,
  resolveStoneGrowthColors,
  STONE_PALETTES
} from '../world/stones/StonePalette';
import { resolveStoneVertexWetness } from '../world/stones/StoneWetness';
import { stageParam } from './StoneStages';
import { findStage, type StoneBuildSettings } from './StoneGeneration';

const GROWTH_EPSILON = 1e-4;

export interface StoneSurfaceData {
  readonly colors: Float32Array;
  readonly wetness: Float32Array;
  readonly bedding: Float32Array;
  readonly weathering: Float32Array;
  readonly moss: Float32Array;
  readonly lichen: Float32Array;
  readonly growthSeed: Float32Array;
  readonly growthPosition: Float32Array;
  readonly mossColor: Float32Array;
  readonly lichenColor: Float32Array;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

/** Build the renderer-neutral surface attributes used by the Lab stone material. */
export function buildStoneSurfaceData(
  mesh: StoneMeshData,
  settings: StoneBuildSettings
): StoneSurfaceData {
  const palette = STONE_PALETTES[settings.paletteKey];
  const stages = settings.stages;
  const weatheringStage = findStage(stages, 'weathering');
  const weatheringOn = weatheringStage?.enabled ?? false;
  const weatheringStrength = weatheringOn
    ? stageParam(weatheringStage, 'strength', 'weathering')
    : 0;
  const weatheringBias = weatheringOn
    ? stageParam(weatheringStage, 'bias', 'weathering')
    : 0;

  const mossStage = findStage(stages, 'moss-lichen');
  const mossOn = mossStage?.enabled ?? false;
  const mossAmount = mossOn ? stageParam(mossStage, 'moss', 'moss-lichen') : 0;
  const mossCoverage = mossOn
    ? stageParam(mossStage, 'mossCoverage', 'moss-lichen')
    : 0;
  const lichenAmount = mossOn ? stageParam(mossStage, 'lichen', 'moss-lichen') : 0;

  const wetStage = findStage(stages, 'wetness');
  const wetOn = wetStage?.enabled ?? false;
  const wetStrength = wetOn ? stageParam(wetStage, 'strength', 'wetness') : 0;
  const waterlineShare = wetOn ? stageParam(wetStage, 'waterline', 'wetness') : 0;

  const vertexCount = mesh.tones.length;
  const weathering = new Float32Array(vertexCount);
  for (let vertex = 0; vertex < vertexCount; vertex += 1) {
    weathering[vertex] = clamp(mesh.weatherings[vertex] * weatheringStrength, 0, 1);
  }

  const colors = new Float32Array(vertexCount * 3);
  colorizeStoneVertices(
    mesh.tones,
    mesh.wears,
    mesh.bounces,
    mesh.minerals,
    weathering,
    mesh.cavities,
    undefined,
    palette,
    { valueScale: settings.valueScale, weatheringBias },
    colors
  );

  const growthColors = resolveStoneGrowthColors(palette, {
    valueScale: settings.valueScale
  });
  const moss = new Float32Array(vertexCount);
  const lichen = new Float32Array(vertexCount);
  const growthSeed = new Float32Array(vertexCount);
  const growthPosition = new Float32Array(vertexCount * 3);
  const mossColor = new Float32Array(vertexCount * 3);
  const lichenColor = new Float32Array(vertexCount * 3);
  const wetness = new Float32Array(vertexCount);
  const bedding = new Float32Array(vertexCount);

  const inverseGrowthRadius =
    0.5 / Math.max(mesh.metrics.materialFootprintRadius, GROWTH_EPSILON);
  const inverseGrowthHeight = 1 / Math.max(mesh.metrics.materialHeight, GROWTH_EPSILON);
  const waterlineY = mesh.metrics.height * waterlineShare;
  const seedValue = (settings.seed % 104729) / 104729;

  for (let vertex = 0; vertex < vertexCount; vertex += 1) {
    moss[vertex] = mossOn
      ? Math.max(
          Math.min(1, mesh.mosses[vertex] * (1.5 + mossAmount)) * mossAmount,
          mossCoverage * mossAmount * 0.82
        )
      : 0;
    lichen[vertex] = lichenAmount * 0.82;
    growthSeed[vertex] = seedValue;
    const offset = vertex * 3;
    growthPosition[offset] = mesh.positions[offset] * inverseGrowthRadius;
    growthPosition[offset + 1] = mesh.positions[offset + 1] * inverseGrowthHeight;
    growthPosition[offset + 2] = mesh.positions[offset + 2] * inverseGrowthRadius;
    mossColor[offset] = growthColors.moss.r;
    mossColor[offset + 1] = growthColors.moss.g;
    mossColor[offset + 2] = growthColors.moss.b;
    lichenColor[offset] = growthColors.lichen.r;
    lichenColor[offset + 1] = growthColors.lichen.g;
    lichenColor[offset + 2] = growthColors.lichen.b;
    wetness[vertex] =
      wetOn && wetStrength > 0
        ? resolveStoneVertexWetness(
            { strength: wetStrength, waterlineY, topY: waterlineY },
            mesh.positions[offset + 1]
          )
        : 0;
    bedding[vertex] = mesh.metrics.bedding;
  }

  return {
    colors,
    wetness,
    bedding,
    weathering,
    moss,
    lichen,
    growthSeed,
    growthPosition,
    mossColor,
    lichenColor
  };
}
