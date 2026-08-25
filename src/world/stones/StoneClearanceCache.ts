import type { WorldConfig } from "../WorldConfig";
import type { StoneField, StoneInstance } from "./StoneField";
import {
  resolveStoneSkirtBand,
  resolveStoneSkirtWidth,
} from "./StoneSkirt";

const CACHE_LIMIT = 512;
const EXPANDED_CACHE_LIMIT = 256;
const CELL_KEY_MARGIN = 4;
const EDGE_EPSILON = 1e-6;
// The fully bare region stays within the physical contact footprint. Most of
// the configured feather can therefore be occupied by a short grass fringe.
const CLEARANCE_INNER_SCALE = 0.84;

interface StoneClearanceCandidate {
  x: number;
  z: number;
  clearRadius: number;
  innerRadius: number;
  reach: number;
  reachSquared: number;
  skirtWidth: number;
  skirtReachSquared: number;
}

function smoothstep(value: number, minimum: number, maximum: number): number {
  if (value <= minimum) return 0;
  if (value >= maximum) return 1;
  const amount = (value - minimum) / (maximum - minimum);
  return amount * amount * (3 - 2 * amount);
}

function trimOldest<K, V>(cache: Map<K, V>, limit: number): void {
  if (cache.size < limit) return;
  const oldestKey = cache.keys().next().value;
  if (oldestKey !== undefined) cache.delete(oldestKey);
}

/**
 * Amortizes stone clearance across all grass blades sharing a stone cell.
 * The expensive deterministic placement walk runs once per neighborhood rather
 * than once per blade; hot samples are one numeric Map lookup plus distance tests.
 */
export class StoneClearanceCache {
  private readonly neighborhoods = new Map<number, StoneClearanceCandidate[]>();
  private readonly expandedNeighborhoods = new Map<
    string,
    StoneClearanceCandidate[]
  >();
  private readonly chunkScratch: StoneInstance[] = [];
  private readonly cellKeyOffset: number;
  private readonly cellKeyStride: number;
  private readonly feather: number;

  constructor(
    private readonly field: StoneField,
    private readonly config: WorldConfig,
  ) {
    const halfCells =
      Math.ceil(config.worldSize / (config.stoneCellSize * 2)) +
      CELL_KEY_MARGIN;
    this.cellKeyOffset = halfCells;
    this.cellKeyStride = halfCells * 2 + 1;
    this.feather = config.stoneGrassClearanceFeather;
  }

  sample(x: number, z: number, extraRadius = 0): number {
    const cellSize = this.config.stoneCellSize;
    const cellX = Math.floor(x / cellSize);
    const cellZ = Math.floor(z / cellSize);
    let marginCells = 1;
    if (extraRadius !== 0) {
      if (!Number.isFinite(extraRadius) || extraRadius < 0) {
        throw new Error(
          "Stone clearance extraRadius must be a non-negative finite number.",
        );
      }
      marginCells += Math.ceil(extraRadius / cellSize);
    }
    const candidates = this.getNeighborhood(cellX, cellZ, marginCells);
    let mask = 1;

    if (extraRadius === 0) {
      for (const candidate of candidates) {
        const offsetX = x - candidate.x;
        const offsetZ = z - candidate.z;
        const distanceSquared = offsetX * offsetX + offsetZ * offsetZ;
        if (distanceSquared >= candidate.reachSquared) continue;

        mask *= smoothstep(
          Math.sqrt(distanceSquared),
          candidate.innerRadius,
          candidate.reach,
        );
        if (mask <= 0.02) return 0;
      }
      return mask;
    }

    for (const candidate of candidates) {
      const radius = candidate.clearRadius + extraRadius;
      const reach = radius + this.feather;
      const offsetX = x - candidate.x;
      const offsetZ = z - candidate.z;
      const distanceSquared = offsetX * offsetX + offsetZ * offsetZ;
      if (distanceSquared >= reach * reach) continue;

      mask *= smoothstep(
        Math.sqrt(distanceSquared),
        radius * CLEARANCE_INNER_SCALE,
        reach,
      );
      if (mask <= 0.02) return 0;
    }
    return mask;
  }

  /**
   * Strength of the planted band at (x, z), taking the nearest stone's ring
   * rather than summing: two stones half a metre apart share one skirt, they do
   * not grow a doubly lush seam between them.
   */
  sampleSkirt(x: number, z: number): number {
    const cellSize = this.config.stoneCellSize;
    const cellX = Math.floor(x / cellSize);
    const cellZ = Math.floor(z / cellSize);
    const candidates = this.getNeighborhood(cellX, cellZ, 1);
    let skirt = 0;
    for (const candidate of candidates) {
      const offsetX = x - candidate.x;
      const offsetZ = z - candidate.z;
      const distanceSquared = offsetX * offsetX + offsetZ * offsetZ;
      if (distanceSquared >= candidate.skirtReachSquared) continue;
      skirt = Math.max(
        skirt,
        resolveStoneSkirtBand(
          Math.sqrt(distanceSquared),
          candidate.innerRadius,
          candidate.reach,
          candidate.skirtWidth,
        ),
      );
      if (skirt >= 1) return 1;
    }
    return skirt;
  }

  clear(): void {
    this.neighborhoods.clear();
    this.expandedNeighborhoods.clear();
  }

  private getNeighborhood(
    cellX: number,
    cellZ: number,
    marginCells: number,
  ): StoneClearanceCandidate[] {
    const cellKey = this.cellKey(cellX, cellZ);
    if (marginCells === 1) {
      const cached = this.neighborhoods.get(cellKey);
      if (cached) return cached;
      const candidates = this.collectNeighborhood(cellX, cellZ, marginCells);
      trimOldest(this.neighborhoods, CACHE_LIMIT);
      this.neighborhoods.set(cellKey, candidates);
      return candidates;
    }

    const expandedKey = `${cellKey}:${marginCells}`;
    const cached = this.expandedNeighborhoods.get(expandedKey);
    if (cached) return cached;
    const candidates = this.collectNeighborhood(cellX, cellZ, marginCells);
    trimOldest(this.expandedNeighborhoods, EXPANDED_CACHE_LIMIT);
    this.expandedNeighborhoods.set(expandedKey, candidates);
    return candidates;
  }

  private collectNeighborhood(
    cellX: number,
    cellZ: number,
    marginCells: number,
  ): StoneClearanceCandidate[] {
    if (!Number.isFinite(cellX) || !Number.isFinite(cellZ)) {
      throw new Error("Stone clearance coordinates must be finite numbers.");
    }

    const cellSize = this.config.stoneCellSize;
    const chunkSize = this.config.chunkSize;
    const minimumX = (cellX - marginCells) * cellSize;
    const minimumZ = (cellZ - marginCells) * cellSize;
    const maximumX = (cellX + 1 + marginCells) * cellSize;
    const maximumZ = (cellZ + 1 + marginCells) * cellSize;
    const halfChunks = this.config.worldSize / (chunkSize * 2);
    const minimumChunk = -halfChunks;
    const maximumChunk = halfChunks - 1;
    const firstChunkX = Math.max(
      minimumChunk,
      Math.floor(minimumX / chunkSize),
    );
    const firstChunkZ = Math.max(
      minimumChunk,
      Math.floor(minimumZ / chunkSize),
    );
    const lastChunkX = Math.min(
      maximumChunk,
      Math.floor((maximumX - EDGE_EPSILON) / chunkSize),
    );
    const lastChunkZ = Math.min(
      maximumChunk,
      Math.floor((maximumZ - EDGE_EPSILON) / chunkSize),
    );
    const candidates: StoneClearanceCandidate[] = [];

    for (let chunkZ = firstChunkZ; chunkZ <= lastChunkZ; chunkZ += 1) {
      for (let chunkX = firstChunkX; chunkX <= lastChunkX; chunkX += 1) {
        const instances = this.field.collectChunkInstances(
          chunkX,
          chunkZ,
          true,
          this.chunkScratch,
        );
        for (const instance of instances) {
          if (
            instance.clearRadius > 0 &&
            instance.x >= minimumX &&
            instance.x < maximumX &&
            instance.z >= minimumZ &&
            instance.z < maximumZ
          ) {
            const reach = instance.clearRadius + this.feather;
            const skirtWidth = resolveStoneSkirtWidth(instance.clearRadius);
            const skirtReach = reach + skirtWidth;
            candidates.push({
              x: instance.x,
              z: instance.z,
              clearRadius: instance.clearRadius,
              innerRadius: instance.clearRadius * CLEARANCE_INNER_SCALE,
              reach,
              reachSquared: reach * reach,
              skirtWidth,
              skirtReachSquared: skirtReach * skirtReach,
            });
          }
        }
      }
    }
    return candidates;
  }

  private cellKey(cellX: number, cellZ: number): number {
    return (
      (cellX + this.cellKeyOffset) * this.cellKeyStride +
      cellZ +
      this.cellKeyOffset
    );
  }
}
