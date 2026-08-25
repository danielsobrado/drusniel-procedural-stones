import type { WorldConfig } from "../WorldConfig";
import { StoneClearanceCache } from "./StoneClearanceCache";
import type { StoneField } from "./StoneField";
import {
  clearStoneGroundInfluence,
  type MutableStoneGroundInfluence,
} from "./StoneGroundInfluence";

export interface StoneClearanceRegistration {
  dispose(): void;
}

interface StoneClearanceOwner {
  readonly owner: symbol;
  readonly field: StoneField | undefined;
  readonly cache: StoneClearanceCache | undefined;
}

const owners: StoneClearanceOwner[] = [];
let activeField: StoneField | undefined;
let activeCache: StoneClearanceCache | undefined;

function createStoneClearanceCache(
  field: StoneField | undefined,
  config?: WorldConfig,
): StoneClearanceCache | undefined {
  return field && config ? new StoneClearanceCache(field, config) : undefined;
}

function activateStoneClearance(
  field: StoneField | undefined,
  cache: StoneClearanceCache | undefined,
): void {
  const previousCache = activeCache;
  activeField = field;
  activeCache = cache;
  if (previousCache && previousCache !== cache) {
    previousCache.clear();
  }
}

function activateCurrentOwner(): void {
  const active = owners[owners.length - 1];
  activateStoneClearance(active?.field, active?.cache);
}

/** Register the deterministic stone field used by grass placement. */
export function registerStoneClearanceField(
  field: StoneField | undefined,
  config?: WorldConfig,
): StoneClearanceRegistration {
  const registration: StoneClearanceOwner = {
    owner: Symbol("stone-clearance-owner"),
    field,
    cache: createStoneClearanceCache(field, config),
  };
  owners.push(registration);
  activateStoneClearance(registration.field, registration.cache);
  let disposed = false;

  return {
    dispose(): void {
      if (disposed) {
        return;
      }
      disposed = true;
      const index = owners.findIndex(
        (candidate) => candidate.owner === registration.owner,
      );
      if (index < 0) {
        return;
      }
      const wasActive = index === owners.length - 1;
      owners.splice(index, 1);
      if (wasActive) {
        activateCurrentOwner();
      } else {
        registration.cache?.clear();
      }
    },
  };
}

/**
 * Direct registration retained for isolated probes and regression scenes.
 * Runtime systems should prefer registerStoneClearanceField for owned cleanup.
 */
export function setStoneClearanceField(
  field: StoneField | undefined,
  config?: WorldConfig,
): void {
  const cache = createStoneClearanceCache(field, config);
  for (const owner of owners) {
    owner.cache?.clear();
  }
  owners.length = 0;
  activateStoneClearance(field, cache);
}

/**
 * How much grass survives stones at (x, z): 1 clear, 0 under a footprint.
 * Scenes that register config use the amortized neighborhood cache; isolated
 * probes that only register a field retain the exact direct sampler.
 */
export function sampleStoneGrassClearance(
  x: number,
  z: number,
  extraRadius = 0,
  field?: StoneField,
): number {
  if (activeCache && (!field || field === activeField)) {
    return activeCache.sample(x, z, extraRadius);
  }
  const source = field ?? activeField;
  return source ? source.sampleGrassClearance(x, z, extraRadius) : 1;
}

/**
 * Strength of the planted band around stone bases at (x, z): 0 in the open and
 * inside the bare contact, 1 along the seam where clearance releases the
 * ground. Accents read this to thicken and shift species at stone feet; the
 * blade layer does not, since a per-blade second neighbourhood walk would cost
 * more than the effect is worth at blade scale.
 */
export function sampleStoneGrassSkirt(
  x: number,
  z: number,
  field?: StoneField,
): number {
  if (activeCache && (!field || field === activeField)) {
    return activeCache.sampleSkirt(x, z);
  }
  const source = field ?? activeField;
  return source ? source.sampleGrassSkirt(x, z) : 0;
}

/**
 * The dominant stone influence at (x, z), for the terrain surface to carry to
 * its fragment shader. Unregistered scenes report open ground.
 */
export function sampleStoneGroundInfluence(
  x: number,
  z: number,
  out: MutableStoneGroundInfluence,
  field?: StoneField,
): MutableStoneGroundInfluence {
  const source = field ?? activeField;
  if (!source) {
    clearStoneGroundInfluence(x, z, out);
    return out;
  }
  return source.sampleGroundInfluence(x, z, out);
}
