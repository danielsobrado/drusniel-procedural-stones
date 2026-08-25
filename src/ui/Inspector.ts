import { LAB_CONFIG, type ControlRange } from '../config/labConfig';
import type { ProjectState } from '../app/ProjectState';
import { STONE_PALETTES, type StonePaletteKey } from '../world/stones/StonePalette';
import {
  STONE_STAGE_DEFINITIONS,
  stageParamRange,
  type StoneStageKind
} from '../stones/StoneStages';
import { escapeHtml } from '../utils/html';

export interface InspectorCallbacks {
  onStoneNumber(key: 'seed' | 'scale' | 'valueScale', value: number, commit: boolean): void;
  onQuality(value: boolean): void;
  onFormationPair(value: boolean): void;
  onPalette(key: StonePaletteKey): void;
  onStageParam(kind: StoneStageKind, key: string, value: number, commit: boolean): void;
  onClusterNumber(key: string, value: number, commit: boolean): void;
  onFieldNumber(key: string, value: number, commit: boolean): void;
  onEnvironment(value: ProjectState['environment']): void;
}

const PALETTE_LABELS: Record<StonePaletteKey, string> = {
  meadowSage: 'Meadow sage',
  steppeTan: 'Steppe tan',
  graniteGrey: 'Granite grey',
  mossy: 'Mossy'
};

const CLUSTER_LABELS: Record<string, string> = {
  seed: 'Cluster seed',
  budget: 'Stone budget',
  radius: 'Radius (m)',
  aspect: 'Aspect',
  formationChance: 'Split chance'
};

const FIELD_LABELS: Record<string, string> = {
  seed: 'World seed',
  density: 'Density',
  clusterChance: 'Cluster chance',
  clusterSpacing: 'Cluster spacing',
  singletonChance: 'Singletons',
  formationChance: 'Formations',
  radiusChunks: 'Stream radius',
  detailRadiusChunks: 'Detail radius',
  rollingHeight: 'Terrain relief'
};

function sliderRow(
  dataKey: string,
  dataValue: string,
  label: string,
  range: ControlRange,
  value: number
): string {
  return `
    <div class="parameter-row">
      <span>${escapeHtml(label)}</span>
      <input ${dataKey}="${dataValue}" type="range" min="${range.min}" max="${range.max}" step="${range.step}" value="${value}">
      <input class="number-input" ${dataKey}="${dataValue}" type="number" min="${range.min}" max="${range.max}" step="${range.step}" value="${value}">
    </div>
  `;
}

export class Inspector {
  private readonly host: HTMLElement;
  private readonly callbacks: InspectorCallbacks;

  public constructor(host: HTMLElement, callbacks: InspectorCallbacks) {
    this.host = host;
    this.callbacks = callbacks;
    this.host.addEventListener('input', (event) => this.handleInput(event, false));
    this.host.addEventListener('change', (event) => this.handleInput(event, true));
  }

  public render(state: ProjectState): void {
    this.host.innerHTML = `
      <div class="panel-heading">
        <span class="eyebrow">Inspector</span>
        <strong>${escapeHtml(this.headingFor(state))}</strong>
      </div>
      ${state.mode === 'single' ? this.stoneSection(state) : ''}
      ${state.mode === 'single' ? this.stageSection(state) : ''}
      ${state.mode === 'cluster' ? this.clusterSection(state) : ''}
      ${state.mode === 'field' ? this.fieldSection(state) : ''}
      ${this.viewportSection(state)}
    `;
  }

  private headingFor(state: ProjectState): string {
    if (state.mode === 'cluster') {
      return 'Cluster';
    }
    if (state.mode === 'field') {
      return 'Stone field';
    }
    const kind = state.selectedStageKind;
    return kind === null ? 'Stone' : STONE_STAGE_DEFINITIONS[kind].label;
  }

  private stoneSection(state: ProjectState): string {
    return `
      <section class="inspector-section">
        <div class="section-heading"><span>Stone</span></div>
        ${sliderRow('data-stone', 'seed', 'Seed', LAB_CONFIG.stone.seed, state.seed)}
        ${sliderRow('data-stone', 'scale', 'Scale', LAB_CONFIG.stone.scale, state.scale)}
        ${sliderRow('data-stone', 'valueScale', 'Value', LAB_CONFIG.stone.valueScale, state.valueScale)}
        <label class="field-stack routing-field">
          <span>Palette</span>
          <select data-palette>
            ${(Object.keys(STONE_PALETTES) as StonePaletteKey[])
              .map(
                (key) =>
                  `<option value="${key}" ${state.paletteKey === key ? 'selected' : ''}>${PALETTE_LABELS[key]}</option>`
              )
              .join('')}
          </select>
        </label>
        <label class="toggle-row"><span>Best-of-N silhouette</span><input data-toggle="quality" type="checkbox" ${state.quality ? 'checked' : ''}></label>
        <label class="toggle-row"><span>Show formation pair</span><input data-toggle="formationPair" type="checkbox" ${state.formationPair ? 'checked' : ''}></label>
      </section>
    `;
  }

  private stageSection(state: ProjectState): string {
    const kind = state.selectedStageKind;
    if (kind === null) {
      return '';
    }
    const definition = STONE_STAGE_DEFINITIONS[kind];
    const stage = state.stages.find((entry) => entry.kind === kind);
    if (stage === undefined) {
      return '';
    }
    const rows = definition.params
      .map((param) => {
        const range = stageParamRange(kind, param.key);
        const value = stage.params[param.key] ?? range.default;
        return sliderRow('data-stage-param', `${kind}:${param.key}`, param.label, range, value);
      })
      .join('');
    return `
      <section class="inspector-section parameter-section">
        <div class="section-heading"><span>${escapeHtml(definition.label)} stage</span><small>${stage.enabled ? 'on' : 'off'}</small></div>
        <p class="section-note">${escapeHtml(definition.description)}</p>
        ${rows}
      </section>
    `;
  }

  private clusterSection(state: ProjectState): string {
    const rows = Object.entries(LAB_CONFIG.cluster)
      .map(([key, range]) =>
        sliderRow(
          'data-cluster',
          key,
          CLUSTER_LABELS[key] ?? key,
          range,
          state.cluster[key as keyof typeof state.cluster]
        )
      )
      .join('');
    return `
      <section class="inspector-section parameter-section">
        <div class="section-heading"><span>Cluster</span></div>
        <p class="section-note">Anchor, secondary and debris stones composed as one geological family.</p>
        ${rows}
      </section>
    `;
  }

  private fieldSection(state: ProjectState): string {
    const rows = Object.entries(LAB_CONFIG.field)
      .map(([key, range]) =>
        sliderRow(
          'data-field',
          key,
          FIELD_LABELS[key] ?? key,
          range,
          state.field[key as keyof typeof state.field]
        )
      )
      .join('');
    return `
      <section class="inspector-section parameter-section">
        <div class="section-heading"><span>Stone field</span></div>
        <p class="section-note">Streamed chunk batches with distance LOD, exactly as the world renders them.</p>
        ${rows}
      </section>
    `;
  }

  private viewportSection(state: ProjectState): string {
    return `
      <section class="inspector-section">
        <div class="section-heading"><span>Viewport</span></div>
        <label class="field-stack routing-field">
          <span>Environment</span>
          <select data-environment>
            <option value="meadow" ${state.environment === 'meadow' ? 'selected' : ''}>Meadow</option>
            <option value="overcast" ${state.environment === 'overcast' ? 'selected' : ''}>Overcast</option>
            <option value="studio" ${state.environment === 'studio' ? 'selected' : ''}>Studio</option>
          </select>
        </label>
      </section>
    `;
  }

  private handleInput(event: Event, commit: boolean): void {
    const target = event.target as HTMLElement | null;
    if (target === null) {
      return;
    }

    if (target instanceof HTMLSelectElement) {
      if (!commit) {
        return;
      }
      if (target.hasAttribute('data-palette')) {
        this.callbacks.onPalette(target.value as StonePaletteKey);
      } else if (target.hasAttribute('data-environment')) {
        this.callbacks.onEnvironment(target.value as ProjectState['environment']);
      }
      return;
    }

    if (!(target instanceof HTMLInputElement)) {
      return;
    }

    if (target.type === 'checkbox') {
      if (!commit) {
        return;
      }
      if (target.dataset.toggle === 'quality') {
        this.callbacks.onQuality(target.checked);
      } else if (target.dataset.toggle === 'formationPair') {
        this.callbacks.onFormationPair(target.checked);
      }
      return;
    }

    const value = Number(target.value);
    if (!Number.isFinite(value)) {
      return;
    }
    this.syncTwin(target);

    const stone = target.dataset.stone;
    if (stone !== undefined) {
      this.callbacks.onStoneNumber(stone as 'seed' | 'scale' | 'valueScale', value, commit);
      return;
    }
    const stageParamKey = target.dataset.stageParam;
    if (stageParamKey !== undefined) {
      const [kind, key] = stageParamKey.split(':');
      this.callbacks.onStageParam(kind as StoneStageKind, key, value, commit);
      return;
    }
    const cluster = target.dataset.cluster;
    if (cluster !== undefined) {
      this.callbacks.onClusterNumber(cluster, value, commit);
      return;
    }
    const field = target.dataset.field;
    if (field !== undefined) {
      this.callbacks.onFieldNumber(field, value, commit);
    }
  }

  /** Keep the paired range/number input in step without a full re-render. */
  private syncTwin(source: HTMLInputElement): void {
    const row = source.closest('.parameter-row');
    if (row === null) {
      return;
    }
    for (const input of row.querySelectorAll<HTMLInputElement>('input')) {
      if (input !== source) {
        input.value = source.value;
      }
    }
  }
}
