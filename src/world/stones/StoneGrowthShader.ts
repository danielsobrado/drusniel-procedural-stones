import * as THREE from "three";
import type { WorldConfig } from "../WorldConfig";

const VERTEX_COMMON = `
attribute float stoneWet;
varying float vStoneWet;
attribute float stoneWeathering;
varying float vStoneWeathering;
attribute float stoneBedding;
varying float vStoneBedding;
attribute float stoneMoss;
attribute float stoneLichen;
attribute float stoneGrowthSeed;
attribute vec3 stoneGrowthPosition;
attribute vec3 stoneMossColor;
attribute vec3 stoneLichenColor;
varying vec3 vStoneWorldPosition;
varying vec3 vStoneWorldNormal;
varying float vStoneMoss;
varying float vStoneLichen;
varying float vStoneGrowthSeed;
varying vec3 vStoneGrowthPosition;
varying vec3 vStoneMossColor;
varying vec3 vStoneLichenColor;
`;

const VERTEX_POSITION = `
vStoneWet = stoneWet;
vStoneWeathering = stoneWeathering;
vStoneBedding = stoneBedding;
vStoneWorldPosition = (modelMatrix * vec4(transformed, 1.0)).xyz;
vStoneWorldNormal = mat3(modelMatrix) * objectNormal;
vStoneMoss = stoneMoss;
vStoneLichen = stoneLichen;
vStoneGrowthSeed = stoneGrowthSeed;
vStoneGrowthPosition = stoneGrowthPosition;
vStoneMossColor = stoneMossColor;
vStoneLichenColor = stoneLichenColor;
`;

const COARSE_VERTEX_COMMON = `
attribute float stoneWet;
attribute float stoneMoss;
attribute float stoneLichen;
attribute vec3 stoneMossColor;
attribute vec3 stoneLichenColor;
varying float vStoneWet;
varying float vStoneMoss;
varying float vStoneLichen;
varying vec3 vStoneMossColor;
varying vec3 vStoneLichenColor;
`;

const COARSE_VERTEX_POSITION = `
vStoneWet = stoneWet;
vStoneMoss = stoneMoss;
vStoneLichen = stoneLichen;
vStoneMossColor = stoneMossColor;
vStoneLichenColor = stoneLichenColor;
`;

const COARSE_FRAGMENT_COMMON = `
uniform float uStoneWetDarken;
varying float vStoneWet;
varying float vStoneMoss;
varying float vStoneLichen;
varying vec3 vStoneMossColor;
varying vec3 vStoneLichenColor;
`;

const COARSE_COLOR = `
if ((vStoneMoss + vStoneLichen) > 0.001) {
  diffuseColor.rgb = mix(diffuseColor.rgb, vStoneLichenColor, vStoneLichen);
  diffuseColor.rgb = mix(diffuseColor.rgb, vStoneMossColor, vStoneMoss);
}
diffuseColor.rgb *= mix(1.0, uStoneWetDarken, vStoneWet);
`;

const GROWTH_FRAGMENT_COMMON = `
uniform float uStoneCrustBreakup;
varying float vStoneWeathering;
varying float vStoneBedding;
uniform float uStoneWetDarken;
uniform float uStoneWetSheenStrength;
uniform float uStoneWetSheenPower;
uniform float uStoneDrySheenStrength;
uniform float uStoneDrySheenPower;
varying float vStoneWet;
uniform float uStoneGrowthDetailStrength;
uniform float uStoneGrowthDetailScale;
uniform vec2 uStoneGrowthDetailFadeSquared;
uniform float uStoneMossStreakStrength;
varying vec3 vStoneWorldPosition;
varying vec3 vStoneWorldNormal;
varying float vStoneMoss;
varying float vStoneLichen;
varying float vStoneGrowthSeed;
varying vec3 vStoneGrowthPosition;
varying vec3 vStoneMossColor;
varying vec3 vStoneLichenColor;

float stoneGrowthHash(vec2 p) {
  vec3 p3 = fract(p.xyx * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

float stoneGrowthNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(stoneGrowthHash(i), stoneGrowthHash(i + vec2(1.0, 0.0)), u.x),
    mix(
      stoneGrowthHash(i + vec2(0.0, 1.0)),
      stoneGrowthHash(i + vec2(1.0, 1.0)),
      u.x
    ),
    u.y
  );
}

vec2 stoneGrowthProjection(vec3 position, vec3 normal) {
  vec3 axis = abs(normal);
  if (axis.y >= axis.x && axis.y >= axis.z) return position.xz;
  if (axis.x >= axis.z) return position.zy;
  return position.xy;
}

float stoneColony(vec3 point, vec3 center, float innerRadius, float outerRadius) {
  vec3 delta = point - center;
  float distanceSquared = dot(delta, delta);
  return 1.0 - smoothstep(
    innerRadius * innerRadius,
    outerRadius * outerRadius,
    distanceSquared
  );
}
`;

const GROWTH_COLOR = `
vec3 stoneCameraDelta = cameraPosition - vStoneWorldPosition;
float stoneGrowthDistanceSquared = dot(stoneCameraDelta, stoneCameraDelta);
float stoneGrowthDetailFade = 1.0 - smoothstep(
  uStoneGrowthDetailFadeSquared.x,
  uStoneGrowthDetailFadeSquared.y,
  stoneGrowthDistanceSquared
);
float stoneDetailWeight =
  clamp(uStoneGrowthDetailStrength, 0.0, 1.0) * stoneGrowthDetailFade;
vec3 stoneSurfaceNormal = normalize(vStoneWorldNormal);

// Weathering boundaries are baked per corner, so vertex interpolation can only
// ramp one across a facet, and at arm's length that reads as light falling on
// the stone rather than as crust sitting on it. Close range therefore rebuilds
// the two masks from the baked channel plus the noise the colonies already use:
// the noise wanders the boundary off the mesh, and the extra contrast arrives
// only where the eye is close enough to have noticed the facet. Everything here
// fades out on the same curve the colonies do, so the macro read this all
// exists to serve is what survives into the distance.
//
// Outside the growth branch on purpose: a bare stone with no moss and no lichen
// still has a crust, and putting this inside that branch made weathering a
// property of having colonies on it.
if (stoneDetailWeight > 0.001) {
  vec2 stoneWeatherUv =
    stoneGrowthProjection(vStoneWorldPosition, stoneSurfaceNormal) *
    uStoneGrowthDetailScale;
  float stoneWeatherNoise =
    stoneGrowthNoise(stoneWeatherUv * 1.15 + vec2(5.71, 31.43));
  float stoneWeatherField =
    vStoneWeathering +
    (stoneWeatherNoise - 0.5) * uStoneCrustBreakup;
  float stoneCrustMask = smoothstep(0.6, 0.78, stoneWeatherField);
  float stoneStainMask = 1.0 - smoothstep(0.26, 0.44, stoneWeatherField);
  diffuseColor.rgb = mix(
    diffuseColor.rgb,
    diffuseColor.rgb * vec3(1.14, 1.11, 1.0),
    stoneCrustMask * stoneDetailWeight
  );
  diffuseColor.rgb = mix(
    diffuseColor.rgb,
    diffuseColor.rgb * vec3(0.9, 0.82, 0.68),
    stoneStainMask * stoneDetailWeight
  );

  // Bedding is a broken geological accent, never a continuous contour map.
  // Two local-height partings are enough to imply sediment while a broad
  // body-space breakup field removes long horizontal rings around the mesh.
  if (vStoneBedding > 0.001) {
    float stoneBedPhase = stoneGrowthHash(
      vec2(vStoneGrowthSeed * 91.7 + 3.1, vStoneGrowthSeed * 47.3 + 8.9)
    );
    float stoneBedHeight =
      vStoneGrowthPosition.y + (stoneWeatherNoise - 0.5) * 0.055;
    float stoneBedA = 0.31 + (stoneBedPhase - 0.5) * 0.1;
    float stoneBedB = 0.66 + (0.5 - stoneBedPhase) * 0.12;
    float stoneBedDistance = min(
      abs(stoneBedHeight - stoneBedA),
      abs(stoneBedHeight - stoneBedB)
    );
    float stoneBedHalfWidth = mix(0.006, 0.011, vStoneBedding);
    float stoneBedAntialias = max(fwidth(stoneBedHeight), 0.004);
    float stoneBedSeam = 1.0 - smoothstep(
      stoneBedHalfWidth,
      stoneBedHalfWidth + stoneBedAntialias,
      stoneBedDistance
    );
    float stoneBedSide = smoothstep(
      0.16,
      0.58,
      1.0 - abs(stoneSurfaceNormal.y)
    );
    float stoneBedBreakup = smoothstep(
      0.44,
      0.68,
      stoneGrowthNoise(
        vStoneGrowthPosition.xz * 2.2 +
        vec2(vStoneGrowthSeed * 19.3, vStoneGrowthSeed * 31.7)
      )
    );
    float stoneBedMask =
      stoneBedSeam *
      stoneBedSide *
      stoneBedBreakup *
      vStoneBedding *
      stoneDetailWeight;
    diffuseColor.rgb = mix(
      diffuseColor.rgb,
      diffuseColor.rgb * vec3(0.76, 0.68, 0.58),
      stoneBedMask * 0.55
    );
  }
}

if ((vStoneMoss + vStoneLichen) > 0.001) {
  float stoneMossCoverage = vStoneMoss;
  float stoneLichenCoverage = vStoneLichen;
  float stoneMossColorVariation = 1.0;
  float stoneLichenColorVariation = 1.0;

  if (stoneDetailWeight > 0.001) {
    // Facets are smoothed across shallow breaks, so a corner's normal no longer
    // matches its neighbours and interpolation shortens the varying. Projection
    // only compares axis magnitudes and does not care, but the runoff term
    // reads the vertical component directly and would drift without this.
    vec3 stoneGrowthNormal = stoneSurfaceNormal;
    vec2 stoneGrowthOffset = vec2(
      vStoneGrowthSeed * 37.17,
      vStoneGrowthSeed * 71.93
    );
    vec2 stoneGrowthUv =
      stoneGrowthProjection(vStoneWorldPosition, stoneGrowthNormal) +
      stoneGrowthOffset;
    vec3 stoneGrowthLocalPosition = vStoneGrowthPosition;
    float stoneColonyNoise = stoneGrowthNoise(
      stoneGrowthUv * uStoneGrowthDetailScale * 0.32 + vec2(7.31, 19.17)
    );
    float stoneNoiseColonyMask = smoothstep(
      0.18,
      0.72,
      stoneColonyNoise + vStoneMoss * 0.24
    );
    vec3 stoneColonyCenterA = vec3(
      stoneGrowthHash(vec2(vStoneGrowthSeed * 17.3, 2.1)) - 0.5,
      0.06 + stoneGrowthHash(vec2(vStoneGrowthSeed * 29.7, 5.4)) * 0.26,
      stoneGrowthHash(vec2(vStoneGrowthSeed * 41.9, 8.7)) - 0.5
    ) * vec3(0.82, 1.0, 0.82);
    vec3 stoneColonyCenterB = vec3(
      stoneGrowthHash(vec2(vStoneGrowthSeed * 53.1, 11.2)) - 0.5,
      0.08 + stoneGrowthHash(vec2(vStoneGrowthSeed * 67.7, 14.6)) * 0.3,
      stoneGrowthHash(vec2(vStoneGrowthSeed * 79.3, 17.9)) - 0.5
    ) * vec3(0.9, 1.0, 0.9);
    vec3 stoneColonyCenterC = vec3(
      stoneGrowthHash(vec2(vStoneGrowthSeed * 91.7, 21.3)) - 0.5,
      0.1 + stoneGrowthHash(vec2(vStoneGrowthSeed * 103.9, 24.8)) * 0.34,
      stoneGrowthHash(vec2(vStoneGrowthSeed * 117.1, 28.2)) - 0.5
    ) * vec3(0.86, 1.0, 0.86);
    float stoneColonyDistortion = (stoneColonyNoise - 0.5) * 0.2;
    float stoneColonyInnerA = max(0.03, 0.29 - stoneColonyDistortion);
    float stoneColonyOuterA = max(stoneColonyInnerA + 0.03, 0.41 - stoneColonyDistortion);
    float stoneColonyInnerB = max(0.03, 0.26 - stoneColonyDistortion);
    float stoneColonyOuterB = max(stoneColonyInnerB + 0.03, 0.37 - stoneColonyDistortion);
    float stoneColonyInnerC = max(0.03, 0.22 - stoneColonyDistortion);
    float stoneColonyOuterC = max(stoneColonyInnerC + 0.03, 0.32 - stoneColonyDistortion);
    float stoneColonyA = stoneColony(
      stoneGrowthLocalPosition,
      stoneColonyCenterA,
      stoneColonyInnerA,
      stoneColonyOuterA
    );
    float stoneColonyB = stoneColony(
      stoneGrowthLocalPosition,
      stoneColonyCenterB,
      stoneColonyInnerB,
      stoneColonyOuterB
    );
    float stoneColonyC = stoneColony(
      stoneGrowthLocalPosition,
      stoneColonyCenterC,
      stoneColonyInnerC,
      stoneColonyOuterC
    );
    float stoneConnectedColonies = max(
      stoneColonyA,
      max(stoneColonyB, stoneColonyC)
    );
    float stoneColonyMask = max(
      stoneConnectedColonies,
      stoneNoiseColonyMask * 0.28
    );
    float stoneMossPotential = smoothstep(0.06, 0.65, vStoneMoss);
    float stonePatternedMoss = stoneMossPotential * stoneColonyMask;
    stoneMossCoverage = mix(
      vStoneMoss,
      stonePatternedMoss,
      min(0.92, stoneDetailWeight * 0.96)
    );

    float stoneLichenNoise = stoneGrowthNoise(
      stoneGrowthUv * uStoneGrowthDetailScale * 0.58 + vec2(41.73, 8.91)
    );
    float stoneLichenPattern = smoothstep(
      0.55,
      0.79,
      stoneLichenNoise
    );
    stoneLichenCoverage =
      vStoneLichen * mix(1.0, stoneLichenPattern, stoneDetailWeight);

    float stoneFineNoise = stoneGrowthNoise(
      stoneGrowthUv * uStoneGrowthDetailScale * 2.35 + vec2(23.41, 57.13)
    );
    float stoneMossBreakup = smoothstep(
      0.27,
      0.76,
      stoneFineNoise * 0.64 + stoneColonyNoise * 0.36
    );
    stoneMossCoverage *= mix(
      1.0,
      max(0.05, stoneMossBreakup),
      stoneDetailWeight
    );

    float stoneSideAmount = 1.0 - abs(stoneGrowthNormal.y);
    float stoneRunoffNoise = stoneGrowthNoise(
      vec2(
        (vStoneWorldPosition.x + vStoneWorldPosition.z * 0.37 +
          vStoneGrowthSeed * 13.0) * uStoneGrowthDetailScale * 0.62,
        vStoneWorldPosition.y * uStoneGrowthDetailScale * 0.24
      ) + vec2(11.7, 3.9)
    );
    float stoneRunoff = smoothstep(0.24, 0.78, stoneRunoffNoise);
    stoneMossCoverage *= mix(
      1.0,
      0.55 + stoneRunoff * 0.58,
      uStoneMossStreakStrength * stoneSideAmount * stoneDetailWeight
    );

    float stoneLichenFine = stoneGrowthNoise(
      stoneGrowthUv * uStoneGrowthDetailScale * 4.2 + vec2(71.1, 14.3)
    );
    float stoneLichenBreakup = smoothstep(
      0.62,
      0.86,
      stoneLichenFine * 0.68 + stoneLichenNoise * 0.32
    );
    stoneLichenCoverage *= mix(
      1.0,
      stoneLichenBreakup,
      stoneDetailWeight
    );

    stoneMossColorVariation = mix(
      1.0,
      mix(0.82, 1.08, stoneColonyNoise),
      stoneDetailWeight
    );
    stoneLichenColorVariation = mix(
      1.0,
      mix(0.90, 1.08, stoneLichenNoise),
      stoneDetailWeight
    );
  }

  stoneMossCoverage = clamp(stoneMossCoverage, 0.0, 1.0);
  stoneLichenCoverage = clamp(stoneLichenCoverage, 0.0, 1.0);
  diffuseColor.rgb = mix(
    diffuseColor.rgb,
    vStoneLichenColor * stoneLichenColorVariation,
    stoneLichenCoverage
  );
  diffuseColor.rgb = mix(
    diffuseColor.rgb,
    vStoneMossColor * stoneMossColorVariation,
    stoneMossCoverage
  );
}
`;

const GRAIN_FRAGMENT_COMMON = `
uniform sampler2D uStoneGrain;
uniform float uStoneGrainStrength;
uniform float uStoneGrainNormalStrength;
uniform float uStoneGrainScale;
uniform vec2 uStoneGrainFadeSquared;
`;

/**
 * The grain is sampled unconditionally rather than behind its fade test.
 *
 * The bump below reads this height field with screen-space derivatives, and a
 * derivative taken inside non-uniform control flow is undefined -- at the fade
 * boundary that shows as a seam of wrong shading one pixel wide. Only detail
 * batches compile this shader at all, so the three taps it costs are paid on
 * the near ring and nowhere else.
 */
const GRAIN_COLOR = `
vec3 stoneGrainCameraDelta = cameraPosition - vStoneWorldPosition;
float stoneGrainDistanceSquared = dot(stoneGrainCameraDelta, stoneGrainCameraDelta);
float stoneGrainFade = 1.0 - smoothstep(
  uStoneGrainFadeSquared.x,
  uStoneGrainFadeSquared.y,
  stoneGrainDistanceSquared
);
vec3 stoneBlend = pow(abs(normalize(vStoneWorldNormal)), vec3(4.0));
stoneBlend /= max(stoneBlend.x + stoneBlend.y + stoneBlend.z, 0.0001);
float stoneGrain =
  texture2D(uStoneGrain, vStoneWorldPosition.zy * uStoneGrainScale).r *
    stoneBlend.x +
  texture2D(uStoneGrain, vStoneWorldPosition.xz * uStoneGrainScale).r *
    stoneBlend.y +
  texture2D(uStoneGrain, vStoneWorldPosition.xy * uStoneGrainScale).r *
    stoneBlend.z;
diffuseColor.rgb *= 1.0 +
  (stoneGrain - 0.5) * 2.0 * uStoneGrainStrength * stoneGrainFade;
`;

/**
 * Surface grain that moves the shading instead of the albedo.
 *
 * The albedo term above was judged and left off: at a feature size fine enough
 * to see it reads as dirty concrete, and coarse enough to stay tasteful it is
 * nearly constant across a one-metre stone. Both halves of that are about
 * *value* -- a painted light-dark pattern competing with a flat-value palette.
 * Perturbing the normal from the same height field is a different effect: value
 * stays exactly where the palette put it, and what changes is how the surface
 * catches the sun, which is what stone micro-relief actually does.
 *
 * The gradient comes from screen-space derivatives rather than extra taps, so
 * this needs no tangents, no second UV set, and no additional texture reads --
 * the same three samples the albedo term already pays for. It is the standard
 * surface-gradient construction: build a basis from the derivatives of view
 * position, project the height gradient onto it, and lean the normal away.
 */
const GRAIN_NORMAL = `
vec3 stoneBumpSurfaceX = dFdx(-vViewPosition);
vec3 stoneBumpSurfaceY = dFdy(-vViewPosition);
float stoneBumpHeightX = dFdx(stoneGrain);
float stoneBumpHeightY = dFdy(stoneGrain);
vec3 stoneBumpR1 = cross(stoneBumpSurfaceY, normal);
vec3 stoneBumpR2 = cross(normal, stoneBumpSurfaceX);
float stoneBumpDeterminant = dot(stoneBumpSurfaceX, stoneBumpR1);
vec3 stoneBumpGradient = sign(stoneBumpDeterminant) *
  (stoneBumpHeightX * stoneBumpR1 + stoneBumpHeightY * stoneBumpR2);
normal = normalize(
  abs(stoneBumpDeterminant) * normal -
    uStoneGrainNormalStrength * stoneGrainFade * stoneBumpGradient
);
`;

/**
 * Wet stone, in two halves that only work together.
 *
 * The albedo goes down because water fills the pores and stops them scattering
 * light back; on its own that is a stone someone painted darker. The sheen is
 * the half that says water: a narrow lobe off the light actually shading the
 * stone, so it cannot drift out of agreement with the sun the way a separate
 * direction uniform would, and skipped entirely on dry bodies, where the branch
 * is coherent across whole batches.
 *
 * Both are cut off at the baked waterline, which is what keeps this reading as
 * a river's edge rather than as a polished rock.
 */
const WET_COLOR = `
if (vStoneWet > 0.001) {
  diffuseColor.rgb *= mix(1.0, uStoneWetDarken, vStoneWet);
}
`;

const SHEEN = `
#if NUM_DIR_LIGHTS > 0
  vec3 stoneSheenView = normalize(vViewPosition);
  vec3 stoneSheenHalf = normalize(
    directionalLights[0].direction + stoneSheenView
  );
  float stoneSheenBase = saturate(dot(normal, stoneSheenHalf));
  // Unbranched: the dry term applies to every body, so there is no coherent
  // batch to skip and a branch would only cost the divergence it saves.
  float stoneSheen =
    pow(stoneSheenBase, uStoneDrySheenPower) * uStoneDrySheenStrength;
  if (vStoneWet > 0.001) {
    stoneSheen = mix(
      stoneSheen,
      pow(stoneSheenBase, uStoneWetSheenPower) * uStoneWetSheenStrength,
      vStoneWet
    );
  }
  outgoingLight += directionalLights[0].color * stoneSheen;
#endif
`;

/**
 * Ambient wrap.
 *
 * A hemisphere ground colour tuned for turf leaves a downward-facing stone
 * bevel at almost zero, and the baked turf bounce cannot rescue albedo the
 * lighting has already multiplied to black. Raising the floor turns that hard
 * contact rim back into shaded stone, and because the base albedo is already
 * pushed toward the bounce colour there, the lift arrives green rather than
 * grey. Still one max: no extra fragment cost over the old floor.
 */
const LIGHTING_FLOOR = `
outgoingLight = max(outgoingLight, diffuseColor.rgb * 0.34);
`;

/** Directional open-sky fill kept deliberately weak under the strong world key. */
const SKY_SIDE_AMBIENT = `
#if NUM_DIR_LIGHTS > 0 && NUM_HEMI_LIGHTS > 0
  float stoneSunFacing = saturate(
    dot(normal, directionalLights[0].direction)
  );
  float stoneSkyFacing = saturate(
    dot(normal, hemisphereLights[0].direction) * 0.5 + 0.5
  );
  float stoneSkySide =
    (1.0 - smoothstep(0.08, 0.46, stoneSunFacing)) *
    smoothstep(0.18, 0.78, stoneSkyFacing);
  outgoingLight +=
    diffuseColor.rgb * hemisphereLights[0].skyColor *
    vec3(0.72, 0.92, 1.18) * (stoneSkySide * 0.2);
#endif
`;

/**
 * How far the close-range noise may drag a weathering boundary off the mesh.
 * Large enough to hide the facet, small enough that a body cannot flip from
 * crusted to stained on noise alone.
 */
const STONE_CRUST_BREAKUP = 0.55;
/** How far wet stone darkens where the film is unbroken. */
const STONE_WET_DARKEN = 0.58;
/** Narrow enough to read as a film of water rather than polish. */
const STONE_WET_SHEEN_POWER = 110;
const STONE_WET_SHEEN_STRENGTH = 0.28;
/**
 * The lobe dry stone gets.
 *
 * Broad and weak, where the wet lobe is narrow and strong: this is not a wet
 * highlight but the fact that rock is not a perfect diffuser, and its whole
 * job is to give a perturbed normal something to move. `stoneGrainNormalStrength`
 * was measured at zero effect and switched off because on a pure Lambert
 * surface a bumped normal only changes N.L, which is a brightness blotch --
 * indistinguishable from an albedo blotch. That measurement was correct about
 * the material as it stood and wrong about the material as it had to be: the
 * mechanism it said was missing is the one below, and the wet path already had
 * it. At this width the term reads as a sheen across a whole plane rather than
 * a specular dot, which is what stone at this scale actually does.
 */
const STONE_DRY_SHEEN_POWER = 16;
const STONE_DRY_SHEEN_STRENGTH = 0.075;

export function applyStoneSurfaceShader(
  material: THREE.MeshLambertMaterial,
  config: WorldConfig,
  grainTexture?: THREE.Texture,
): void {
  const growthFadeEnd = config.stoneGrowthDetailFadeDistance;
  const growthFadeStart = growthFadeEnd * 0.55;
  const grainFadeEnd = config.stoneGrainFadeDistance;
  const grainFadeStart = grainFadeEnd * 0.6;

  material.onBeforeCompile = (shader) => {
    shader.uniforms.uStoneGrowthDetailStrength = {
      value: config.stoneGrowthDetailStrength,
    };
    shader.uniforms.uStoneGrowthDetailScale = {
      value: 1 / config.stoneGrowthDetailSize,
    };
    shader.uniforms.uStoneGrowthDetailFadeSquared = {
      value: new THREE.Vector2(
        growthFadeStart * growthFadeStart,
        growthFadeEnd * growthFadeEnd,
      ),
    };
    shader.uniforms.uStoneMossStreakStrength = {
      value: config.stoneMossStreakStrength,
    };
    shader.uniforms.uStoneCrustBreakup = { value: STONE_CRUST_BREAKUP };
    shader.uniforms.uStoneWetDarken = { value: STONE_WET_DARKEN };
    shader.uniforms.uStoneWetSheenStrength = {
      value: STONE_WET_SHEEN_STRENGTH,
    };
    shader.uniforms.uStoneWetSheenPower = { value: STONE_WET_SHEEN_POWER };
    shader.uniforms.uStoneDrySheenStrength = {
      value: STONE_DRY_SHEEN_STRENGTH,
    };
    shader.uniforms.uStoneDrySheenPower = { value: STONE_DRY_SHEEN_POWER };

    let fragmentCommon = GROWTH_FRAGMENT_COMMON;
    let colorFragment = GROWTH_COLOR;
    let normalFragment = "";
    colorFragment += WET_COLOR;
    if (grainTexture) {
      shader.uniforms.uStoneGrain = { value: grainTexture };
      shader.uniforms.uStoneGrainStrength = {
        value: config.stoneGrainStrength,
      };
      shader.uniforms.uStoneGrainNormalStrength = {
        value: config.stoneGrainNormalStrength,
      };
      shader.uniforms.uStoneGrainScale = { value: 1 / config.stoneGrainSize };
      shader.uniforms.uStoneGrainFadeSquared = {
        value: new THREE.Vector2(
          grainFadeStart * grainFadeStart,
          grainFadeEnd * grainFadeEnd,
        ),
      };
      fragmentCommon += GRAIN_FRAGMENT_COMMON;
      colorFragment += GRAIN_COLOR;
      normalFragment += GRAIN_NORMAL;
    }

    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `#include <common>${VERTEX_COMMON}`)
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>${VERTEX_POSITION}`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>${fragmentCommon}`)
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>${colorFragment}`,
      )
      .replace(
        "#include <normal_fragment_begin>",
        `#include <normal_fragment_begin>${normalFragment}`,
      )
      .replace(
        "#include <opaque_fragment>",
        `${SKY_SIDE_AMBIENT}${LIGHTING_FLOOR}${SHEEN}#include <opaque_fragment>`,
      );
  };

  material.customProgramCacheKey = () =>
    `world-stone-surface-v19-side-fill:${grainTexture ? "grain" : "growth"}`;
  material.needsUpdate = true;
}

/** Far batches have already passed every close-detail fade. */
export function applyStoneCoarseSurfaceShader(
  material: THREE.MeshLambertMaterial,
): void {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uStoneWetDarken = { value: STONE_WET_DARKEN };
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `#include <common>${COARSE_VERTEX_COMMON}`)
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>${COARSE_VERTEX_POSITION}`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>${COARSE_FRAGMENT_COMMON}`,
      )
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>${COARSE_COLOR}`,
      )
      .replace(
        "#include <opaque_fragment>",
        `${SKY_SIDE_AMBIENT}${LIGHTING_FLOOR}#include <opaque_fragment>`,
      );
  };
  material.customProgramCacheKey = () => "world-stone-coarse-v4-wet-albedo";
  material.needsUpdate = true;
}
