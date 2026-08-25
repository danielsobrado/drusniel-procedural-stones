/**
 * Lab shim for FluffyGrass's hydrology system.
 *
 * The stone code only consumes the sample data shape; the lab has no rivers or
 * lakes, so samples stay dry unless the lab terrain injects a waterline.
 */
export interface HydrologySample {
  waterCoverage: number;
  waterProximity: number;
  humidityBoost: number;
  grassMask: number;
  waterLevel: number;
  riverCoverage: number;
  lakeCoverage: number;
  flowX: number;
  flowZ: number;
  riverMorphology: number;
  riverBend: number;
  riverLateral: number;
  lakeNormalizedDistance: number;
  riverDischarge: number;
  riverFallStep: number;
  riverFallFace: number;
  riverFallDrop: number;
}

export function createHydrologySample(): HydrologySample {
  return {
    waterCoverage: 0,
    waterProximity: 0,
    humidityBoost: 0,
    grassMask: 1,
    waterLevel: 0,
    riverCoverage: 0,
    lakeCoverage: 0,
    flowX: 0,
    flowZ: 0,
    riverMorphology: 0,
    riverBend: 0,
    riverLateral: 0,
    lakeNormalizedDistance: 1,
    riverDischarge: 0,
    riverFallStep: 0,
    riverFallFace: 0,
    riverFallDrop: 0,
  };
}
