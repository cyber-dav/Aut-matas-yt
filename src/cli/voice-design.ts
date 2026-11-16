import { Command } from "commander";
import { dirname, isAbsolute, join } from "node:path";
import { loadConfig } from "../core/config.js";
import { run } from "../core/ffmpeg.js";
import { ensureDir, ROOT } from "../core/paths.js";
import { log } from "../core/util.js";
import { main } from "./common.js";

const SAMPLE =
  "Hay historias que el tiempo no consigue enterrar. Historias que se susurran junto al fuego, en las noches largas de invierno, cuando el viento golpea las ventanas. Esta es una de ellas. Escuchad con atención.";

const program = new Command()
  .name("voice:design")
  .description("Diseña la voz del narrador (Qwen3-TTS VoiceDesign) y la guarda como referencia para clonarla en cada episodio.")
  .option("--desc <texto>", "descripción de la voz (por defecto, voice.qwen3.voiceDescription)")
  .option("--seed <n>", "semilla (prueba varias hasta que te guste)", (v) => parseInt(v, 10), 42)
  .option("--out <ruta>", "archivo de salida (por defecto, voice.qwen3.refAudio)")
  .parse();

main(async () => {
  const cfg = loadConfig();
  const opts = program.opts<{ desc?: string; seed: number; out?: string }>();
  const q = cfg.voice.qwen3;
  const out = opts.out ?? q.refAudio;
  const abs = isAbsolute(out) ? out : join(ROOT, out);
  ensureDir(dirname(abs));
  log.step(`Diseñando voz (semilla ${opts.seed})`);
  log.info(opts.desc ?? q.voiceDescription);
  const python = (process.env.QWEN3_PYTHON || q.python).replace(/^~/, process.env.HOME ?? "");
  const { stdout } = await run(python, ["-I", join(ROOT, "scripts", "qwen3_design.py"), abs, opts.desc ?? q.voiceDescription, SAMPLE, String(opts.seed), q.designModel]);
  log.ok(stdout.trim().split("\n").pop() ?? abs);
  log.info("Escúchala. Si te gusta, deja esa ruta en voice.qwen3.refAudio; si no, prueba otra --seed o ajusta la descripción.");
});
