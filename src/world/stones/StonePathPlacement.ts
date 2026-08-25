export type StoneVergePathChannel = "main" | "branch";

export interface StoneVergePathSelection {
  readonly channel: StoneVergePathChannel;
  readonly distance: number;
  readonly clearance: number;
}

export const STONE_PATH_DISTANCE_PLATEAU = 24;
const SOURCE_NEIGHBORHOOD_EPSILON = 1e-6;

function candidate(
  channel: StoneVergePathChannel,
  distance: number,
  clearance: number,
  reach: number,
): StoneVergePathSelection | undefined {
  if (
    Math.abs(Math.abs(distance) - STONE_PATH_DISTANCE_PLATEAU) < 0.01 ||
    Math.abs(distance) > clearance + reach
  ) {
    return undefined;
  }
  return { channel, distance, clearance };
}

/** Chooses the path whose physical clearance edge is closest to the source cell. */
export function selectStoneVergePath(
  mainDistance: number,
  branchDistance: number,
  mainClearance: number,
  branchClearance: number,
  reach: number,
): StoneVergePathSelection | undefined {
  const main = candidate("main", mainDistance, mainClearance, reach);
  const branch = candidate("branch", branchDistance, branchClearance, reach);
  if (!main) {
    return branch;
  }
  if (!branch) {
    return main;
  }
  const mainEdgeDistance = Math.abs(Math.abs(main.distance) - main.clearance);
  const branchEdgeDistance = Math.abs(
    Math.abs(branch.distance) - branch.clearance,
  );
  return branchEdgeDistance < mainEdgeDistance ? branch : main;
}

export function selectPathDistance(
  channel: StoneVergePathChannel,
  mainDistance: number,
  branchDistance: number,
): number {
  return channel === "main" ? mainDistance : branchDistance;
}

/** Keeps a verge root inside its source cell or one immediate neighbor. */
export function stoneVergeInsideSourceNeighborhood(
  sourceCenterX: number,
  sourceCenterZ: number,
  x: number,
  z: number,
  cellSize: number,
): boolean {
  const reach = cellSize * 1.5 - SOURCE_NEIGHBORHOOD_EPSILON;
  return (
    Math.abs(x - sourceCenterX) < reach &&
    Math.abs(z - sourceCenterZ) < reach
  );
}
