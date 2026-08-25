/**
 * What stones do to the ground they stand in, at the ground's own resolution.
 *
 * Contact soil and contact shade deliberately keep separate owners. A squat
 * stone can own the compacted-soil band while a taller neighbour blocks more of
 * the sky at the same point; forcing both effects through one winner makes the
 * smaller radius steal the larger effect. The terrain carries both centres and
 * resolves their distances independently.
 */

import type { StoneInstance } from "./StoneField";

/**
 * The radii and centres imposed on the ground by the dominant local stones.
 */
export interface StoneGroundInfluence {
  readonly centerX: number;
  readonly centerZ: number;
  /** Ground the contact owner clears entirely; full soil inside this. */
  readonly innerClearRadius: number;
  /** Where the contact owner's soil stain has faded back to open meadow. */
  readonly contactSoilRadius: number;
  /** Outer edge of the planted band the skirt layer thickens. */
  readonly understoryBoostRadius: number;
  /** Centre of the independently selected contact-shadow owner. */
  readonly occlusionCenterX: number;
  readonly occlusionCenterZ: number;
  /** Reach of the contact shadow the occlusion owner throws onto the ground. */
  readonly occlusionRadius: number;
}

/**
 * Share of the clear radius that reads as fully disturbed soil.
 *
 * Short of the clearance edge on purpose: the outer part of a cleared disc is
 * ground the stone shades and dries rather than ground it sits on, and running
 * full soil all the way out turns a rock into a painted brown plate.
 */
const SOIL_CORE_RATIO = 0.62;

/**
 * Share of a body's height that its contact shadow reaches out across the
 * ground. Short: past roughly half a body height the stone has dropped low
 * enough in the sky that what it still blocks is not worth a darkening.
 */
const OCCLUSION_HEIGHT_REACH = 0.55;

export function createStoneGroundInfluence(): StoneGroundInfluence {
  return {
    centerX: 0,
    centerZ: 0,
    innerClearRadius: 0,
    contactSoilRadius: 0,
    understoryBoostRadius: 0,
    occlusionCenterX: 0,
    occlusionCenterZ: 0,
    occlusionRadius: 0,
  };
}

/** Mutable form, so sampling can fill one scratch value per vertex. */
export interface MutableStoneGroundInfluence {
  centerX: number;
  centerZ: number;
  innerClearRadius: number;
  contactSoilRadius: number;
  understoryBoostRadius: number;
  occlusionCenterX: number;
  occlusionCenterZ: number;
  occlusionRadius: number;
}

export function createMutableStoneGroundInfluence(): MutableStoneGroundInfluence {
  return {
    centerX: 0,
    centerZ: 0,
    innerClearRadius: 0,
    contactSoilRadius: 0,
    understoryBoostRadius: 0,
    occlusionCenterX: 0,
    occlusionCenterZ: 0,
    occlusionRadius: 0,
  };
}

/** Squared normalized contact distance; lower values dominate. */
export function scoreStoneContactInfluence(
  instance: StoneInstance,
  x: number,
  z: number,
  feather: number,
): number {
  if (!(instance.clearRadius > 0)) return Number.POSITIVE_INFINITY;
  const reach = Math.max(1e-4, instance.clearRadius + feather);
  const dx = x - instance.x;
  const dz = z - instance.z;
  return (dx * dx + dz * dz) / (reach * reach);
}

/** Squared normalized sky-occlusion distance; lower values dominate. */
export function scoreStoneOcclusionInfluence(
  instance: StoneInstance,
  x: number,
  z: number,
): number {
  if (!(instance.occlusionRadius > 0)) return Number.POSITIVE_INFINITY;
  const reach = Math.max(1e-4, instance.occlusionRadius);
  const dx = x - instance.x;
  const dz = z - instance.z;
  return (dx * dx + dz * dz) / (reach * reach);
}

/** Write only the compacted-soil owner. */
export function writeStoneContactInfluence(
  instance: StoneInstance,
  feather: number,
  skirtWidth: number,
  out: MutableStoneGroundInfluence,
): void {
  out.centerX = instance.x;
  out.centerZ = instance.z;
  out.innerClearRadius = instance.clearRadius * SOIL_CORE_RATIO;
  out.contactSoilRadius = instance.clearRadius + feather;
  out.understoryBoostRadius = instance.clearRadius + skirtWidth;
}

/** Write only the contact-shadow owner. */
export function writeStoneOcclusionInfluence(
  instance: StoneInstance,
  out: MutableStoneGroundInfluence,
): void {
  out.occlusionCenterX = instance.x;
  out.occlusionCenterZ = instance.z;
  out.occlusionRadius = instance.occlusionRadius;
}

/**
 * Convenience for callers that intentionally use one stone for both effects.
 */
export function writeStoneGroundInfluence(
  instance: StoneInstance,
  feather: number,
  skirtWidth: number,
  out: MutableStoneGroundInfluence,
): void {
  writeStoneContactInfluence(instance, feather, skirtWidth, out);
  writeStoneOcclusionInfluence(instance, out);
}

/**
 * Clears the influence to "no stone here", anchored at the sampling point.
 *
 * Anchoring both centres at the sample matters because zero-radius descriptors
 * are still interpolated by the terrain mesh. Keeping that interpolation local
 * avoids dragging inactive descriptors toward the world origin.
 */
export function clearStoneGroundInfluence(
  x: number,
  z: number,
  out: MutableStoneGroundInfluence,
): void {
  out.centerX = x;
  out.centerZ = z;
  out.innerClearRadius = 0;
  out.contactSoilRadius = 0;
  out.understoryBoostRadius = 0;
  out.occlusionCenterX = x;
  out.occlusionCenterZ = z;
  out.occlusionRadius = 0;
}

/**
 * How far a body's contact shadow reaches across the ground.
 *
 * Scaled by height rather than by footprint, because what darkens the ground is
 * the sky the body takes away, and a tall stone takes away a wedge of sky far
 * out while a flat one stops almost at its own edge. The peak is not scaled the
 * same way and is left to the shader: at the point of contact you are in the
 * angle between ground and body whatever the body is, so contact shade is close
 * to scale-invariant right at the base and only its reach really varies.
 */
export function resolveStoneOcclusionRadius(
  footprintRadius: number,
  bodyHeight: number,
): number {
  return footprintRadius + bodyHeight * OCCLUSION_HEIGHT_REACH;
}

/**
 * How strongly the contact band applies at `distance` from the stone centre.
 *
 * The terrain fragment shader mirrors this in GLSL rather than calling it --
 * there is no shared language between them -- so the two must be changed
 * together. It is stated here because probes and any CPU-side consumer need the
 * same curve, and two hand-written falloffs drift.
 */
export function resolveStoneContactBand(
  distance: number,
  innerClearRadius: number,
  contactSoilRadius: number,
): number {
  if (!(contactSoilRadius > 0)) return 0;
  if (distance <= innerClearRadius) return 1;
  if (distance >= contactSoilRadius) return 0;
  const amount =
    (distance - innerClearRadius) /
    Math.max(1e-4, contactSoilRadius - innerClearRadius);
  return 1 - amount * amount * (3 - 2 * amount);
}

/**
 * Contact shade at `distance` from the stone centre, in [0, 1].
 *
 * Squared rather than linear: the sky comes back quickly once you step out from
 * under a body, and a linear ramp reads as a painted halo, which is the failure
 * this is meant to avoid rather than repeat. Mirrored in the terrain fragment
 * shader, like the band above, and must be changed with it.
 */
export function resolveStoneContactShade(
  distance: number,
  occlusionRadius: number,
): number {
  if (!(occlusionRadius > 0)) return 0;
  if (distance >= occlusionRadius) return 0;
  const amount = distance / occlusionRadius;
  const shade = 1 - amount * amount * (3 - 2 * amount);
  return shade * shade;
}
