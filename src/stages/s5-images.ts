import { existsSync } from "node:fs";
import pLimit from "p-limit";
import { ensureDir } from "../core/paths.js";
import { ScenesFile } from "../core/types.js";
import { log, readJson } from "../core/util.js";
import { buildImagePrompt, getImageProvider } from "../providers/image/index.js";
import type { Stage } from "./types.js";

export const imagesStage: Stage = {
  name: "images",
  label: "Fase 5 — Ilustraciones",
  requiresApproval: true,
  outputs: (c) => {
    const file = ScenesFile.parse(readJson(c.paths.scenes));
    return file.scenes.filter((s) => s.reuseImageOf == null).map((s) => c.paths.image(s.id));
  },
  async run(ctx) {
    const { paths, cfg, cost } = ctx;
    const file = ScenesFile.parse(readJson(paths.scenes));
    ensureDir(paths.imagesDir);
    const provider = getImageProvider(cfg);
    const own = file.scenes.filter((s) => s.reuseImageOf == null);
    const todo = own.filter((s) => (ctx.scene ? s.id === ctx.scene : ctx.force || !existsSync(paths.image(s.id))));
    if (ctx.scene && !todo.length) {
      const s = file.scenes.find((x) => x.id === ctx.scene);
      throw new Error(s ? `La escena ${ctx.scene} reutiliza la imagen de la escena ${s.reuseImageOf}; regenera esa.` : `No existe la escena ${ctx.scene}`);
    }
    if (!ctx.scene && ctx.force) cost.reset("images");
    log.info(`Generando ${todo.length} ilustraciones (${provider.name}, ${cfg.images.model}, concurrencia ${cfg.images.concurrency})`);

    const limit = pLimit(cfg.images.concurrency);
    const failed: number[] = [];
    let done = 0;
    await Promise.all(
      todo.map((s) =>
        limit(async () => {
          try {
            const { usd } = await provider.generate(
              {
                prompt: buildImagePrompt(cfg, s.imagePrompt),
                width: cfg.images.width,
                height: cfg.images.height,
                // Semilla estable por escena: regenerar con --scene da otra variante.
                seed: ctx.scene ? Math.floor(Math.random() * 1e9) : s.id * 7919,
              },
              paths.image(s.id),
            );
            cost.add("images", { provider: provider.name, description: `escena ${s.id}`, quantity: 1, unit: "imagen", usd });
            done++;
            log.info(`  [${done}/${todo.length}] escena ${s.id}`);
          } catch (err) {
            failed.push(s.id);
            log.warn(`Escena ${s.id}: ${(err as Error).message}`);
          }
        }),
      ),
    );
    if (failed.length) {
      throw new Error(`Fallaron ${failed.length} imágenes (escenas ${failed.join(", ")}). Vuelve a lanzar la fase: solo rehará las que faltan.`);
    }
    log.ok(`${own.length} ilustraciones listas en 05-images/`);
  },
};

/** Ruta de la imagen que usa una escena (propia o reutilizada). */
export function imageForScene(paths: { image: (id: number) => string }, scene: { id: number; reuseImageOf?: number | null }): string {
  return paths.image(scene.reuseImageOf ?? scene.id);
}
