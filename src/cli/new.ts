import { Command } from "commander";
import { existsSync } from "node:fs";
import { episodePaths, slugify } from "../core/paths.js";
import { log, writeJson } from "../core/util.js";
import { WRITING, runStage } from "../stages/index.js";
import { keysFor, main, makeCtx, requireKeys } from "./common.js";

const program = new Command()
  .name("new")
  .description("Crea un episodio y ejecuta investigación + guion + escenas; se detiene para revisión.")
  .argument("<tema>", "tema del episodio")
  .option("--slug <slug>", "nombre de carpeta (por defecto, derivado del tema)")
  .option("--angle <texto>", "ángulo editorial sugerido")
  .option("--force", "rehacer fases aunque existan sus salidas")
  .parse();

main(async () => {
  const [topic] = program.args;
  const opts = program.opts<{ slug?: string; angle?: string; force?: boolean }>();
  const slug = opts.slug ?? slugify(topic);
  const paths = episodePaths(slug);
  if (!existsSync(paths.brief) || opts.force) {
    writeJson(paths.brief, { topic, slug, angle: opts.angle, createdAt: new Date().toISOString() });
    log.ok(`Episodio creado: episodes/${slug}/`);
  } else log.info(`El episodio episodes/${slug}/ ya existe; continúo donde se quedó.`);

  requireKeys(keysFor(WRITING.map((s) => s.name)));
  const ctx = makeCtx(slug, { force: opts.force });
  for (const stage of WRITING) await runStage(stage, ctx);

  console.log(`
────────────────────────────────────────────────────────
Listo para revisión. Lee y edita si hace falta:
  • episodes/${slug}/01-research.md
  • episodes/${slug}/02-script.md
  • episodes/${slug}/03-scenes.json
Si cambias el guion, regenera las escenas:
  npm run stage -- ${slug} scenes
Cuando esté bien, dale el OK y produce:
  touch episodes/${slug}/APPROVED
  npm run produce -- ${slug}
Coste hasta ahora: ${ctx.cost.total.toFixed(2)} USD
────────────────────────────────────────────────────────`);
});
