/**
 * Lab shim for FluffyGrass's landform lattice. Only the sample data shape is
 * consumed by the stone code; the lab terrain measures landform directly.
 */
export interface TerrainLandform {
  /** Positive on spurs and ridges, negative in hollows and drainage lines. */
  convexity: number;
  /** Fall of the land as `1 - normal.y` would express it, at landform scale. */
  slope: number;
  /** Height gradient toward increasing elevation. */
  gradientX: number;
  gradientZ: number;
}

export function createTerrainLandform(): TerrainLandform {
  return { convexity: 0, slope: 0, gradientX: 0, gradientZ: 0 };
}
