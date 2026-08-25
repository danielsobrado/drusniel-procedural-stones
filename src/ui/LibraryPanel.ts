import type { ProjectState } from '../app/ProjectState';
import { STONE_ARCHETYPE_IDS, type StoneArchetypeId } from '../world/stones/StoneRecipe';
import { STONE_PRESETS, type StonePreset } from '../stones/presets';
import { escapeHtml } from '../utils/html';

export interface LibraryCallbacks {
  onArchetype(archetype: StoneArchetypeId): void;
  onPreset(preset: StonePreset): void;
  onLoadPresetFile(): void;
  onSavePresetFile(): void;
}

const ARCHETYPE_GLYPHS: Record<StoneArchetypeId, string> = {
  pebble: '●',
  boulder: '⬢',
  slab: '▬',
  block: '◼',
  shard: '◆',
  outcrop: '⛰'
};

export class LibraryPanel {
  private readonly host: HTMLElement;
  private readonly callbacks: LibraryCallbacks;
  private search = '';
  private activeTag: string | null = null;

  public constructor(host: HTMLElement, callbacks: LibraryCallbacks) {
    this.host = host;
    this.callbacks = callbacks;

    this.host.addEventListener('click', (event) => {
      const target = event.target as HTMLElement | null;
      const archetype = target?.closest<HTMLElement>('[data-archetype]');
      if (archetype) {
        this.callbacks.onArchetype(archetype.dataset.archetype as StoneArchetypeId);
        return;
      }
      const tag = target?.closest<HTMLElement>('[data-tag]');
      if (tag) {
        const value = tag.dataset.tag ?? '';
        this.activeTag = value === '' || this.activeTag === value ? null : value;
        this.render(this.lastState);
        return;
      }
      const preset = target?.closest<HTMLElement>('[data-preset]');
      if (preset) {
        const found = STONE_PRESETS.find((entry) => entry.id === preset.dataset.preset);
        if (found) {
          this.callbacks.onPreset(found);
        }
        return;
      }
      const action = target?.closest<HTMLElement>('[data-action]');
      if (action?.dataset.action === 'load-preset') {
        this.callbacks.onLoadPresetFile();
      } else if (action?.dataset.action === 'save-preset') {
        this.callbacks.onSavePresetFile();
      }
    });

    this.host.addEventListener('input', (event) => {
      const target = event.target as HTMLInputElement | null;
      if (target?.dataset.role === 'search') {
        this.search = target.value.trim().toLowerCase();
        this.renderPresetList();
      }
    });
    this.host.addEventListener(
      'wheel',
      (event) => {
        const tagsContainer = (event.target as HTMLElement | null)?.closest<HTMLElement>('.preset-tags');
        if (tagsContainer && event.deltaY !== 0 && tagsContainer.scrollWidth > tagsContainer.clientWidth) {
          event.preventDefault();
          tagsContainer.scrollLeft += event.deltaY;
        }
      },
      { passive: false }
    );
  }

  private lastState: ProjectState | null = null;

  public render(state: ProjectState | null): void {
    if (state === null) {
      return;
    }
    this.lastState = state;

    const tags = [...new Set(STONE_PRESETS.flatMap((preset) => [...preset.tags]))].sort();

    this.host.innerHTML = `
      <div class="panel-heading">
        <span class="eyebrow">Library</span>
        <strong>Stones</strong>
      </div>

      <label class="search-field">
        <input data-role="search" type="search" placeholder="Search presets…" value="${escapeHtml(this.search)}">
      </label>

      <section class="library-section preview-library-section">
        <div class="section-heading"><span>Archetype</span></div>
        <div class="object-grid compact-object-grid" role="group" aria-label="Stone archetype">
          ${STONE_ARCHETYPE_IDS.map(
            (id) => `
            <button
              class="object-tile compact-object-tile ${state.archetype === id ? 'is-active' : ''}"
              data-archetype="${id}"
              data-tooltip="${id}"
              title="${id}"
            >
              <span class="object-glyph" aria-hidden="true">${ARCHETYPE_GLYPHS[id]}</span>
              <span>${id}</span>
            </button>
          `
          ).join('')}
        </div>
        <div class="preset-file-actions" role="group" aria-label="Share stone preset">
          <button class="preset-file-button" data-action="load-preset" title="Load a stone preset from disk">Load preset…</button>
          <button class="preset-file-button" data-action="save-preset" title="Save the current stone as a preset file">Save preset</button>
        </div>
      </section>

      <section class="library-section preset-section">
        <div class="section-heading"><span>Presets</span></div>
        <div class="preset-tags" role="group" aria-label="Filter presets by tag">
          <button data-tag="" class="tag-chip ${this.activeTag === null ? 'is-active' : ''}">All</button>
          ${tags
            .map(
              (tag) => `
            <button data-tag="${escapeHtml(tag)}" class="tag-chip ${this.activeTag === tag ? 'is-active' : ''}">${escapeHtml(tag)}</button>
          `
            )
            .join('')}
        </div>
        <div class="preset-list" data-role="preset-list"></div>
      </section>
    `;
    this.renderPresetList();
  }

  private renderPresetList(): void {
    const list = this.host.querySelector<HTMLElement>('[data-role="preset-list"]');
    if (list === null) {
      return;
    }
    const visible = STONE_PRESETS.filter((preset) => {
      if (this.activeTag !== null && !preset.tags.includes(this.activeTag)) {
        return false;
      }
      if (this.search.length === 0) {
        return true;
      }
      const haystack = `${preset.name} ${preset.description} ${preset.tags.join(' ')}`.toLowerCase();
      return haystack.includes(this.search);
    });

    list.innerHTML =
      visible.length === 0
        ? '<div class="preset-empty">No presets match.</div>'
        : visible
            .map(
              (preset) => `
        <button class="preset-card" data-preset="${preset.id}" title="${escapeHtml(preset.description)}">
          <span class="preset-swatch stage-glyph" aria-hidden="true">${ARCHETYPE_GLYPHS[preset.archetype]}</span>
          <span class="preset-copy">
            <strong>${escapeHtml(preset.name)}</strong>
            <small>${escapeHtml(preset.description)}</small>
            <span class="preset-card-tags">${preset.tags
              .slice(0, 3)
              .map((tag) => `<span>${escapeHtml(tag)}</span>`)
              .join('')}</span>
          </span>
          <span class="preset-arrow" aria-hidden="true">›</span>
        </button>
      `
            )
            .join('');
  }
}
