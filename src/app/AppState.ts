import { LAB_CONFIG } from '../config/labConfig';
import {
  createDefaultProject,
  normalizeProject,
  type ProjectState
} from './ProjectState';
import type { StoneStageKind } from '../stones/StoneStages';

export type StateChangeReason =
  | 'project'
  | 'stone'
  | 'stages'
  | 'selection'
  | 'mode'
  | 'viewport'
  | 'cluster'
  | 'field';

export type StateListener = (state: ProjectState, reason: StateChangeReason) => void;

/**
 * Same pattern as the texture lab: a cloned project snapshot, reasoned
 * notifications, undo/redo with commit coalescing for slider drags, and a
 * debounced localStorage autosave.
 */
export class AppState {
  private project: ProjectState;
  private readonly listeners = new Set<StateListener>();
  private readonly undoStack: ProjectState[] = [];
  private readonly redoStack: ProjectState[] = [];
  private coalesceTimer: number | null = null;
  private pendingHistoryBase: ProjectState | null = null;
  private autosaveTimer: number | null = null;

  public constructor() {
    this.project = this.restoreAutosave() ?? createDefaultProject();
  }

  public get state(): ProjectState {
    return this.project;
  }

  public subscribe(listener: StateListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  public canUndo(): boolean {
    return this.undoStack.length > 0 || this.pendingHistoryBase !== null;
  }

  public canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  public undo(): boolean {
    this.flushHistory();
    const previous = this.undoStack.pop();
    if (previous === undefined) {
      return false;
    }
    this.redoStack.push(structuredClone(this.project));
    this.project = previous;
    this.emit('project');
    return true;
  }

  public redo(): boolean {
    this.flushHistory();
    const next = this.redoStack.pop();
    if (next === undefined) {
      return false;
    }
    this.undoStack.push(structuredClone(this.project));
    this.project = next;
    this.emit('project');
    return true;
  }

  /**
   * Apply a mutation. Consecutive edits inside the coalescing window share one
   * undo entry, so slider drags stay a single step.
   */
  public update(
    reason: StateChangeReason,
    mutate: (draft: ProjectState) => void,
    options: { coalesce?: boolean } = {}
  ): void {
    if (this.pendingHistoryBase === null) {
      this.pendingHistoryBase = structuredClone(this.project);
    }
    const draft = structuredClone(this.project);
    mutate(draft);
    this.project = normalizeProject(draft);
    if (options.coalesce === true) {
      if (this.coalesceTimer !== null) {
        window.clearTimeout(this.coalesceTimer);
      }
      this.coalesceTimer = window.setTimeout(() => this.flushHistory(), 350);
    } else {
      this.flushHistory();
    }
    this.emit(reason);
  }

  public replaceProject(raw: unknown): void {
    this.flushHistory();
    this.undoStack.push(structuredClone(this.project));
    this.redoStack.length = 0;
    this.project = normalizeProject(raw);
    this.emit('project');
  }

  public resetProject(): void {
    this.replaceProject(createDefaultProject());
  }

  public selectStage(kind: StoneStageKind | null): void {
    if (this.project.selectedStageKind === kind) {
      return;
    }
    this.project.selectedStageKind = kind;
    this.emit('selection');
  }

  private flushHistory(): void {
    if (this.coalesceTimer !== null) {
      window.clearTimeout(this.coalesceTimer);
      this.coalesceTimer = null;
    }
    const base = this.pendingHistoryBase;
    if (base === null) {
      return;
    }
    this.pendingHistoryBase = null;
    if (JSON.stringify(base) === JSON.stringify(this.project)) {
      return;
    }
    this.undoStack.push(base);
    this.redoStack.length = 0;
    if (this.undoStack.length > LAB_CONFIG.app.historyLimit) {
      this.undoStack.shift();
    }
  }

  private emit(reason: StateChangeReason): void {
    for (const listener of this.listeners) {
      listener(this.project, reason);
    }
    this.scheduleAutosave();
  }

  private scheduleAutosave(): void {
    if (this.autosaveTimer !== null) {
      window.clearTimeout(this.autosaveTimer);
    }
    this.autosaveTimer = window.setTimeout(() => {
      try {
        window.localStorage.setItem(
          LAB_CONFIG.app.autosaveKey,
          JSON.stringify(this.project)
        );
      } catch {
        // Storage may be unavailable; autosave is best-effort.
      }
    }, LAB_CONFIG.app.autosaveDelayMs);
  }

  private restoreAutosave(): ProjectState | null {
    try {
      const raw = window.localStorage.getItem(LAB_CONFIG.app.autosaveKey);
      if (raw === null) {
        return null;
      }
      return normalizeProject(JSON.parse(raw));
    } catch {
      return null;
    }
  }
}
