import { existsSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { z } from "zod";
import { durationOf, ffmpeg, loudnormFilter } from "../core/ffmpeg.js";
import { ensureDir } from "../core/paths.js";
import { bundleWith, renderThumb, renderVideo } from "../core/render.js";
import { buildCues } from "../core/subtitles.js";
import { Brief, ScenesFile, type TimestampsFile } from "../core/types.js";
import { fmtTime, log, readJson, writeJson, writeText } from "../core/util.js";
import { generateJson, llmCostUsd } from "../providers/llm/claude.js";
import { buildImagePrompt, getImageProvider } from "../providers/image/index.js";
import type { ShortProps, TimelineScene } from "../../remotion/types.js";
import { loopMusic } from "./s6-audio.js";
import { imageForScene } from "./s5-images.js";
import { channelSystem } from "./prompts.js";
import type { Stage, StageCtx } from "./types.js";

const mock = () => process.env.PIPELINE_MOCK === "1";

/* ─────────────────────────── Fase 7 — Miniaturas ─────────────────────────── */

const ThumbPlan = z.object({
  options: z.array(
    z.object({
      text: z.string().describe("2–4 palabras en MAYÚSCULAS, gancho de curiosidad, p. ej. «¿ASESINO O MITO?»"),
      imagePrompt: z.string().describe("Escena en inglés, un único sujeto potente y reconocible, composición que deje un lateral libre para el texto"),
      align: z.enum(["left", "right"]).describe("Lado donde va el texto (el sujeto en el lado contrario)"),
    }),
  ),
});

export const thumbnailsStage: Stage = {
  name: "thumbnails",
  label: "Fase 7 — Miniaturas",
  requiresApproval: true,
  outputs: (c) => [1, 2, 3].map((i) => join(c.paths.thumbsDir, `thumb-${i}.jpg`)),
  async run(ctx) {
    const { paths, cfg, cost } = ctx;
    const file = ScenesFile.parse(readJson(paths.scenes));
    ensureDir(paths.thumbsDir);
    cost.reset("thumbnails");
    let plan: z.infer<typeof ThumbPlan>;
    if (mock()) {
      plan = { options: [1, 2, 3].map((i) => ({ text: ["¿ASESINO O MITO?", "LA BESTIA DE ALLARIZ", "JURÓ SER LOBO"][i - 1], imagePrompt: file.scenes[(i * 3) % file.scenes.length].imagePrompt, align: i % 2 ? "left" : "right" })) };
    } else {
      const res = await generateJson(
        cfg,
        ThumbPlan,
        channelSystem(cfg),
        `Propón 3 miniaturas MUY distintas entre sí para el vídeo «${file.title}». Deben funcionar en móvil: texto de 2–4 palabras (≤ 18 caracteres si es posible), sin repetir el título, que genere curiosidad sin mentir. Escenas disponibles como inspiración:\n${file.scenes.filter((s) => !s.reuseImageOf).slice(0, 40).map((s) => `- ${s.imagePrompt}`).join("\n")}\nDevuelve exactamente 3 opciones.`,
      );
      plan = res.value;
      cost.add("thumbnails", { provider: "anthropic", description: "propuestas de miniatura", quantity: res.usage.outputTokens, unit: "tok salida", usd: llmCostUsd(cfg, res.usage) });
    }
    const provider = getImageProvider(cfg);
    const files: Record<string, string> = {};
    for (const [i, o] of plan.options.slice(0, 3).entries()) {
      const img = join(paths.thumbsDir, `bg-${i + 1}.png`);
      if (ctx.force || !existsSync(img)) {
        const { usd } = await provider.generate({ prompt: buildImagePrompt(cfg, o.imagePrompt, cfg.images.thumbnailBoost), width: 1280 * 1.5, height: 720 * 1.5 }, img);
        cost.add("thumbnails", { provider: provider.name, description: `fondo miniatura ${i + 1}`, quantity: 1, unit: "imagen", usd });
      }
      files[`thumb/bg-${i + 1}.png`] = img;
    }
    const serveUrl = await bundleWith(join(paths.cacheDir, "public-thumbs"), files);
    for (const [i, o] of plan.options.slice(0, 3).entries()) {
      const out = join(paths.thumbsDir, `thumb-${i + 1}.jpg`);
      await renderThumb({ serveUrl, out, props: { image: `thumb/bg-${i + 1}.png`, text: o.text, channelName: cfg.channel.name, align: o.align } });
    }
    writeJson(join(paths.thumbsDir, "thumbnails.json"), plan);
    log.ok(`3 miniaturas en 07-thumbnail/: ${plan.options.map((o) => `«${o.text}»`).join(", ")}`);
  },
};

/* ─────────────────────────── Fase 8 — Metadatos ─────────────────────────── */

const MetaPlan = z.object({
  titles: z.array(z.string()).describe("5 títulos ≤ 60 caracteres, curiosidad + palabra clave"),
  hook: z.string().describe("2 primeras líneas de la descripción: gancho + palabra clave principal (≤ 200 caracteres)"),
  summary: z.string().describe("Resumen de 3–5 frases, sin destripar el final"),
  tags: z.array(z.string()).describe("15 etiquetas"),
  hashtags: z.array(z.string()).describe("3 hashtags con #"),
});

/** Capítulos con marcas de tiempo reales a partir de los timestamps de la voz. */
export function chaptersWithTimes(ctx: StageCtx): { title: string; seconds: number }[] {
  const file = ScenesFile.parse(readJson(ctx.paths.scenes));
  const ts = readJson<TimestampsFile>(ctx.paths.timestamps);
  const intro = ctx.cfg.video.introSeconds;
  const out = file.chapters
    .map((c) => ({ title: c.title, seconds: intro + (ts.scenes.find((s) => s.id === c.firstSceneId)?.start ?? 0) }))
    .sort((a, b) => a.seconds - b.seconds);
  if (out.length) out[0].seconds = 0; // YouTube exige que el primer capítulo empiece en 0:00
  // YouTube exige capítulos de ≥ 10 s: fusiona los demasiado cortos.
  return out.filter((c, i) => i === 0 || c.seconds - out[i - 1].seconds >= 10);
}

export const metadataStage: Stage = {
  name: "metadata",
  label: "Fase 8 — Metadatos",
  requiresApproval: true,
  outputs: (c) => [c.paths.metadata],
  async run(ctx) {
    const { paths, cfg, cost } = ctx;
    const brief = Brief.parse(readJson(paths.brief));
    const file = ScenesFile.parse(readJson(paths.scenes));
    const chapters = chaptersWithTimes(ctx);
    const sources = existsSync(paths.sources) ? readJson<{ cited: string[] }>(paths.sources).cited : [];
    cost.reset("metadata");
    let meta: z.infer<typeof MetaPlan>;
    if (mock()) {
      meta = { titles: [file.title], hook: file.title, summary: "(modo de prueba)", tags: ["historia"], hashtags: ["#historia"] };
    } else {
      const script = readFileSync(paths.script, "utf8");
      const res = await generateJson(
        cfg,
        MetaPlan,
        channelSystem(cfg),
        `Escribe los metadatos de YouTube (en español de España) para este episodio.\nTema: ${brief.topic}\nTítulo de trabajo: ${file.title}\n\n<guion>\n${script}\n</guion>\n\nReglas: títulos ≤ 60 caracteres, sin clickbait engañoso ni mayúsculas abusivas; palabra clave principal al principio cuando sea natural. 15 etiquetas relevantes (mezcla de amplias y específicas). 3 hashtags.`,
      );
      meta = res.value;
      cost.add("metadata", { provider: "anthropic", description: "metadatos", quantity: res.usage.outputTokens, unit: "tok salida", usd: llmCostUsd(cfg, res.usage) });
    }
    const tooLong = meta.titles.filter((t) => t.length > 60);
    const md = `# Metadatos — ${file.title}

## Títulos alternativos
${meta.titles.map((t, i) => `${i + 1}. ${t} (${t.length} caracteres${t.length > 60 ? " ⚠ más de 60" : ""})`).join("\n")}

## Descripción (copiar y pegar)

\`\`\`
${meta.hook}

${meta.summary}

CAPÍTULOS
${chapters.map((c) => `${fmtTime(c.seconds)} ${c.title}`).join("\n")}

FUENTES
${sources.length ? sources.map((u) => `• ${u}`).join("\n") : "• (añade aquí las fuentes de 01-research.md)"}

Nota: la voz narradora y las ilustraciones de este vídeo se han generado con inteligencia artificial a partir de un guion investigado y revisado por el canal. La música ${readMusicNote(ctx)}.

${meta.hashtags.join(" ")}
\`\`\`

## Etiquetas (${meta.tags.length})
${meta.tags.join(", ")}

## Hashtags
${meta.hashtags.join(" ")}

## Antes de publicar
- [ ] Revisa en YouTube Studio si debes marcar **«Contenido alterado o sintético»** (obligatorio si el vídeo muestra personas, lugares o hechos realistas que puedan confundirse con reales; las ilustraciones claramente artísticas normalmente no lo requieren, pero la decisión es tuya).
- [ ] Sube \`06-render/subtitles.srt\` como subtítulos en español.
- [ ] Añade las tarjetas finales en los últimos ${cfg.video.outroSeconds} s (vídeo recomendado + suscripción).
- [ ] Elige miniatura en \`07-thumbnail/\`.
${tooLong.length ? `- [ ] ⚠ Acorta los títulos de más de 60 caracteres.\n` : ""}`;
    writeText(paths.metadata, md);
    log.ok(`08-metadata.md (${chapters.length} capítulos, ${sources.length} fuentes)`);
  },
};

function readMusicNote(ctx: StageCtx): string {
  if (!existsSync(ctx.paths.musicMeta)) return "es de uso libre";
  const m = readJson<{ source: string; detail: string }>(ctx.paths.musicMeta);
  return m.source === "elevenlabs" ? "se ha generado con ElevenLabs Music" : `procede de la Biblioteca de audio de YouTube (${m.detail})`;
}

/* ─────────────────────────── Fase 9 — Shorts ─────────────────────────── */

const ShortsPlan = z.object({
  shorts: z.array(
    z.object({
      firstSceneId: z.number().int(),
      lastSceneId: z.number().int(),
      hook: z.string().describe("Gancho en pantalla para el primer segundo, ≤ 6 palabras, en mayúsculas"),
      title: z.string().describe("Título del Short ≤ 60 caracteres con #Shorts"),
    }),
  ),
});

export const shortsStage: Stage = {
  name: "shorts",
  label: "Fase 9 — Shorts",
  requiresApproval: true,
  outputs: (c) => [join(c.paths.shortsDir, "short-1.mp4")],
  async run(ctx) {
    const { paths, cfg, cost } = ctx;
    const file = ScenesFile.parse(readJson(paths.scenes));
    const ts = readJson<TimestampsFile>(paths.timestamps);
    ensureDir(paths.shortsDir);
    cost.reset("shorts");
    const ctaSeconds = 3;
    const maxVoice = cfg.shorts.maxSeconds - ctaSeconds;
    const minVoice = cfg.shorts.minSeconds - ctaSeconds;
    const timing = (id: number) => ts.scenes.find((s) => s.id === id)!;

    let plan: z.infer<typeof ShortsPlan>;
    if (mock()) {
      plan = { shorts: [{ firstSceneId: 1, lastSceneId: 1, hook: "EL HOMBRE QUE JURÓ SER LOBO", title: "Prueba #Shorts" }] };
    } else {
      const list = file.scenes.map((s) => `${s.id} (${timing(s.id).audioSeconds.toFixed(1)} s): ${s.narration}`).join("\n");
      const res = await generateJson(
        cfg,
        ShortsPlan,
        channelSystem(cfg),
        `Elige ${cfg.shorts.count} fragmentos para Shorts verticales a partir de estas escenas (id, duración de voz, texto). Cada fragmento: escenas CONSECUTIVAS cuya voz sume entre ${minVoice} y ${maxVoice} s, que se entiendan solas, con el dato más impactante del episodio y que empiecen con una frase que enganche desde el primer segundo. No se solapan entre sí.\n\n${list}`,
      );
      plan = res.value;
      cost.add("shorts", { provider: "anthropic", description: "selección de Shorts", quantity: res.usage.outputTokens, unit: "tok salida", usd: llmCostUsd(cfg, res.usage) });
    }

    const ids = file.scenes.map((s) => s.id);
    const produced: { file: string; title: string; seconds: number; scenes: string }[] = [];
    for (const [n, sh] of plan.shorts.slice(0, cfg.shorts.count).entries()) {
      // Ajusta el rango a la duración permitida usando los tiempos reales.
      let a = ids.indexOf(sh.firstSceneId);
      let b = Math.max(a, ids.indexOf(sh.lastSceneId));
      if (a < 0) continue;
      const span = () => timing(ids[b]).start + timing(ids[b]).audioSeconds - timing(ids[a]).start;
      while (span() > maxVoice && b > a) b--;
      while (span() < minVoice && b < ids.length - 1 && timing(ids[b + 1]).end - timing(ids[a]).start <= maxVoice) b++;
      const startT = timing(ids[a]).start;
      const voiceSecs = span();
      const total = voiceSecs + ctaSeconds + 0.4;
      const scenes: TimelineScene[] = [];
      const files: Record<string, string> = {};
      for (let i = a; i <= b; i++) {
        const s = file.scenes[i];
        const t = timing(s.id);
        const img = imageForScene(paths, s);
        const rel = `images/${basename(img)}`;
        files[rel] = img;
        scenes.push({ id: s.id, image: rel, camera: s.camera, start: t.start - startT, end: i === b ? total : t.end - startT });
      }
      const words = ts.scenes.filter((s) => s.id >= ids[a] && s.id <= ids[b]).flatMap((s) => s.words);
      const cues = buildCues(words, -startT, 22, 2).filter((c) => c.start < voiceSecs + 0.5);

      // Audio: voz recortada + música (más presente que en el vídeo largo) → −14 LUFS.
      const tmp = ensureDir(join(paths.cacheDir, `short-${n + 1}`));
      const audio = join(tmp, "short.wav");
      const bed = join(tmp, "bed.wav");
      await loopMusic(paths.music, total, bed, tmp);
      const pre = join(tmp, "pre.wav");
      await ffmpeg([
        "-ss", startT.toFixed(3), "-t", voiceSecs.toFixed(3), "-i", paths.narration, "-i", bed,
        "-filter_complex",
        `[0:a]aresample=48000,aformat=channel_layouts=stereo,apad=whole_dur=${total.toFixed(3)}[v];[1:a]volume=-16dB,afade=t=out:st=${(total - 1.5).toFixed(2)}:d=1.5[m];[v][m]amix=inputs=2:normalize=0:duration=first[o]`,
        "-map", "[o]", "-ar", "48000", "-ac", "2", pre,
      ]);
      await ffmpeg(["-i", pre, "-af", await loudnormFilter(pre, cfg.music.finalLufs), "-ar", "48000", audio]);

      const props: ShortProps = {
        channelName: cfg.channel.name,
        fps: cfg.video.fps,
        totalSeconds: total,
        audio: "short.wav",
        hook: sh.hook,
        cta: "La historia completa, en el canal",
        ctaSeconds,
        scenes,
        cues,
      };
      files["short.wav"] = audio;
      const serveUrl = await bundleWith(join(paths.cacheDir, `public-short-${n + 1}`), files);
      const out = join(paths.shortsDir, `short-${n + 1}.mp4`);
      await renderVideo({ serveUrl, compositionId: "Short", props, out, label: `Short ${n + 1}` });
      const secs = await durationOf(out);
      produced.push({ file: basename(out), title: sh.title, seconds: Math.round(secs * 10) / 10, scenes: `${ids[a]}–${ids[b]}` });
      log.ok(`${basename(out)}: ${secs.toFixed(1)} s (escenas ${ids[a]}–${ids[b]}) «${sh.hook}»`);
    }
    writeJson(join(paths.shortsDir, "shorts.json"), produced);
  },
};
