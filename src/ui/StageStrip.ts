import type { ProjectState } from '../app/ProjectState';
import {
  STONE_STAGE_DEFINITIONS,
  STONE_STAGE_ORDER,
  type StoneStageKind
} from '../stones/StoneStages';
import { escapeHtml } from '../utils/html';

export interface StageStripCallbacks {
  onSelect(kind: StoneStageKind): void;
  onToggle(kind: StoneStageKind): void;
}

/** Compact per-stage status shown under the stage name. */
function stageStatus(state: ProjectState, kind: StoneStageKind): string {
  const stage = state.stages.find((entry) => entry.kind === kind);
  if (stage === undefined || !stage.enabled) {
    return 'off';
  }
  switch (kind) {
    case 'shape':
      return state.archetype;
    case 'cuts': {
      const extra = Math.round(stage.params.extraCuts ?? 0);
      return extra === 0 ? 'auto' : extra > 0 ? `+${extra}` : `${extra}`;
    }
    case 'chips': {
      const extra = Math.round(stage.params.extraChips ?? 0);
      return extra === 0 ? 'auto' : extra > 0 ? `+${extra}` : `${extra}`;
    }
    case 'indentation':
      return `${Math.round((stage.params.chance ?? 0) * 100)}%`;
    case 'fracture-relief':
      return `×${(stage.params.strength ?? 1).toFixed(2)}`;
    case 'weathering':
      return `×${(stage.params.strength ?? 1).toFixed(2)}`;
    case 'moss-lichen':
      return `${Math.round((stage.params.moss ?? 0) * 100)}%`;
    case 'wetness':
      return `${Math.round((stage.params.waterline ?? 0) * 100)}%`;
    case 'grain':
      return `${(stage.params.normalStrength ?? 0).toFixed(2)}`;
  }
}

/**
 * Bottom dock: the stone pipeline as a fixed-order stack of stage cards.
 * Reuses the texture lab's layer-dock styling.
 */
export class StageStrip {
  private readonly host: HTMLElement;
  private readonly callbacks: StageStripCallbacks;

  public constructor(host: HTMLElement, callbacks: StageStripCallbacks) {
    this.host = host;
    this.callbacks = callbacks;
    this.host.addEventListener('click', (event) => {
      const target = event.target as HTMLElement | null;
      const action = target?.closest<HTMLElement>('[data-action]');
      if (action === null || action === undefined) {
        return;
      }
      const card = action.closest<HTMLElement>('[data-stage]');
      const kind = card?.dataset.stage as StoneStageKind | undefined;
      if (kind === undefined) {
        return;
      }
      if (action.dataset.action === 'toggle') {
        this.callbacks.onToggle(kind);
      } else {
        this.callbacks.onSelect(kind);
      }
    });
  }

  public render(state: ProjectState): void {
    const cards = STONE_STAGE_ORDER.map((kind) => {
      const definition = STONE_STAGE_DEFINITIONS[kind];
      const stage = state.stages.find((entry) => entry.kind === kind);
      const enabled = stage?.enabled ?? false;
      const selected = state.selectedStageKind === kind;
      return `
        <article
          class="layer-card stage-card ${selected ? 'is-selected' : ''} ${enabled ? '' : 'is-disabled'}"
          data-stage="${kind}"
          title="${escapeHtml(definition.description)}"
        >
          <button
            class="layer-visibility"
            data-action="toggle"
            aria-label="${enabled ? 'Disable' : 'Enable'} ${escapeHtml(definition.label)}"
            title="${definition.locked === true ? 'The shape stage is always on' : 'Toggle stage'}"
            ${definition.locked === true ? 'disabled' : ''}
          >${enabled ? '●' : '○'}</button>
          <button class="layer-main" data-action="select" aria-label="Edit ${escapeHtml(definition.label)}">
            <span class="layer-swatch stage-glyph" aria-hidden="true">${definition.icon}</span>
            <span class="layer-copy">
              <strong>${escapeHtml(definition.label)}</strong>
              <small>${escapeHtml(stageStatus(state, kind))}</small>
            </span>
          </button>
        </article>
      `;
    }).join('');

    this.host.innerHTML = `
      <div class="layer-dock-heading">
        <div>
          <span class="eyebrow">Stone pipeline</span>
        </div>
      </div>
      <div class="layer-scroll">${cards}</div>
    `;
  }
}
