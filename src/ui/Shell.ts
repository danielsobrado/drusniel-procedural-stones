import { escapeHtml } from '../utils/html';
import { LAB_CONFIG } from '../config/labConfig';
import type { LabMode } from '../app/ProjectState';
import type { RendererStats } from '../engine/LabRenderer';

export interface ShellElements {
  viewport: HTMLElement;
  library: HTMLElement;
  inspector: HTMLElement;
  layers: HTMLElement;
  projectInput: HTMLInputElement;
  presetInput: HTMLInputElement;
  performance: HTMLElement;
  objectLabel: HTMLElement;
  status: HTMLElement;
}

function required<T extends Element>(root: ParentNode, selector: string): T {
  const element = root.querySelector<T>(selector);
  if (element === null) {
    throw new Error(`Missing required UI element: ${selector}`);
  }
  return element;
}

const MODES: readonly { id: LabMode; label: string; title: string }[] = [
  { id: 'single', label: 'Stone', title: 'Single stone editor' },
  { id: 'cluster', label: 'Cluster', title: 'Cluster / formation preview' },
  { id: 'field', label: 'Field', title: 'Streamed stone field' }
];

export class Shell {
  public readonly elements: ShellElements;

  private readonly root: HTMLElement;
  private readonly toastElement: HTMLElement;
  private toastTimer: number | null = null;

  public constructor(root: HTMLElement) {
    this.root = root;
    const appName = escapeHtml(LAB_CONFIG.app.name);

    this.root.innerHTML = `
      <div class="app-shell">
        <header class="topbar">
          <div class="brand" title="${appName}">
            <span class="brand-mark" aria-hidden="true">PSL</span>
            <div class="brand-copy">
              <strong>${appName}</strong>
              <span>Procedural stone authoring</span>
            </div>
          </div>

          <div class="toolbar-group toolbar-project" aria-label="Project and export commands">
            <button class="icon-button" data-command="undo" aria-label="Undo" title="Undo (Ctrl/Cmd+Z)">↶</button>
            <button class="icon-button" data-command="redo" aria-label="Redo" title="Redo (Ctrl/Cmd+Shift+Z)">↷</button>
            <span class="toolbar-divider" aria-hidden="true"></span>
            <button class="compact-button" data-command="open-project">Open</button>
            <button class="compact-button" data-command="save-project">Save</button>
            <button class="compact-button" data-command="export-glb" title="Export the current stone as binary glTF">Export GLB</button>
          </div>

          <div class="toolbar-group toolbar-view" aria-label="Viewport commands">
            <span class="status-pill" data-role="status">Stones · WebGL</span>
            <div class="mode-switch" role="group" aria-label="Preview mode">
              ${MODES.map(
                (mode) => `
                <button class="compact-button mode-button" data-mode="${mode.id}" title="${escapeHtml(mode.title)}">${escapeHtml(mode.label)}</button>
              `
              ).join('')}
            </div>
            <button class="icon-button" data-command="reroll" aria-label="Reroll seed" title="Reroll seed (R)">⚄</button>
            <button class="icon-button" data-command="turntable" aria-label="Toggle turntable" title="Toggle turntable">↻</button>
            <button class="icon-button" data-command="wireframe" aria-label="Toggle wireframe" title="Toggle wireframe (W)">◇</button>
            <button class="icon-button" data-command="snapshot" aria-label="Save preview PNG" title="Save PNG">◫</button>
          </div>
        </header>

        <aside class="panel library-panel" data-role="library"></aside>

        <main class="viewport" data-role="viewport">
          <div class="viewport-badge">
            <span class="live-dot" aria-hidden="true"></span>
            <span data-role="object-label">Boulder</span>
          </div>
          <div class="viewport-help">Drag to orbit · scroll to zoom</div>
          <div class="performance-hud" data-role="performance">Profiling…</div>
        </main>

        <aside class="panel inspector-panel" data-role="inspector"></aside>
        <section class="layer-dock" data-role="layers"></section>
        <div class="toast" data-role="toast" aria-live="polite"></div>

        <input class="visually-hidden" data-role="project-input" type="file" accept=".json,application/json">
        <input class="visually-hidden" data-role="preset-input" type="file" accept=".json,application/json">
      </div>
    `;

    this.elements = {
      viewport: required(this.root, '[data-role="viewport"]'),
      library: required(this.root, '[data-role="library"]'),
      inspector: required(this.root, '[data-role="inspector"]'),
      layers: required(this.root, '[data-role="layers"]'),
      projectInput: required(this.root, '[data-role="project-input"]'),
      presetInput: required(this.root, '[data-role="preset-input"]'),
      performance: required(this.root, '[data-role="performance"]'),
      objectLabel: required(this.root, '[data-role="object-label"]'),
      status: required(this.root, '[data-role="status"]')
    };

    this.toastElement = required(this.root, '[data-role="toast"]');
  }

  public onCommand(command: string, callback: () => void): void {
    const button = this.root.querySelector<HTMLElement>(`[data-command="${command}"]`);
    if (button === null) {
      throw new Error(`Unknown shell command: ${command}`);
    }
    button.addEventListener('click', callback);
  }

  public onModeChange(callback: (mode: LabMode) => void): void {
    for (const button of this.root.querySelectorAll<HTMLElement>('[data-mode]')) {
      button.addEventListener('click', () => {
        callback(button.dataset.mode as LabMode);
      });
    }
  }

  public setMode(mode: LabMode): void {
    for (const button of this.root.querySelectorAll<HTMLElement>('[data-mode]')) {
      button.classList.toggle('is-active', button.dataset.mode === mode);
    }
  }

  public setPerformanceStats(stats: RendererStats): void {
    this.elements.performance.textContent = [
      `${Math.round(stats.fps)} FPS`,
      `${stats.frameMs.toFixed(1)} ms`,
      `${stats.drawCalls} calls`,
      `${stats.triangles.toLocaleString()} tris`
    ].join(' · ');
  }

  public setObjectLabel(label: string): void {
    this.elements.objectLabel.textContent = label;
  }

  public setStatus(status: string): void {
    this.elements.status.textContent = status;
  }

  public toast(message: string, kind: 'info' | 'error' = 'info'): void {
    if (this.toastTimer !== null) {
      window.clearTimeout(this.toastTimer);
    }
    this.toastElement.textContent = message;
    this.toastElement.dataset.kind = kind;
    this.toastElement.classList.add('is-visible');
    this.toastTimer = window.setTimeout(
      () => {
        this.toastElement.classList.remove('is-visible');
        this.toastTimer = null;
      },
      kind === 'error' ? 5200 : 2600
    );
  }
}
