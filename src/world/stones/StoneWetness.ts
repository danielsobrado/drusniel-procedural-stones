import type { HydrologySample } from "../hydrology/HydrologyField";

/**
 * How wet a stone is, and where the hydrologic waterline sits on it.
 *
 * `waterlineY` is the actual water surface used by scouring and splash-zone
 * growth. `topY` is deliberately different: it is the top of visible wetting
 * after splash and waterfall spray climb are added. Keeping those semantics
 * separate prevents spray from moving the geological waterline up the rock.
 */
export interface StoneWetness {
  /** Peak wetness of this body: 0 dry, 1 running with water. */
  readonly strength: number;
  /** Actual hydrologic water surface used by scouring and splash growth. */
  readonly waterlineY: number;
  /** World height up to which the body is visibly wetted. */
  readonly topY: number;
}

export const STONE_WETNESS_DRY: StoneWetness = Object.freeze({
  strength: 0,
  waterlineY: 0,
  topY: 0,
});

/**
 * Where the terrain's own wet band begins. `waterProximity` is a humidity halo
 * reaching tens of metres, which is right for deciding what grows and far too
 * wide for what glistens; only the top of that ramp is ground the water has
 * actually touched.
 */
const SHORE_PROXIMITY_START = 0.94;
/** Spray carries further than splash, so it opens earlier on the same ramp. */
const SPRAY_PROXIMITY_START = 0.86;
/** Metres of splash above the wetted ground or water surface. */
const SPLASH_HEIGHT = 0.34;
/** A fall of this drop soaks everything around its plunge pool. */
const SPRAY_REFERENCE_DROP = 3;
/** Extra metres of body the spray of a full-sized fall keeps wet. */
const SPRAY_CLIMB = 1.6;
/** Vertical softness of the visible wet edge. */
const WATERLINE_BAND = 0.18;

/** Metres above the waterline that splash keeps damp enough to favour moss. */
const WATERLINE_MOSS_CLIMB = 0.55;
/** Peak susceptibility the damp band adds, and what scouring takes below it. */
const WATERLINE_MOSS_BOOST = 0.55;
const WATERLINE_MOSS_SCOUR = 0.7;

function smoothstep(value: number, minimum: number, maximum: number): number {
  if (value <= minimum) return 0;
  if (value >= maximum) return 1;
  const amount = (value - minimum) / (maximum - minimum);
  return amount * amount * (3 - 2 * amount);
}

function clamp01(value: number): number {
  return value <= 0 ? 0 : value >= 1 ? 1 : value;
}

/**
 * Resolve one stone's wetness from the hydrology under it.
 *
 * `waterLevel` is only trusted where there is water to have a level: away from
 * a channel it describes a surface that is not being drawn, and reading it
 * there would hang a waterline in dry grass. The visible wet edge starts no
 * lower than the ground under the stone, while `waterlineY` remains the actual
 * water surface for growth/scouring semantics.
 */
export function resolveStoneWetness(
  hydrology: HydrologySample,
  groundHeight: number,
): StoneWetness {
  const shore = smoothstep(hydrology.waterProximity, SHORE_PROXIMITY_START, 1);
  const spray =
    smoothstep(hydrology.waterProximity, SPRAY_PROXIMITY_START, 1) *
    clamp01(hydrology.riverFallDrop / SPRAY_REFERENCE_DROP);
  const strength = clamp01(Math.max(shore, spray));
  if (strength <= 0) {
    return STONE_WETNESS_DRY;
  }
  const hasWaterline = hydrology.waterCoverage > 0 || shore > 0;
  const waterlineY = hasWaterline ? hydrology.waterLevel : groundHeight;
  const visibleWetBase = Math.max(groundHeight, waterlineY);
  return {
    strength,
    waterlineY,
    topY: visibleWetBase + SPLASH_HEIGHT + spray * SPRAY_CLIMB,
  };
}

/**
 * Wetness at one vertex, baked at batch build so the fragment shader pays
 * nothing for the visible wet edge. Water and spray do not climb indefinitely,
 * so this is a hard-edged function of world height softened by a hand's width.
 */
export function resolveStoneVertexWetness(
  wetness: StoneWetness,
  worldY: number,
): number {
  if (wetness.strength <= 0) {
    return 0;
  }
  return (
    wetness.strength *
    (1 - smoothstep(worldY, wetness.topY - WATERLINE_BAND, wetness.topY))
  );
}

/**
 * How much the water encourages moss at world height `y` on a wetted body.
 *
 * Scouring is anchored to the real hydrologic waterline, never the top of the
 * splash/spray wet band. Below the line this returns less than nothing, which
 * suppresses the body's own susceptibility; immediately above it, splash keeps
 * a short damp band green before the rock dries. `topY` is intentionally not
 * read here: waterfall spray can raise visible wetting by metres without moving
 * the water surface by a millimetre.
 */
export function resolveStoneWaterlineMoss(
  wetness: StoneWetness,
  y: number,
): number {
  if (wetness.strength <= 0) return 0;
  const scoured =
    1 -
    smoothstep(
      y,
      wetness.waterlineY - WATERLINE_BAND,
      wetness.waterlineY,
    );
  const damp =
    smoothstep(
      y,
      wetness.waterlineY - WATERLINE_BAND,
      wetness.waterlineY,
    ) *
    (1 -
      smoothstep(
        y,
        wetness.waterlineY,
        wetness.waterlineY + WATERLINE_MOSS_CLIMB,
      ));
  return (
    wetness.strength *
    (damp * WATERLINE_MOSS_BOOST - scoured * WATERLINE_MOSS_SCOUR)
  );
}
