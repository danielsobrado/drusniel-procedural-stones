/**
 * Tuning for the ecological field layer.
 *
 * One rule governs how these combine, and it is the reason the fields are
 * multiplied rather than summed. Adding eight roughly-independent terms drives
 * their sum toward its mean by the central limit theorem, so a summed ecology
 * ends up "moderate" almost everywhere and the landscape reads as uniform
 * procedural mush. Limiting factors instead multiply, or take a minimum: the
 * scarcest resource caps growth, which is both how vegetation actually behaves
 * and what preserves the extremes that make a landscape legible.
 */

/** Baseline moisture before any landform, water, or exposure modifier. */
export const ECOLOGY_BASE_RAINFALL = 0.46;

/**
 * Landform gathering. A hollow concentrates what falls on the slopes above it;
 * a spur sheds. Applied as a multiplier on rainfall so the difference between a
 * gully and a ridge survives even far from any mapped water.
 */
export const ECOLOGY_CURVATURE_DRY = 0.55;
export const ECOLOGY_CURVATURE_WET = 1.55;

/**
 * Slope shedding. Steep ground loses water before it can soak in, and this is
 * what keeps a ridge dry even when it stands a short distance from a river:
 * proximity supplies water, slope refuses to hold it.
 */
export const ECOLOGY_SLOPE_SHED = 0.62;

/** Sun-facing ground dries out; sheltered ground stays damp. */
export const ECOLOGY_EXPOSURE_DRY = 0.78;
export const ECOLOGY_EXPOSURE_WET = 1.16;

/** Ambient share of insolation, so a shaded face is dim rather than black. */
export const ECOLOGY_EXPOSURE_AMBIENT = 0.34;

/**
 * What a crown overhead does to the ground beneath it.
 *
 * Aspect shade and canopy shade are not the same thing and the field keeps them
 * apart deliberately. A north-facing slope is cooler but still open to the sky:
 * rain reaches it, nothing falls on it, and it grows the same meadow at lower
 * vigour. Ground under a crown is a different habitat — dim, sheltered from
 * drying wind, and continuously fed litter — which is why ferns, broadleaf
 * rosettes and moss cluster there and why sun-flowers do not. Folding canopy
 * cover into `exposure` alone would have lost that distinction and left the
 * accent layer with nothing new to key on.
 */
/** Share of direct sun a full crown takes away from the ground under it. */
export const ECOLOGY_CANOPY_EXPOSURE_LOSS = 0.72;
/**
 * Extra water a full crown's ground holds beyond what the exposure loss already
 * buys: leaf litter is a mulch, and it works on retention rather than supply.
 */
export const ECOLOGY_CANOPY_MULCH_RETENTION = 0.18;
/** Soil accumulation multiplier under a full crown; leaf fall is material
 * arriving that nothing else on the meadow receives. */
export const ECOLOGY_CANOPY_LITTER_FERTILITY = 1.42;

/**
 * How a crown's occlusion falls off across the ground.
 *
 * Two footprints, because a crown shades in two ways and they land in different
 * places: the ring directly beneath it, which is dim all day, and the cast
 * shadow offset along the sun, which is dim for part of it. Modelling only the
 * first put every fern in a perfect circle around a trunk; the offset lobe is
 * what makes the shaded ground read as a consequence of the light rather than
 * of the tree's coordinates.
 */
export const ECOLOGY_CANOPY_CROWN_SHADE = 0.94;
export const ECOLOGY_CANOPY_SHADOW_SHADE = 0.58;
/** Inner radius of each footprint, as a share of the crown radius: inside this
 * the shade is full, outside it feathers to nothing. */
export const ECOLOGY_CANOPY_CORE_RADIUS = 0.55;
/** Metres of feather past a footprint's radius. Wide, because a crown edge is
 * not a line and a hard one would print the icosahedron's silhouette on the
 * vegetation. */
export const ECOLOGY_CANOPY_SHADE_FEATHER = 1.4;

/** Weight of mapped rivers and lakes in the moisture supply. */
export const ECOLOGY_WATER_SUPPLY = 0.72;

/** Slope at which loose material stops resting on the surface. */
export const ECOLOGY_ROCK_SLOPE_START = 0.22;
export const ECOLOGY_ROCK_SLOPE_FULL = 0.62;
/** Convex ground strips its own cover and exposes what is underneath. */
export const ECOLOGY_ROCK_CONVEXITY = 0.42;
/** Fertile, moist ground buries stone under soil and litter. */
export const ECOLOGY_ROCK_SOIL_BURIAL = 0.72;

/**
 * Soil accumulates where material comes to rest: flat, concave, moist ground
 * that nothing keeps scraping bare.
 */
export const ECOLOGY_FERTILITY_MOISTURE_EXPONENT = 0.65;
export const ECOLOGY_FERTILITY_DISTURBANCE = 0.7;
/**
 * Working range of the raw accumulation product, measured across the world.
 * Stretching it here is what stops four mid-range factors multiplying into a
 * uniformly adequate soil everywhere.
 */
export const ECOLOGY_FERTILITY_FLOOR = 0.12;
export const ECOLOGY_FERTILITY_CEILING = 0.62;

/** Altitude band over which alpine thinning takes hold, as a share of the
 * configured grass altitude ceiling. */
export const ECOLOGY_ALPINE_FADE = 0.22;
