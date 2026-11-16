import type { ChannelConfig } from "../core/config.js";
import type { CostTracker } from "../core/cost.js";
import type { EpisodePaths } from "../core/paths.js";

export interface StageCtx {
  paths: EpisodePaths;
  cfg: ChannelConfig;
  cost: CostTracker;
  force: boolean;
  /** Rehacer solo esta escena (voz o imagen). */
  scene?: number;
}

export interface Stage {
  name: string;
  label: string;
  /** Si es true, la fase solo se ejecuta si existe el archivo APPROVED. */
  requiresApproval: boolean;
  /** Archivos cuya existencia indica que la fase ya está hecha (idempotencia). */
  outputs(ctx: StageCtx): string[];
  run(ctx: StageCtx): Promise<void>;
}
