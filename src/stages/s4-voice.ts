import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import pLimit from "p-limit";
import { durationOf, ffmpeg } from "../core/ffmpeg.js";
import { ensureDir, pad } from "../core/paths.js";
import { ScenesFile, type SceneTiming, type TimestampsFile, type WordTiming } from "../core/types.js";
import { countWords, fmtTime, log, readJson, writeJson } from "../core/util.js";
import { getTts, type Alignment } from "../providers/tts/index.js";
import type { Stage, StageCtx } from "./types.js";

interface SceneAudioMeta {
  id: number;
  text: string;
  seconds: number;
  words: WordTiming[]; // relativos al inicio de la escena
}

export const voiceStage: Stage = {
  name: "voice",
  label: "Fase 4 — Voz",
  requiresApproval: true,
  outputs: (c) => [c.paths.narration, c.paths.timestamps],
  async run(ctx) {
    const { paths, cfg, cost } = ctx;
    const file = ScenesFile.parse(readJson(paths.scenes));
    const tts = getTts(cfg);
    ensureDir(join(paths.audioDir, "scenes"));

    const todo = file.scenes.filter((s) =>
      ctx.scene ? s.id === ctx.scene : ctx.force || !existsSync(paths.audioScene(s.id)) || !existsSync(paths.audioSceneTs(s.id)),
    );
    if (!ctx.scene && ctx.force) cost.reset("voice");
    log.info(`Generando voz de ${todo.length}/${file.scenes.length} escenas (${cfg.voice.provider}, ${cfg.voice.modelId})`);

    const limit = pLimit(3);
    let done = 0;
    await Promise.all(
      todo.map((scene) =>
        limit(async () => {
          const idx = file.scenes.findIndex((s) => s.id === scene.id);
          const prev = file.scenes[idx - 1]?.narration;
          const next = file.scenes[idx + 1]?.narration;
          const meta = await synthesizeScene(ctx, scene.id, scene.narration, prev, next, tts);
          done++;
          log.info(`  [${done}/${todo.length}] escena ${scene.id}: ${meta.seconds.toFixed(1)} s`);
        }),
      ),
    );
    if (todo.length) {
      const chars = todo.reduce((a, s) => a + cleanText(s.narration).length, 0);
      cost.add("voice", {
        provider: "elevenlabs",
        description: `TTS ${cfg.voice.modelId} (${todo.length} escenas)`,
        quantity: chars,
        unit: "caracteres",
        usd: cfg.voice.provider === "mock" ? 0 : (chars / 1000) * cfg.pricing.elevenlabsTtsPer1kChars,
      });
    }
    await buildNarration(ctx, file);
  },
};

const cleanText = (t: string) => t.replace(/\[pausa\]/gi, " ").replace(/\s+/g, " ").trim();

/** Genera una escena: trocea por [pausa], sintetiza cada trozo y los une con silencios. */
async function synthesizeScene(
  { paths, cfg }: StageCtx,
  id: number,
  narration: string,
  prev: string | undefined,
  next: string | undefined,
  tts: ReturnType<typeof getTts>,
): Promise<SceneAudioMeta> {
  const parts = narration.split(/\[pausa\]/i).map((p) => p.trim()).filter(Boolean);
  const tmpDir = ensureDir(join(paths.cacheDir, `voice-${pad(id)}`));
  const pieces: string[] = [];
  const words: WordTiming[] = [];
  let offset = 0;
  const silence = join(tmpDir, "pause.wav");
  await ffmpeg(["-f", "lavfi", "-i", `anullsrc=r=44100:cl=mono`, "-t", String(cfg.voice.pauseSeconds), silence]);

  for (let i = 0; i < parts.length; i++) {
    const res = await tts.synthesize(parts[i], {
      previousText: [cleanText(prev ?? ""), ...parts.slice(0, i)].join(" ").trim() || undefined,
      nextText: [...parts.slice(i + 1), cleanText(next ?? "")].join(" ").trim() || undefined,
    });
    const mp3 = join(tmpDir, `part-${i}.mp3`);
    const wav = join(tmpDir, `part-${i}.wav`);
    writeFileSync(mp3, res.audio);
    await ffmpeg(["-i", mp3, "-ar", "44100", "-ac", "1", wav]);
    const dur = await durationOf(wav);
    words.push(...alignmentToWords(res.alignment, offset));
    pieces.push(wav);
    offset += dur;
    if (i < parts.length - 1) {
      pieces.push(silence);
      offset += cfg.voice.pauseSeconds;
    }
  }
  const list = join(tmpDir, "list.txt");
  writeFileSync(list, pieces.map((p) => `file '${p}'`).join("\n"));
  await ffmpeg(["-f", "concat", "-safe", "0", "-i", list, "-ar", "44100", "-ac", "1", "-b:a", "192k", paths.audioScene(id)]);
  const seconds = await durationOf(paths.audioScene(id));
  const meta: SceneAudioMeta = { id, text: narration, seconds, words };
  writeJson(paths.audioSceneTs(id), meta);
  return meta;
}

/** Agrupa caracteres con tiempos en palabras. */
export function alignmentToWords(a: Alignment, offset = 0): WordTiming[] {
  const out: WordTiming[] = [];
  let cur: WordTiming | null = null;
  for (let i = 0; i < a.characters.length; i++) {
    const ch = a.characters[i];
    if (/\s/.test(ch)) {
      if (cur) out.push(cur);
      cur = null;
      continue;
    }
    if (!cur) cur = { text: "", start: a.starts[i] + offset, end: a.ends[i] + offset };
    cur.text += ch;
    cur.end = a.ends[i] + offset;
  }
  if (cur) out.push(cur);
  return out;
}

/** Une las escenas en narration.wav (con una pausa corta entre escenas) y escribe timestamps.json. */
export async function buildNarration({ paths, cfg }: StageCtx, file: ScenesFile) {
  const gap = join(paths.cacheDir, "scene-gap.wav");
  ensureDir(paths.cacheDir);
  await ffmpeg(["-f", "lavfi", "-i", "anullsrc=r=44100:cl=mono", "-t", String(cfg.voice.sceneGapSeconds), gap]);
  const pieces: string[] = [];
  const scenes: SceneTiming[] = [];
  let t = 0;
  for (const s of file.scenes) {
    if (!existsSync(paths.audioSceneTs(s.id))) throw new Error(`Falta el audio de la escena ${s.id}`);
    const meta = readJson<SceneAudioMeta>(paths.audioSceneTs(s.id));
    const dur = meta.seconds + cfg.voice.sceneGapSeconds;
    scenes.push({
      id: s.id,
      start: t,
      end: t + dur,
      audioSeconds: meta.seconds,
      words: meta.words.map((w) => ({ text: w.text, start: w.start + t, end: w.end + t })),
    });
    pieces.push(paths.audioScene(s.id), gap);
    t += dur;
  }
  const list = join(paths.cacheDir, "narration-list.txt");
  writeFileSync(list, pieces.map((p) => `file '${p}'`).join("\n"));
  await ffmpeg(["-f", "concat", "-safe", "0", "-i", list, "-ar", "44100", "-ac", "1", "-c:a", "pcm_s16le", paths.narration]);
  const total = await durationOf(paths.narration);
  const ts: TimestampsFile = { totalSeconds: total, scenes };
  writeJson(paths.timestamps, ts);

  const words = file.scenes.reduce((a, s) => a + countWords(s.narration), 0);
  const wpm = words / (total / 60);
  const videoSeconds = total + cfg.video.introSeconds + cfg.video.outroSeconds;
  log.ok(`narration.wav: ${fmtTime(total)} de voz (${wpm.toFixed(0)} palabras/min) → vídeo ≈ ${fmtTime(videoSeconds)}`);
  checkDuration(cfg, videoSeconds, wpm);
}

function checkDuration(cfg: StageCtx["cfg"], videoSeconds: number, wpm: number) {
  const { minSeconds, maxSeconds } = cfg.target;
  if (videoSeconds >= minSeconds && videoSeconds <= maxSeconds) return;
  const target = (minSeconds + maxSeconds) / 2;
  const deltaWords = Math.round(((target - videoSeconds) / 60) * wpm);
  log.warn(
    `Duración fuera de rango (${fmtTime(minSeconds)}–${fmtTime(maxSeconds)}): ${fmtTime(videoSeconds)}. ` +
      (deltaWords > 0 ? `Amplía el guion unas ${deltaWords} palabras` : `Recorta el guion unas ${-deltaWords} palabras`) +
      ` (a ${wpm.toFixed(0)} palabras/min). Ajusta también target.wordsMin/wordsMax en config/channel.json.`,
  );
}
