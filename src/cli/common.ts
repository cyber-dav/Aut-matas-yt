import "dotenv/config";
import { existsSync } from "node:fs";
import { loadConfig } from "../core/config.js";
import { CostTracker } from "../core/cost.js";
import { episodePaths } from "../core/paths.js";
import type { StageCtx } from "../stages/types.js";

export function makeCtx(slug: string, opts: { force?: boolean; scene?: number } = {}): StageCtx {
  const paths = episodePaths(slug);
  if (!existsSync(paths.dir)) throw new Error(`No existe el episodio episodes/${slug}/`);
  return { paths, cfg: loadConfig(), cost: new CostTracker(paths), force: !!opts.force, scene: opts.scene };
}

/** Comprueba que las claves necesarias están definidas antes de empezar a gastar. */
export function requireKeys(keys: string[]) {
  const missing = keys.filter((k) => !process.env[k]);
  if (missing.length) throw new Error(`Faltan claves en .env: ${missing.join(", ")} (mira .env.example)`);
}

export function keysFor(stageNames: string[]): string[] {
  const cfg = loadConfig();
  const keys = new Set<string>();
  const mock = process.env.PIPELINE_MOCK === "1";
  for (const s of stageNames) {
    if (["research", "script", "scenes"].includes(s)) keys.add("ANTHROPIC_API_KEY");
    if (!mock && ["thumbnails", "metadata", "shorts"].includes(s)) keys.add("ANTHROPIC_API_KEY");
    if (s === "voice" && cfg.voice.provider === "elevenlabs") keys.add("ELEVENLABS_API_KEY");
    if (s === "music" && cfg.music.provider === "elevenlabs") keys.add("ELEVENLABS_API_KEY");
    if ((s === "images" || s === "thumbnails") && cfg.images.provider === "fal") keys.add("FAL_KEY");
  }
  // Con proxy de credenciales (entornos en la nube) la clave puede inyectarse fuera del proceso.
  if (process.env.PIPELINE_KEYS_VIA_PROXY === "1") return [];
  return [...keys];
}

export async function main(fn: () => Promise<void>) {
  try {
    await fn();
    process.exit(0); // cierra procesos auxiliares (p. ej. Kokoro)
  } catch (err) {
    console.error(`\n✗ ${(err as Error).message}`);
    if (process.env.DEBUG) console.error(err);
    process.exit(1);
  }
}
