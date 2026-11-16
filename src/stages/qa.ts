import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { CostTracker } from "../core/cost.js";
import { durationOf, hasStream, measureLoudness, run } from "../core/ffmpeg.js";
import { ScenesFile, type TimestampsFile } from "../core/types.js";
import { fmtTime, log, readJson, writeText } from "../core/util.js";
import { narrationOnly } from "./s1-3-writing.js";
import { imageForScene } from "./s5-images.js";
import type { Stage } from "./types.js";

interface Check {
  name: string;
  ok: boolean;
  detail: string;
  warnOnly?: boolean;
}

export const qaStage: Stage = {
  name: "qa",
  label: "Control de calidad",
  requiresApproval: true,
  outputs: () => [], // siempre se ejecuta
  async run({ paths, cfg }) {
    const checks: Check[] = [];
    const file = ScenesFile.parse(readJson(paths.scenes));
    const ts = existsSync(paths.timestamps) ? readJson<TimestampsFile>(paths.timestamps) : null;

    // Duración total
    if (existsSync(paths.video)) {
      const d = await durationOf(paths.video);
      checks.push({
        name: "Duración del vídeo",
        ok: d >= cfg.target.minSeconds && d <= cfg.target.maxSeconds,
        detail: `${fmtTime(d)} (objetivo ${fmtTime(cfg.target.minSeconds)}–${fmtTime(cfg.target.maxSeconds)})`,
      });
      const v = await hasStream(paths.video, "v");
      const a = await hasStream(paths.video, "a");
      checks.push({ name: "Pistas de vídeo y audio", ok: v && a, detail: `vídeo: ${v ? "sí" : "NO"}, audio: ${a ? "sí" : "NO"}` });
      const { stdout } = await run("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=codec_name,width,height,r_frame_rate", "-of", "csv=p=0", paths.video]);
      const [codec, w, h, fr] = stdout.trim().split(",");
      checks.push({ name: "Formato", ok: codec === "h264" && w === String(cfg.video.width) && h === String(cfg.video.height), detail: `${codec} ${w}×${h} @ ${fr}` });
      const l = await measureLoudness(paths.video);
      checks.push({
        name: "Nivel de audio",
        ok: Math.abs(l.integrated - cfg.music.finalLufs) <= 1 && l.truePeak <= -0.5,
        detail: `${l.integrated} LUFS (objetivo ${cfg.music.finalLufs} ±1), pico real ${l.truePeak} dBTP`,
      });
      if (ts) {
        const expected = cfg.video.introSeconds + ts.totalSeconds + cfg.video.outroSeconds;
        checks.push({ name: "Vídeo = intro + voz + outro", ok: Math.abs(d - expected) < 0.25, detail: `${d.toFixed(2)} s frente a ${expected.toFixed(2)} s` });
      }
    } else {
      checks.push({ name: "Vídeo renderizado", ok: false, detail: "falta 06-render/video.mp4" });
    }

    // Escenas sin imagen o sin audio
    const noImg = file.scenes.filter((s) => !existsSync(imageForScene(paths, s))).map((s) => s.id);
    const noAudio = file.scenes.filter((s) => !existsSync(paths.audioScene(s.id))).map((s) => s.id);
    checks.push({ name: "Escenas sin imagen", ok: noImg.length === 0, detail: noImg.length ? noImg.join(", ") : "ninguna" });
    checks.push({ name: "Escenas sin audio", ok: noAudio.length === 0, detail: noAudio.length ? noAudio.join(", ") : "ninguna" });

    // Desfase voz/subtítulos: la última palabra de cada escena debe acabar con su audio.
    if (ts) {
      const drifts = ts.scenes.map((s) => {
        const last = s.words[s.words.length - 1];
        return { id: s.id, drift: last ? Math.abs(s.start + s.audioSeconds - last.end) : Infinity };
      });
      const bad = drifts.filter((d) => d.drift > 0.6);
      const max = Math.max(...drifts.map((d) => (Number.isFinite(d.drift) ? d.drift : 0)));
      checks.push({
        name: "Desfase voz/subtítulos",
        ok: bad.length === 0,
        detail: bad.length ? `escenas con > 0,6 s: ${bad.map((b) => b.id).join(", ")}` : `máx. ${max.toFixed(2)} s de cola tras la última palabra`,
      });
      const outOfRange = ts.scenes.filter((s) => s.audioSeconds < cfg.target.sceneSecondsMin * 0.6 || s.audioSeconds > cfg.target.sceneSecondsMax * 1.4);
      checks.push({
        name: "Escenas con duración atípica",
        ok: outOfRange.length === 0,
        warnOnly: true,
        detail: outOfRange.length ? outOfRange.map((s) => `${s.id} (${s.audioSeconds.toFixed(1)} s)`).join(", ") : "ninguna",
      });
    }

    // Palabras del guion no verificadas en la investigación (nombres propios y cifras).
    const unverified = unverifiedTerms(readFileSync(paths.script, "utf8"), existsSync(paths.research) ? readFileSync(paths.research, "utf8") : "");
    checks.push({
      name: "Términos del guion no encontrados en 01-research.md",
      ok: unverified.length === 0,
      warnOnly: true,
      detail: unverified.length ? unverified.slice(0, 60).join(", ") + (unverified.length > 60 ? "…" : "") : "ninguno",
    });

    // Miniaturas y Shorts
    const thumbs = [1, 2, 3].filter((i) => existsSync(join(paths.thumbsDir, `thumb-${i}.jpg`))).length;
    checks.push({ name: "Miniaturas", ok: thumbs === 3, detail: `${thumbs}/3` });
    const shortsMeta = join(paths.shortsDir, "shorts.json");
    if (existsSync(shortsMeta)) {
      const shorts = readJson<{ file: string; seconds: number }[]>(shortsMeta);
      const bad = shorts.filter((s) => s.seconds < cfg.shorts.minSeconds || s.seconds > cfg.shorts.maxSeconds + 0.5);
      checks.push({ name: "Shorts", ok: shorts.length >= 2 && bad.length === 0, detail: shorts.map((s) => `${s.file} ${s.seconds} s`).join(", ") || "ninguno" });
    } else checks.push({ name: "Shorts", ok: false, detail: "no generados" });
    checks.push({ name: "Metadatos", ok: existsSync(paths.metadata), detail: existsSync(paths.metadata) ? "08-metadata.md" : "falta" });

    // Coste
    const cost = new CostTracker(paths);
    const byStage = cost.byStage();
    const failed = checks.filter((c) => !c.ok && !c.warnOnly);
    const warned = checks.filter((c) => !c.ok && c.warnOnly);
    const md = `# QA — ${file.title}

Resultado: ${failed.length ? `❌ ${failed.length} comprobaciones fallidas` : "✅ todo correcto"}${warned.length ? ` · ⚠ ${warned.length} avisos para revisar` : ""}

| Comprobación | Estado | Detalle |
|---|---|---|
${checks.map((c) => `| ${c.name} | ${c.ok ? "✅" : c.warnOnly ? "⚠" : "❌"} | ${c.detail.replace(/\|/g, "\\|")} |`).join("\n")}

## Coste estimado del episodio
| Fase | USD |
|---|---|
${Object.entries(byStage).map(([k, v]) => `| ${k} | ${v.toFixed(2)} |`).join("\n")}
| **Total** | **${cost.total.toFixed(2)}** |

_Generado el ${new Date().toISOString()}_
`;
    writeText(paths.qa, md);
    for (const c of checks) (c.ok ? log.ok : log.warn)(`${c.name}: ${c.detail}`);
    log.info(`Coste total estimado: ${cost.total.toFixed(2)} USD`);
    if (failed.length) throw new Error(`QA: ${failed.length} comprobaciones fallidas. Revisa QA.md`);
  },
};

const STOP = new Set(
  "El La Los Las Un Una Unos Unas Y O Pero Porque Que Qué Quién Quien Cómo Como Cuando Cuándo Donde Dónde Por Para Con Sin En De Del Al Es Era Fue Hay Ya No Sí Si Se Su Sus Lo Le Les Esa Ese Eso Esta Este Esto Aquella Aquel Hoy Ayer Entonces Durante Después Antes Allí Aquí Nadie Todo Todos Toda Nada Algo Alguien Mucho Muchos Nunca Siempre Tal Tras Sobre Bajo Entre Hasta Desde Pues Mientras Aunque Incluso Además Así Ni Él Ella Ellos Nosotros Vosotros Yo Tú Mi Tu Nuestro Nuestra Cada Otro Otra Otros Ahora Pero Hace Hacia Según Al Pausa Gancho Contexto Acto Mito Realidad Cierre Dejadnos Suscríbete Suscribíos Comentarios".split(" "),
);

/** Nombres propios y cifras del guion que no aparecen en la investigación. */
export function unverifiedTerms(script: string, research: string): string[] {
  const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const hay = norm(research);
  const text = narrationOnly(script).replace(/\[pausa\]/gi, " ");
  const found = new Set<string>();
  for (const sentence of text.split(/(?<=[.!?…])\s+|\n+/)) {
    const tokens = sentence.split(/\s+/).map((t) => t.replace(/^[«"“¿¡(]+|[»"”?!.,;:)…]+$/g, ""));
    tokens.forEach((t, i) => {
      if (!t) return;
      const isNumber = /\d/.test(t);
      const isProper = i > 0 && /^\p{Lu}/u.test(t) && !STOP.has(t);
      if ((isNumber || isProper) && t.length > 2 && !hay.includes(norm(t))) found.add(t);
    });
  }
  return [...found];
}
