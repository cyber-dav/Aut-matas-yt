import { readFileSync } from "node:fs";
import { z } from "zod";
import { generateJson, generateText, llmCostUsd, researchWithWeb } from "../providers/llm/claude.js";
import { Brief, ScenesFile } from "../core/types.js";
import { countWords, log, readJson, writeJson, writeText } from "../core/util.js";
import { channelSystem, researchPrompt, scenesPrompt, scriptPrompt } from "./prompts.js";
import type { Stage } from "./types.js";

export const researchStage: Stage = {
  name: "research",
  label: "Fase 1 — Investigación",
  requiresApproval: false,
  outputs: (c) => [c.paths.research],
  async run({ paths, cfg, cost }) {
    const brief = Brief.parse(readJson(paths.brief));
    log.info(`Investigando «${brief.topic}» con búsqueda web (puede tardar varios minutos)…`);
    const res = await researchWithWeb(cfg, channelSystem(cfg), researchPrompt(cfg, brief.topic, brief.angle));
    writeText(paths.research, res.value);
    // URLs citadas en el documento (las que se usarán en «Fuentes») + todas las consultadas.
    const cited = [...new Set([...res.value.matchAll(/https?:\/\/[^\s)\]>"]+/g)].map((m) => m[0].replace(/[.,;]+$/, "")))];
    writeJson(paths.sources, { cited, searched: res.urls });
    cost.reset("research");
    cost.add("research", {
      provider: "anthropic",
      description: `${cfg.llm.model}: ${res.usage.inputTokens} tok entrada, ${res.usage.outputTokens} tok salida, ${res.usage.webSearches} búsquedas`,
      quantity: res.usage.webSearches,
      unit: "búsquedas",
      usd: llmCostUsd(cfg, res.usage),
    });
    log.ok(`01-research.md (${cited.length} fuentes citadas, ${res.usage.webSearches} búsquedas)`);
  },
};

export const scriptStage: Stage = {
  name: "script",
  label: "Fase 2 — Guion",
  requiresApproval: false,
  outputs: (c) => [c.paths.script],
  async run({ paths, cfg, cost }) {
    const brief = Brief.parse(readJson(paths.brief));
    const research = readFileSync(paths.research, "utf8");
    cost.reset("script");
    let script = "";
    let prompt = scriptPrompt(cfg, brief.topic, research);
    for (let attempt = 1; attempt <= 3; attempt++) {
      const res = await generateText(cfg, channelSystem(cfg), prompt);
      cost.add("script", { provider: "anthropic", description: `${cfg.llm.model} guion (intento ${attempt})`, quantity: res.usage.outputTokens, unit: "tok salida", usd: llmCostUsd(cfg, res.usage) });
      script = res.value;
      const words = countWords(narrationOnly(script));
      log.info(`Guion: ${words} palabras`);
      if (words >= cfg.target.wordsMin * 0.95 && words <= cfg.target.wordsMax * 1.05) break;
      if (attempt < 3) {
        const dir = words < cfg.target.wordsMin ? "ampliarlo" : "recortarlo";
        log.warn(`Fuera del rango ${cfg.target.wordsMin}–${cfg.target.wordsMax}; pido ${dir}`);
        prompt = `${scriptPrompt(cfg, brief.topic, research)}\n\nBorrador anterior (${words} palabras, fuera de rango; debes ${dir} hasta ${cfg.target.wordsMin}–${cfg.target.wordsMax} palabras manteniendo estructura y calidad):\n<borrador>\n${script}\n</borrador>`;
      }
    }
    writeText(paths.script, script);
    log.ok(`02-script.md (${countWords(narrationOnly(script))} palabras)`);
  },
};

/** Esquema para la salida estructurada de Claude (sin refinamientos no admitidos por JSON Schema estricto). */
const LlmScenes = z.object({
  title: z.string(),
  chapters: z.array(z.object({ title: z.string(), firstSceneId: z.number().int() })),
  scenes: z.array(
    z.object({
      id: z.number().int(),
      chapter: z.string(),
      narration: z.string(),
      imagePrompt: z.string(),
      reuseImageOf: z.number().int().nullable(),
      onScreenText: z.string().nullable(),
      camera: z.enum(["zoom-in", "zoom-out", "pan-left", "pan-right"]),
      estSeconds: z.number(),
      sfx: z.string().nullable(),
    }),
  ),
});

export const scenesStage: Stage = {
  name: "scenes",
  label: "Fase 3 — Escenas",
  requiresApproval: false,
  outputs: (c) => [c.paths.scenes],
  async run({ paths, cfg, cost }) {
    const script = readFileSync(paths.script, "utf8");
    const res = await generateJson(cfg, LlmScenes, channelSystem(cfg), scenesPrompt(cfg, script));
    cost.reset("scenes");
    cost.add("scenes", { provider: "anthropic", description: `${cfg.llm.model} escenas`, quantity: res.usage.outputTokens, unit: "tok salida", usd: llmCostUsd(cfg, res.usage) });
    const file = ScenesFile.parse(res.value);
    file.scenes.forEach((s, i) => (s.id = i + 1));
    // Una imagen solo se puede reutilizar de una escena anterior que tenga imagen propia.
    for (const s of file.scenes) {
      if (s.reuseImageOf != null) {
        const src = file.scenes.find((x) => x.id === s.reuseImageOf);
        if (!src || src.id >= s.id) s.reuseImageOf = null;
        else if (src.reuseImageOf != null) s.reuseImageOf = src.reuseImageOf;
      }
    }
    writeJson(paths.scenes, file);
    checkCoverage(script, file);
    const unique = file.scenes.filter((s) => s.reuseImageOf == null).length;
    log.ok(`03-scenes.json: ${file.scenes.length} escenas, ${unique} imágenes únicas, ${file.chapters.length} capítulos`);
  },
};

/** Texto narrado: sin título ni encabezados Markdown. */
export function narrationOnly(md: string): string {
  return md
    .split("\n")
    .filter((l) => !/^\s*#/.test(l))
    .join("\n")
    .trim();
}

/** Comprueba que las escenas reproducen el guion (avisa si se perdieron palabras). */
function checkCoverage(script: string, file: ScenesFile) {
  const norm = (s: string) => s.toLowerCase().replace(/\[pausa\]/g, " ").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  const a = norm(narrationOnly(script)).split(" ");
  const b = norm(file.scenes.map((s) => s.narration).join(" ")).split(" ");
  const diff = Math.abs(a.length - b.length);
  if (diff > a.length * 0.02) log.warn(`Las escenas tienen ${b.length} palabras y el guion ${a.length}: revisa que no falte texto.`);
}
