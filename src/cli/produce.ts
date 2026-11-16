import { Command } from "commander";
import { existsSync } from "node:fs";
import { episodePaths } from "../core/paths.js";
import { PRODUCTION, runStage } from "../stages/index.js";
import { keysFor, main, makeCtx, requireKeys } from "./common.js";

const program = new Command()
  .name("produce")
  .description("Produce el episodio aprobado: voz, imágenes, música, mezcla, render, miniaturas, metadatos, Shorts y QA.")
  .argument("<slug>", "carpeta del episodio en episodes/")
  .option("--force", "rehacer todas las fases aunque existan sus salidas")
  .option("--from <fase>", "empezar en esta fase (las anteriores deben estar hechas)")
  .parse();

main(async () => {
  const [slug] = program.args;
  const opts = program.opts<{ force?: boolean; from?: string }>();
  const paths = episodePaths(slug);
  if (!existsSync(paths.approved)) {
    throw new Error(`episodes/${slug}/APPROVED no existe. Revisa guion y escenas y créalo con:  touch episodes/${slug}/APPROVED`);
  }
  let stages = PRODUCTION;
  if (opts.from) {
    const i = stages.findIndex((s) => s.name === opts.from);
    if (i < 0) throw new Error(`Fase desconocida: ${opts.from}`);
    stages = stages.slice(i);
  }
  requireKeys(keysFor(stages.map((s) => s.name)));
  const ctx = makeCtx(slug, { force: opts.force });
  for (const stage of stages) await runStage(stage, ctx);
  console.log(`\n✓ Episodio producido. Revisa episodes/${slug}/QA.md, 06-render/video.mp4, 07-thumbnail/, 08-metadata.md y 09-shorts/.`);
});
