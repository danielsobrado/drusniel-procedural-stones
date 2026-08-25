import labConfigData from './lab.generated.json';

export interface ControlRange {
  readonly min: number;
  readonly max: number;
  readonly step: number;
  readonly default: number;
}

export interface LabConfig {
  readonly app: {
    readonly name: string;
    readonly autosaveKey: string;
    readonly autosaveDelayMs: number;
    readonly historyLimit: number;
  };
  readonly stone: Record<string, ControlRange>;
  readonly stages: Record<string, Record<string, ControlRange>>;
  readonly cluster: Record<string, ControlRange>;
  readonly field: Record<string, ControlRange>;
}

function asRange(value: unknown, path: string): ControlRange {
  if (typeof value !== 'object' || value === null) {
    throw new Error(`Invalid control range at ${path}.`);
  }
  const record = value as Record<string, unknown>;
  for (const key of ['min', 'max', 'step', 'default']) {
    if (typeof record[key] !== 'number') {
      throw new Error(`Missing numeric "${key}" in control range at ${path}.`);
    }
  }
  return {
    min: record.min as number,
    max: record.max as number,
    step: record.step as number,
    default: record.default as number
  };
}

function asRangeMap(value: unknown, path: string): Record<string, ControlRange> {
  if (typeof value !== 'object' || value === null) {
    throw new Error(`Invalid range table at ${path}.`);
  }
  const result: Record<string, ControlRange> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    result[key] = asRange(entry, `${path}.${key}`);
  }
  return result;
}

function parseLabConfig(source: unknown): LabConfig {
  if (typeof source !== 'object' || source === null) {
    throw new Error('Invalid generated Lab configuration.');
  }
  const raw = source as Record<string, unknown>;
  const app = raw.app as Record<string, unknown>;
  const stages = raw.stages as Record<string, unknown>;
  const stageRanges: Record<string, Record<string, ControlRange>> = {};
  for (const [kind, params] of Object.entries(stages)) {
    stageRanges[kind] = asRangeMap(params, `stages.${kind}`);
  }
  return {
    app: {
      name: String(app.name),
      autosaveKey: String(app.autosaveKey),
      autosaveDelayMs: Number(app.autosaveDelayMs),
      historyLimit: Number(app.historyLimit)
    },
    stone: asRangeMap(raw.stone, 'stone'),
    stages: stageRanges,
    cluster: asRangeMap(raw.cluster, 'cluster'),
    field: asRangeMap(raw.field, 'field')
  };
}

export const LAB_CONFIG: LabConfig = parseLabConfig(labConfigData);
