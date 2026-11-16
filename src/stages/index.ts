import { existsSync } from "node:fs";
import { log } from "../core/util.js";
import { qaStage } from "./qa.js";
import { researchStage, scenesStage, scriptStage } from "./s1-3-writing.js";
import { voiceStage } from "./s4-voice.js";
import { imagesStage } from "./s5-images.js";
import { mixStage, musicStage } from "./s6-audio.js";
import { renderStage } from "./s6-render.js";
import { metadataStage, shortsStage, thumbnailsStage } from "./s7-9-publish.js";
import type { Stage, StageCtx } from "./types.js";

/** Fases de `npm run new` (se detiene para revisión humana). */
export const WRITING: Stage[] = [researchStage, scriptStage, scenesStage];

/** Fases de `npm run produce` (requieren APPROVED). */
export const PRODUCTION: Stage[] = [
  voiceStage,
  imagesStage,
  musicStage,
  mixStage,
  renderStage,
  thumbnailsStage,
  metadataStage,
  shortsStage,
  qaStage,
];

export const ALL: Stage[] = [...WRITING, ...PRODUCTION];

export function findStage(name: string): Stage {
  const s = ALL.find((x) => x.name === name);
  if (!s) throw new Error(`Fase desconocida «${name}». Disponibles: ${ALL.map((x) => x.name).join(", ")}`);
  return s;
}

/** Ejecuta una fase respetando idempotencia (salta si sus salidas existen, salvo --force o --scene). */
export async function runStage(stage: Stage, ctx: StageCtx): Promise<void> {
  log.step(stage.label);
  if (stage.requiresApproval && !existsSync(ctx.paths.approved)) {
    throw new Error(`Falta el archivo APPROVED en episodes/${ctx.paths.slug}/. Revisa el guion y las escenas y créalo para continuar.`);
  }
  const outs = stage.outputs(ctx);
  if (!ctx.force && ctx.scene === undefined && outs.length > 0 && outs.every((o) => existsSync(o))) {
    log.skip(stage.name);
    return;
  }
  const t0 = Date.now();
  await stage.run(ctx);
  log.info(`(${((Date.now() - t0) / 1000).toFixed(0)} s)`);
}
