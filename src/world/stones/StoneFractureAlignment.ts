/**
 * Turning a variant so its fractures face where the formation wants them.
 *
 * Placement can only spin a stone about Y, and the mesh pool is shared: the
 * same six archetypes × N variants serve every cluster in the world, each
 * carrying cut planes on whatever bearing its own seed produced. Aligning
 * members by yaw alone therefore aligns their bodies and not their geology,
 * which is why a cluster built from a common strike could still read as
 * unrelated stones parked together.
 *
 * The fix is to treat the authored yaw as a *bearing the fracture should take*
 * rather than an angle to spin by, and to cancel the variant's own bearing on
 * the way in. Every member of a cluster then breaks along the same line, as
 * pieces of one parent boulder do.
 */

import type { StoneVec3 } from "./StoneClipper";
import type { WorkingStoneFace } from "./StoneMeshTopology";

/** Cut faces flatter than this carry no usable bearing. */
const FRACTURE_MINIMUM_HORIZONTAL = 0.2;
/** Total axial weight below which a body counts as unfractured. */
const FRACTURE_MINIMUM_WEIGHT = 1e-4;


/**
 * A right-handed rotation of `yaw` about +Y sends a local direction at
 * `atan2(z, x)` to `atan2(z, x) - yaw`, so the yaw that lands `fractureAzimuth`
 * on `bearing` is their difference. Bodies with no fracture report an azimuth
 * of zero and pass their authored bearing through unchanged.
 */
export function resolveStoneYaw(
  bearing: number,
  fractureAzimuth: number,
): number {
  return fractureAzimuth - bearing;
}

/**
 * Area-weighted axial mean bearing of the cut faces.
 *
 * A formation fragment's break counts here alongside ordinary cuts: it is the
 * body's dominant joint by construction, and both halves derive their bearing
 * from the same plane, so cancelling it lines the pair up on the formation's
 * strike exactly as it lines up unrelated members.
 *
 * Near-horizontal cuts are skipped rather than down-weighted to zero by their
 * horizontal component alone: a lid-like break has no bearing to contribute and
 * its numerical noise would otherwise steer a body with few real fractures. A
 * stone with no qualifying cut returns zero, which leaves its authored yaw
 * exactly as placement chose it.
 */
export function resolveStoneFractureAzimuth(faces: readonly WorkingStoneFace[]): number {
  let doubledX = 0;
  let doubledZ = 0;
  for (const face of faces) {
    if (face.role !== "cut" && face.role !== "fracture") continue;
    const horizontal = Math.hypot(face.normalX, face.normalZ);
    if (horizontal < FRACTURE_MINIMUM_HORIZONTAL) continue;
    const angle = Math.atan2(face.normalZ, face.normalX);
    const weight = polygonArea(face.points) * horizontal;
    doubledX += weight * Math.cos(2 * angle);
    doubledZ += weight * Math.sin(2 * angle);
  }
  if (Math.hypot(doubledX, doubledZ) < FRACTURE_MINIMUM_WEIGHT) {
    return 0;
  }
  return 0.5 * Math.atan2(doubledZ, doubledX);
}

function polygonArea(points: readonly StoneVec3[]): number {
  let nx = 0;
  let ny = 0;
  let nz = 0;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    nx += (current.y - next.y) * (current.z + next.z);
    ny += (current.z - next.z) * (current.x + next.x);
    nz += (current.x - next.x) * (current.y + next.y);
  }
  return Math.hypot(nx, ny, nz) * 0.5;
}
