/**
 * Stone palettes and the tone→colour ramp.
 *
 * Stone paint and biological growth are resolved separately. The base mesh
 * keeps broad value variation while the shared stone shader applies moss and
 * lichen masks, so close-range colony breakup can reveal the original stone.
 */

import { STONE_CONTACT_OCCLUSION } from "./StoneContactOcclusion";
import {
  STONE_BOUNCE_STRENGTH,
  STONE_MINERAL_COLOR_STRENGTH,
  STONE_WEATHERING_COLOR_STRENGTH,
} from "./StoneGeometryTuning";
import { applyStoneGeologyWeathering } from "./StoneGeology";

export interface StoneLinearColor {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

export interface StonePalette {
  readonly key: string;
  readonly shadow: StoneLinearColor;
  readonly mid: StoneLinearColor;
  readonly light: StoneLinearColor;
  readonly edge: StoneLinearColor;
  readonly moss: StoneLinearColor;
  readonly lichen: StoneLinearColor;
  readonly edgeStrength: number;
  /**
   * Pale mineral, iron-rich mineral/weathering, and the warm dark that fills
   * cracks. Mineral zoning and weathering use the same physically compatible
   * endpoints but are independent signals.
   */
  readonly crust: StoneLinearColor;
  readonly stain: StoneLinearColor;
  readonly cavity: StoneLinearColor;
  /** How readily this rock loses its staining. Damp families keep theirs. */
  readonly crustStrength: number;
}

export interface StoneGrowthColors {
  readonly moss: StoneLinearColor;
  readonly lichen: StoneLinearColor;
}

function srgbChannelToLinear(channel: number): number {
  return channel <= 0.04045
    ? channel / 12.92
    : Math.pow((channel + 0.055) / 1.055, 2.4);
}

export function linearFromHex(hex: string): StoneLinearColor {
  const value = parseInt(hex.slice(1), 16);
  return {
    r: srgbChannelToLinear(((value >> 16) & 0xff) / 255),
    g: srgbChannelToLinear(((value >> 8) & 0xff) / 255),
    b: srgbChannelToLinear((value & 0xff) / 255),
  };
}

function palette(
  key: string,
  shadow: string,
  mid: string,
  light: string,
  edge: string,
  moss: string,
  lichen: string,
  edgeStrength: number,
  crust: string,
  stain: string,
  cavity: string,
  crustStrength: number,
): StonePalette {
  return {
    key,
    shadow: linearFromHex(shadow),
    mid: linearFromHex(mid),
    light: linearFromHex(light),
    edge: linearFromHex(edge),
    moss: linearFromHex(moss),
    lichen: linearFromHex(lichen),
    edgeStrength,
    crust: linearFromHex(crust),
    stain: linearFromHex(stain),
    cavity: linearFromHex(cavity),
    crustStrength,
  };
}

/**
 * Warm mineral ramps calibrated under the world's Neutral tone mapping and
 * exposure. Direct sun supplies the bright crown; the albedo itself stays
 * restrained so top faces do not burn to cream while the sides retain a warm
 * tan/brown mineral identity instead of inheriting the meadow's green cast.
 *
 * `crust` and `stain` serve two independent processes. The low-frequency
 * mineral field moves broad regions toward those geological endpoints, while
 * weathering only nudges the result according to exposure, age and contact.
 */
export const STONE_PALETTES = {
  meadowSage: palette(
    "meadow-sage",
    "#47352b",
    "#745844",
    "#957c5f",
    "#a98d6e",
    "#4f633e",
    "#9d9a75",
    0.56,
    "#aa9275",
    "#7a4930",
    "#35271f",
    0.54,
  ),
  steppeTan: palette(
    "steppe-tan",
    "#423329",
    "#6c513e",
    "#997655",
    "#ad8866",
    "#666a43",
    "#b4aa74",
    0.58,
    "#b99c79",
    "#754832",
    "#33251d",
    0.66,
  ),
  graniteGrey: palette(
    "granite-grey",
    "#393837",
    "#5d5954",
    "#837a6d",
    "#998e7f",
    "#536844",
    "#a3a486",
    0.62,
    "#aea18f",
    "#6f503e",
    "#2e2925",
    0.62,
  ),
  mossy: palette(
    "mossy",
    "#383b35",
    "#52574b",
    "#6b6c5a",
    "#7d7c69",
    "#50683f",
    "#878f69",
    0.52,
    "#857e6c",
    "#5d4432",
    "#29231d",
    0.38,
  ),
} as const;

export type StonePaletteKey = keyof typeof STONE_PALETTES;

export interface StoneTintParams {
  readonly valueScale: number;
  readonly secondary?: StonePalette;
  readonly secondaryBlend?: number;
  /** Formation-wide aging bias, signed around zero. */
  readonly weatheringBias?: number;
}

/** Warm reflected light from soil and neighbouring mineral faces. */
const GROUND_BOUNCE = linearFromHex("#936447");
const GROUND_BOUNCE_WORLD_BLEND = 0.5;

/** A trace of value stepping preserves the stylized read without contour bands. */
const RAMP_BANDING_STRENGTH = 0.08;

function mixChannel(a: number, b: number, amount: number): number {
  return a + (b - a) * amount;
}

function mixColor(
  primary: StoneLinearColor,
  secondary: StoneLinearColor,
  amount: number,
): StoneLinearColor {
  return {
    r: mixChannel(primary.r, secondary.r, amount),
    g: mixChannel(primary.g, secondary.g, amount),
    b: mixChannel(primary.b, secondary.b, amount),
  };
}

export function resolveStoneGrowthColors(
  paletteColors: StonePalette,
  tint: StoneTintParams,
): StoneGrowthColors {
  const secondary = tint.secondary;
  const blend = tint.secondaryBlend ?? 0;
  if (!secondary || blend <= 0) {
    return { moss: paletteColors.moss, lichen: paletteColors.lichen };
  }
  return {
    moss: mixColor(paletteColors.moss, secondary.moss, blend),
    lichen: mixColor(paletteColors.lichen, secondary.lichen, blend),
  };
}

/** Allocation-free stone material colour resolution for chunk-build hot paths. */
export function colorizeStoneVertices(
  tones: Float32Array,
  wears: Float32Array,
  bounces: Float32Array,
  minerals: Float32Array,
  weatherings: Float32Array,
  cavities: Float32Array,
  contacts: Float32Array | undefined,
  paletteColors: StonePalette,
  tint: StoneTintParams,
  target: Float32Array | Uint8Array,
  targetOffset = 0,
  targetScale = 1,
  targetStride = 3,
): void {
  const secondary = tint.secondary;
  const blend = tint.secondaryBlend ?? 0;
  const hasSecondary = secondary !== undefined && blend > 0;
  const valueScale = tint.valueScale * targetScale;
  const weatheringBias = tint.weatheringBias ?? 0;

  for (let index = 0; index < tones.length; index += 1) {
    const tone = tones[index];
    const quantized = Math.round(tone * 3) / 3;
    const banded = tone + (quantized - tone) * RAMP_BANDING_STRENGTH;

    let r: number;
    let g: number;
    let b: number;
    let r2 = 0;
    let g2 = 0;
    let b2 = 0;

    if (banded < 0.5) {
      const amount = banded * 2;
      r = mixChannel(paletteColors.shadow.r, paletteColors.mid.r, amount);
      g = mixChannel(paletteColors.shadow.g, paletteColors.mid.g, amount);
      b = mixChannel(paletteColors.shadow.b, paletteColors.mid.b, amount);
      if (hasSecondary) {
        r2 = mixChannel(secondary.shadow.r, secondary.mid.r, amount);
        g2 = mixChannel(secondary.shadow.g, secondary.mid.g, amount);
        b2 = mixChannel(secondary.shadow.b, secondary.mid.b, amount);
      }
    } else {
      const amount = (banded - 0.5) * 2;
      r = mixChannel(paletteColors.mid.r, paletteColors.light.r, amount);
      g = mixChannel(paletteColors.mid.g, paletteColors.light.g, amount);
      b = mixChannel(paletteColors.mid.b, paletteColors.light.b, amount);
      if (hasSecondary) {
        r2 = mixChannel(secondary.mid.r, secondary.light.r, amount);
        g2 = mixChannel(secondary.mid.g, secondary.light.g, amount);
        b2 = mixChannel(secondary.mid.b, secondary.light.b, amount);
      }
    }

    let edgeR = paletteColors.edge.r;
    let edgeG = paletteColors.edge.g;
    let edgeB = paletteColors.edge.b;
    let edgeStrength = paletteColors.edgeStrength;
    let crustR = paletteColors.crust.r;
    let crustG = paletteColors.crust.g;
    let crustB = paletteColors.crust.b;
    let crustStrength = paletteColors.crustStrength;
    let stainR = paletteColors.stain.r;
    let stainG = paletteColors.stain.g;
    let stainB = paletteColors.stain.b;
    let cavityR = paletteColors.cavity.r;
    let cavityG = paletteColors.cavity.g;
    let cavityB = paletteColors.cavity.b;
    if (hasSecondary) {
      crustR = mixChannel(crustR, secondary.crust.r, blend);
      crustG = mixChannel(crustG, secondary.crust.g, blend);
      crustB = mixChannel(crustB, secondary.crust.b, blend);
      crustStrength = mixChannel(crustStrength, secondary.crustStrength, blend);
      stainR = mixChannel(stainR, secondary.stain.r, blend);
      stainG = mixChannel(stainG, secondary.stain.g, blend);
      stainB = mixChannel(stainB, secondary.stain.b, blend);
      cavityR = mixChannel(cavityR, secondary.cavity.r, blend);
      cavityG = mixChannel(cavityG, secondary.cavity.g, blend);
      cavityB = mixChannel(cavityB, secondary.cavity.b, blend);
      r = mixChannel(r, r2, blend);
      g = mixChannel(g, g2, blend);
      b = mixChannel(b, b2, blend);
      edgeR = mixChannel(edgeR, secondary.edge.r, blend);
      edgeG = mixChannel(edgeG, secondary.edge.g, blend);
      edgeB = mixChannel(edgeB, secondary.edge.b, blend);
      edgeStrength = mixChannel(edgeStrength, secondary.edgeStrength, blend);
    }

    // Geological identity first. It crosses faces and does not know height,
    // exposure or soil contact, so the stone cannot collapse back into bands.
    const mineral =
      (minerals[index] - 0.5) * 2 * STONE_MINERAL_COLOR_STRENGTH;
    if (mineral > 0) {
      r = mixChannel(r, crustR, mineral);
      g = mixChannel(g, crustG, mineral);
      b = mixChannel(b, crustB, mineral);
    } else if (mineral < 0) {
      const iron = -mineral;
      r = mixChannel(r, stainR, iron);
      g = mixChannel(g, stainG, iron);
      b = mixChannel(b, stainB, iron);
    }

    // Weathering sits on top of geology and remains deliberately weaker.
    const weatheringValue = applyStoneGeologyWeathering(
      weatherings[index],
      weatheringBias,
    );
    const weathering =
      (weatheringValue - 0.5) *
      2 *
      crustStrength *
      STONE_WEATHERING_COLOR_STRENGTH;
    if (weathering > 0) {
      r = mixChannel(r, crustR, weathering);
      g = mixChannel(g, crustG, weathering);
      b = mixChannel(b, crustB, weathering);
    } else if (weathering < 0) {
      const stain = -weathering;
      r = mixChannel(r, stainR, stain);
      g = mixChannel(g, stainG, stain);
      b = mixChannel(b, stainB, stain);
    }

    const cavity = cavities[index];
    if (cavity > 0) {
      r = mixChannel(r, cavityR, cavity);
      g = mixChannel(g, cavityG, cavity);
      b = mixChannel(b, cavityB, cavity);
    }

    const wear = wears[index] * edgeStrength;
    if (wear > 0) {
      r = mixChannel(r, edgeR, wear);
      g = mixChannel(g, edgeG, wear);
      b = mixChannel(b, edgeB, wear);
    }

    const bounce = bounces[index] * STONE_BOUNCE_STRENGTH;
    if (bounce > 0) {
      const bounceR = mixChannel(stainR, GROUND_BOUNCE.r, GROUND_BOUNCE_WORLD_BLEND);
      const bounceG = mixChannel(stainG, GROUND_BOUNCE.g, GROUND_BOUNCE_WORLD_BLEND);
      const bounceB = mixChannel(stainB, GROUND_BOUNCE.b, GROUND_BOUNCE_WORLD_BLEND);
      r = mixChannel(r, bounceR, bounce);
      g = mixChannel(g, bounceG, bounce);
      b = mixChannel(b, bounceB, bounce);
    }

    const contact = contacts ? contacts[index] * STONE_CONTACT_OCCLUSION : 0;
    if (contact > 0) {
      r = mixChannel(r, cavityR, contact);
      g = mixChannel(g, cavityG, contact);
      b = mixChannel(b, cavityB, contact);
    }

    const offset = targetOffset + index * targetStride;
    target[offset] = r * valueScale;
    target[offset + 1] = g * valueScale;
    target[offset + 2] = b * valueScale;
  }
}
