import type { StoneMeshData } from "./StoneGeometry";
import type { StoneInstance } from "./StoneField";

/**
 * Shade thrown by one stone onto the stone beside it.
 *
 * Every body in this system is shaded as though it were alone in the field: the
 * tone ramp, the crease occlusion and the ground bounce are all baked from one
 * mesh's own geometry. A real formation still needs a darker junction between
 * neighbouring blocks, but that junction must stay local and retain reflected
 * light rather than becoming a black stripe.
 *
 * Nothing here is per-frame. Neighbours are known at batch build, the shade is
 * folded into the same vertex colour the palette already writes, and the
 * runtime cost is zero.
 */

export interface StoneOccluder {
  x: number;
  y: number;
  z: number;
  radius: number;
  reach: number;
}

/**
 * How far past its own body a stone keeps darkening its neighbour, as a share
 * of its radius. Contact shade is tight so the broad side planes keep their own
 * warm colour instead of inheriting a grey halo from nearby stones.
 */
const OCCLUSION_REACH_RATIO = 0.34;
/** Deepest colour mix at direct stone-to-stone contact. */
export const STONE_CONTACT_OCCLUSION = 0.46;

function smoothstep(value: number, minimum: number, maximum: number): number {
  if (value <= minimum) return 0;
  if (value >= maximum) return 1;
  const amount = (value - minimum) / (maximum - minimum);
  return amount * amount * (3 - 2 * amount);
}

/**
 * The sphere a body occludes with: its footprint radius, centred a little above
 * the contact because that is where the mass actually is once the stone is sunk
 * into the terrain.
 */
function occluderOf(
  instance: StoneInstance,
  variant: StoneMeshData,
  target: StoneOccluder,
): void {
  const radius = variant.metrics.footprintRadius * instance.scale;
  target.x = instance.x;
  target.y =
    instance.height -
    instance.sink +
    variant.metrics.height * instance.scale * 0.45;
  target.z = instance.z;
  target.radius = radius;
  target.reach = radius * (1 + OCCLUSION_REACH_RATIO);
}

/**
 * Neighbours close enough to shade the stone at `index`.
 *
 * Scoped to one render batch, which is where clusters live: members are placed
 * within a macro cell and batches cover whole chunks, so a formation is almost
 * always resolved together. A member that lands across a batch seam loses the
 * shade rather than acquiring a wrong one.
 */
export function collectStoneOccluders(
  instances: readonly StoneInstance[],
  variants: readonly StoneMeshData[],
  index: number,
  scratch: StoneOccluder[],
): number {
  const subject = instances[index];
  const subjectRadius =
    variants[index].metrics.footprintRadius * subject.scale;
  let count = 0;
  for (let other = 0; other < instances.length; other += 1) {
    if (other === index) continue;
    const candidate = instances[other];
    const candidateRadius =
      variants[other].metrics.footprintRadius * candidate.scale;
    const span =
      subjectRadius + candidateRadius * (1 + OCCLUSION_REACH_RATIO);
    const offsetX = candidate.x - subject.x;
    const offsetZ = candidate.z - subject.z;
    if (offsetX * offsetX + offsetZ * offsetZ >= span * span) continue;
    let target = scratch[count];
    if (!target) {
      target = { x: 0, y: 0, z: 0, radius: 0, reach: 0 };
      scratch[count] = target;
    }
    occluderOf(candidate, variants[other], target);
    count += 1;
  }
  return count;
}

/**
 * Occlusion at one vertex: the nearest neighbour wins rather than the sum, and
 * only surfaces that face a neighbour take it. Without the facing term the far
 * side of a stone darkens as well, which reads as the stone itself being dirty
 * instead of as a junction being deep.
 */
export function resolveStoneContactOcclusion(
  occluders: readonly StoneOccluder[],
  count: number,
  x: number,
  y: number,
  z: number,
  normalX: number,
  normalY: number,
  normalZ: number,
): number {
  let occlusion = 0;
  for (let index = 0; index < count; index += 1) {
    const occluder = occluders[index];
    const deltaX = occluder.x - x;
    const deltaY = occluder.y - y;
    const deltaZ = occluder.z - z;
    const distance = Math.hypot(deltaX, deltaY, deltaZ);
    if (distance >= occluder.reach) continue;
    const proximity =
      1 - smoothstep(distance, occluder.radius, occluder.reach);
    if (proximity <= occlusion) continue;
    const inverse = distance > 1e-6 ? 1 / distance : 0;
    const facing = Math.max(
      0,
      normalX * deltaX * inverse +
        normalY * deltaY * inverse +
        normalZ * deltaZ * inverse,
    );
    const value = proximity * facing;
    if (value > occlusion) occlusion = value;
  }
  return occlusion;
}
