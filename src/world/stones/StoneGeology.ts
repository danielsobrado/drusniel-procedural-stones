/**
 * What every stone in one formation inherits from the ground it came out of.
 *
 * A cluster already shared several things by accident of how it was composed:
 * the palette came from the biome, the fracture bearing from the macro strike,
 * the moss level from the local ecology. What it did not share was a common
 * weathering tendency. Two boulders from one outcrop have stood in the same rain
 * and soil conditions; giving one a strong bleach bias and its neighbour a
 * strong iron-stain bias reads as unrelated rocks even when their palettes match.
 *
 * This is deliberately a small descriptor rather than the full geological
 * fantasy. Fields are here only if something consumes them:
 *
 * - The mineral *pattern* cannot be shared. It is baked into vertex attributes
 *   per pooled variant, and per-cluster patterns would mean per-cluster meshes,
 *   which is the same trap the formation work avoided. What is shared instead
 *   is a signed weathering bias, folded per instance at batch build.
 * - Dip is absent for the same reason. Tilting a fracture to a formation's dip
 *   means clipping geometry per formation; the bearing can be cancelled by yaw
 *   at placement, and the tilt cannot.
 */

import { hashStoneCell } from "./StoneRandom";
import type { StonePaletteKey } from "./StonePalette";

export interface StoneGeologyDescriptor {
  /** The cluster seed every member of this formation derives from. */
  readonly formationSeed: number;
  /** Bearing the formation's joints run on, shared by every member. */
  readonly strike: number;
  readonly paletteKey: StonePaletteKey;
  /**
   * Formation-wide weathering bias, signed around 0.
   *
   * Negative moves the channel toward iron/soil stain; positive moves it toward
   * pale bleached crust. The bias is added to each body's local weathering field
   * rather than replacing it, so members keep surface variation while agreeing
   * on the formation's overall tendency.
   */
  readonly weathering: number;
}

const GEOLOGY_WEATHERING_XOR = 0x57746872;

/**
 * Maximum signed displacement from the middle of the weathering range.
 *
 * Modest on purpose. The channel already contains local exposure and contact
 * variation; a larger formation bias would stop reading as weathering and start
 * reading as a flat material tint.
 */
export const STONE_GEOLOGY_WEATHERING_RANGE = 0.16;

export function resolveStoneGeology(
  formationSeed: number,
  strike: number,
  paletteKey: StonePaletteKey,
): StoneGeologyDescriptor {
  const roll =
    hashStoneCell(formationSeed, 0, GEOLOGY_WEATHERING_XOR) / 4294967296;
  return {
    formationSeed,
    strike,
    paletteKey,
    weathering: (roll * 2 - 1) * STONE_GEOLOGY_WEATHERING_RANGE,
  };
}

/** Apply a signed formation bias to a body's normalized weathering channel. */
export function applyStoneGeologyWeathering(
  weathering: number,
  bias: number,
): number {
  const biased = weathering + bias;
  return biased <= 0 ? 0 : biased >= 1 ? 1 : biased;
}
