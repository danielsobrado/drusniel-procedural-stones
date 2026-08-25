import { buildStonePolyhedron } from "./StoneClipper";
import { resolveStoneFractureAzimuth } from "./StoneFractureAlignment";
import { addStoneFractureRelief } from "./StoneFractureRelief";
import {
  centerStoneContact,
  resolveStableStoneMaterialFrame,
  transformStonePoints,
} from "./StoneGeometryFrame";
import {
  resolveStoneFacetSoftening,
  STONE_CENTROID_FAN_MIN_CORNERS,
  STONE_MESH_QUANTIZE,
} from "./StoneGeometryTuning";
import { addStoneIndentation } from "./StoneIndentation";
import {
  buildStoneEdgeSharpness,
  buildWorkingStoneFaces,
  chooseStoneFanRoot,
  countSharedStoneFacePairs,
  type WorkingStoneFace,
} from "./StoneMeshTopology";
import type { StoneRecipe } from "./StoneRecipe";
import { buildStoneSoftNormals } from "./StoneSurfaceNormals";
import {
  averageStoneFaceCorners,
  resolveCornerBounce,
  resolveCornerCavity,
  resolveCornerEdgeShading,
  resolveCornerMineral,
  resolveCornerTone,
  resolveCornerWeathering,
  resolveFaceTint,
  resolveMoss,
} from "./StoneVertexShading";

export interface StoneMeshData {
  readonly positions: Float32Array;
  readonly normals: Float32Array;
  readonly tones: Float32Array;
  readonly wears: Float32Array;
  readonly bounces: Float32Array;
  readonly mosses: Float32Array;
  /** Broad geological identity, independent from surface exposure/weathering. */
  readonly minerals: Float32Array;
  /**
   * Where each corner sits between stained and bleached rock, and how deep in
   * a cavity it lies. Both are albedo: the lighting model never sees them.
   */
  readonly weatherings: Float32Array;
  readonly cavities: Float32Array;
  readonly indices: Uint16Array;
  readonly metrics: StoneMeshMetrics;
}

export interface StoneMeshMetrics {
  readonly vertexCount: number;
  readonly triangleCount: number;
  readonly height: number;
  readonly contactRadius: number;
  readonly footprintRadius: number;
  /** Stable coarse-parent height used by material and growth coordinates. */
  readonly materialHeight: number;
  /** Stable coarse-parent radius used by material and growth coordinates. */
  readonly materialFootprintRadius: number;
  readonly embed: number;
  /** Strength of close-range horizontal bedding seams for this body. */
  readonly bedding: number;
  readonly silhouetteVariant: StoneRecipe["silhouetteVariant"];
  /** Axial bearing of this body's dominant fracture set, in mesh-local space. */
  readonly fractureAzimuth: number;
  /** Contact-centroid shift applied while centring this pooled body. */
  readonly contactOffsetX: number;
  readonly contactOffsetZ: number;
  readonly fingerprint: number;
}

/** Lab hooks into the detail passes; omitted means shipped behaviour. */
export interface StoneMeshOptions {
  readonly indentation?: {
    readonly enabled: boolean;
    readonly chance?: number;
    readonly depthScale?: number;
  };
  readonly fractureRelief?: {
    readonly enabled: boolean;
    readonly strengthScale?: number;
  };
}

export function generateStoneMesh(
  recipe: StoneRecipe,
  includeChips = false,
  options?: StoneMeshOptions,
): StoneMeshData {
  let polygons = buildStonePolyhedron(recipe, includeChips);
  const indentation = options?.indentation;
  if (indentation === undefined || indentation.enabled) {
    polygons = addStoneIndentation(polygons, recipe, indentation);
  }
  const relief = options?.fractureRelief;
  if (relief === undefined || relief.enabled) {
    polygons = addStoneFractureRelief(
      polygons,
      recipe,
      relief?.strengthScale ?? 1,
    );
  }
  const uniquePoints = transformStonePoints(polygons, recipe);
  const stableMaterialFrame = resolveStableStoneMaterialFrame(
    recipe,
    includeChips,
  );

  const contactOffset = centerStoneContact(polygons, uniquePoints);
  const faces = buildWorkingStoneFaces(polygons);
  const softening = resolveStoneFacetSoftening(recipe.archetype);
  const edgeSharpness = buildStoneEdgeSharpness(faces, softening);
  const sharedFacePairs = countSharedStoneFacePairs(faces);
  const softNormals = buildStoneSoftNormals(faces, softening);
  const heightMetres = resolveStoneHeight(faces);
  // Chips and a tilted fracture may both change the rendered mesh's extrema.
  // Material/growth normalization must not follow those LOD/fragment changes.
  const shadingHeightMetres = Math.max(
    stableMaterialFrame?.height ?? heightMetres,
    1e-3,
  );
  const { vertexCount, triangleCount } = resolveMeshCounts(faces);

  const positions = new Float32Array(vertexCount * 3);
  const normals = new Float32Array(vertexCount * 3);
  const tones = new Float32Array(vertexCount);
  const wears = new Float32Array(vertexCount);
  const bounces = new Float32Array(vertexCount);
  const mosses = new Float32Array(vertexCount);
  const minerals = new Float32Array(vertexCount);
  const weatherings = new Float32Array(vertexCount);
  const cavities = new Float32Array(vertexCount);
  const indices = new Uint16Array(triangleCount * 3);

  let vertexCursor = 0;
  let cornerCursor = 0;
  let indexCursor = 0;
  let contactRadius = 0;
  let footprintRadius = 0;
  const edgeMaterialOffsetX = recipe.fracture ? contactOffset.x : 0;
  const edgeMaterialOffsetZ = recipe.fracture ? contactOffset.z : 0;

  for (const face of faces) {
    const corners = face.points.length;
    const faceTint = resolveFaceTint(face, recipe);
    const broken = face.role === "fracture";
    const baseVertex = vertexCursor;

    for (let corner = 0; corner < corners; corner += 1) {
      const point = face.points[corner];
      const offset = vertexCursor * 3;
      const softOffset = cornerCursor * 3;
      positions[offset] = point.x;
      positions[offset + 1] = point.y;
      positions[offset + 2] = point.z;
      normals[offset] = softNormals[softOffset];
      normals[offset + 1] = softNormals[softOffset + 1];
      normals[offset + 2] = softNormals[softOffset + 2];

      const edgeShading = resolveCornerEdgeShading(
        face,
        corner,
        edgeSharpness,
        recipe,
        edgeMaterialOffsetX,
        edgeMaterialOffsetZ,
      );
      const softNormalY = softNormals[softOffset + 1];
      wears[vertexCursor] = edgeShading.wear;
      tones[vertexCursor] = resolveCornerTone(
        faceTint,
        softNormalY,
        point.y,
        shadingHeightMetres,
        edgeShading.crease,
      );
      // Contact centring is a render transform, not a material transform. Add
      // it back for geology/growth fields so fragments sample one parent rock.
      const materialX = point.x + contactOffset.x;
      const materialZ = point.z + contactOffset.z;
      minerals[vertexCursor] = resolveCornerMineral(
        materialX,
        point.y,
        materialZ,
        recipe,
      );
      weatherings[vertexCursor] = resolveCornerWeathering(
        materialX,
        point.y,
        materialZ,
        softNormalY,
        shadingHeightMetres,
        recipe,
        broken,
      );
      cavities[vertexCursor] = resolveCornerCavity(
        edgeShading.crease,
        softNormalY,
        broken,
        point.y,
        shadingHeightMetres,
      );
      bounces[vertexCursor] = resolveCornerBounce(
        point.y,
        shadingHeightMetres,
        softNormalY,
        edgeShading.crease,
      );
      const baseMoss = resolveMoss(
        materialX,
        point.y,
        materialZ,
        softNormalY,
        shadingHeightMetres,
        recipe,
        broken,
        edgeShading.crease,
      );
      const notchShelter = face.planeId.startsWith("notch-")
        ? 0.42 + 0.28 * (1 - Math.abs(face.normalY))
        : 0;
      mosses[vertexCursor] = Math.max(baseMoss, notchShelter);

      const radial = Math.hypot(point.x, point.z);
      footprintRadius = Math.max(footprintRadius, radial);
      if (point.y === 0) {
        contactRadius = Math.max(contactRadius, radial);
      }
      vertexCursor += 1;
      cornerCursor += 1;
    }

    if (corners >= STONE_CENTROID_FAN_MIN_CORNERS) {
      averageStoneFaceCorners(
        {
          positions,
          normals,
          tones,
          wears,
          bounces,
          mosses,
          minerals,
          weatherings,
          cavities,
        },
        baseVertex,
        corners,
        vertexCursor,
      );
      const centroidVertex = vertexCursor;
      vertexCursor += 1;
      for (let corner = 0; corner < corners; corner += 1) {
        indices[indexCursor] = centroidVertex;
        indices[indexCursor + 1] = baseVertex + corner;
        indices[indexCursor + 2] = baseVertex + ((corner + 1) % corners);
        indexCursor += 3;
      }
      continue;
    }

    const fanRoot = chooseStoneFanRoot(face, sharedFacePairs);
    for (let offset = 1; offset < corners - 1; offset += 1) {
      indices[indexCursor] = baseVertex + fanRoot;
      indices[indexCursor + 1] = baseVertex + ((fanRoot + offset) % corners);
      indices[indexCursor + 2] =
        baseVertex + ((fanRoot + offset + 1) % corners);
      indexCursor += 3;
    }
  }

  const metrics: StoneMeshMetrics = {
    vertexCount,
    triangleCount,
    height: heightMetres,
    contactRadius,
    footprintRadius,
    materialHeight: shadingHeightMetres,
    materialFootprintRadius: Math.max(
      stableMaterialFrame?.footprintRadius ?? footprintRadius,
      1e-4,
    ),
    embed: recipe.embed,
    bedding:
      recipe.archetype === "slab"
        ? 0.24
        : recipe.archetype === "outcrop"
          ? 0.18
          : recipe.silhouetteVariant === "capstone"
            ? 0.12
            : recipe.archetype === "block"
              ? 0.05
              : 0,
    silhouetteVariant: recipe.silhouetteVariant,
    fractureAzimuth: resolveStoneFractureAzimuth(faces),
    contactOffsetX: contactOffset.x,
    contactOffsetZ: contactOffset.z,
    fingerprint: fingerprintMesh(positions, tones),
  };

  return {
    positions,
    normals,
    tones,
    wears,
    bounces,
    mosses,
    minerals,
    weatherings,
    cavities,
    indices,
    metrics,
  };
}

function resolveStoneHeight(faces: readonly WorkingStoneFace[]): number {
  let maxY = 0;
  for (const face of faces) {
    for (const point of face.points) {
      maxY = Math.max(maxY, point.y);
    }
  }
  return Math.max(maxY, 1e-3);
}

function resolveMeshCounts(faces: readonly WorkingStoneFace[]): {
  vertexCount: number;
  triangleCount: number;
} {
  let vertexCount = 0;
  let triangleCount = 0;
  for (const face of faces) {
    const corners = face.points.length;
    if (corners >= STONE_CENTROID_FAN_MIN_CORNERS) {
      vertexCount += corners + 1;
      triangleCount += corners;
    } else {
      vertexCount += corners;
      triangleCount += corners - 2;
    }
  }
  return { vertexCount, triangleCount };
}

function fingerprintMesh(positions: Float32Array, tones: Float32Array): number {
  let hash = 0x811c9dc5;
  const mix = (value: number): void => {
    hash = Math.imul(hash ^ (value & 0xffff), 0x01000193) >>> 0;
    hash = Math.imul(hash ^ ((value >>> 16) & 0xffff), 0x01000193) >>> 0;
  };
  for (let index = 0; index < positions.length; index += 1) {
    mix(Math.round(positions[index] / STONE_MESH_QUANTIZE) | 0);
  }
  for (let index = 0; index < tones.length; index += 1) {
    mix(Math.round(tones[index] * 1024) | 0);
  }
  return hash >>> 0;
}
