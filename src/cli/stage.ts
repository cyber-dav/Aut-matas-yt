import { Command } from "commander";
import { log } from "../core/util.js";
import { ALL, findStage, runStage } from "../stages/index.js";
import { keysFor, main, makeCtx, requireKeys } from "./common.js";

/** Qué fases dependen de cada una (para --cascade). */
const DEPENDENTS: Record<string, string[]> = {
  research: ["script", "scenes"],
  script: ["scenes"],
  scenes: [],
  voice: ["mix", "render", "metadata", "shorts", "qa"],
  images: ["render", "shorts", "qa"],
  music: ["mix", "render", "shorts", "qa"],
  mix: ["render", "qa"],
  render: ["qa"],
  thumbnails: ["qa"],
  metadata: ["qa"],
  shorts: ["qa"],
  qa: [],
};

const program = new Command()
  .name("stage")
  .description("Rehace una sola fase de un episodio.")
  .argument("<slug>", "carpeta del episodio")
  .argument("<fase>", ALL.map((s) => s.name).join(" | "))
  .option("--scene <n>", "solo esta escena (voice, images)", (v) => parseInt(v, 10))
  .option("--cascade", "rehacer también las fases que dependen de esta")
  .option("--no-force", "no rehacer si la salida ya existe")
  .parse();

main(async () => {
  const [slug, name] = program.args;
  const opts = program.opts<{ scene?: number; cascade?: boolean; force: boolean }>();
  const stage = findStage(name);
  const chain = [stage, ...(opts.cascade ? DEPENDENTS[name].map(findStage) : [])];
  requireKeys(keysFor(chain.map((s) => s.name)));
  const ctx = makeCtx(slug, { force: opts.force, scene: opts.scene });
  await runStage(stage, ctx);
  for (const s of chain.slice(1)) await runStage(s, { ...ctx, scene: undefined, force: true });
  if (!opts.cascade && DEPENDENTS[name].length) {
    log.info(`Recuerda rehacer lo que depende de «${name}»: ${DEPENDENTS[name].join(", ")} (o usa --cascade).`);
  }
});
