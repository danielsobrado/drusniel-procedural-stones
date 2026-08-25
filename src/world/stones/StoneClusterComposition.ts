import type { WorldConfig } from "../WorldConfig";
import { STONE_ARCHETYPE_IDS, type StoneArchetypeId } from "./StoneRecipe";
import { StoneRandom } from "./StoneRandom";
import type { StoneClusterDescriptor } from "./StoneClusterField";
import {
  ANCHOR_BIOME_MULTIPLIERS,
  archetypeBiomeMultiplier,
  axisLerp,
  clamp,
  clampClusterLocalToInfluence,
  clusterRoleCounts,
  DEBRIS_FAMILY,
  GOLDEN_ANGLE,
  lerp,
  ROLE_YAW_EXTRA,
  SECONDARY_FAMILY,
  STONE_CLUSTER_MEMBER_JITTER,
  stoneClusterMemberLabel,
  type ClusterFamilyWeights,
  type StoneClusterProcess,
  type StoneClusterRole,
} from "./StoneClusterTuning";
import {
  LEVEL_WEIGHTS,
  pickFamilyArchetype,
  pickWeightedArchetype,
  SCALE_BANDS,
  scaleArchetypeWeight,
  SLOPE_WEIGHTS,
  withoutPebble,
  type ArchetypeWeights,
} from "./StonePlacementProfile";

export interface StoneClusterMemberSpec {
  readonly index: number;
  readonly role: StoneClusterRole;
  readonly archetype: StoneArchetypeId;
  readonly localU: number;
  readonly localV: number;
  readonly normalizedRadius: number;
  readonly scale: number;
  readonly rotationY: number;
  readonly variantIndex: number;
  readonly valueScale: number;
  readonly mossScale: number;
  readonly splitEligible: boolean;
  readonly fallback?: StoneClusterMemberSpec;
}

/**
 * Pure logical composition of one macro cluster.
 *
 * Terrain is not sampled here. The returned specs are immutable authored
 * members: overlap correction later may move a root, but it must not rewrite
 * scale, family, or the authored radial coordinate used for size hierarchy.
 */
export class StoneClusterComposition {
  constructor(private readonly config: WorldConfig) {}

  compose(descriptor: StoneClusterDescriptor): readonly StoneClusterMemberSpec[] {
    if (!descriptor.active || descriptor.budget < 4) {
      return [];
    }
    const clusterRng = StoneRandom.fromSeed(descriptor.seed);
    const phase = clusterRng.fork("composition-phase").range(0, Math.PI * 2);
    const { secondaryCount, debrisCount } = clusterRoleCounts(descriptor.budget);
    const roles: StoneClusterRole[] = ["anchor"];
    for (let index = 0; index < secondaryCount; index += 1) {
      roles.push("secondary");
    }
    for (let index = 0; index < debrisCount; index += 1) {
      roles.push("debris");
    }

    const members: StoneClusterMemberSpec[] = [];
    const usedVariants = new Map<StoneArchetypeId, number[]>();
    let anchorArchetype: StoneArchetypeId = "boulder";
    let anchorScale = 1;

    for (let index = 0; index < roles.length; index += 1) {
      const role = roles[index];
      const spec = this.composeMember(
        descriptor,
        clusterRng.fork(stoneClusterMemberLabel(index)),
        index,
        role,
        phase,
        anchorArchetype,
        anchorScale,
        usedVariants,
      );
      if (role === "anchor") {
        anchorArchetype = spec.archetype;
        anchorScale = spec.scale;
      }
      members.push(spec);
    }

    const firstSecondary = members.find((member) => member.role === "secondary");
    if (
      firstSecondary &&
      (anchorArchetype === "boulder" || anchorArchetype === "block") &&
      clusterRng
        .fork(stoneClusterMemberLabel(firstSecondary.index))
        .fork("split")
        .chance(this.config.stoneFormationChance)
    ) {
      members[firstSecondary.index] = {
        ...firstSecondary,
        splitEligible: true,
        fallback: firstSecondary,
      };
    }

    return members;
  }

  private composeMember(
    descriptor: StoneClusterDescriptor,
    random: StoneRandom,
    index: number,
    role: StoneClusterRole,
    phase: number,
    anchorArchetype: StoneArchetypeId,
    anchorScale: number,
    usedVariants: Map<StoneArchetypeId, number[]>,
  ): StoneClusterMemberSpec {
    const halo = this.config.stoneClusterHaloRatio;
    const offset = this.authoredOffset(
      descriptor.process,
      role,
      index,
      phase,
      random,
      this.config.stoneClusterCoreRatio,
      this.config.stoneClusterShoulderRatio,
      halo,
    );
    const local = clampClusterLocalToInfluence(
      offset.u,
      offset.v,
      descriptor.majorRadius,
      descriptor.minorRadius,
      descriptor.influenceRadius,
    );
    const archetype =
      role === "anchor"
        ? this.pickAnchorArchetype(descriptor, random)
        : pickFamilyArchetype(
            applyBiomeToFamily(
              role === "secondary"
                ? SECONDARY_FAMILY[anchorArchetype]
                : DEBRIS_FAMILY[anchorArchetype],
              role === "secondary" ? descriptor.biomeIndex : -1,
            ),
            random.fork("family"),
          );
    const scale = this.resolveScale(
      descriptor,
      role,
      archetype,
      offset.normalizedRadius,
      halo,
      anchorScale,
      random,
    );
    const rotationY = this.resolveYaw(descriptor, role, archetype, random);
    const variantIndex = this.pickUniqueVariant(
      random,
      archetype,
      usedVariants,
      this.config.stoneVariantsPerArchetype,
    );
    return {
      index,
      role,
      archetype,
      localU: local.u,
      localV: local.v,
      normalizedRadius: offset.normalizedRadius,
      scale,
      rotationY,
      variantIndex,
      valueScale: clamp(
        descriptor.valueBase + random.fork("value").signed(0.015),
        0.92,
        1.06,
      ),
      mossScale: random.fork("moss").range(0.95, 1.05),
      splitEligible: false,
    };
  }

  private pickUniqueVariant(
    random: StoneRandom,
    archetype: StoneArchetypeId,
    usedVariants: Map<StoneArchetypeId, number[]>,
    variantCount: number,
  ): number {
    const start = random.fork("variant").integer(0, variantCount - 1);
    const used = usedVariants.get(archetype) ?? [];
    for (let attempt = 0; attempt < variantCount; attempt += 1) {
      const index = (start + attempt) % variantCount;
      if (!used.includes(index)) {
        used.push(index);
        usedVariants.set(archetype, used);
        return index;
      }
    }
    return start;
  }

  private pickAnchorArchetype(
    descriptor: StoneClusterDescriptor,
    random: StoneRandom,
  ): StoneArchetypeId {
    const base =
      descriptor.process === "scree"
        ? SLOPE_WEIGHTS
        : LEVEL_WEIGHTS[descriptor.biomeIndex] ?? LEVEL_WEIGHTS[0];
    return pickWeightedArchetype(
      applyProcessModifiers(
        applyAnchorBiome(withoutPebble(base), descriptor.biomeIndex),
        descriptor.process,
      ),
      random.fork("family"),
    );
  }

  private resolveScale(
    descriptor: StoneClusterDescriptor,
    role: StoneClusterRole,
    archetype: StoneArchetypeId,
    normalizedRadius: number,
    halo: number,
    anchorScale: number,
    random: StoneRandom,
  ): number {
    const band = SCALE_BANDS[archetype];
    const landmarkScale = random.fork("landmark-scale").range(1.7, 2.4);
    if (role === "anchor") {
      let scale = lerp(band[0], band[1], random.fork("scale").range(0.62, 0.92));
      if (
        archetype === "boulder" &&
        descriptor.suitability >= 0.7 &&
        random.fork("landmark").chance(0.06)
      ) {
        scale *= landmarkScale;
      }
      return scale;
    }
    const radiusT = Math.min(1, normalizedRadius / halo);
    if (role === "secondary") {
      const radialScale = lerp(0.7, 0.46, radiusT);
      return clamp(
        anchorScale * radialScale * random.fork("scale-jitter").range(0.9, 1.08),
        Math.max(0.3, band[0] * 0.45),
        band[1] * 0.82,
      );
    }
    const radialScale = lerp(0.36, 0.16, radiusT);
    return clamp(
      anchorScale * radialScale * random.fork("scale-jitter").range(0.85, 1.15),
      0.22,
      band[1] * 0.55,
    );
  }

  private resolveYaw(
    descriptor: StoneClusterDescriptor,
    role: StoneClusterRole,
    archetype: StoneArchetypeId,
    random: StoneRandom,
  ): number {
    const extra = ROLE_YAW_EXTRA[role];
    const yaw = random.fork("yaw");
    if (archetype === "pebble") {
      return yaw.range(0, Math.PI);
    }
    if (archetype === "outcrop") {
      return descriptor.strike + yaw.signed(0.18 + extra);
    }
    if (archetype === "slab") {
      return descriptor.strike + yaw.signed(0.22 + extra);
    }
    if (archetype === "block") {
      return descriptor.strike + yaw.signed(0.28 + extra);
    }
    if (archetype === "boulder") {
      return (
        axisLerp(descriptor.strike, descriptor.direction, 0.35) +
        yaw.signed(0.42 + extra)
      );
    }
    return descriptor.direction + yaw.signed(0.38 + extra);
  }

  private authoredOffset(
    process: StoneClusterProcess,
    role: StoneClusterRole,
    memberIndex: number,
    phase: number,
    random: StoneRandom,
    core: number,
    shoulder: number,
    halo: number,
  ): { u: number; v: number; normalizedRadius: number } {
    if (role === "anchor") {
      if (process === "scree" || process === "fan") {
        const u = -0.16 + random.fork("anchor-u").signed(0.04);
        const v = random.fork("anchor-v").signed(0.05);
        return { u, v, normalizedRadius: Math.hypot(u, v) };
      }
      const u = random.fork("anchor-u").signed(0.06);
      const v = random.fork("anchor-v").signed(0.06);
      return { u, v, normalizedRadius: Math.hypot(u, v) };
    }

    const radius =
      role === "secondary"
        ? lerp(core * 0.55, shoulder * 0.92, random.fork("radius").next())
        : lerp(core, halo, Math.sqrt(random.fork("radius").next()));
    const offset = this.processOffset(
      process,
      role,
      memberIndex,
      phase,
      radius,
      halo,
      random,
    );
    offset.u += random.fork("jitter-u").signed(STONE_CLUSTER_MEMBER_JITTER);
    offset.v += random.fork("jitter-v").signed(STONE_CLUSTER_MEMBER_JITTER);
    return {
      u: offset.u,
      v: offset.v,
      normalizedRadius: radius,
    };
  }

  private processOffset(
    process: StoneClusterProcess,
    role: StoneClusterRole,
    memberIndex: number,
    phase: number,
    radius: number,
    halo: number,
    random: StoneRandom,
  ): { u: number; v: number } {
    if (process === "compact") {
      const angle =
        phase +
        memberIndex * GOLDEN_ANGLE +
        random.fork("angle-jitter").signed(0.28);
      return { u: Math.cos(angle) * radius, v: Math.sin(angle) * radius };
    }
    if (process === "ridge") {
      const side = memberIndex % 2 === 0 ? 1 : -1;
      const spread = role === "secondary" ? 0.18 : 0.34;
      return {
        u: side * radius,
        v: random.fork("lateral").signed(spread * radius),
      };
    }
    const span =
      process === "scree"
        ? role === "secondary"
          ? lerp(0.16, 0.3, radius / halo)
          : lerp(0.22, 0.48, radius / halo)
        : role === "secondary"
          ? lerp(0.24, 0.46, radius / halo)
          : lerp(0.32, 0.68, radius / halo);
    return { u: radius, v: random.fork("lateral").signed(radius * span) };
  }
}

function applyAnchorBiome(
  weights: ArchetypeWeights,
  biomeIndex: number,
): ArchetypeWeights {
  const multipliers =
    ANCHOR_BIOME_MULTIPLIERS[biomeIndex] ?? ANCHOR_BIOME_MULTIPLIERS[0];
  return {
    ids: weights.ids,
    weights: weights.ids.map((id, index) => {
      const archetypeIndex = STONE_ARCHETYPE_IDS.indexOf(id);
      const multiplier =
        archetypeIndex >= 0 ? multipliers[archetypeIndex] : 1;
      return weights.weights[index] * multiplier;
    }),
  };
}

function applyBiomeToFamily(
  family: ClusterFamilyWeights,
  biomeIndex: number,
): ClusterFamilyWeights {
  if (biomeIndex < 0) {
    return family;
  }
  const scaled: Partial<Record<StoneArchetypeId, number>> = {};
  for (const id of STONE_ARCHETYPE_IDS) {
    const weight = family[id];
    if (weight === undefined) {
      continue;
    }
    scaled[id] = weight * archetypeBiomeMultiplier(id, biomeIndex);
  }
  return scaled;
}

function applyProcessModifiers(
  weights: ArchetypeWeights,
  process: StoneClusterProcess,
): ArchetypeWeights {
  if (process === "ridge") {
    return scaleArchetypeWeight(
      scaleArchetypeWeight(
        scaleArchetypeWeight(weights, "slab", 1.35),
        "outcrop",
        1.35,
      ),
      "boulder",
      0.7,
    );
  }
  if (process === "scree") {
    return scaleArchetypeWeight(
      scaleArchetypeWeight(weights, "shard", 1.25),
      "outcrop",
      1.15,
    );
  }
  if (process === "fan") {
    return scaleArchetypeWeight(
      scaleArchetypeWeight(
        scaleArchetypeWeight(
          scaleArchetypeWeight(weights, "boulder", 1.25),
          "slab",
          1.1,
        ),
        "shard",
        0.75,
      ),
      "outcrop",
      0.7,
    );
  }
  return weights;
}
