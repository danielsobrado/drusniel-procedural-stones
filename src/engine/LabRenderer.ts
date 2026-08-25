import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import {
  WORLD_DEFAULT_EXPOSURE,
  WORLD_DEFAULT_HEMISPHERE_GROUND,
  WORLD_DEFAULT_HEMISPHERE_INTENSITY,
  WORLD_DEFAULT_HEMISPHERE_SKY,
  WORLD_DEFAULT_SUN,
  WORLD_DEFAULT_SUN_INTENSITY,
  WORLD_OVERCAST_HEMISPHERE_GROUND,
  WORLD_OVERCAST_HEMISPHERE_SKY,
  WORLD_OVERCAST_SUN,
  WORLD_SUN_DIRECTION,
  WORLD_TONE_MAPPING
} from '../app/WorldEnvironmentTuning';
import type { EnvironmentPreset } from '../app/ProjectState';
import { TerrainField } from '../world/TerrainField';
import { StoneField } from '../world/stones/StoneField';
import { WorldStoneSystem } from '../world/stones/WorldStoneSystem';
import type { WorldConfig } from '../world/WorldConfig';

export interface RendererStats {
  fps: number;
  frameMs: number;
  drawCalls: number;
  triangles: number;
}

interface WorldModeResources {
  readonly terrain: TerrainField;
  readonly stoneField: StoneField;
  readonly system: WorldStoneSystem;
  readonly groundMesh: THREE.Mesh;
}

const ENVIRONMENTS: Record<
  EnvironmentPreset,
  {
    background: string;
    hemisphereSky: string;
    hemisphereGround: string;
    sun: string;
    sunIntensity: number;
    hemisphereIntensity: number;
    ground: string;
  }
> = {
  meadow: {
    background: '#bfd4df',
    hemisphereSky: WORLD_DEFAULT_HEMISPHERE_SKY,
    hemisphereGround: WORLD_DEFAULT_HEMISPHERE_GROUND,
    sun: WORLD_DEFAULT_SUN,
    sunIntensity: WORLD_DEFAULT_SUN_INTENSITY,
    hemisphereIntensity: WORLD_DEFAULT_HEMISPHERE_INTENSITY,
    ground: '#466f3a'
  },
  overcast: {
    background: '#b9c8c7',
    hemisphereSky: WORLD_OVERCAST_HEMISPHERE_SKY,
    hemisphereGround: WORLD_OVERCAST_HEMISPHERE_GROUND,
    sun: WORLD_OVERCAST_SUN,
    sunIntensity: WORLD_DEFAULT_SUN_INTENSITY * 0.62,
    hemisphereIntensity: WORLD_DEFAULT_HEMISPHERE_INTENSITY * 1.4,
    ground: '#5d6b52'
  },
  studio: {
    background: '#14181f',
    hemisphereSky: '#8f9bb0',
    hemisphereGround: '#2c3038',
    sun: '#ffffff',
    sunIntensity: WORLD_DEFAULT_SUN_INTENSITY * 0.85,
    hemisphereIntensity: WORLD_DEFAULT_HEMISPHERE_INTENSITY * 1.2,
    ground: '#22262e'
  }
};

export class LabRenderer {
  public readonly scene = new THREE.Scene();
  public readonly stoneGroup = new THREE.Group();

  private readonly renderer: THREE.WebGLRenderer;
  private readonly camera: THREE.PerspectiveCamera;
  private readonly controls: OrbitControls;
  private readonly hemisphere: THREE.HemisphereLight;
  private readonly sun: THREE.DirectionalLight;
  private readonly ground: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshLambertMaterial>;
  private readonly host: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  private world: WorldModeResources | null = null;
  private turntable = false;
  private disposed = false;
  private statsListener: ((stats: RendererStats) => void) | null = null;
  private frameCount = 0;
  private statsWindowStart = performance.now();
  private lastFrameStart = performance.now();

  public constructor(host: HTMLElement) {
    this.host = host;
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'lab-canvas';
    host.prepend(this.canvas);

    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      preserveDrawingBuffer: true
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = WORLD_TONE_MAPPING;
    this.renderer.toneMappingExposure = WORLD_DEFAULT_EXPOSURE;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;

    this.camera = new THREE.PerspectiveCamera(45, 1, 0.05, 900);
    this.camera.position.set(2.4, 1.9, 4.2);

    this.controls = new OrbitControls(this.camera, this.canvas);
    this.controls.target.set(0, 0.45, 0);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.update();

    this.hemisphere = new THREE.HemisphereLight();
    this.scene.add(this.hemisphere);

    this.sun = new THREE.DirectionalLight();
    this.sun.position.set(...WORLD_SUN_DIRECTION).normalize().multiplyScalar(60);
    this.sun.castShadow = true;
    this.configureShadow(9);
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);

    this.ground = new THREE.Mesh(
      new THREE.PlaneGeometry(160, 160),
      new THREE.MeshLambertMaterial({ color: '#466f3a' })
    );
    this.ground.rotation.x = -Math.PI / 2;
    this.ground.receiveShadow = true;
    this.scene.add(this.ground);

    this.scene.add(this.stoneGroup);

    this.setEnvironment('meadow');
    this.resize();
    window.addEventListener('resize', this.resize);
    this.renderer.setAnimationLoop(this.tick);
  }

  public onStats(listener: (stats: RendererStats) => void): void {
    this.statsListener = listener;
  }

  public setEnvironment(preset: EnvironmentPreset): void {
    const environment = ENVIRONMENTS[preset];
    this.scene.background = new THREE.Color(environment.background);
    this.hemisphere.color.set(environment.hemisphereSky);
    this.hemisphere.groundColor.set(environment.hemisphereGround);
    this.hemisphere.intensity = environment.hemisphereIntensity;
    this.sun.color.set(environment.sun);
    this.sun.intensity = environment.sunIntensity;
    if (this.world === null) {
      (this.ground.material as THREE.MeshLambertMaterial).color.set(environment.ground);
    }
  }

  public setTurntable(active: boolean): void {
    this.turntable = active;
  }

  public setWireframe(active: boolean): void {
    this.scene.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        const materials = Array.isArray(object.material)
          ? object.material
          : [object.material];
        for (const material of materials) {
          if ('wireframe' in material) {
            (material as THREE.MeshLambertMaterial).wireframe = active;
          }
        }
      }
    });
  }

  /** Frame the current stone group with a comfortable margin. */
  public frameStone(radius: number, height: number): void {
    const distance = Math.max(radius * 3.2, height * 2.6, 1.4);
    this.controls.target.set(0, Math.max(height * 0.42, 0.2), 0);
    this.camera.position
      .set(0.55, 0.5, 1)
      .normalize()
      .multiplyScalar(distance)
      .add(new THREE.Vector3(0, this.controls.target.y, 0));
    this.controls.update();
  }

  public frameArea(centerX: number, centerZ: number, radius: number, groundY: number): void {
    this.controls.target.set(centerX, groundY + 0.6, centerZ);
    this.camera.position.set(
      centerX + radius * 0.9,
      groundY + radius * 0.75,
      centerZ + radius * 1.35
    );
    this.controls.update();
  }

  public showSingleMode(): void {
    this.exitWorldMode();
    this.ground.visible = true;
    this.stoneGroup.visible = true;
  }

  /** Stream real world stones over a lab terrain. */
  public enterWorldMode(config: WorldConfig, rollingHeight: number): WorldModeResources {
    this.exitWorldMode();
    this.stoneGroup.visible = false;
    this.ground.visible = false;

    const terrain = new TerrainField({
      seed: config.seed,
      rollingHeight,
      rollingScale: 46,
      waterLevel: null
    });
    const stoneField = new StoneField(terrain, config);
    const system = new WorldStoneSystem(this.scene, stoneField, config, false, true);
    const groundMesh = this.buildTerrainMesh(terrain, config);
    this.scene.add(groundMesh);

    this.world = { terrain, stoneField, system, groundMesh };
    return this.world;
  }

  public get worldResources(): WorldModeResources | null {
    return this.world;
  }

  public exitWorldMode(): void {
    if (this.world === null) {
      return;
    }
    this.world.system.dispose();
    this.scene.remove(this.world.groundMesh);
    this.world.groundMesh.geometry.dispose();
    (this.world.groundMesh.material as THREE.Material).dispose();
    this.world = null;
    this.ground.visible = true;
  }

  public clearStones(): void {
    while (this.stoneGroup.children.length > 0) {
      const child = this.stoneGroup.children[0];
      this.stoneGroup.remove(child);
      if (child instanceof THREE.Mesh) {
        child.geometry.dispose();
      }
    }
  }

  public addStoneMesh(mesh: THREE.Mesh): void {
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.stoneGroup.add(mesh);
  }

  public collectExportMeshes(): THREE.Mesh[] {
    const meshes: THREE.Mesh[] = [];
    const visit = (root: THREE.Object3D): void => {
      root.traverse((object) => {
        if (
          object instanceof THREE.Mesh &&
          object !== this.ground &&
          object.name !== 'lab-terrain'
        ) {
          meshes.push(object);
        }
      });
    };
    if (this.world !== null) {
      visit(this.scene);
    } else {
      visit(this.stoneGroup);
    }
    return meshes;
  }

  public snapshotPng(): string {
    this.renderer.render(this.scene, this.camera);
    return this.canvas.toDataURL('image/png');
  }

  public dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.exitWorldMode();
    this.renderer.setAnimationLoop(null);
    window.removeEventListener('resize', this.resize);
    this.controls.dispose();
    this.renderer.dispose();
  }

  private buildTerrainMesh(terrain: TerrainField, config: WorldConfig): THREE.Mesh {
    const radiusChunks = config.stoneRadiusDesktop;
    const extent = (radiusChunks + 1) * config.chunkSize * 2;
    const segments = Math.min(196, Math.max(48, Math.round(extent / 2)));
    const geometry = new THREE.PlaneGeometry(extent, extent, segments, segments);
    geometry.rotateX(-Math.PI / 2);
    const positions = geometry.getAttribute('position');
    for (let index = 0; index < positions.count; index += 1) {
      const x = positions.getX(index);
      const z = positions.getZ(index);
      positions.setY(index, terrain.sampleHeight(x, z));
    }
    positions.needsUpdate = true;
    geometry.computeVertexNormals();
    const mesh = new THREE.Mesh(
      geometry,
      new THREE.MeshLambertMaterial({ color: '#4d7440' })
    );
    mesh.name = 'lab-terrain';
    mesh.receiveShadow = true;
    return mesh;
  }

  private configureShadow(halfExtent: number): void {
    this.sun.shadow.camera.left = -halfExtent;
    this.sun.shadow.camera.right = halfExtent;
    this.sun.shadow.camera.top = halfExtent;
    this.sun.shadow.camera.bottom = -halfExtent;
    this.sun.shadow.camera.near = 1;
    this.sun.shadow.camera.far = this.sun.position.length() + halfExtent * 2;
    this.sun.shadow.camera.updateProjectionMatrix();
    this.sun.shadow.normalBias = 0.02;
    this.sun.shadow.radius = 3;
    this.sun.shadow.bias = -0.0008;
    this.sun.shadow.mapSize.set(2048, 2048);
  }

  public setShadowExtent(halfExtent: number): void {
    this.configureShadow(halfExtent);
  }

  private readonly resize = (): void => {
    const width = Math.max(1, this.host.clientWidth);
    const height = Math.max(1, this.host.clientHeight);
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  };

  private readonly tick = (): void => {
    const frameStart = performance.now();
    if (this.turntable) {
      this.stoneGroup.rotation.y += 0.004;
    }
    this.controls.update();
    if (this.world !== null) {
      // Follow the sun's shadow to the camera in streamed modes.
      this.sun.target.position.set(
        this.controls.target.x,
        this.controls.target.y,
        this.controls.target.z
      );
      this.world.system.update(this.camera.position, performance.now() + 6);
    }
    this.renderer.render(this.scene, this.camera);

    this.frameCount += 1;
    const now = performance.now();
    if (now - this.statsWindowStart >= 500 && this.statsListener !== null) {
      const fps = (this.frameCount * 1000) / (now - this.statsWindowStart);
      this.statsListener({
        fps,
        frameMs: now - frameStart,
        drawCalls: this.renderer.info.render.calls,
        triangles: this.renderer.info.render.triangles
      });
      this.frameCount = 0;
      this.statsWindowStart = now;
    }
    this.lastFrameStart = frameStart;
    void this.lastFrameStart;
  };
}
