/**
 * Lab shim for FluffyGrass's ecology field. The stone code reads the sample
 * shape; the lab terrain derives a simple ecology from slope and hydrology.
 */
export interface WorldEcologySample {
  /** Water available to plants. */
  moisture: number;
  /** Soil depth and richness. */
  fertility: number;
  /** Insolation from surface aspect against the world sun. */
  exposure: number;
  /** Trampling and traffic; 1 on a bare tread, 0 in untouched country. */
  disturbance: number;
  /** Exposed stone and gravel at the surface. */
  rockiness: number;
  /** Sky blocked by whatever stands over this point. */
  shade: number;
}

export function createEcologySample(): WorldEcologySample {
  return {
    moisture: 0,
    fertility: 0,
    exposure: 0,
    disturbance: 0,
    rockiness: 0,
    shade: 0,
  };
}
