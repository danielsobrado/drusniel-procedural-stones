/**
 * The planted band around a stone's base.
 *
 * Clearance answers one half of how a stone meets the meadow — where grass
 * cannot grow — and on its own that is a subtraction: the field is exactly the
 * meadow it would have been, minus a disc. Real stones add as much as they
 * remove. Water runs off the body and collects at the foot, the flank shelters
 * seedlings from grazing and wind, and litter gathers where the slope breaks,
 * so the ring immediately outside the bare contact carries *more* plant life
 * than open ground, not less.
 *
 * This is the signal for that ring. It is zero inside the bare contact, peaks
 * where clearance releases the ground back to vegetation, and falls to zero
 * again a stone-sized distance further out, so the accent layer can thicken and
 * shift toward ferns and rosettes exactly along the seam.
 */

/**
 * How far past the clearance reach the planted band extends, for a stone whose
 * clearance is the reference size below. Roughly the 25–60 cm skirt a boulder
 * gathers; smaller stones scale it down rather than ringing a pebble with a
 * metre of ferns.
 */
export const STONE_SKIRT_WIDTH = 0.42;
/** Clearance radius the width above is authored against. */
const STONE_SKIRT_REFERENCE_RADIUS = 0.6;
const STONE_SKIRT_MIN_SCALE = 0.55;
const STONE_SKIRT_MAX_SCALE = 1.75;

/** Planted-band width for one stone, scaled by how much ground it clears. */
export function resolveStoneSkirtWidth(clearRadius: number): number {
  const scale = Math.min(
    STONE_SKIRT_MAX_SCALE,
    Math.max(
      STONE_SKIRT_MIN_SCALE,
      clearRadius / STONE_SKIRT_REFERENCE_RADIUS,
    ),
  );
  return STONE_SKIRT_WIDTH * scale;
}

/**
 * The band's value at `distance` from one stone's centre.
 *
 * `emergence` is the same ramp clearance uses to hand the ground back, so the
 * band cannot begin before plants are allowed at all; `decay` closes it out
 * over the skirt width. Multiplying rather than adding keeps the peak pinned to
 * the seam wherever the clearance feather happens to put it.
 */
export function resolveStoneSkirtBand(
  distance: number,
  innerRadius: number,
  reach: number,
  width: number,
): number {
  if (distance >= reach + width) return 0;
  const emergence = smoothstep(distance, innerRadius, reach);
  const decay = 1 - smoothstep(distance, reach, reach + width);
  return emergence * decay;
}

function smoothstep(value: number, minimum: number, maximum: number): number {
  if (value <= minimum) return 0;
  if (value >= maximum) return 1;
  const amount = (value - minimum) / (maximum - minimum);
  return amount * amount * (3 - 2 * amount);
}
