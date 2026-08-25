import * as THREE from "three";
import { disposeResources } from "../../render/ResourceDisposal";
import type { WorldConfig } from "../WorldConfig";
import {
  registerStoneClearanceField,
  type StoneClearanceRegistration,
} from "./StoneClearance";
import type { StoneField } from "./StoneField";
import {
  applyStoneCoarseSurfaceShader,
  applyStoneSurfaceShader,
} from "./StoneGrowthShader";
import {
  StoneRenderBatchBuilder,
  type StoneRenderBatchBuildJob,
  type StoneRenderBatchSource,
} from "./StoneRenderBatchBuilder";

interface StoneBatch {
  readonly key: string;
  readonly signature: string;
  readonly mesh: THREE.Mesh;
  readonly triangles: number;
  readonly stones: number;
}

interface StoneBatchRequest {
  readonly key: string;
  readonly sources: StoneRenderBatchSource[];
  distance: number;
  signature: string;
}

interface ActiveStoneBuild {
  readonly request: StoneBatchRequest;
  readonly job: StoneRenderBatchBuildJob;
}

interface StoneRuntimeResources {
  readonly detailMaterial: THREE.MeshLambertMaterial;
  readonly coarseMaterial: THREE.MeshLambertMaterial;
  readonly builder: StoneRenderBatchBuilder;
  readonly clearanceRegistration: StoneClearanceRegistration;
  readonly grainTexture?: THREE.Texture;
}

export interface StoneDiagnostics {
  /** Active render batches; retained for compatibility with existing diagnostics. */
  activeChunks: number;
  queuedChunks: number;
  stones: number;
  triangles: number;
  drawCalls: number;
  /** CPU time of the latest frame-budgeted build slice. */
  lastBuildMs: number;
  /** Highest single build-slice CPU time observed. */
  maxBuildMs: number;
}

/** Either grain term alone is reason enough to bind the shared noise texture. */
function stoneGrainEnabled(config: WorldConfig): boolean {
  return config.stoneGrainStrength > 0 || config.stoneGrainNormalStrength > 0;
}

export class WorldStoneSystem {
  private readonly batches = new Map<string, StoneBatch>();
  private readonly queue: StoneBatchRequest[] = [];
  private readonly desired = new Map<string, StoneBatchRequest>();
  /** Negative cache prevents deterministic empty batches rebuilding on every move. */
  private readonly emptySignatures = new Map<string, string>();
  private readonly detailMaterial: THREE.MeshLambertMaterial;
  private readonly coarseMaterial: THREE.MeshLambertMaterial;
  private readonly mossExposureDirection = new THREE.Vector3();
  private readonly builder: StoneRenderBatchBuilder;
  private readonly clearanceRegistration: StoneClearanceRegistration;
  private readonly coarseShaderMinimumDistance: number;
  private readonly enabled: boolean;
  private readonly grainTexture?: THREE.Texture;
  private activeBuild?: ActiveStoneBuild;
  private centerChunkX = Number.NaN;
  private centerChunkZ = Number.NaN;
  private lastBuildMs = 0;
  private maxBuildMs = 0;
  private disposed = false;

  constructor(
    private readonly scene: THREE.Scene,
    stoneField: StoneField,
    private readonly config: WorldConfig,
    private readonly compact: boolean,
    private readonly receiveShadows: boolean,
  ) {
    this.enabled = config.stonesEnabled >= 1;
    this.coarseShaderMinimumDistance = Math.max(
      config.stoneGrowthDetailStrength > 0
        ? config.stoneGrowthDetailFadeDistance
        : 0,
      stoneGrainEnabled(config) ? config.stoneGrainFadeDistance : 0,
    );

    const azimuth = THREE.MathUtils.degToRad(
      config.stoneMossExposureAzimuthDegrees,
    );
    const elevation = THREE.MathUtils.degToRad(
      config.stoneMossExposureElevationDegrees,
    );
    const horizontal = Math.cos(elevation);
    this.mossExposureDirection
      .set(
        Math.cos(azimuth) * horizontal,
        Math.sin(elevation),
        Math.sin(azimuth) * horizontal,
      )
      .normalize();

    const resources = createStoneRuntimeResources(
      stoneField,
      config,
      this.mossExposureDirection,
      this.enabled,
    );
    this.detailMaterial = resources.detailMaterial;
    this.coarseMaterial = resources.coarseMaterial;
    this.builder = resources.builder;
    this.clearanceRegistration = resources.clearanceRegistration;
    this.grainTexture = resources.grainTexture;
  }

  update(position: THREE.Vector3, buildDeadline: number): void {
    if (
      this.disposed ||
      !this.enabled ||
      !Number.isFinite(position.x) ||
      !Number.isFinite(position.y) ||
      !Number.isFinite(position.z)
    ) {
      return;
    }
    this.lastBuildMs = 0;

    const chunkX = Math.floor(position.x / this.config.chunkSize);
    const chunkZ = Math.floor(position.z / this.config.chunkSize);
    if (chunkX !== this.centerChunkX || chunkZ !== this.centerChunkZ) {
      this.centerChunkX = chunkX;
      this.centerChunkZ = chunkZ;
      this.reconcile();
    }
    this.processQueue(buildDeadline);
  }

  getDiagnostics(): StoneDiagnostics {
    let stones = 0;
    let triangles = 0;
    for (const batch of this.batches.values()) {
      stones += batch.stones;
      triangles += batch.triangles;
    }
    return {
      activeChunks: this.batches.size,
      queuedChunks: this.queue.length + (this.activeBuild ? 1 : 0),
      stones,
      triangles,
      drawCalls: this.batches.size,
      lastBuildMs: this.lastBuildMs,
      maxBuildMs: this.maxBuildMs,
    };
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.activeBuild = undefined;
    const batches = Array.from(this.batches.values());
    this.batches.clear();
    this.queue.length = 0;
    this.desired.clear();
    this.emptySignatures.clear();
    disposeResources([
      ...batches.map((batch) => ({ dispose: () => this.removeBatch(batch) })),
      this.clearanceRegistration,
      this.detailMaterial,
      this.coarseMaterial,
      this.grainTexture,
    ]);
  }

  private reconcile(): void {
    const radius = this.compact
      ? this.config.stoneRadiusCompact
      : this.config.stoneRadiusDesktop;
    const configuredDetailRadius = this.compact
      ? this.config.stoneDetailRadiusCompact
      : this.config.stoneDetailRadius;
    const detailRadius = Math.min(radius, configuredDetailRadius);
    const batchAxis = this.config.stoneRenderBatchChunksPerAxis;
    const chunkSize = this.config.chunkSize;
    const halfWorld = this.config.worldSize * 0.5;
    this.desired.clear();

    for (let dz = -radius; dz <= radius; dz += 1) {
      for (let dx = -radius; dx <= radius; dx += 1) {
        const chunkX = this.centerChunkX + dx;
        const chunkZ = this.centerChunkZ + dz;
        const originX = chunkX * chunkSize;
        const originZ = chunkZ * chunkSize;
        if (
          originX < -halfWorld ||
          originZ < -halfWorld ||
          originX + chunkSize > halfWorld ||
          originZ + chunkSize > halfWorld
        ) {
          continue;
        }

        const distance = Math.max(Math.abs(dx), Math.abs(dz));
        const batchX = Math.floor(chunkX / batchAxis);
        const batchZ = Math.floor(chunkZ / batchAxis);
        const key = `${batchX}:${batchZ}`;
        let request = this.desired.get(key);
        if (!request) {
          request = {
            key,
            sources: [],
            distance,
            signature: "",
          };
          this.desired.set(key, request);
        }
        request.distance = Math.min(request.distance, distance);
        request.sources.push({
          chunkX,
          chunkZ,
          detailed: distance <= detailRadius,
        });
      }
    }

    for (const request of this.desired.values()) {
      request.signature = request.sources
        .map(
          (source) =>
            `${source.chunkX},${source.chunkZ},${source.detailed ? 1 : 0}`,
        )
        .join(";");
    }

    for (const [key, batch] of this.batches) {
      if (!this.desired.has(key)) {
        this.removeBatch(batch);
        this.batches.delete(key);
      }
    }
    for (const key of this.emptySignatures.keys()) {
      if (!this.desired.has(key)) {
        this.emptySignatures.delete(key);
      }
    }

    if (this.activeBuild) {
      const wanted = this.desired.get(this.activeBuild.request.key);
      if (!wanted || wanted.signature !== this.activeBuild.request.signature) {
        this.activeBuild = undefined;
      }
    }

    this.queue.length = 0;
    for (const request of this.desired.values()) {
      const existing = this.batches.get(request.key);
      if (existing?.signature === request.signature) continue;
      if (this.emptySignatures.get(request.key) === request.signature) continue;
      if (
        this.activeBuild?.request.key === request.key &&
        this.activeBuild.request.signature === request.signature
      ) {
        continue;
      }
      this.queue.push(request);
    }
    this.queue.sort((left, right) => right.distance - left.distance);
  }

  private processQueue(buildDeadline: number): void {
    let completed = 0;
    while (
      completed < this.config.stoneChunksPerFrame &&
      performance.now() < buildDeadline
    ) {
      if (!this.activeBuild) {
        const request = this.takeNextRequest();
        if (!request) return;
        this.activeBuild = {
          request,
          job: this.builder.begin(request.sources),
        };
      }

      const active = this.activeBuild;
      const sliceStartedAt = performance.now();
      const progress = this.builder.advance(active.job, buildDeadline);
      const sliceMs = performance.now() - sliceStartedAt;
      this.lastBuildMs = sliceMs;
      this.maxBuildMs = Math.max(this.maxBuildMs, sliceMs);
      if (!progress.complete) return;

      const wanted = this.desired.get(active.request.key);
      if (!wanted || wanted.signature !== active.request.signature) {
        if (progress.result) {
          disposeStoneResource(progress.result.geometry, "Stale stone batch");
        }
        this.activeBuild = undefined;
        continue;
      }

      this.commitBuild(active.request, progress.result);
      this.activeBuild = undefined;
      completed += 1;
    }
  }

  private takeNextRequest(): StoneBatchRequest | undefined {
    while (this.queue.length > 0) {
      const request = this.queue.pop();
      if (!request) return undefined;
      const wanted = this.desired.get(request.key);
      if (!wanted || wanted.signature !== request.signature) continue;
      const existing = this.batches.get(request.key);
      if (existing?.signature === request.signature) continue;
      if (this.emptySignatures.get(request.key) === request.signature) continue;
      return request;
    }
    return undefined;
  }

  private commitBuild(
    request: StoneBatchRequest,
    result: ReturnType<StoneRenderBatchBuilder["build"]>,
  ): void {
    const existing = this.batches.get(request.key);
    if (!result) {
      if (existing) {
        this.removeBatch(existing);
        this.batches.delete(existing.key);
      }
      this.emptySignatures.set(request.key, request.signature);
      return;
    }

    let batch: StoneBatch | undefined;
    try {
      const useDetailMaterial =
        result.hasDetailedGeometry || !this.isCoarseShaderSafe(request);
      const mesh = new THREE.Mesh(
        result.geometry,
        useDetailMaterial ? this.detailMaterial : this.coarseMaterial,
      );
      mesh.name = `world-stones-${request.key}`;
      mesh.position.set(result.originX, result.originY, result.originZ);
      const localShadowDetail =
        this.receiveShadows && result.hasDetailedGeometry;
      mesh.castShadow = localShadowDetail;
      mesh.receiveShadow = localShadowDetail;
      mesh.matrixAutoUpdate = false;
      mesh.updateMatrix();
      sceneAddAndUpdate(this.scene, mesh);

      batch = {
        key: request.key,
        signature: request.signature,
        mesh,
        triangles: result.triangles,
        stones: result.stones,
      };
      this.batches.set(batch.key, batch);
      this.emptySignatures.delete(request.key);
    } catch (error) {
      if (batch && this.batches.get(batch.key) === batch) {
        if (existing) {
          this.batches.set(existing.key, existing);
        } else {
          this.batches.delete(batch.key);
        }
      }
      try {
        disposeResources([
          { dispose: () => batch?.mesh.removeFromParent() },
          result.geometry,
        ]);
      } catch (cleanupError) {
        console.warn(
          "[Drusniel World] Unpublished stone batch cleanup failed.",
          cleanupError,
        );
      }
      throw error;
    }

    if (existing) {
      try {
        this.removeBatch(existing);
      } catch (error) {
        console.warn(
          "[Drusniel World] Replaced stone batch cleanup failed.",
          error,
        );
      }
    }
  }

  private isCoarseShaderSafe(request: StoneBatchRequest): boolean {
    const minimumDistance =
      Math.max(0, request.distance - 1) * this.config.chunkSize;
    return minimumDistance >= this.coarseShaderMinimumDistance;
  }

  private removeBatch(batch: StoneBatch): void {
    disposeResources([
      { dispose: () => this.scene.remove(batch.mesh) },
      batch.mesh.geometry,
    ]);
  }
}

function createStoneRuntimeResources(
  stoneField: StoneField,
  config: WorldConfig,
  mossExposureDirection: THREE.Vector3,
  enabled: boolean,
): StoneRuntimeResources {
  let detailMaterial: THREE.MeshLambertMaterial | undefined;
  let coarseMaterial: THREE.MeshLambertMaterial | undefined;
  let grainTexture: THREE.Texture | undefined;
  let clearanceRegistration: StoneClearanceRegistration | undefined;
  try {
    detailMaterial = new THREE.MeshLambertMaterial({ vertexColors: true });
    detailMaterial.name = "world-stone-detail-material";
    detailMaterial.dithering = true;
    coarseMaterial = new THREE.MeshLambertMaterial({ vertexColors: true });
    coarseMaterial.name = "world-stone-coarse-material";
    coarseMaterial.dithering = false;
    const builder = new StoneRenderBatchBuilder(
      stoneField,
      config,
      mossExposureDirection,
    );

    if (enabled && stoneGrainEnabled(config)) {
      grainTexture = createGrainTexture();
    }
    if (enabled) {
      applyStoneSurfaceShader(detailMaterial, config, grainTexture);
      applyStoneCoarseSurfaceShader(coarseMaterial);
    }

    clearanceRegistration = registerStoneClearanceField(
      enabled ? stoneField : undefined,
      enabled ? config : undefined,
    );
    return {
      detailMaterial,
      coarseMaterial,
      builder,
      clearanceRegistration,
      grainTexture,
    };
  } catch (error) {
    try {
      disposeResources([
        clearanceRegistration,
        grainTexture,
        detailMaterial,
        coarseMaterial,
      ]);
    } catch (cleanupError) {
      console.warn(
        "[Drusniel World] Stone construction cleanup failed.",
        cleanupError,
      );
    }
    throw error;
  }
}

/**
 * The shared noise the grain reads, or nothing where there is no DOM to load it
 * from.
 *
 * Node-hosted verification builds the whole stone system to measure it, and
 * three's image loader reaches for `document` the moment it is asked for a
 * file. That never surfaced while the grain was switched off; it is a fail-soft
 * case rather than a test-only one, because a texture that cannot load should
 * cost the stones their grain and nothing else.
 */
function createGrainTexture(): THREE.Texture | undefined {
  if (typeof document === "undefined") {
    return undefined;
  }
  const texture = new THREE.TextureLoader().load("./perlinnoise.webp");
  texture.name = "world-stone-grain";
  texture.colorSpace = THREE.NoColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = true;
  return texture;
}

function sceneAddAndUpdate(scene: THREE.Scene, mesh: THREE.Mesh): void {
  scene.add(mesh);
  try {
    mesh.updateMatrixWorld(true);
  } catch (error) {
    mesh.removeFromParent();
    throw error;
  }
}

function disposeStoneResource(
  resource: { dispose(): void } | undefined,
  label: string,
): void {
  if (!resource) {
    return;
  }
  try {
    resource.dispose();
  } catch (error) {
    console.warn(`[Drusniel World] ${label} cleanup failed.`, error);
  }
}
