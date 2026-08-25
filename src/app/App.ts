import type { StateChangeReason } from './AppState';
import { AppState } from './AppState';
import {
  createDefaultStages,
  type StoneStageKind
} from '../stones/StoneStages';
import {
  buildClusterPreview,
  buildSinglePreview,
  createStoneMaterial,
  fieldWorldConfig
} from '../stones/StonePreview';
import { stoneMaterialSignature } from '../stones/StoneMaterial';
import type { StonePreset } from '../stones/presets';
import { LabRenderer } from '../engine/LabRenderer';
import { Inspector } from '../ui/Inspector';
import { LibraryPanel } from '../ui/LibraryPanel';
import { Shell } from '../ui/Shell';
import { StageStrip } from '../ui/StageStrip';
import { downloadJson, readFileAsText } from '../utils/download';
import { exportGlb, exportPngDataUrl } from '../export/exporters';
import type { ClusterSettings, FieldSettings, LabMode, ProjectState } from './ProjectState';
import type { StoneArchetypeId } from '../world/stones/StoneRecipe';
import * as THREE from 'three';

function isTextEditingTarget(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    (target instanceof HTMLElement && target.isContentEditable)
  );
}

function capitalise(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function applyPresetToDraft(draft: ProjectState, preset: StonePreset): void {
  draft.archetype = preset.archetype;
  draft.paletteKey = preset.paletteKey;
  draft.seed = preset.seed;
  if (preset.valueScale !== undefined) {
    draft.valueScale = preset.valueScale;
  }
  draft.stages = createDefaultStages();
  if (preset.stages === undefined) {
    return;
  }
  for (const [kind, override] of Object.entries(preset.stages)) {
    const stage = draft.stages.find((entry) => entry.kind === kind);
    if (stage === undefined || override === undefined) {
      continue;
    }
    if (override.enabled !== undefined) {
      stage.enabled = override.enabled;
    }
    if (override.params !== undefined) {
      for (const [key, value] of Object.entries(override.params)) {
        if (key in stage.params && Number.isFinite(value)) {
          stage.params[key] = value;
        }
      }
    }
  }
}

export class App {
  private readonly shell: Shell;
  private readonly state: AppState;
  private readonly renderer: LabRenderer;
  private readonly library: LibraryPanel;
  private readonly inspector: Inspector;
  private readonly stages: StageStrip;
  private material: THREE.MeshLambertMaterial;
  private materialSignature: string;
  private rebuildFrame = 0;
  private fieldRebuildTimer: number | null = null;
  private panelFrame = 0;
  private pendingPanel: ProjectState | null = null;
  private pendingInspector = false;
  private pendingLibrary = false;
  private pendingStages = false;
  private framedKey = '';
  private lastMode: LabMode | null = null;
  private lastFieldKey = '';

  public constructor(root: HTMLElement) {
    this.shell = new Shell(root);
    this.state = new AppState();
    this.renderer = new LabRenderer(this.shell.elements.viewport);
    this.renderer.onStats((stats) => this.shell.setPerformanceStats(stats));

    this.materialSignature = stoneMaterialSignature(this.state.state.stages);
    this.material = createStoneMaterial(this.state.state.stages);

    this.library = new LibraryPanel(this.shell.elements.library, {
      onArchetype: (archetype) => this.setArchetype(archetype),
      onPreset: (preset) => this.applyPreset(preset),
      onLoadPresetFile: () => this.shell.elements.presetInput.click(),
      onSavePresetFile: () => this.savePresetFile()
    });

    this.inspector = new Inspector(this.shell.elements.inspector, {
      onStoneNumber: (key, value, commit) => {
        this.state.update('stone', (draft) => {
          draft[key] = value;
        }, { coalesce: !commit });
      },
      onQuality: (value) => {
        this.state.update('stone', (draft) => {
          draft.quality = value;
        });
      },
      onFormationPair: (value) => {
        this.state.update('stone', (draft) => {
          draft.formationPair = value;
        });
      },
      onPalette: (key) => {
        this.state.update('stone', (draft) => {
          draft.paletteKey = key;
        });
      },
      onStageParam: (kind, key, value, commit) => {
        this.state.update('stages', (draft) => {
          const stage = draft.stages.find((entry) => entry.kind === kind);
          if (stage !== undefined) {
            stage.params[key] = value;
          }
        }, { coalesce: !commit });
      },
      onClusterNumber: (key, value, commit) => {
        this.state.update('cluster', (draft) => {
          if (Object.prototype.hasOwnProperty.call(draft.cluster, key)) {
            draft.cluster[key as keyof ClusterSettings] = value;
          }
        }, { coalesce: !commit });
      },
      onFieldNumber: (key, value, commit) => {
        this.state.update('field', (draft) => {
          if (Object.prototype.hasOwnProperty.call(draft.field, key)) {
            draft.field[key as keyof FieldSettings] = value;
          }
        }, { coalesce: !commit });
      },
      onEnvironment: (value) => {
        this.state.update('viewport', (draft) => {
          draft.environment = value;
        });
      }
    });

    this.stages = new StageStrip(this.shell.elements.layers, {
      onSelect: (kind) => this.state.selectStage(kind),
      onToggle: (kind) => this.toggleStage(kind)
    });

    this.state.subscribe((project, reason) => this.handleStateChange(project, reason));
    this.bindCommands();
    this.bindFiles();
    this.bindKeyboard();
    this.library.render(this.state.state);
    this.inspector.render(this.state.state);
    this.stages.render(this.state.state);
    this.syncChrome(this.state.state, true);
    this.rebuildPreview(this.state.state, true);
  }

  private handleStateChange(project: ProjectState, reason: StateChangeReason): void {
    const inspect =
      reason === 'project' ||
      reason === 'selection' ||
      reason === 'mode' ||
      reason === 'viewport';
    const library = reason === 'project' || reason === 'stone' || reason === 'mode';
    const strip = reason !== 'viewport';
    this.schedulePanels(project, { inspector: inspect, library, stages: strip });
    this.syncChrome(project, reason === 'mode' || reason === 'project');

    if (reason === 'viewport' && project.mode === this.lastMode) {
      this.renderer.setEnvironment(project.environment);
      this.renderer.setTurntable(project.turntable);
      this.renderer.setWireframe(project.wireframe);
      return;
    }

    this.scheduleRebuild();
  }

  private schedulePanels(
    state: ProjectState,
    panels: { inspector?: boolean; library?: boolean; stages?: boolean }
  ): void {
    this.pendingPanel = state;
    this.pendingInspector ||= panels.inspector === true;
    this.pendingLibrary ||= panels.library === true;
    this.pendingStages ||= panels.stages === true;
    if (this.panelFrame !== 0) {
      return;
    }
    this.panelFrame = window.requestAnimationFrame(() => {
      this.panelFrame = 0;
      const next = this.pendingPanel;
      const inspector = this.pendingInspector;
      const library = this.pendingLibrary;
      const stages = this.pendingStages;
      this.pendingPanel = null;
      this.pendingInspector = false;
      this.pendingLibrary = false;
      this.pendingStages = false;
      if (next === null) {
        return;
      }
      if (inspector) {
        this.inspector.render(next);
      }
      if (library) {
        this.library.render(next);
      }
      if (stages) {
        this.stages.render(next);
      }
    });
  }

  private syncChrome(state: ProjectState, refreshLabel: boolean): void {
    this.shell.setMode(state.mode);
    if (refreshLabel) {
      const label =
        state.mode === 'single'
          ? capitalise(state.archetype)
          : state.mode === 'cluster'
            ? 'Cluster'
            : 'Stone field';
      this.shell.setObjectLabel(label);
    }
    this.shell.setStatus(
      state.mode === 'single'
        ? `${capitalise(state.archetype)} · seed ${state.seed}`
        : state.mode === 'cluster'
          ? `Cluster · ${Math.round(state.cluster.budget)} stones`
          : `Field · seed ${Math.trunc(state.field.seed)}`
    );
  }

  private scheduleRebuild(): void {
    if (this.rebuildFrame !== 0) {
      return;
    }
    this.rebuildFrame = window.requestAnimationFrame(() => {
      this.rebuildFrame = 0;
      this.rebuildPreview(this.state.state, false);
    });
  }

  private rebuildPreview(state: ProjectState, forceFrame: boolean): void {
    this.renderer.setEnvironment(state.environment);
    this.renderer.setTurntable(state.turntable);

    const signature = stoneMaterialSignature(state.stages);
    if (signature !== this.materialSignature) {
      this.material.dispose();
      this.material = createStoneMaterial(state.stages);
      this.materialSignature = signature;
    }

    if (state.mode === 'field') {
      this.scheduleFieldRebuild(state, forceFrame);
      return;
    }

    if (this.fieldRebuildTimer !== null) {
      window.clearTimeout(this.fieldRebuildTimer);
      this.fieldRebuildTimer = null;
    }
    this.renderer.showSingleMode();
    this.renderer.clearStones();
    this.lastFieldKey = '';

    const preview =
      state.mode === 'cluster'
        ? buildClusterPreview(state, this.material)
        : buildSinglePreview(state, this.material);
    for (const mesh of preview.meshes) {
      this.renderer.addStoneMesh(mesh);
    }
    this.renderer.setWireframe(state.wireframe);

    const frameKey = `${state.mode}:${state.archetype}:${state.seed}:${state.cluster.seed}:${state.cluster.radius}`;
    if (forceFrame || frameKey !== this.framedKey || this.lastMode !== state.mode) {
      this.framedKey = frameKey;
      this.renderer.frameStone(preview.bounds.radius, preview.bounds.height);
      this.renderer.setShadowExtent(Math.max(preview.bounds.radius * 1.6, 4));
    }
    this.lastMode = state.mode;
  }

  private scheduleFieldRebuild(state: ProjectState, forceFrame: boolean): void {
    const key = JSON.stringify({
      field: state.field,
      grain: this.materialSignature,
      environment: state.environment
    });
    if (!forceFrame && key === this.lastFieldKey && this.lastMode === 'field') {
      this.renderer.setEnvironment(state.environment);
      this.renderer.setWireframe(state.wireframe);
      return;
    }
    if (this.fieldRebuildTimer !== null) {
      window.clearTimeout(this.fieldRebuildTimer);
    }
    const delay = forceFrame || this.lastMode !== 'field' ? 0 : 180;
    this.fieldRebuildTimer = window.setTimeout(() => {
      this.fieldRebuildTimer = null;
      this.enterField(state, forceFrame);
      this.lastFieldKey = key;
    }, delay);
  }

  private enterField(state: ProjectState, forceFrame: boolean): void {
    const config = fieldWorldConfig(state);
    this.renderer.enterWorldMode(config, state.field.rollingHeight);
    this.renderer.setEnvironment(state.environment);
    this.renderer.setWireframe(state.wireframe);
    const viewRadius = Math.min(28, config.chunkSize * 0.42);
    if (forceFrame || this.lastMode !== 'field') {
      this.renderer.frameArea(0, 0, viewRadius, 0.35);
      this.renderer.setShadowExtent(22);
    }
    this.lastMode = 'field';
  }

  private setArchetype(archetype: StoneArchetypeId): void {
    this.state.update('stone', (draft) => {
      draft.archetype = archetype;
    });
  }

  private applyPreset(preset: StonePreset): void {
    this.state.update('project', (draft) => applyPresetToDraft(draft, preset));
    this.shell.toast(`Loaded ${preset.name}.`);
  }

  private toggleStage(kind: StoneStageKind): void {
    this.state.update('stages', (draft) => {
      const stage = draft.stages.find((entry) => entry.kind === kind);
      if (stage === undefined) {
        return;
      }
      stage.enabled = !stage.enabled;
    });
  }

  private bindCommands(): void {
    this.shell.onCommand('undo', () => {
      if (!this.state.undo()) {
        this.shell.toast('Nothing to undo.');
      }
    });
    this.shell.onCommand('redo', () => {
      if (!this.state.redo()) {
        this.shell.toast('Nothing to redo.');
      }
    });
    this.shell.onCommand('open-project', () => this.shell.elements.projectInput.click());
    this.shell.onCommand('save-project', () => {
      downloadJson(this.state.state, 'procedural-stone-lab.json');
      this.shell.toast('Project saved.');
    });
    this.shell.onCommand('export-glb', () => {
      void this.exportCurrentGlb();
    });
    this.shell.onCommand('reroll', () => this.reroll());
    this.shell.onCommand('turntable', () => {
      this.state.update('viewport', (draft) => {
        draft.turntable = !draft.turntable;
      });
    });
    this.shell.onCommand('wireframe', () => {
      this.state.update('viewport', (draft) => {
        draft.wireframe = !draft.wireframe;
      });
    });
    this.shell.onCommand('snapshot', () => {
      exportPngDataUrl(this.renderer.snapshotPng(), 'stone-lab.png');
      this.shell.toast('PNG saved.');
    });
    this.shell.onModeChange((mode) => {
      this.state.update('mode', (draft) => {
        draft.mode = mode;
      });
    });
  }

  private bindFiles(): void {
    this.shell.elements.projectInput.addEventListener('change', () => {
      const file = this.shell.elements.projectInput.files?.[0];
      this.shell.elements.projectInput.value = '';
      if (file !== undefined) {
        void this.openProjectFile(file);
      }
    });
    this.shell.elements.presetInput.addEventListener('change', () => {
      const file = this.shell.elements.presetInput.files?.[0];
      this.shell.elements.presetInput.value = '';
      if (file !== undefined) {
        void this.openPresetFile(file);
      }
    });
  }

  private bindKeyboard(): void {
    window.addEventListener('keydown', (event) => {
      if (isTextEditingTarget(event.target)) {
        return;
      }
      const meta = event.metaKey || event.ctrlKey;
      if (meta && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        if (event.shiftKey) {
          this.state.redo();
        } else {
          this.state.undo();
        }
        return;
      }
      if (event.key.toLowerCase() === 'r') {
        event.preventDefault();
        this.reroll();
        return;
      }
      if (event.key.toLowerCase() === 'w') {
        event.preventDefault();
        this.state.update('viewport', (draft) => {
          draft.wireframe = !draft.wireframe;
        });
      }
    });
  }

  private reroll(): void {
    this.state.update('stone', (draft) => {
      if (draft.mode === 'cluster') {
        draft.cluster.seed = (draft.cluster.seed + 1 + Math.floor(Math.random() * 97)) % 1000000;
      } else if (draft.mode === 'field') {
        draft.field.seed = (draft.field.seed + 1 + Math.floor(Math.random() * 997)) % 1000000;
      } else {
        draft.seed = (draft.seed + 1 + Math.floor(Math.random() * 97)) % 1000000;
      }
    });
  }

  private async openProjectFile(file: File): Promise<void> {
    try {
      const raw = JSON.parse(await readFileAsText(file)) as unknown;
      this.state.replaceProject(raw);
      this.shell.toast('Project opened.');
    } catch (error) {
      this.shell.toast(error instanceof Error ? error.message : 'Could not open project.', 'error');
    }
  }

  private async openPresetFile(file: File): Promise<void> {
    try {
      const raw = JSON.parse(await readFileAsText(file)) as unknown;
      this.state.replaceProject(raw);
      this.shell.toast('Preset loaded.');
    } catch (error) {
      this.shell.toast(error instanceof Error ? error.message : 'Could not open preset.', 'error');
    }
  }

  private savePresetFile(): void {
    const state = this.state.state;
    downloadJson(
      {
        format: 'psl-preset',
        version: 1,
        id: `custom-${state.archetype}-${state.seed}`,
        name: `${capitalise(state.archetype)} ${state.seed}`,
        description: 'User stone preset.',
        tags: [state.archetype, state.paletteKey],
        archetype: state.archetype,
        paletteKey: state.paletteKey,
        seed: state.seed,
        valueScale: state.valueScale,
        stages: Object.fromEntries(
          state.stages.map((stage) => [stage.kind, { enabled: stage.enabled, params: stage.params }])
        ),
        quality: state.quality,
        scale: state.scale,
        formationPair: state.formationPair
      },
      `${state.archetype}-${state.seed}.pslpreset.json`
    );
    this.shell.toast('Preset saved.');
  }

  private async exportCurrentGlb(): Promise<void> {
    try {
      const meshes = this.renderer.collectExportMeshes();
      await exportGlb(meshes, `stone-lab-${this.state.state.mode}.glb`);
      this.shell.toast('GLB exported. Growth shading is baked as vertex colour.');
    } catch (error) {
      this.shell.toast(error instanceof Error ? error.message : 'GLB export failed.', 'error');
    }
  }
}
