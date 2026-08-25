import {
  STONE_DEGENERATE_NORMAL_LENGTH,
  type StoneFacetSoftening,
} from "./StoneGeometryTuning";
import type { WorkingStoneFace } from "./StoneMeshTopology";

/**
 * Normal softening for the stone shell.
 *
 * The clipper emits one flat normal per plane, which is honest about the
 * topology and wrong about the art: the profile rings exist to approximate a
 * weathered curve, so every ring boundary reads as a manufactured crease. Here
 * each render corner averages the normals of the faces that meet at its welded
 * point, but only across breaks shallower than the dihedral limit. Fracture
 * planes, notch rims, and the ground cap stay outside that group and keep the
 * hard break they earned.
 *
 * Corners keep their own position and index, so this changes shading only —
 * silhouette, triangle count, and vertex count are identical.
 *
 * The dihedral limit and averaging strength arrive per archetype, so the same
 * ring structure can read as a weathered boulder or as a fractured shard.
 */

/** Corner records live in per-welded-point linked lists to avoid nested arrays. */
interface CornerAdjacency {
  readonly head: Int32Array;
  readonly next: Int32Array;
  readonly face: Int32Array;
  readonly weight: Float32Array;
}

export function countStoneFaceCorners(
  faces: readonly WorkingStoneFace[],
): number {
  let corners = 0;
  for (const face of faces) {
    corners += face.points.length;
  }
  return corners;
}

/**
 * Unit normals for every render corner, in the same face-then-corner order the
 * mesh packer walks.
 */
export function buildStoneSoftNormals(
  faces: readonly WorkingStoneFace[],
  softening: StoneFacetSoftening,
): Float32Array {
  const cornerCount = countStoneFaceCorners(faces);
  const softNormals = new Float32Array(cornerCount * 3);
  const adjacency = buildCornerAdjacency(faces, cornerCount);

  let corner = 0;
  for (let faceIndex = 0; faceIndex < faces.length; faceIndex += 1) {
    const face = faces[faceIndex];
    for (let index = 0; index < face.points.length; index += 1) {
      let sumX = 0;
      let sumY = 0;
      let sumZ = 0;
      for (
        let link = adjacency.head[face.shared[index]];
        link >= 0;
        link = adjacency.next[link]
      ) {
        const neighbour = faces[adjacency.face[link]];
        const alignment =
          face.normalX * neighbour.normalX +
          face.normalY * neighbour.normalY +
          face.normalZ * neighbour.normalZ;
        if (alignment < softening.cosLimit) continue;
        const weight = adjacency.weight[link];
        sumX += neighbour.normalX * weight;
        sumY += neighbour.normalY * weight;
        sumZ += neighbour.normalZ * weight;
      }

      const offset = corner * 3;
      const length = Math.hypot(sumX, sumY, sumZ);
      if (length > STONE_DEGENERATE_NORMAL_LENGTH) {
        const inverse = softening.strength / length;
        const rest = 1 - softening.strength;
        const blendedX = face.normalX * rest + sumX * inverse;
        const blendedY = face.normalY * rest + sumY * inverse;
        const blendedZ = face.normalZ * rest + sumZ * inverse;
        const blendedLength = Math.hypot(blendedX, blendedY, blendedZ);
        if (blendedLength > STONE_DEGENERATE_NORMAL_LENGTH) {
          softNormals[offset] = blendedX / blendedLength;
          softNormals[offset + 1] = blendedY / blendedLength;
          softNormals[offset + 2] = blendedZ / blendedLength;
          corner += 1;
          continue;
        }
      }
      softNormals[offset] = face.normalX;
      softNormals[offset + 1] = face.normalY;
      softNormals[offset + 2] = face.normalZ;
      corner += 1;
    }
  }
  return softNormals;
}

/**
 * The ground cap is excluded as a contributor: it is buried by the placement
 * embed, and its straight-down normal would drag the visible contact bevel
 * under the stone.
 */
function buildCornerAdjacency(
  faces: readonly WorkingStoneFace[],
  cornerCount: number,
): CornerAdjacency {
  let weldedCount = 0;
  for (const face of faces) {
    for (const shared of face.shared) {
      if (shared >= weldedCount) weldedCount = shared + 1;
    }
  }

  const head = new Int32Array(weldedCount).fill(-1);
  const next = new Int32Array(cornerCount);
  const face = new Int32Array(cornerCount);
  const weight = new Float32Array(cornerCount);

  let corner = 0;
  for (let faceIndex = 0; faceIndex < faces.length; faceIndex += 1) {
    const source = faces[faceIndex];
    const count = source.points.length;
    for (let index = 0; index < count; index += 1) {
      face[corner] = faceIndex;
      weight[corner] =
        source.role === "bottom"
          ? 0
          : cornerAngle(source, index, count);
      const welded = source.shared[index];
      next[corner] = head[welded];
      head[welded] = corner;
      corner += 1;
    }
  }
  return { head, next, face, weight };
}

/**
 * Corner angle keeps a long face from outvoting the short facets that meet it,
 * which is what a plain face-count average gets wrong on a tapered ring.
 */
function cornerAngle(
  face: WorkingStoneFace,
  index: number,
  count: number,
): number {
  const current = face.points[index];
  const previous = face.points[(index + count - 1) % count];
  const following = face.points[(index + 1) % count];
  const ax = previous.x - current.x;
  const ay = previous.y - current.y;
  const az = previous.z - current.z;
  const bx = following.x - current.x;
  const by = following.y - current.y;
  const bz = following.z - current.z;
  const lengths = Math.hypot(ax, ay, az) * Math.hypot(bx, by, bz);
  if (!(lengths > STONE_DEGENERATE_NORMAL_LENGTH)) return 0;
  const cosine = (ax * bx + ay * by + az * bz) / lengths;
  return Math.acos(Math.max(-1, Math.min(1, cosine)));
}
