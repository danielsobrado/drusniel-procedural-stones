import * as THREE from "three";
import type { TerrainField } from "../TerrainField";
import type { WorldConfig } from "../WorldConfig";
import {
  pickGrassBiomeIndex,
  sampleGrassBiome,
} from "../grass/WorldBiomeField";
import { hashStoneCell, StoneRandom } from "./StoneRandom";
import { type StoneArchetypeId, type StoneRecipe } from "./StoneRecipe";
import { resolveQualityStoneRecipe } from "./StoneShapeQuality";
import { resolveStoneGeology } from "./StoneGeology";
import {
  clearStoneGroundInfluence,
  resolveStoneOcclusionRadius,
  scoreStoneContactInfluence,
  scoreStoneOcclusionInfluence,
  writeStoneContactInfluence,
  writeStoneOcclusionInfluence,
  type MutableStoneGroundInfluence,
} from "./StoneGroundInfluence";
import {
  resolveStoneFormationGap,
  resolveStoneFormationOffset,
  resolveStoneFractureHorizontalNormal,
  resolveStoneFragmentRecipe,
  stoneFormationSplits,
  type StoneFragmentId,
} from "./StoneFormation";
import { generateStoneMesh, type StoneMeshData } from "./StoneGeometry";
import { type StonePaletteKey } from "./StonePalette";
import {
  StoneClusterComposition,
  type StoneClusterMemberSpec,
} from "./StoneClusterComposition";
import {
  StoneClusterField,
  type StoneClusterDescriptor,
} from "./StoneClusterField";
import {
  clamp01,
  clusterCacheKeepCount,
  clusterInfluenceIntersectsAabb,
  clusterLocalToWorld,
  clusterPointInsideInfluence,
  clusterRadialWorld,
  fillStoneCellMacroCoordinates,
  lerp,
  OVERLAP_FOOTPRINT_FACTOR,
  OVERLAP_PADDING,
  packLatticeKey,
  resolveOverlapPush,
  singletonProbability,
  uplandGeologyBoost,
  smoothstep,
  SPLIT_CORE_OFFSET_FACTOR,
  STONE_CELL_DOMAIN,
  STONE_CELL_SOURCE_MARGIN,
  STONE_CLUSTER_RESOLVED_CACHE_LIMIT,
  stoneClusterMemberLabel,
  stoneSourceCellCacheLimit,
  trimOldestCacheEntries,
  type StoneClusterRole,
  type StoneMacroCoord,
} from "./StoneClusterTuning";
import {
  BIOME_PALETTE,
  SCALE_BANDS,
  stoneMossBase,
} from "./StonePlacementProfile";
import {
  selectPathDistance,
  selectStoneVergePath,
  stoneVergeInsideSourceNeighborhood,
  STONE_PATH_DISTANCE_PLATEAU,
  type StoneVergePathChannel,
} from "./StonePathPlacement";
import { resolveStoneYaw } from "./StoneFractureAlignment";
import { resolveStoneSkirtBand, resolveStoneSkirtWidth } from "./StoneSkirt";
import {
  createHydrologySample,
  type HydrologySample,
} from "../hydrology/HydrologyField";
import { resolveStoneWetness, type StoneWetness } from "./StoneWetness";

/**
 * Deterministic world-space stone placement.
 *
 * Stones are a consequence of geology, surface exposure, and erosion: a macro
 * lattice decides where formations exist, composition assigns an
 * anchor/secondary/debris family, and this field only validates those members
 * against terrain, paths, and one another. Quiet ground stays quiet except for
 * a rare singleton, and walking ways keep their own kicked-aside verge stones.
 *
 * Cell results are cached; the cache is transparent (pure regeneration).
 */

export interface StoneInstance {
  readonly x: number;
  readonly z: number;
  /**
   * World base height before sink. Whole stones use their terrain root; mated
   * fragments share the anchor's height so one rigid fracture cannot shear in Y.
   */
  readonly height: number;
  readonly sink: number;
  readonly rotationY: number;
  readonly scale: number;
  readonly archetype: StoneArchetypeId;
  readonly variantIndex: number;
  /**
   * Which piece of the pooled body this instance draws: a whole stone, or one
   * half of a formation whose sibling stands against its break.
   */
  readonly fragment: StoneFragmentId;
  readonly paletteKey: StonePaletteKey;
  /** Blend towards granite with altitude, resolved at colorize time. */
  readonly graniteBlend: number;
  /**
   * How much of the geometry's baked moss susceptibility actually grows here.
   * Damp lowland meadow is mossy, dry steppe barely lichened, and bare rock
   * above the grass line has almost nothing on it.
   */
  readonly moss: number;
  readonly valueScale: number;
  /**
   * How far the formation this body belongs to has weathered, as a bias on its
   * own weathering channel. Shared by every member of a cluster, so a formation
   * agrees about its age without agreeing about its banding.
   */
  readonly weatheringBias: number;
  /** Terrain normal at the root, and how strongly to align to it. */
  readonly normalX: number;
  readonly normalY: number;
  readonly normalZ: number;
  readonly tiltStrength: number;
  /** Metres of grass cleared around the footprint; 0 for nestling pebbles. */
  readonly clearRadius: number;
  /**
   * Reach of the contact shadow this body throws onto the ground.
   *
   * Resolved here rather than at sampling time because it needs the body's
   * height, which lives on the mesh the instance draws; carrying the answer
   * keeps the terrain's per-vertex influence lookup to arithmetic.
   */
  readonly occlusionRadius: number;
  /** Splash-zone wetness and its waterline, resolved from hydrology at root. */
  readonly wetness: StoneWetness;
}

export interface StoneResolvedMember {
  readonly instance: StoneInstance;
  readonly footprintRadius: number;
  readonly memberIndex: number;
  readonly role: StoneClusterRole;
  readonly isSplitHalf: boolean;
  readonly localU: number;
  readonly localV: number;
}

export interface StoneResolvedCluster {
  readonly members: readonly StoneResolvedMember[];
  readonly logicalSlots: number;
  readonly validationAttempts: number;
  readonly overlapCorrections: number;
  readonly splitEligibleSlots: number;
  readonly splitSucceeded: boolean;
  readonly usedFallback: boolean;
}

export interface StoneClusterBoundsSummary {
  activeClusters: number;
  compact: number;
  ridge: number;
  scree: number;
  fan: number;
  acceptedMembers: number;
  splits: number;
  singletons: number;
}

interface AcceptedMember {
  instance: StoneInstance;
  footprintRadius: number;
  memberIndex: number;
  role: StoneClusterRole;
  isSplitHalf: boolean;
  localU: number;
  localV: number;
}

/** Below this scale a stone nestles into grass instead of clearing it. */
const CLEAR_SCALE_CUTOFF = 0.5;
/**
 * Ceiling on how much of a stone's baked moss susceptibility may actually grow.
 *
 * Damp lowland meadow was reaching 0.89, and at that level the growth shader
 * mixes so far towards moss colour that a boulder renders as a smooth green
 * dome — indistinguishable from a shrub, and with none of the silhouette or
 * material read the stone geometry was built for. Capping keeps the wettest
 * meadow stones clearly mossy while leaving roughly a third of the rock
 * showing through on their mossiest faces; drier biomes are nowhere near this
 * bound and are unaffected.
 */
const MAX_ENVIRONMENT_MOSS = 0.66;
/** Slope gates on the terrain normal's Y component. */
const SLOPE_REJECT_NY = 0.62;
/** Source displacement plus one cell of verified base clearance reach. */
const CLEARANCE_SOURCE_CELL_MARGIN = STONE_CELL_SOURCE_MARGIN + 1;
const VERGE_BAND = 1.6;
const VERGE_STEP_PASSES = 4;
const VERGE_MAX_PER_CELL = 7;

const EMPTY_RESOLVED: StoneResolvedCluster = {
  members: [],
  logicalSlots: 0,
  validationAttempts: 0,
  overlapCorrections: 0,
  splitEligibleSlots: 0,
  splitSucceeded: false,
  usedFallback: false,
};

export class StoneField {
  private readonly cellSize: number;
  private readonly cellCacheLimit: number;
  private readonly cells = new Map<number, StoneInstance[]>();
  private readonly cellSingletons = new Map<number, number>();
  private readonly resolvedClusters = new Map<number, StoneResolvedCluster>();
  private readonly variants = new Map<string, StoneMeshData>();
  private readonly parentRecipes = new Map<string, StoneRecipe>();
  private readonly normalScratch = new THREE.Vector3();
  private readonly hydrologyScratch: HydrologySample = createHydrologySample();
  private readonly pathScratch = new THREE.Vector2();
  private readonly tangentScratch = { x: 0, z: 0 };
  private readonly macroScratch: StoneMacroCoord[] = [];
  private readonly clusterField: StoneClusterField;
  private readonly composition: StoneClusterComposition;
  private readonly enabled: boolean;

  constructor(
    private readonly field: TerrainField,
    private readonly config: WorldConfig,
  ) {
    this.cellSize = config.stoneCellSize;
    this.cellCacheLimit = stoneSourceCellCacheLimit(
      config.stoneRadiusDesktop,
      config.chunkSize,
      config.stoneCellSize,
    );
    this.enabled = config.stonesEnabled >= 1;
    this.clusterField = new StoneClusterField(field, config);
    this.composition = new StoneClusterComposition(config);
  }

  getCellCacheLimit(): number {
    return this.cellCacheLimit;
  }

  getClusterField(): StoneClusterField {
    return this.clusterField;
  }

  getClusterDescriptor(gridX: number, gridZ: number): StoneClusterDescriptor {
    return this.clusterField.getDescriptor(gridX, gridZ);
  }

  getResolvedCluster(gridX: number, gridZ: number): StoneResolvedCluster {
    const key = packLatticeKey(gridX, gridZ);
    const cached = this.resolvedClusters.get(key);
    if (cached) {
      return cached;
    }
    const resolved = this.resolveCluster(gridX, gridZ);
    if (this.resolvedClusters.size >= STONE_CLUSTER_RESOLVED_CACHE_LIMIT) {
      trimOldestCacheEntries(
        this.resolvedClusters,
        clusterCacheKeepCount(STONE_CLUSTER_RESOLVED_CACHE_LIMIT),
      );
    }
    this.resolvedClusters.set(key, resolved);
    return resolved;
  }

  getVariant(
    archetype: StoneArchetypeId,
    variantIndex: number,
    detailed = false,
    fragment: StoneFragmentId = "whole",
  ): StoneMeshData {
    const key = `${archetype}:${variantIndex}:${fragment}:${detailed ? "near" : "far"}`;
    let mesh = this.variants.get(key);
    if (!mesh) {
      mesh = generateStoneMesh(
        resolveStoneFragmentRecipe(
          this.parentRecipe(archetype, variantIndex),
          fragment,
        ),
        detailed,
      );
      this.variants.set(key, mesh);
    }
    return mesh;
  }

  /** The pooled body an instance draws, whole or fragment. */
  getInstanceVariant(instance: StoneInstance, detailed = false): StoneMeshData {
    return this.getVariant(
      instance.archetype,
      instance.variantIndex,
      detailed,
      instance.fragment,
    );
  }

  private parentRecipe(
    archetype: StoneArchetypeId,
    variantIndex: number,
  ): StoneRecipe {
    const key = `${archetype}:${variantIndex}`;
    let recipe = this.parentRecipes.get(key);
    if (!recipe) {
      const seed = hashStoneCell(
        variantIndex,
        hashStoneCell(archetype.length, variantIndex, this.config.seed),
        this.config.seed,
      );
      recipe = resolveQualityStoneRecipe(archetype, seed);
      this.parentRecipes.set(key, recipe);
    }
    return recipe;
  }

  collectChunkInstances(
    chunkX: number,
    chunkZ: number,
    includeSmall: boolean,
    out: StoneInstance[],
  ): StoneInstance[] {
    out.length = 0;
    if (!this.enabled) {
      return out;
    }
    const chunkSize = this.config.chunkSize;
    const minX = chunkX * chunkSize;
    const minZ = chunkZ * chunkSize;
    const maxX = minX + chunkSize;
    const maxZ = minZ + chunkSize;
    const firstCellX =
      Math.floor(minX / this.cellSize) - STONE_CELL_SOURCE_MARGIN;
    const firstCellZ =
      Math.floor(minZ / this.cellSize) - STONE_CELL_SOURCE_MARGIN;
    const lastCellX =
      Math.floor((maxX - 1e-3) / this.cellSize) + STONE_CELL_SOURCE_MARGIN;
    const lastCellZ =
      Math.floor((maxZ - 1e-3) / this.cellSize) + STONE_CELL_SOURCE_MARGIN;
    for (let cellZ = firstCellZ; cellZ <= lastCellZ; cellZ += 1) {
      for (let cellX = firstCellX; cellX <= lastCellX; cellX += 1) {
        for (const instance of this.getCellInstances(cellX, cellZ)) {
          if (
            instance.x >= minX &&
            instance.x < maxX &&
            instance.z >= minZ &&
            instance.z < maxZ &&
            (includeSmall || instance.scale >= CLEAR_SCALE_CUTOFF)
          ) {
            out.push(instance);
          }
        }
      }
    }
    return out;
  }

  /**
   * Strength of the planted band around stone bases at (x, z).
   *
   * The exact counterpart of the clearance walk above, for scenes that hold a
   * field without the amortized cache. Nearest ring wins rather than the sum.
   */
  sampleGrassSkirt(x: number, z: number): number {
    if (!this.enabled) {
      return 0;
    }
    const feather = this.config.stoneGrassClearanceFeather;
    const centerCellX = Math.floor(x / this.cellSize);
    const centerCellZ = Math.floor(z / this.cellSize);
    let skirt = 0;
    for (
      let dz = -CLEARANCE_SOURCE_CELL_MARGIN;
      dz <= CLEARANCE_SOURCE_CELL_MARGIN;
      dz += 1
    ) {
      for (
        let dx = -CLEARANCE_SOURCE_CELL_MARGIN;
        dx <= CLEARANCE_SOURCE_CELL_MARGIN;
        dx += 1
      ) {
        const instances = this.getCellInstances(
          centerCellX + dx,
          centerCellZ + dz,
        );
        for (const instance of instances) {
          if (instance.clearRadius <= 0) {
            continue;
          }
          const reach = instance.clearRadius + feather;
          const width = resolveStoneSkirtWidth(instance.clearRadius);
          const offsetX = x - instance.x;
          const offsetZ = z - instance.z;
          const distance = Math.hypot(offsetX, offsetZ);
          if (distance >= reach + width) {
            continue;
          }
          skirt = Math.max(
            skirt,
            resolveStoneSkirtBand(
              distance,
              instance.clearRadius * 0.84,
              reach,
              width,
            ),
          );
          if (skirt >= 1) {
            return 1;
          }
        }
      }
    }
    return skirt;
  }

  /**
   * Dominant ground influences at (x, z), with contact soil and sky occlusion
   * selected independently.
   *
   * Both competitions use normalized distance, not raw distance. A small stone
   * can therefore own the soil directly under it without stealing the longer
   * shadow of a taller neighbour; stones too small to clear grass still take
   * part in the occlusion competition.
   */
  sampleGroundInfluence(
    x: number,
    z: number,
    out: MutableStoneGroundInfluence,
  ): MutableStoneGroundInfluence {
    clearStoneGroundInfluence(x, z, out);
    if (!this.enabled) {
      return out;
    }
    const feather = this.config.stoneGrassClearanceFeather;
    const centerCellX = Math.floor(x / this.cellSize);
    const centerCellZ = Math.floor(z / this.cellSize);
    let closestContact = Number.POSITIVE_INFINITY;
    let closestOcclusion = Number.POSITIVE_INFINITY;
    for (
      let dz = -CLEARANCE_SOURCE_CELL_MARGIN;
      dz <= CLEARANCE_SOURCE_CELL_MARGIN;
      dz += 1
    ) {
      for (
        let dx = -CLEARANCE_SOURCE_CELL_MARGIN;
        dx <= CLEARANCE_SOURCE_CELL_MARGIN;
        dx += 1
      ) {
        for (const instance of this.getCellInstances(
          centerCellX + dx,
          centerCellZ + dz,
        )) {
          const contactScore = scoreStoneContactInfluence(
            instance,
            x,
            z,
            feather,
          );
          if (contactScore < closestContact) {
            closestContact = contactScore;
            writeStoneContactInfluence(
              instance,
              feather,
              resolveStoneSkirtWidth(instance.clearRadius),
              out,
            );
          }

          const occlusionScore = scoreStoneOcclusionInfluence(
            instance,
            x,
            z,
          );
          if (occlusionScore < closestOcclusion) {
            closestOcclusion = occlusionScore;
            writeStoneOcclusionInfluence(instance, out);
          }
        }
      }
    }
    return out;
  }

  sampleGrassClearance(x: number, z: number, extraRadius = 0): number {
    if (!this.enabled) {
      return 1;
    }
    let sourceMargin = CLEARANCE_SOURCE_CELL_MARGIN;
    if (extraRadius !== 0) {
      if (!Number.isFinite(extraRadius) || extraRadius < 0) {
        throw new Error(
          "Stone clearance extraRadius must be a non-negative finite number.",
        );
      }
      sourceMargin += Math.ceil(extraRadius / this.cellSize);
    }
    const feather = this.config.stoneGrassClearanceFeather;
    const centerCellX = Math.floor(x / this.cellSize);
    const centerCellZ = Math.floor(z / this.cellSize);
    let mask = 1;
    for (let dz = -sourceMargin; dz <= sourceMargin; dz += 1) {
      for (let dx = -sourceMargin; dx <= sourceMargin; dx += 1) {
        const instances = this.getCellInstances(
          centerCellX + dx,
          centerCellZ + dz,
        );
        for (const instance of instances) {
          if (instance.clearRadius <= 0) {
            continue;
          }
          const radius = instance.clearRadius + extraRadius;
          const reach = radius + feather;
          const offsetX = x - instance.x;
          const offsetZ = z - instance.z;
          const distanceSquared = offsetX * offsetX + offsetZ * offsetZ;
          if (distanceSquared >= reach * reach) {
            continue;
          }
          const distance = Math.sqrt(distanceSquared);
          mask *= smoothstep(distance, radius * 0.84, reach);
          if (mask <= 0.02) {
            return 0;
          }
        }
      }
    }
    return mask;
  }

  summarizeBounds(
    minX: number,
    minZ: number,
    maxX: number,
    maxZ: number,
  ): StoneClusterBoundsSummary {
    const summary: StoneClusterBoundsSummary = {
      activeClusters: 0,
      compact: 0,
      ridge: 0,
      scree: 0,
      fan: 0,
      acceptedMembers: 0,
      splits: 0,
      singletons: 0,
    };
    if (!this.enabled) {
      return summary;
    }
    const spacing = this.config.stoneClusterSpacing;
    const pad = this.config.stoneClusterRadiusMax * 2;
    const firstGx = Math.floor((minX - pad) / spacing);
    const lastGx = Math.floor((maxX + pad) / spacing);
    const firstGz = Math.floor((minZ - pad) / spacing);
    const lastGz = Math.floor((maxZ + pad) / spacing);
    for (let gridZ = firstGz; gridZ <= lastGz; gridZ += 1) {
      for (let gridX = firstGx; gridX <= lastGx; gridX += 1) {
        const descriptor = this.clusterField.getDescriptor(gridX, gridZ);
        if (
          !descriptor.active ||
          descriptor.centerX < minX ||
          descriptor.centerX >= maxX ||
          descriptor.centerZ < minZ ||
          descriptor.centerZ >= maxZ
        ) {
          continue;
        }
        summary.activeClusters += 1;
        summary[descriptor.process] += 1;
        const resolved = this.getResolvedCluster(gridX, gridZ);
        summary.acceptedMembers += resolved.members.length;
        for (const member of resolved.members) {
          if (member.isSplitHalf) {
            summary.splits += 1;
          }
        }
      }
    }
    const firstCellX = Math.floor(minX / this.cellSize);
    const lastCellX = Math.floor((maxX - 1e-3) / this.cellSize);
    const firstCellZ = Math.floor(minZ / this.cellSize);
    const lastCellZ = Math.floor((maxZ - 1e-3) / this.cellSize);
    for (let cellZ = firstCellZ; cellZ <= lastCellZ; cellZ += 1) {
      for (let cellX = firstCellX; cellX <= lastCellX; cellX += 1) {
        this.getCellInstances(cellX, cellZ);
        summary.singletons +=
          this.cellSingletons.get(packLatticeKey(cellX, cellZ)) ?? 0;
      }
    }
    return summary;
  }

  sourceCellHasClusterInfluence(cellX: number, cellZ: number): boolean {
    const minX = cellX * this.cellSize;
    const minZ = cellZ * this.cellSize;
    const maxX = minX + this.cellSize;
    const maxZ = minZ + this.cellSize;
    const count = fillStoneCellMacroCoordinates(
      cellX,
      cellZ,
      this.cellSize,
      this.config.stoneClusterSpacing,
      this.macroScratch,
    );
    for (let index = 0; index < count; index += 1) {
      const coord = this.macroScratch[index];
      const descriptor = this.clusterField.getDescriptor(
        coord.gridX,
        coord.gridZ,
      );
      if (
        descriptor.active &&
        clusterInfluenceIntersectsAabb(
          descriptor.centerX,
          descriptor.centerZ,
          descriptor.influenceRadius,
          minX,
          maxX,
          minZ,
          maxZ,
        )
      ) {
        return true;
      }
    }
    return false;
  }

  private getCellInstances(cellX: number, cellZ: number): StoneInstance[] {
    const key = packLatticeKey(cellX, cellZ);
    const cached = this.cells.get(key);
    if (cached) {
      return cached;
    }
    const instances = this.generateCell(cellX, cellZ);
    if (this.cells.size >= this.cellCacheLimit) {
      for (const staleKey of this.cells.keys()) {
        this.cells.delete(staleKey);
        this.cellSingletons.delete(staleKey);
        if (this.cells.size < this.cellCacheLimit) {
          break;
        }
      }
    }
    this.cells.set(key, instances);
    return instances;
  }

  private generateCell(cellX: number, cellZ: number): StoneInstance[] {
    const random = StoneRandom.fromSeed(
      hashStoneCell(cellX, cellZ, this.config.seed ^ STONE_CELL_DOMAIN),
    );
    const originX = cellX * this.cellSize;
    const originZ = cellZ * this.cellSize;
    const centerX = originX + this.cellSize * 0.5;
    const centerZ = originZ + this.cellSize * 0.5;
    const minX = originX;
    const minZ = originZ;
    const maxX = originX + this.cellSize;
    const maxZ = originZ + this.cellSize;
    const cellKey = packLatticeKey(cellX, cellZ);

    const halfWorld = this.config.worldSize * 0.5;
    if (
      centerX < -halfWorld ||
      centerX > halfWorld ||
      centerZ < -halfWorld ||
      centerZ > halfWorld
    ) {
      this.cellSingletons.set(cellKey, 0);
      return [];
    }

    const instances: StoneInstance[] = [];
    const count = fillStoneCellMacroCoordinates(
      cellX,
      cellZ,
      this.cellSize,
      this.config.stoneClusterSpacing,
      this.macroScratch,
    );
    let influenceHits = false;
    for (let index = 0; index < count; index += 1) {
      const coord = this.macroScratch[index];
      const descriptor = this.clusterField.getDescriptor(
        coord.gridX,
        coord.gridZ,
      );
      if (!descriptor.active) {
        continue;
      }
      if (
        !clusterInfluenceIntersectsAabb(
          descriptor.centerX,
          descriptor.centerZ,
          descriptor.influenceRadius,
          minX,
          maxX,
          minZ,
          maxZ,
        )
      ) {
        continue;
      }
      influenceHits = true;
      for (const member of this.getResolvedCluster(coord.gridX, coord.gridZ)
        .members) {
        if (
          member.instance.x >= minX &&
          member.instance.x < maxX &&
          member.instance.z >= minZ &&
          member.instance.z < maxZ
        ) {
          instances.push(member.instance);
        }
      }
    }

    let singletons = 0;
    if (!influenceHits) {
      singletons = this.addSingleton(
        random.fork("singleton"),
        originX,
        originZ,
        centerX,
        centerZ,
        instances,
      )
        ? 1
        : 0;
    }
    this.cellSingletons.set(cellKey, singletons);

    if (this.config.stoneVergeChance > 0) {
      const geologyPotential = this.clusterField.sampleGeologyPotential(
        centerX,
        centerZ,
      );
      this.addVergeStones(
        random.fork("verge"),
        originX,
        originZ,
        geologyPotential,
        instances,
      );
    }
    return instances;
  }

  /**
   * The weathering every member of one cluster inherits.
   *
   * Resolved from the descriptor rather than threaded, because it is a pure
   * hash of values every member already has: recomputing it costs less than
   * carrying it and cannot fall out of step between members.
   */
  private geologyBias(descriptor: StoneClusterDescriptor): number {
    return resolveStoneGeology(
      descriptor.seed,
      descriptor.strike,
      descriptor.paletteKey,
    ).weathering;
  }

  private resolveCluster(gridX: number, gridZ: number): StoneResolvedCluster {
    const descriptor = this.clusterField.getDescriptor(gridX, gridZ);
    if (!descriptor.active) {
      return EMPTY_RESOLVED;
    }
    const specs = this.composition.compose(descriptor);
    if (specs.length === 0) {
      return EMPTY_RESOLVED;
    }
    const accepted: AcceptedMember[] = [];
    let validationAttempts = 0;
    let overlapCorrections = 0;
    let splitSucceeded = false;
    let usedFallback = false;
    const splitEligibleSlots = specs.some((spec) => spec.splitEligible) ? 1 : 0;

    const anchorSpec = specs[0];
    // The anchor has to know it is half of something before it is placed: a
    // formation is one body cut in two, so the piece that stands first is the
    // major fragment, not a whole stone that a sibling is fitted to afterwards.
    const anchorFragment: StoneFragmentId =
      splitEligibleSlots > 0 &&
      stoneFormationSplits(
        this.parentRecipe(anchorSpec.archetype, anchorSpec.variantIndex),
      )
        ? "a"
        : "whole";
    let anchorIsFragment = anchorFragment === "a";
    validationAttempts += 1;
    const anchor = this.placeNormalMember(
      descriptor,
      anchorSpec,
      accepted,
      false,
      anchorFragment,
    );
    if (!anchor.member) {
      return {
        members: [],
        logicalSlots: specs.length,
        validationAttempts,
        overlapCorrections: 0,
        splitEligibleSlots,
        splitSucceeded: false,
        usedFallback: false,
      };
    }
    if (anchor.corrected) {
      overlapCorrections += 1;
    }
    accepted.push(anchor.member);

    for (let index = 1; index < specs.length; index += 1) {
      const spec = specs[index];
      if (spec.splitEligible && spec.fallback) {
        const splitAttempt = anchorIsFragment
          ? this.tryMatedFragment(
              descriptor,
              spec,
              accepted[0],
              accepted.slice(1),
            )
          : undefined;
        validationAttempts += 1;
        if (splitAttempt) {
          accepted.push(splitAttempt);
          splitSucceeded = true;
          continue;
        }
        // No sibling stood up, so the anchor goes back to being a whole stone
        // rather than a body with an unexplained flat break down one side.
        if (anchorIsFragment) {
          accepted[0] = this.rejoinAnchor(accepted[0]);
          anchorIsFragment = false;
        }
        validationAttempts += 1;
        usedFallback = true;
        const fallback = this.placeNormalMember(
          descriptor,
          spec.fallback,
          accepted,
          true,
        );
        if (fallback.corrected) {
          overlapCorrections += 1;
        }
        if (fallback.member) {
          accepted.push(fallback.member);
        }
        continue;
      }
      validationAttempts += 1;
      const placed = this.placeNormalMember(descriptor, spec, accepted, true);
      if (placed.corrected) {
        overlapCorrections += 1;
      }
      if (placed.member) {
        accepted.push(placed.member);
      }
    }

    return {
      members: accepted.map((member) => ({ ...member })),
      logicalSlots: specs.length,
      validationAttempts,
      overlapCorrections,
      splitEligibleSlots,
      splitSucceeded,
      usedFallback,
    };
  }

  /**
   * Puts a major fragment back together when its sibling could not be placed.
   *
   * The body only grows here -- the fragment is a subset of the whole -- and the
   * anchor was cleared against the larger of the two radii when it was placed,
   * so the position it already holds stays valid. Everything else about the
   * stone is unchanged: this is the same rock, unbroken.
   */
  private rejoinAnchor(member: AcceptedMember): AcceptedMember {
    const whole = this.getVariant(
      member.instance.archetype,
      member.instance.variantIndex,
    );
    return {
      ...member,
      footprintRadius: whole.metrics.footprintRadius * member.instance.scale,
      instance: this.createInstance(
        member.instance.x,
        member.instance.z,
        member.instance.height,
        this.normalScratch.set(
          member.instance.normalX,
          member.instance.normalY,
          member.instance.normalZ,
        ),
        member.instance.archetype,
        member.instance.variantIndex,
        member.instance.scale,
        resolveStoneYaw(
          member.instance.rotationY,
          whole.metrics.fractureAzimuth,
        ),
        member.instance.paletteKey,
        member.instance.valueScale,
        member.instance.moss,
        whole,
        member.role,
        "whole",
        member.instance.weatheringBias,
      ),
    };
  }

  /**
   * The detached fragment of the anchor body, returned to its original break and
   * opened only by a small size-relative aperture. Both pieces share one rigid
   * transform; terrain below the smaller fragment is a support check, not a
   * second placement transform.
   */
  private tryMatedFragment(
    descriptor: StoneClusterDescriptor,
    spec: StoneClusterMemberSpec,
    anchor: AcceptedMember,
    others: readonly AcceptedMember[],
  ): AcceptedMember | undefined {
    const memberRng = StoneRandom.fromSeed(descriptor.seed).fork(
      stoneClusterMemberLabel(spec.index),
    );
    const archetype = anchor.instance.archetype;
    const variantIndex = anchor.instance.variantIndex;
    const scale = anchor.instance.scale;
    const parent = this.parentRecipe(archetype, variantIndex);
    const majorRecipe = resolveStoneFragmentRecipe(parent, "a");
    const major = this.getVariant(archetype, variantIndex, false, "a");
    const minor = this.getVariant(archetype, variantIndex, false, "b");
    const footprint = minor.metrics.footprintRadius * scale;

    const crackGap = resolveStoneFormationGap(
      major.metrics,
      minor.metrics,
      scale,
      memberRng.fork("split-gap").next(),
      this.config.stoneFormationGapRatioMin,
      this.config.stoneFormationGapRatioMax,
      this.config.stoneFormationGapMax,
    );
    const parted = resolveStoneFormationOffset(
      major.metrics,
      minor.metrics,
      scale,
      crackGap,
      resolveStoneFractureHorizontalNormal(majorRecipe),
    );
    if (!parted) {
      return undefined;
    }
    const { x: offsetX, z: offsetZ } = parted;
    if (
      Math.hypot(offsetX, offsetZ) >
      descriptor.majorRadius *
        this.config.stoneClusterCoreRatio *
        SPLIT_CORE_OFFSET_FACTOR
    ) {
      return undefined;
    }

    const yaw = anchor.instance.rotationY;
    const cos = Math.cos(yaw);
    const sin = Math.sin(yaw);
    const x = anchor.instance.x + offsetX * cos + offsetZ * sin;
    const z = anchor.instance.z - offsetX * sin + offsetZ * cos;
    if (!this.insideWorld(x, z) || !this.insideInfluence(descriptor, x, z)) {
      return undefined;
    }
    const supportHeight = this.field.sampleHeight(x, z);
    const supportTolerance = Math.min(
      this.config.stoneFormationSupportHeightMax,
      Math.max(
        major.metrics.materialHeight,
        minor.metrics.materialHeight,
      ) *
        scale *
        this.config.stoneFormationSupportHeightRatio,
    );
    if (Math.abs(supportHeight - anchor.instance.height) > supportTolerance) {
      return undefined;
    }
    if (this.pathBlocks(x, z, supportHeight, scale, footprint)) {
      return undefined;
    }
    if (this.overlapsAny(x, z, footprint, others)) {
      return undefined;
    }
    const normal = this.normalScratch.set(
      anchor.instance.normalX,
      anchor.instance.normalY,
      anchor.instance.normalZ,
    );
    const instance = this.createInstance(
      x,
      z,
      anchor.instance.height,
      normal,
      archetype,
      variantIndex,
      scale,
      resolveStoneYaw(yaw, minor.metrics.fractureAzimuth),
      descriptor.paletteKey,
      anchor.instance.valueScale,
      anchor.instance.moss,
      minor,
      "secondary",
      "b",
      anchor.instance.weatheringBias,
    );
    return {
      instance,
      footprintRadius: footprint,
      memberIndex: spec.index,
      role: "secondary",
      isSplitHalf: true,
      localU: spec.localU,
      localV: spec.localV,
    };
  }

  private placeNormalMember(
    descriptor: StoneClusterDescriptor,
    spec: StoneClusterMemberSpec,
    accepted: readonly AcceptedMember[],
    allowOverlapCorrection: boolean,
    fragment: StoneFragmentId = "whole",
  ): { member?: AcceptedMember; corrected: boolean } {
    const root = clusterLocalToWorld(
      descriptor.centerX,
      descriptor.centerZ,
      descriptor.direction,
      descriptor.majorRadius,
      descriptor.minorRadius,
      spec.localU,
      spec.localV,
    );
    let x = root.x;
    let z = root.z;
    if (!this.insideWorld(x, z) || !this.insideInfluence(descriptor, x, z)) {
      return { corrected: false };
    }
    const sampled = this.samplePlacement(
      x,
      z,
      spec.archetype,
      spec.variantIndex,
      spec.scale,
      fragment,
    );
    if (!sampled) {
      return { corrected: false };
    }
    let { height, normal, footprint, variant } = sampled;
    if (this.pathBlocks(x, z, height, spec.scale, footprint)) {
      return { corrected: false };
    }

    const overlap = this.findOverlap(x, z, footprint, accepted);
    let corrected = false;
    if (overlap) {
      if (!allowOverlapCorrection) {
        return { corrected: false };
      }
      const pushed = this.pushOutward(
        descriptor,
        spec,
        x,
        z,
        overlap.member,
        footprint,
      );
      if (!pushed) {
        return { corrected: false };
      }
      x = pushed.x;
      z = pushed.z;
      corrected = true;
      if (!this.insideWorld(x, z) || !this.insideInfluence(descriptor, x, z)) {
        return { corrected: true };
      }
      const resampled = this.samplePlacement(
        x,
        z,
        spec.archetype,
        spec.variantIndex,
        spec.scale,
        fragment,
      );
      if (!resampled) {
        return { corrected: true };
      }
      height = resampled.height;
      normal = resampled.normal;
      footprint = resampled.footprint;
      variant = resampled.variant;
      if (this.pathBlocks(x, z, height, spec.scale, footprint)) {
        return { corrected: true };
      }
      if (this.overlapsAny(x, z, footprint, accepted)) {
        return { corrected: true };
      }
    }

    const instance = this.createInstance(
      x,
      z,
      height,
      normal,
      spec.archetype,
      spec.variantIndex,
      spec.scale,
      spec.rotationY,
      descriptor.paletteKey,
      spec.valueScale,
      this.memberMoss(descriptor, spec),
      variant,
      spec.role,
      fragment,
      this.geologyBias(descriptor),
    );
    return {
      member: {
        instance,
        footprintRadius: footprint,
        memberIndex: spec.index,
        role: spec.role,
        isSplitHalf: false,
        localU: spec.localU,
        localV: spec.localV,
      },
      corrected,
    };
  }

  private addSingleton(
    random: StoneRandom,
    originX: number,
    originZ: number,
    centerX: number,
    centerZ: number,
    instances: StoneInstance[],
  ): boolean {
    const activationRoll = random.next();
    if (activationRoll >= this.config.stoneSingletonChance) {
      return false;
    }
    const height = this.field.sampleHeight(centerX, centerZ);
    const ecology = this.field.sampleEcologyAt(centerX, centerZ, height);
    const geologyPotential = this.clusterField.sampleGeologyPotential(
      centerX,
      centerZ,
    );
    const probability = singletonProbability(
      geologyPotential,
      ecology.rockiness,
      this.config.stoneSingletonChance,
      uplandGeologyBoost(
        height,
        this.config.grassMinAltitude,
        this.config.grassMaxAltitude,
      ),
    );
    if (activationRoll >= probability) {
      return false;
    }
    const x = originX + random.fork("x").range(0.2, 0.8) * this.cellSize;
    const z = originZ + random.fork("z").range(0.2, 0.8) * this.cellSize;
    if (!this.insideWorld(x, z)) {
      return false;
    }
    const familyRoll = random.fork("family").next();
    const archetype: StoneArchetypeId =
      familyRoll < 0.7 ? "pebble" : familyRoll < 0.92 ? "boulder" : "slab";
    const band = SCALE_BANDS[archetype];
    let scale = lerp(band[0], band[1], random.fork("scale").range(0.35, 0.72));
    const landmarkScale = random.fork("landmark-scale").range(1.7, 2.4);
    if (
      archetype === "boulder" &&
      geologyPotential > 0.45 &&
      random.fork("landmark").chance(0.06)
    ) {
      scale *= landmarkScale;
    }
    const variantIndex = random
      .fork("variant")
      .integer(0, this.config.stoneVariantsPerArchetype - 1);
    const sampled = this.samplePlacement(x, z, archetype, variantIndex, scale);
    if (!sampled) {
      return false;
    }
    if (this.pathBlocks(x, z, sampled.height, scale, sampled.footprint)) {
      return false;
    }
    const biomeSample = sampleGrassBiome(x, z);
    const biomeIndex = Math.min(
      pickGrassBiomeIndex(x, z, biomeSample),
      BIOME_PALETTE.length - 1,
    );
    const moss = Math.min(
      MAX_ENVIRONMENT_MOSS,
      clamp01(
        stoneMossBase(
          sampled.height,
          biomeIndex,
          ecology.rockiness,
          this.config.grassMinAltitude,
          this.config.grassMaxAltitude,
        ) * random.fork("moss").range(0.94, 1.06),
      ),
    );
    instances.push(
      this.createInstance(
        x,
        z,
        sampled.height,
        sampled.normal,
        archetype,
        variantIndex,
        scale,
        this.clusterField.sampleStrike(x, z) + random.fork("yaw").signed(0.42),
        BIOME_PALETTE[biomeIndex],
        random.fork("value").range(0.92, 1.06),
        moss,
        sampled.variant,
      ),
    );
    return true;
  }

  private addVergeStones(
    random: StoneRandom,
    originX: number,
    originZ: number,
    geologyPotential: number,
    instances: StoneInstance[],
  ): void {
    const mainClearance =
      this.config.pathWidth * 0.5 +
      this.config.pathEdgeRoughness +
      this.config.pathGrassClearance;
    const branchClearance =
      this.config.pathBranchWidth * 0.5 +
      this.config.pathEdgeRoughness +
      this.config.pathGrassClearance;
    const centerX = originX + this.cellSize * 0.5;
    const centerZ = originZ + this.cellSize * 0.5;
    const centerHeight = this.field.sampleHeight(centerX, centerZ);
    if (this.field.samplePathVisibility(centerHeight) <= 0.05) {
      return;
    }
    this.field.samplePathDistances(centerX, centerZ, this.pathScratch);
    const selectedPath = selectStoneVergePath(
      this.pathScratch.x,
      this.pathScratch.y,
      mainClearance,
      branchClearance,
      VERGE_BAND + this.cellSize * 0.8,
    );
    if (!selectedPath) {
      return;
    }
    const channel = selectedPath.channel;
    const clearance = selectedPath.clearance;
    const ecology = this.field.sampleEcologyAt(centerX, centerZ, centerHeight);
    const regionalStonePotential =
      0.45 * geologyPotential + 0.55 * ecology.rockiness;
    const attempts = random.integer(1, VERGE_MAX_PER_CELL);
    let alongX = 0;
    let alongZ = 0;
    let haveCenterTangent = false;
    for (let index = 0; index < attempts; index += 1) {
      const attempt = random.fork(`verge:${index}`);
      if (
        !attempt.chance(
          this.config.stoneVergeChance * (0.35 + 0.65 * regionalStonePotential),
        )
      ) {
        continue;
      }
      if (!haveCenterTangent) {
        if (!this.samplePathTangent(centerX, centerZ, channel)) {
          return;
        }
        alongX = this.tangentScratch.x;
        alongZ = this.tangentScratch.z;
        haveCenterTangent = true;
      }
      const along = attempt.range(-0.5, 0.5) * this.cellSize;
      const sampleX = centerX + alongX * along;
      const sampleZ = centerZ + alongZ * along;
      const height = this.field.sampleHeight(sampleX, sampleZ);
      if (this.field.samplePathVisibility(height) <= 0.05) {
        continue;
      }
      this.field.samplePathDistances(sampleX, sampleZ, this.pathScratch);
      const distance = selectPathDistance(
        channel,
        this.pathScratch.x,
        this.pathScratch.y,
      );
      if (
        Math.abs(Math.abs(distance) - STONE_PATH_DISTANCE_PLATEAU) < 0.01 ||
        Math.abs(distance) > clearance + VERGE_BAND + this.cellSize
      ) {
        continue;
      }
      if (!this.samplePathTangent(sampleX, sampleZ, channel)) {
        continue;
      }
      const alongTangentX = this.tangentScratch.x;
      const alongTangentZ = this.tangentScratch.z;
      const acrossX = alongTangentZ;
      const acrossZ = -alongTangentX;
      const side = distance >= 0 ? 1 : -1;
      const archetype: StoneArchetypeId = attempt.chance(0.55)
        ? "pebble"
        : attempt.chance(0.6)
          ? "slab"
          : "boulder";
      const scale = attempt.range(0.22, 0.6);
      const variantIndex = attempt.integer(
        0,
        this.config.stoneVariantsPerArchetype - 1,
      );
      const variant = this.getVariant(archetype, variantIndex);
      const footprint = variant.metrics.footprintRadius * scale;
      const target = clearance + footprint + 0.1 + attempt.range(0, VERGE_BAND);
      let x = sampleX;
      let z = sampleZ;
      let currentDistance = distance;
      let stepAcrossX = acrossX;
      let stepAcrossZ = acrossZ;
      for (let pass = 0; pass < VERGE_STEP_PASSES; pass += 1) {
        const travel = side * target - currentDistance;
        if (Math.abs(travel) < 0.1) {
          break;
        }
        x += stepAcrossX * travel;
        z += stepAcrossZ * travel;
        this.field.samplePathDistances(x, z, this.pathScratch);
        currentDistance = selectPathDistance(
          channel,
          this.pathScratch.x,
          this.pathScratch.y,
        );
        if (
          Math.abs(Math.abs(currentDistance) - STONE_PATH_DISTANCE_PLATEAU) <
          0.01
        ) {
          break;
        }
        if (!this.samplePathTangent(x, z, channel)) {
          break;
        }
        stepAcrossX = this.tangentScratch.z;
        stepAcrossZ = -this.tangentScratch.x;
      }
      this.field.samplePathDistances(x, z, this.pathScratch);
      currentDistance = selectPathDistance(
        channel,
        this.pathScratch.x,
        this.pathScratch.y,
      );
      const landed = Math.abs(currentDistance);
      const bandMin = clearance + footprint + 0.05;
      const bandMax = clearance + footprint + VERGE_BAND + 0.6;
      const otherDistance = selectPathDistance(
        channel === "main" ? "branch" : "main",
        this.pathScratch.x,
        this.pathScratch.y,
      );
      const otherClearance =
        channel === "main" ? branchClearance : mainClearance;
      if (
        !(landed >= bandMin && landed <= bandMax) ||
        Math.abs(otherDistance) - otherClearance - footprint < 0.05 ||
        !stoneVergeInsideSourceNeighborhood(
          centerX,
          centerZ,
          x,
          z,
          this.cellSize,
        ) ||
        !this.insideWorld(x, z)
      ) {
        continue;
      }
      const stoneHeight = this.field.sampleHeight(x, z);
      const normal = this.field.sampleNormal(x, z, this.normalScratch);
      if (normal.y < SLOPE_REJECT_NY) {
        continue;
      }
      let blocked = false;
      for (const existing of instances) {
        const offsetX = existing.x - x;
        const offsetZ = existing.z - z;
        const existingFootprint =
          this.getInstanceVariant(existing).metrics.footprintRadius *
          existing.scale;
        const minimum = (existingFootprint + footprint) * 0.85 + 0.2;
        if (offsetX * offsetX + offsetZ * offsetZ < minimum * minimum) {
          blocked = true;
          break;
        }
      }
      if (blocked) {
        continue;
      }
      const biomeSample = sampleGrassBiome(x, z);
      const biomeIndex = Math.min(
        pickGrassBiomeIndex(x, z, biomeSample),
        BIOME_PALETTE.length - 1,
      );
      const alongAngle = Math.atan2(alongTangentZ, alongTangentX);
      const moss = Math.min(
        MAX_ENVIRONMENT_MOSS,
        clamp01(
          stoneMossBase(
            stoneHeight,
            biomeIndex,
            ecology.rockiness,
            this.config.grassMinAltitude,
            this.config.grassMaxAltitude,
          ) * attempt.fork("moss").range(0.94, 1.06),
        ),
      );
      instances.push(
        this.createInstance(
          x,
          z,
          stoneHeight,
          normal,
          archetype,
          variantIndex,
          scale,
          alongAngle + attempt.signed(0.3),
          BIOME_PALETTE[biomeIndex],
          attempt.range(0.92, 1.06),
          moss,
          variant,
        ),
      );
    }
  }

  private samplePathTangent(
    x: number,
    z: number,
    channel: StoneVergePathChannel,
  ): boolean {
    const step = 0.6;
    this.field.samplePathDistances(x + step, z, this.pathScratch);
    const east = selectPathDistance(
      channel,
      this.pathScratch.x,
      this.pathScratch.y,
    );
    this.field.samplePathDistances(x - step, z, this.pathScratch);
    const west = selectPathDistance(
      channel,
      this.pathScratch.x,
      this.pathScratch.y,
    );
    this.field.samplePathDistances(x, z + step, this.pathScratch);
    const north = selectPathDistance(
      channel,
      this.pathScratch.x,
      this.pathScratch.y,
    );
    this.field.samplePathDistances(x, z - step, this.pathScratch);
    const south = selectPathDistance(
      channel,
      this.pathScratch.x,
      this.pathScratch.y,
    );
    const gradientX = (east - west) / (2 * step);
    const gradientZ = (north - south) / (2 * step);
    const length = Math.hypot(gradientX, gradientZ);
    if (!(length > 1e-4)) {
      return false;
    }
    this.tangentScratch.x = -gradientZ / length;
    this.tangentScratch.z = gradientX / length;
    return true;
  }

  private samplePlacement(
    x: number,
    z: number,
    archetype: StoneArchetypeId,
    variantIndex: number,
    scale: number,
    fragment: StoneFragmentId = "whole",
  ):
    | {
        height: number;
        normal: THREE.Vector3;
        footprint: number;
        variant: StoneMeshData;
      }
    | undefined {
    const height = this.field.sampleHeight(x, z);
    const normal = this.field.sampleNormal(x, z, this.normalScratch);
    if (normal.y < SLOPE_REJECT_NY) {
      return undefined;
    }
    const variant = this.getVariant(archetype, variantIndex, false, fragment);
    // A fragment placed here may still be rejoined into the whole body if its
    // sibling fails to stand, and centring each piece on its own contact
    // polygon means neither radius bounds the other. Clearing both keeps that
    // reversal from putting stone through a path it was never checked against.
    const footprint =
      Math.max(
        variant.metrics.footprintRadius,
        fragment === "whole"
          ? 0
          : this.getVariant(archetype, variantIndex).metrics.footprintRadius,
      ) * scale;
    return { height, normal, footprint, variant };
  }

  private pathBlocks(
    x: number,
    z: number,
    height: number,
    scale: number,
    footprint: number,
  ): boolean {
    const visibility = this.field.samplePathVisibility(height);
    if (visibility <= 0.05) {
      return false;
    }
    const distances = this.field.samplePathDistances(x, z, this.pathScratch);
    if (
      scale >= CLEAR_SCALE_CUTOFF &&
      this.field.resolvePathGrassMask(distances, height, 0) <= 0.35
    ) {
      return true;
    }
    const mainClear =
      this.config.pathWidth * 0.5 +
      this.config.pathEdgeRoughness +
      this.config.pathGrassClearance;
    const branchClear =
      this.config.pathBranchWidth * 0.5 +
      this.config.pathEdgeRoughness +
      this.config.pathGrassClearance;
    const mainMargin = Math.abs(distances.x) - mainClear - footprint;
    const branchMargin = Math.abs(distances.y) - branchClear - footprint;
    return Math.min(mainMargin, branchMargin) < 0.35;
  }

  private findOverlap(
    x: number,
    z: number,
    footprint: number,
    accepted: readonly AcceptedMember[],
  ): { member: AcceptedMember; distance: number; minimum: number } | undefined {
    for (const existing of accepted) {
      const offsetX = x - existing.instance.x;
      const offsetZ = z - existing.instance.z;
      const distance = Math.hypot(offsetX, offsetZ);
      const minimum =
        OVERLAP_FOOTPRINT_FACTOR * (footprint + existing.footprintRadius) +
        OVERLAP_PADDING;
      if (distance < minimum) {
        return { member: existing, distance, minimum };
      }
    }
    return undefined;
  }

  private overlapsAny(
    x: number,
    z: number,
    footprint: number,
    accepted: readonly AcceptedMember[],
  ): boolean {
    return this.findOverlap(x, z, footprint, accepted) !== undefined;
  }

  private pushOutward(
    descriptor: StoneClusterDescriptor,
    spec: StoneClusterMemberSpec,
    x: number,
    z: number,
    existing: AcceptedMember,
    footprint: number,
  ): { x: number; z: number } | undefined {
    const radial = clusterRadialWorld(
      descriptor.direction,
      descriptor.majorRadius,
      descriptor.minorRadius,
      spec.localU,
      spec.localV,
    );
    return resolveOverlapPush(
      x,
      z,
      existing.instance.x,
      existing.instance.z,
      footprint,
      existing.footprintRadius,
      radial.x,
      radial.z,
      Math.cos(descriptor.direction),
      Math.sin(descriptor.direction),
    );
  }

  private createInstance(
    x: number,
    z: number,
    height: number,
    normal: THREE.Vector3,
    archetype: StoneArchetypeId,
    variantIndex: number,
    scale: number,
    bearing: number,
    paletteKey: StonePaletteKey,
    valueScale: number,
    moss: number,
    variant: StoneMeshData,
    role: StoneClusterRole = "debris",
    fragment: StoneFragmentId = "whole",
    weatheringBias = 0,
  ): StoneInstance {
    const graniteBlend = smoothstep(
      height,
      this.config.grassMaxAltitude - 35,
      this.config.grassMaxAltitude + 30,
    );
    // Both halves of a mated body must use the parent's embed transform. If the
    // fragment's own clipped height or secondary role changed the sink, the
    // break would shear vertically even though height, normal, scale and yaw
    // are shared. Rejoining the anchor also stays transform-continuous this way.
    const sinkVariant =
      fragment === "whole" ? variant : this.getVariant(archetype, variantIndex);
    const sinkRole: StoneClusterRole = fragment === "whole" ? role : "anchor";
    const embedMultiplier =
      archetype === "pebble" && sinkRole === "debris"
        ? 1.25
        : sinkRole === "anchor"
          ? 1.08
          : sinkRole === "secondary"
            ? 1.03
            : 1;
    const sink =
      sinkVariant.metrics.embed *
        sinkVariant.metrics.height *
        scale *
        embedMultiplier +
      (1 - normal.y) * 0.55 * scale;
    const contact = variant.metrics.contactRadius * scale;
    let clearRadius = 0;
    if (scale >= CLEAR_SCALE_CUTOFF) {
      if (role === "anchor") {
        clearRadius = contact * 0.88 + 0.08;
      } else if (role === "secondary") {
        clearRadius = contact * 0.72 + 0.06;
      } else if (!(role === "debris" && scale < 0.7)) {
        clearRadius = contact * 0.45;
      }
    }
    const tiltStrength =
      archetype === "pebble"
        ? 0.85
        : archetype === "shard"
          ? 0.22
          : archetype === "outcrop" || archetype === "slab"
            ? 0.65
            : 0.45;
    return {
      x,
      z,
      height,
      sink,
      wetness: this.resolveWetness(x, z, height),
      rotationY: resolveStoneYaw(bearing, variant.metrics.fractureAzimuth),
      scale,
      archetype,
      variantIndex,
      fragment,
      paletteKey,
      graniteBlend,
      valueScale,
      weatheringBias,
      moss,
      normalX: normal.x,
      normalY: normal.y,
      normalZ: normal.z,
      tiltStrength,
      clearRadius,
      occlusionRadius: resolveStoneOcclusionRadius(
        variant.metrics.footprintRadius * scale,
        variant.metrics.height * scale,
      ),
    };
  }

  /**
   * Wetness under one root.
   *
   * Sampled per stone rather than per cluster: a formation at a bank can have
   * its anchor in the channel and its debris three metres up the slope, and one
   * shared value would either dry the stone standing in the river or wet the
   * one in the grass.
   */
  private resolveWetness(x: number, z: number, height: number): StoneWetness {
    const hydrology = this.field.sampleHydrology(
      x,
      z,
      height,
      this.hydrologyScratch,
    );
    return resolveStoneWetness(hydrology, height);
  }

  private memberMoss(
    descriptor: StoneClusterDescriptor,
    spec: StoneClusterMemberSpec,
  ): number {
    return clamp01(descriptor.mossBase * descriptor.mossBias * spec.mossScale);
  }

  private insideWorld(x: number, z: number): boolean {
    const limit = this.config.worldSize * 0.5 - 2;
    return Math.abs(x) <= limit && Math.abs(z) <= limit;
  }

  private insideInfluence(
    descriptor: StoneClusterDescriptor,
    x: number,
    z: number,
  ): boolean {
    return clusterPointInsideInfluence(
      descriptor.centerX,
      descriptor.centerZ,
      descriptor.influenceRadius,
      x,
      z,
    );
  }
}
