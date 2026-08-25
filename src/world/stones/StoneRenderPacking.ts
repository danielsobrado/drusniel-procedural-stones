import * as THREE from "three";

export interface StoneRenderBuffers {
  readonly positions: Float32Array;
  readonly packedShorts: Int16Array;
  readonly packedBytes: Uint8Array;
  readonly indices: Uint16Array | Uint32Array;
}

export interface StoneRenderBounds {
  minimumX: number;
  minimumY: number;
  minimumZ: number;
  maximumX: number;
  maximumY: number;
  maximumZ: number;
}

export const STONE_BYTE_MAX = 255;
export const STONE_UINT16_MAX = 65535;
export const STONE_INT16_NORMAL_MAX = 32767;

export const STONE_SHORT_STRIDE = 6;
export const STONE_NORMAL_OFFSET = 0;
export const STONE_GROWTH_POSITION_OFFSET = 3;
/**
 * Twelve bytes of data in a sixteen-byte stride.
 *
 * The wet channel is the thirteenth byte, weathering the fourteenth, and
 * bedding the fifteenth, inside a stride that has to be four-byte aligned
 * anyway. Three bytes of the four the alignment costs are now spent; the
 * sixteenth remains free, and the byte after it costs another four.
 */
export const STONE_BYTE_STRIDE = 16;
export const STONE_COLOR_OFFSET = 0;
export const STONE_MOSS_OFFSET = 3;
export const STONE_LICHEN_OFFSET = 4;
export const STONE_GROWTH_SEED_OFFSET = 5;
export const STONE_MOSS_COLOR_OFFSET = 6;
export const STONE_LICHEN_COLOR_OFFSET = 9;
export const STONE_WET_OFFSET = 12;
export const STONE_WEATHERING_OFFSET = 13;
export const STONE_BEDDING_OFFSET = 14;

export function packStoneUnitByte(value: number): number {
  return Math.round(Math.max(0, Math.min(1, value)) * STONE_BYTE_MAX);
}

export function packStoneSignedInt16(value: number): number {
  return Math.round(
    Math.max(-1, Math.min(1, value)) * STONE_INT16_NORMAL_MAX,
  );
}

export function createStoneRenderBuffers(
  vertexCount: number,
  indexCount: number,
): StoneRenderBuffers {
  return {
    positions: new Float32Array(vertexCount * 3),
    packedShorts: new Int16Array(vertexCount * STONE_SHORT_STRIDE),
    packedBytes: new Uint8Array(vertexCount * STONE_BYTE_STRIDE),
    indices:
      vertexCount <= STONE_UINT16_MAX
        ? new Uint16Array(indexCount)
        : new Uint32Array(indexCount),
  };
}

export function createStoneRenderGeometry(
  buffers: StoneRenderBuffers,
  bounds: StoneRenderBounds,
): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  const shortData = new THREE.InterleavedBuffer(
    buffers.packedShorts,
    STONE_SHORT_STRIDE,
  );
  const byteData = new THREE.InterleavedBuffer(
    buffers.packedBytes,
    STONE_BYTE_STRIDE,
  );

  geometry.setAttribute("position", new THREE.BufferAttribute(buffers.positions, 3));
  geometry.setAttribute(
    "normal",
    new THREE.InterleavedBufferAttribute(
      shortData,
      3,
      STONE_NORMAL_OFFSET,
      true,
    ),
  );
  geometry.setAttribute(
    "stoneGrowthPosition",
    new THREE.InterleavedBufferAttribute(
      shortData,
      3,
      STONE_GROWTH_POSITION_OFFSET,
      true,
    ),
  );
  geometry.setAttribute(
    "color",
    new THREE.InterleavedBufferAttribute(
      byteData,
      3,
      STONE_COLOR_OFFSET,
      true,
    ),
  );
  geometry.setAttribute(
    "stoneMoss",
    new THREE.InterleavedBufferAttribute(
      byteData,
      1,
      STONE_MOSS_OFFSET,
      true,
    ),
  );
  geometry.setAttribute(
    "stoneLichen",
    new THREE.InterleavedBufferAttribute(
      byteData,
      1,
      STONE_LICHEN_OFFSET,
      true,
    ),
  );
  geometry.setAttribute(
    "stoneGrowthSeed",
    new THREE.InterleavedBufferAttribute(
      byteData,
      1,
      STONE_GROWTH_SEED_OFFSET,
      true,
    ),
  );
  geometry.setAttribute(
    "stoneMossColor",
    new THREE.InterleavedBufferAttribute(
      byteData,
      3,
      STONE_MOSS_COLOR_OFFSET,
      true,
    ),
  );
  geometry.setAttribute(
    "stoneLichenColor",
    new THREE.InterleavedBufferAttribute(
      byteData,
      3,
      STONE_LICHEN_COLOR_OFFSET,
      true,
    ),
  );
  geometry.setAttribute(
    "stoneWet",
    new THREE.InterleavedBufferAttribute(
      byteData,
      1,
      STONE_WET_OFFSET,
      true,
    ),
  );
  geometry.setAttribute(
    "stoneWeathering",
    new THREE.InterleavedBufferAttribute(
      byteData,
      1,
      STONE_WEATHERING_OFFSET,
      true,
    ),
  );
  geometry.setAttribute(
    "stoneBedding",
    new THREE.InterleavedBufferAttribute(
      byteData,
      1,
      STONE_BEDDING_OFFSET,
      true,
    ),
  );
  geometry.setIndex(new THREE.BufferAttribute(buffers.indices, 1));

  const centerX = (bounds.minimumX + bounds.maximumX) * 0.5;
  const centerY = (bounds.minimumY + bounds.maximumY) * 0.5;
  const centerZ = (bounds.minimumZ + bounds.maximumZ) * 0.5;
  geometry.boundingBox = new THREE.Box3(
    new THREE.Vector3(bounds.minimumX, bounds.minimumY, bounds.minimumZ),
    new THREE.Vector3(bounds.maximumX, bounds.maximumY, bounds.maximumZ),
  );
  geometry.boundingSphere = new THREE.Sphere(
    new THREE.Vector3(centerX, centerY, centerZ),
    Math.hypot(
      bounds.maximumX - bounds.minimumX,
      bounds.maximumY - bounds.minimumY,
      bounds.maximumZ - bounds.minimumZ,
    ) * 0.5,
  );

  return geometry;
}
