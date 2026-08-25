import type * as THREE from "three";
import type { WorldConfig } from "../WorldConfig";
import type { StoneMeshData } from "./StoneGeometry";
import type { StoneField, StoneInstance } from "./StoneField";
import { StoneRenderInstanceWriter } from "./StoneRenderInstanceWriter";
import {
  createStoneRenderBuffers,
  createStoneRenderGeometry,
  type StoneRenderBuffers,
} from "./StoneRenderPacking";

export interface StoneRenderBatchSource {
  readonly chunkX: number;
  readonly chunkZ: number;
  readonly detailed: boolean;
}

export interface StoneRenderBatchGeometry {
  readonly geometry: THREE.BufferGeometry;
  readonly triangles: number;
  readonly stones: number;
  readonly hasDetailedGeometry: boolean;
  readonly originX: number;
  readonly originY: number;
  readonly originZ: number;
}

type BuildStage = "collect" | "resolve" | "allocate" | "fill" | "finalize";

export interface StoneRenderBatchBuildJob {
  readonly sources: readonly StoneRenderBatchSource[];
  readonly instances: StoneInstance[];
  readonly detailed: boolean[];
  readonly variants: StoneMeshData[];
  readonly originX: number;
  readonly originZ: number;
  stage: BuildStage;
  sourceIndex: number;
  resolveIndex: number;
  fillIndex: number;
  vertexCount: number;
  indexCount: number;
  triangles: number;
  vertexCursor: number;
  indexCursor: number;
  hasDetailedGeometry: boolean;
  heightSum: number;
  originY: number;
  minimumX: number;
  minimumY: number;
  minimumZ: number;
  maximumX: number;
  maximumY: number;
  maximumZ: number;
  buffers?: StoneRenderBuffers;
}

export interface StoneRenderBatchBuildProgress {
  readonly complete: boolean;
  readonly result?: StoneRenderBatchGeometry;
  readonly empty?: boolean;
}

/** Deadline-sliced orchestration for one static stone render batch. */
export class StoneRenderBatchBuilder {
  private readonly chunkScratch: StoneInstance[] = [];
  private readonly writer: StoneRenderInstanceWriter;

  constructor(
    private readonly stoneField: StoneField,
    private readonly config: WorldConfig,
    mossExposureDirection: THREE.Vector3,
  ) {
    this.writer = new StoneRenderInstanceWriter(
      config,
      mossExposureDirection,
    );
  }

  begin(sources: readonly StoneRenderBatchSource[]): StoneRenderBatchBuildJob {
    let sourceCenterX = 0;
    let sourceCenterZ = 0;
    for (const source of sources) {
      sourceCenterX += source.chunkX + 0.5;
      sourceCenterZ += source.chunkZ + 0.5;
    }
    const inverseSourceCount = sources.length > 0 ? 1 / sources.length : 0;
    return {
      sources,
      instances: [],
      detailed: [],
      variants: [],
      originX: sourceCenterX * inverseSourceCount * this.config.chunkSize,
      originZ: sourceCenterZ * inverseSourceCount * this.config.chunkSize,
      stage: "collect",
      sourceIndex: 0,
      resolveIndex: 0,
      fillIndex: 0,
      vertexCount: 0,
      indexCount: 0,
      triangles: 0,
      vertexCursor: 0,
      indexCursor: 0,
      hasDetailedGeometry: false,
      heightSum: 0,
      originY: 0,
      minimumX: Number.POSITIVE_INFINITY,
      minimumY: Number.POSITIVE_INFINITY,
      minimumZ: Number.POSITIVE_INFINITY,
      maximumX: Number.NEGATIVE_INFINITY,
      maximumY: Number.NEGATIVE_INFINITY,
      maximumZ: Number.NEGATIVE_INFINITY,
    };
  }

  /** Convenience path for offline verification and probes. */
  build(
    sources: readonly StoneRenderBatchSource[],
  ): StoneRenderBatchGeometry | undefined {
    const job = this.begin(sources);
    const progress = this.advance(job, Number.POSITIVE_INFINITY);
    if (!progress.complete) {
      throw new Error("Infinite-deadline stone build did not complete.");
    }
    return progress.result;
  }

  advance(
    job: StoneRenderBatchBuildJob,
    deadline: number,
  ): StoneRenderBatchBuildProgress {
    while (
      performance.now() < deadline ||
      deadline === Number.POSITIVE_INFINITY
    ) {
      switch (job.stage) {
        case "collect":
          if (job.sourceIndex < job.sources.length) {
            this.collectSource(job, job.sources[job.sourceIndex]);
            job.sourceIndex += 1;
            continue;
          }
          if (job.instances.length === 0) {
            return { complete: true, empty: true };
          }
          job.originY = job.heightSum / job.instances.length;
          job.stage = "resolve";
          continue;

        case "resolve":
          if (job.resolveIndex < job.instances.length) {
            this.resolveVariant(job, job.resolveIndex);
            job.resolveIndex += 1;
            continue;
          }
          job.stage = "allocate";
          continue;

        case "allocate":
          job.buffers = createStoneRenderBuffers(
            job.vertexCount,
            job.indexCount,
          );
          job.stage = "fill";
          continue;

        case "fill":
          if (job.fillIndex < job.instances.length) {
            const buffers = job.buffers;
            if (!buffers) {
              throw new Error("Stone batch fill started before allocation.");
            }
            this.writer.write(
              job.instances[job.fillIndex],
              job.variants[job.fillIndex],
              buffers,
              job,
              {
                instances: job.instances,
                variants: job.variants,
                index: job.fillIndex,
              },
            );
            job.fillIndex += 1;
            continue;
          }
          job.stage = "finalize";
          continue;

        case "finalize":
          return { complete: true, result: this.finalize(job) };
      }
    }
    return { complete: false };
  }

  private collectSource(
    job: StoneRenderBatchBuildJob,
    source: StoneRenderBatchSource,
  ): void {
    const instances = this.stoneField.collectChunkInstances(
      source.chunkX,
      source.chunkZ,
      source.detailed,
      this.chunkScratch,
    );
    for (const instance of instances) {
      job.instances.push(instance);
      job.detailed.push(source.detailed);
      job.hasDetailedGeometry ||= source.detailed;
      job.heightSum += instance.height - instance.sink;
    }
  }

  private resolveVariant(job: StoneRenderBatchBuildJob, index: number): void {
    const instance = job.instances[index];
    const variant = this.stoneField.getInstanceVariant(
      instance,
      job.detailed[index],
    );
    job.variants[index] = variant;
    job.vertexCount += variant.metrics.vertexCount;
    job.indexCount += variant.indices.length;
    job.triangles += variant.metrics.triangleCount;
  }

  private finalize(job: StoneRenderBatchBuildJob): StoneRenderBatchGeometry {
    const buffers = job.buffers;
    if (
      !buffers ||
      job.vertexCursor !== job.vertexCount ||
      job.indexCursor !== job.indexCount
    ) {
      throw new Error("Stone batch finalized before all geometry was written.");
    }
    return {
      geometry: createStoneRenderGeometry(buffers, job),
      triangles: job.triangles,
      stones: job.instances.length,
      hasDetailedGeometry: job.hasDetailedGeometry,
      originX: job.originX,
      originY: job.originY,
      originZ: job.originZ,
    };
  }
}
