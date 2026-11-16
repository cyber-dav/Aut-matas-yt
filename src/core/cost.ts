import { existsSync } from "node:fs";
import type { EpisodePaths } from "./paths.js";
import { readJson, writeJson } from "./util.js";

export interface CostItem {
  provider: string;
  description: string;
  quantity: number;
  unit: string;
  usd: number;
  at: string;
}

interface CostFile {
  currency: "USD";
  note: string;
  stages: Record<string, CostItem[]>;
  totalUsd: number;
}

/**
 * Registro de costes por fase. Al rehacer una fase con --force se reemplazan sus entradas;
 * al rehacer una sola escena (--scene) se añaden.
 */
export class CostTracker {
  private file: CostFile;
  constructor(private paths: EpisodePaths) {
    this.file = existsSync(paths.cost)
      ? readJson<CostFile>(paths.cost)
      : { currency: "USD", note: "Estimación a partir de config/channel.json → pricing", stages: {}, totalUsd: 0 };
  }

  reset(stage: string) {
    this.file.stages[stage] = [];
    this.save();
  }

  add(stage: string, item: Omit<CostItem, "at">) {
    (this.file.stages[stage] ??= []).push({ ...item, usd: round(item.usd), at: new Date().toISOString() });
    this.save();
  }

  get total(): number {
    return this.file.totalUsd;
  }

  byStage(): Record<string, number> {
    return Object.fromEntries(
      Object.entries(this.file.stages).map(([k, v]) => [k, round(v.reduce((a, b) => a + b.usd, 0))]),
    );
  }

  private save() {
    this.file.totalUsd = round(
      Object.values(this.file.stages).flat().reduce((a, b) => a + b.usd, 0),
    );
    writeJson(this.paths.cost, this.file);
  }
}

const round = (n: number) => Math.round(n * 10000) / 10000;
