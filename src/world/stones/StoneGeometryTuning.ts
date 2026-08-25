import type { StoneArchetypeId } from "./StoneRecipe";

export const STONE_SNAP_EPSILON = 1e-3;
export const STONE_MESH_QUANTIZE = 5e-4;
export const STONE_DEGENERATE_NORMAL_LENGTH = 1e-12;
/**
 * Occlusion in the seam where the body meets the ground.
 *
 * The seam is darker but shorter than the old broad lower-body ramp: contact
 * should pin the rock to the soil for a few centimetres, not paint a belt
 * around the whole base.
 */
export const STONE_CONTACT_SHADE_FLOOR = 0.72;
export const STONE_CONTACT_SHADE_HEIGHT = 0.055;
export const STONE_MOSS_CLIMB = 0.42;

/**
 * How far up a body a concave junction carries moss, as a share of the climb
 * the open flank gets.
 *
 * Height alone makes moss a band around the foot, which is the tell that it is
 * being placed by a formula rather than growing. What actually decides is
 * shelter: a crease holds water after rain, catches litter, and stays out of
 * the sun for most of the day, so it stays green well above the line where the
 * open rock has dried out. Below one, because a sheltered ledge halfway up is
 * still drier than the ground.
 */
export const STONE_MOSS_SHELTER_REACH = 0.72;
export const STONE_MOSS_PATCH_SIZE = 0.26;
export const STONE_INDENTATION_MINIMUM_AREA = 0.035;

/**
 * Facet softening.
 *
 * The body is a convex polyhedron, so shallow profile facets can share normals,
 * but the reference look still depends on a handful of broad readable planes.
 * The default limit therefore softens edges without rounding the boulder into
 * an icosphere-like dome.
 */
export const STONE_SOFT_NORMAL_ANGLE_LIMIT = 0.78;
export const STONE_SOFT_NORMAL_COS_LIMIT = Math.cos(
  STONE_SOFT_NORMAL_ANGLE_LIMIT,
);
export const STONE_SOFT_NORMAL_STRENGTH = 0.62;

/**
 * Edge accents begin exactly where softening stops.
 *
 * Wear brightening and crease occlusion both paint an edge, so they must only
 * fire on edges the dihedral limit refused to smooth. Derived from that limit
 * rather than set beside it: an independent angle would drift into the smoothed
 * range and draw a bright line or a dark seam across a surface that no longer
 * has a visible break there.
 */
export const STONE_WEAR_ANGLE_START = STONE_SOFT_NORMAL_ANGLE_LIMIT;
export const STONE_WEAR_ANGLE_FULL = STONE_SOFT_NORMAL_ANGLE_LIMIT + 0.5;

/** Angle span over which an unsmoothed break reaches full wear brightening. */
const STONE_WEAR_ANGLE_SPAN = STONE_WEAR_ANGLE_FULL - STONE_WEAR_ANGLE_START;

/**
 * One archetype's complete facet treatment: where normals stop averaging, how
 * far they average below that, and where the edge accents that begin at the
 * same threshold reach full strength.
 */
export interface StoneFacetSoftening {
  readonly angleLimit: number;
  readonly cosLimit: number;
  readonly strength: number;
  readonly wearAngleStart: number;
  readonly wearAngleFull: number;
}

/**
 * Dihedral limit and averaging strength per archetype.
 *
 * Rounded families retain some continuity while fractured families keep the
 * planar transitions that define them. The values intentionally stop short of
 * fully smooth boulders so medium-distance silhouettes still read as sculpted.
 */
const STONE_FACET_SOFTENING_BY_ARCHETYPE: Readonly<
  Record<StoneArchetypeId, readonly [angleLimit: number, strength: number]>
> = {
  boulder: [STONE_SOFT_NORMAL_ANGLE_LIMIT, STONE_SOFT_NORMAL_STRENGTH],
  pebble: [0.8, 0.68],
  outcrop: [0.66, 0.58],
  slab: [0.54, 0.5],
  block: [0.48, 0.46],
  shard: [0.4, 0.42],
};

const STONE_FACET_SOFTENING: Readonly<
  Record<StoneArchetypeId, StoneFacetSoftening>
> = Object.freeze(
  Object.fromEntries(
    Object.entries(STONE_FACET_SOFTENING_BY_ARCHETYPE).map(
      ([archetype, [angleLimit, strength]]) => [
        archetype,
        Object.freeze({
          angleLimit,
          cosLimit: Math.cos(angleLimit),
          strength,
          wearAngleStart: angleLimit,
          wearAngleFull: angleLimit + STONE_WEAR_ANGLE_SPAN,
        }),
      ],
    ),
  ) as Record<StoneArchetypeId, StoneFacetSoftening>,
);

/** The facet treatment for one archetype. Wear angles travel with the limit. */
export function resolveStoneFacetSoftening(
  archetype: StoneArchetypeId,
): StoneFacetSoftening {
  return STONE_FACET_SOFTENING[archetype];
}
/**
 * Corner count above which a face is triangulated around its own centre.
 *
 * A corner fan routes every triangle of an n-gon through one shared corner, so
 * once corners carry differing normals that corner's value smears outward as
 * visible spokes. A centre vertex spreads the interpolation evenly for one
 * extra vertex and two extra triangles per face. Quads and triangles keep the
 * cheaper fan: their single diagonal is too short to streak.
 */
export const STONE_CENTROID_FAN_MIN_CORNERS = 5;
/** Concave dihedrals darken; keep the crease readable without drawing black lines. */
export const STONE_CREASE_SHADE = 0.24;
/** Height fraction reached by warm bounce light thrown up from the surrounding soil. */
export const STONE_BOUNCE_HEIGHT = 0.24;
export const STONE_BOUNCE_STRENGTH = 0.28;

/**
 * Value ramp driven by how far a corner faces up.
 *
 * This replaces a per-face role table. Once facets are smoothed, a role table
 * paints an albedo step onto an edge that now shades continuously, and the seam
 * is visible precisely where the softening was supposed to hide one. The corner
 * normal already carries "how exposed is this surface", is continuous wherever
 * the smoothing is, and steps only where the geometry genuinely breaks.
 */
/**
 * How much of the downward half of the exposure ramp is kept.
 *
 * `tone` picks the palette entry, so the ramp is albedo: a face is painted
 * darker for pointing down, and then the light that already knows it points
 * down darkens it again. At full range an underside lands on the palette
 * shadow while the wall above it sits mid, and the step between them draws a
 * hard horizontal line around the body -- the "dipped in paint" base. The
 * up-facing half keeps its full range, because the bright crown against a
 * shaded flank is the flat-value read this palette is built on; only the half
 * that double-counts is compressed.
 */
export const STONE_TONE_DOWNWARD_COMPRESSION = 0.42;
export const STONE_TONE_FLOOR = 0.34;
export const STONE_TONE_RANGE = 0.66;

/**
 * Broad mineral identity is independent from weathering.
 *
 * The primary/secondary fields scale with the body rather than with metres, so
 * a pebble and an outcrop both carry only a handful of large mineral regions.
 * The old face-centre tint remains deliberately weak: it breaks exact equality
 * between adjacent planes but cannot compete with the cross-facet field.
 */
export const STONE_MINERAL_PATCH_SIZE = 0.82;
export const STONE_MINERAL_TINT_STRENGTH = 0.025;
export const STONE_MINERAL_FACE_JITTER = 0.018;
export const STONE_MINERAL_REGION_PRIMARY_RATIO = 0.62;
export const STONE_MINERAL_REGION_SECONDARY_RATIO = 0.34;
export const STONE_MINERAL_COLOR_STRENGTH = 0.34;

/**
 * Weathering is a secondary surface process, not the stone's mineral identity.
 * Exposure and local noise can crust or stain a region, but neither gets enough
 * authority to redraw the body as a vertical gradient. Direct light should
 * brighten the crown; weathering should not bleach it a second time.
 */
export const STONE_WEATHERING_NOISE_STRENGTH = 0.18;
export const STONE_WEATHERING_EXPOSURE_STRENGTH = 0.08;
export const STONE_WEATHERING_COLOR_STRENGTH = 0.44;

/**
 * Crust deposition.
 *
 * The patch size is metres of blotch, chosen against the bodies rather than
 * against the noise: at a quarter-metre the cap breaks into speckle that reads
 * as texture, and at a metre a two-metre boulder gets one boundary and looks
 * dipped. The band is narrow because a wide one produces a gradient, and a
 * gradient reads as light falling on the stone rather than as a different
 * material sitting on it.
 */
export const STONE_CRUST_PATCH_SIZE = 0.34;
export const STONE_CRUST_BLOTCH = 0.58;
export const STONE_CRUST_THRESHOLD = 0.52;
export const STONE_CRUST_BAND = 0.1;
/**
 * Below this the rock is stained rather than merely unbleached.
 *
 * Set well under the crust threshold so most of a body is neither: bare stone
 * between a bleached cap and a stained foot is what gives the two ends
 * something to be read against.
 */
export const STONE_STAIN_THRESHOLD = 0.27;
/** Lower-body soil deposition, expressed as a fraction of stone height. */
export const STONE_SOIL_STAIN_HEIGHT = 0.13;
/** Maximum field bias toward stain at the buried foot. */
export const STONE_SOIL_STAIN_STRENGTH = 0.1;

/**
 * Cavity depth.
 *
 * Concave breaks carry it strongly but do not become black lines. Downward
 * faces get a smaller share because they still see reflected light from the
 * ground and neighbouring stone faces.
 */
export const STONE_CAVITY_CREASE = 0.68;
export const STONE_CAVITY_UNDERCUT = 0.22;

/**
 * Fresh fracture exposes paler stone. Safe as a per-face step because cuts are
 * steep enough that the dihedral limit already denies them smoothing, so the
 * albedo edge lands on a normal edge.
 */
export const STONE_CUT_ACCENT = 0.075;

/**
 * A formation break goes further than a weathering cut, but only a little in
 * value: the fresh-rock read is carried by the weathering channel below, and
 * doubling it up here is what turns a break into a white slab.
 */
export const STONE_FRACTURE_ACCENT = 0.08;

/**
 * How far a break is pushed toward exposed mineral in the weathering field.
 *
 * Sized by measurement rather than by eye: at this value a third of the break
 * saturates at full crust and the rest stays inside the transition band, so the
 * interior reads pale while still showing its own mineral banding. Pushed
 * higher the blotch clamps out and the break becomes one flat panel, which is
 * the failure this whole channel exists to avoid. The shell got its colour from
 * decades of weather; this surface has had none, and the difference between
 * them is the whole reason a break reads as recent.
 */
export const STONE_FRACTURE_EXPOSURE = 0.1;

/** What survives of a body's moss susceptibility on unweathered break rock. */
export const STONE_FRACTURE_MOSS = 0.2;

/**
 * Depth of the shadow that fills the slot between two mated halves, and the
 * share of body height it fades out over.
 *
 * The crack is open to the sky at the top and closed at the bottom, so the
 * darkness belongs low. Painting the whole break face dark instead would lose
 * the fresh stone that makes it a break at all.
 */
export const STONE_FRACTURE_SLOT_CAVITY = 0.32;
export const STONE_FRACTURE_SLOT_HEIGHT = 0.48;
