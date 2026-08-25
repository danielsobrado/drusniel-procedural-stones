import * as THREE from "three";

/**
 * The curve that maps rendered light to screen.
 *
 * The largest single lever on whether this world reads as the stylized
 * reference or as a washed-out photograph, and it was previously an unremarked
 * default. ACES is a film curve: it exists to make bright, saturated colour
 * behave like film stock, which it does by desaturating highlights toward white
 * and pulling midtones down. That is the correct answer for a photographic
 * renderer and the wrong one here — every vivid green in the palette arrives on
 * screen as olive, and the tip colours the grass shader works hardest to
 * produce are exactly the values ACES flattens first.
 *
 * Khronos PBR Neutral was designed for the opposite goal: it holds hue and
 * saturation through the midtones and only rolls off near clipping. The
 * stylized palette survives it, which is the whole reason the palette exists.
 */
export const WORLD_TONE_MAPPING = THREE.NeutralToneMapping;

export const WORLD_DEFAULT_SKY = "#b9dce8";
export const WORLD_DEFAULT_FOG = "#bdced0";
export const WORLD_DEFAULT_HEMISPHERE_SKY = "#c5e0ed";
export const WORLD_DEFAULT_HEMISPHERE_GROUND = "#7b7f3f";
export const WORLD_DEFAULT_SUN = "#fff0c0";
/**
 * Key and fill, set against each other rather than tuned in isolation.
 *
 * The reference look is a high-key sunlit meadow, and what makes it read that
 * way is not brightness — it is the *ratio*. A strong sun against a weak fill
 * gives cast shadows real weight, which is what lets a rock, a tuft, or a
 * character sit in the grass instead of hovering over it. Lifting both together
 * produces a bright picture with no shadows in it, which reads as overcast no
 * matter how high the numbers go.
 */
export const WORLD_DEFAULT_SUN_INTENSITY = 4.15;
export const WORLD_DEFAULT_HEMISPHERE_INTENSITY = 0.34;
export const WORLD_DEFAULT_DESKTOP_FOG_DENSITY = 0.0028;
export const WORLD_DEFAULT_COMPACT_FOG_DENSITY = 0.0036;
export const WORLD_DEFAULT_EXPOSURE = 1.38;
export const WORLD_OVERCAST_FOG = "#b9c8c7";
export const WORLD_OVERCAST_HEMISPHERE_SKY = "#b8c7d0";
export const WORLD_OVERCAST_HEMISPHERE_GROUND = "#728078";
export const WORLD_OVERCAST_SUN = "#f4f1ea";
export const WORLD_OVERCAST_FOG_DENSITY_SCALE = 1.08;
export const WORLD_OVERCAST_EXPOSURE_SCALE = 0.96;
export const WORLD_SKY_ZENITH = "#8fc9ec";
export const WORLD_SKY_HORIZON = "#d7e1d1";
export const WORLD_SKY_HAZE = "#c5d3cc";
export const WORLD_SKY_SUN = "#fff1bf";
export const WORLD_ZELDA_SKY = WORLD_DEFAULT_SKY;
export const WORLD_ZELDA_FOG = WORLD_DEFAULT_FOG;
export const WORLD_ZELDA_HEMISPHERE_GROUND = WORLD_DEFAULT_HEMISPHERE_GROUND;
export const WORLD_ZELDA_SUN = WORLD_DEFAULT_SUN;
export const WORLD_ZELDA_HEMISPHERE_INTENSITY = WORLD_DEFAULT_HEMISPHERE_INTENSITY;
export const WORLD_ZELDA_FOG_DENSITY = WORLD_DEFAULT_DESKTOP_FOG_DENSITY;
export const WORLD_ZELDA_EXPOSURE = WORLD_DEFAULT_EXPOSURE;
export const WORLD_SUN_SHADOW_DISTANCE = 200;
export const WORLD_SUN_SHADOW_HALF_EXTENT = 8;
export const WORLD_SUN_DIRECTION = [350, 500, 220] as const;
