import type { StonePaletteKey } from "./StonePalette";

export interface StoneGrowthSample {
  readonly baseMossSusceptibility: number;
  readonly normalY: number;
  readonly heightFraction: number;
  readonly exposure: number;
  readonly exposureStrength: number;
  readonly environmentMoss: number;
  readonly paletteKey: StonePaletteKey;
  readonly graniteBlend: number;
}

export interface StoneGrowthWeights {
  moss: number;
  lichen: number;
}

const UPPER_LEDGE_MOSS_STRENGTH = 0.3;
const LICHEN_HEIGHT_FLOOR = 0.55;
const LICHEN_ENVIRONMENT: Record<StonePaletteKey, number> = {
  meadowSage: 0.24,
  steppeTan: 0.72,
  graniteGrey: 0.86,
  mossy: 0.16,
};

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

/** Allocation-free coarse growth resolver for render-build hot paths. */
export function resolveStoneGrowthWeightsInto(
  baseMossSusceptibility: number,
  normalY: number,
  heightFractionValue: number,
  exposureValue: number,
  exposureStrength: number,
  environmentMoss: number,
  paletteKey: StonePaletteKey,
  graniteBlend: number,
  target: StoneGrowthWeights,
): void {
  const heightFraction = clamp01(heightFractionValue);
  const upward = Math.max(0, normalY);
  const upperLedgeMoss =
    upward * Math.sqrt(upward) * UPPER_LEDGE_MOSS_STRENGTH * heightFraction;
  const mossSusceptibility = Math.max(
    baseMossSusceptibility,
    upperLedgeMoss,
  );
  const exposure = clamp01(exposureValue);
  const shadeRetention = 1 - exposure * exposureStrength;
  const moss = clamp01(
    mossSusceptibility * environmentMoss * shadeRetention,
  );

  const biomeLichen = LICHEN_ENVIRONMENT[paletteKey];
  const altitudeBoost = graniteBlend * 0.34;
  const dampSuppression = 1 - environmentMoss * 0.42;
  const lichenEnvironment = clamp01(
    (biomeLichen + altitudeBoost) * dampSuppression,
  );
  const lichenExposure = 0.38 + exposure * 0.62;
  const mossCompetition = 1 - moss * 0.5;
  const lichenHeight =
    LICHEN_HEIGHT_FLOOR +
    (1 - LICHEN_HEIGHT_FLOOR) * heightFraction;

  target.moss = moss;
  target.lichen = clamp01(
    lichenEnvironment * lichenExposure * mossCompetition * lichenHeight,
  );
}

/** Resolve coarse growth before near-camera shader breakup. */
export function resolveStoneGrowthWeights(
  sample: StoneGrowthSample,
): StoneGrowthWeights {
  const result: StoneGrowthWeights = { moss: 0, lichen: 0 };
  resolveStoneGrowthWeightsInto(
    sample.baseMossSusceptibility,
    sample.normalY,
    sample.heightFraction,
    sample.exposure,
    sample.exposureStrength,
    sample.environmentMoss,
    sample.paletteKey,
    sample.graniteBlend,
    result,
  );
  return result;
}
