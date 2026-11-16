import { existsSync } from "node:fs";
import { join } from "node:path";
import { durationOf, ffmpeg, loudnormFilter, measureLoudness } from "../core/ffmpeg.js";
import { ensureDir, pad } from "../core/paths.js";
import { Brief, ScenesFile, type TimestampsFile } from "../core/types.js";
import { log, readJson, writeJson } from "../core/util.js";
import { composeElevenLabs, libraryTrack, type MusicResult } from "../providers/music/index.js";
import { generateSfx } from "../providers/sfx/index.js";
import type { Stage, StageCtx } from "./types.js";

export const musicStage: Stage = {
  name: "music",
  label: "Fase 6a — Música",
  requiresApproval: true,
  outputs: (c) => [c.paths.music],
  async run({ paths, cfg, cost }) {
    ensureDir(paths.audioDir);
    const brief = Brief.parse(readJson(paths.brief));
    if (cfg.music.provider === "elevenlabs" && !cfg.music.commercialUseConfirmed) {
      log.warn(
        "AVISO: no has confirmado que tu plan de ElevenLabs permite uso comercial y monetización de la música generada. " +
          "Compruébalo en https://elevenlabs.io/pricing y en sus condiciones de servicio, y pon music.commercialUseConfirmed=true en config/channel.json.",
      );
    }
    const prompt = `${cfg.music.basePrompt}. Banda sonora para un documental sobre «${brief.topic}»: atmósfera sombría y de misterio histórico, evolución lenta, sin cambios bruscos, apta para sonar en bucle bajo una narración`;
    let res: MusicResult;
    cost.reset("music");
    if (cfg.music.provider === "elevenlabs") {
      try {
        res = await composeElevenLabs(cfg, prompt, cfg.music.trackSeconds, paths.music);
      } catch (err) {
        log.warn(`ElevenLabs Music falló (${(err as Error).message}); uso una pista de ${cfg.music.fallbackDir}/`);
        res = await libraryTrack(cfg, paths.music, brief.slug);
      }
    } else {
      res = await libraryTrack(cfg, paths.music, brief.slug);
    }
    if (res.usd) cost.add("music", { provider: "elevenlabs", description: res.detail, quantity: cfg.music.trackSeconds / 60, unit: "minutos", usd: res.usd });
    writeJson(paths.musicMeta, { ...res, prompt, commercialUseConfirmed: cfg.music.commercialUseConfirmed });
    if (res.source === "generated-drone") log.warn("Música: drone sintético de prueba. Añade pistas a assets/music/ o activa ElevenLabs Music antes de publicar.");
    log.ok(`music.mp3 (${res.source}: ${res.detail})`);
  },
};

export const mixStage: Stage = {
  name: "mix",
  label: "Fase 6b — Mezcla de audio",
  requiresApproval: true,
  outputs: (c) => [c.paths.mix],
  async run(ctx) {
    await mixEpisodeAudio(ctx);
  },
};

/** Duración total del vídeo largo (intro + voz + outro). */
export function videoSeconds(ctx: StageCtx): number {
  const ts = readJson<TimestampsFile>(ctx.paths.timestamps);
  return ctx.cfg.video.introSeconds + ts.totalSeconds + ctx.cfg.video.outroSeconds;
}

async function mixEpisodeAudio(ctx: StageCtx) {
  const { paths, cfg, cost } = ctx;
  const ts = readJson<TimestampsFile>(paths.timestamps);
  const file = ScenesFile.parse(readJson(paths.scenes));
  const intro = cfg.video.introSeconds;
  const total = videoSeconds(ctx);
  const tmp = ensureDir(join(paths.cacheDir, "mix"));

  // 1) Voz normalizada (dos pasadas) y desplazada tras la intro.
  const voice = join(tmp, "voice.wav");
  // Compresión suave de narración: iguala el nivel y baja los picos de voces muy graves.
  const voiceComp = join(tmp, "voice-comp.wav");
  await ffmpeg(["-i", paths.narration, "-af", VOICE_CHAIN, "-ar", "44100", "-ac", "1", voiceComp]);
  const vf = await loudnormFilter(voiceComp, cfg.music.voiceLufs);
  await ffmpeg([
    "-i", voiceComp,
    "-af", `${vf},aresample=48000,adelay=${Math.round(intro * 1000)}:all=1,apad=whole_dur=${total.toFixed(3)}`,
    "-ac", "2", "-ar", "48000", "-t", total.toFixed(3), voice,
  ]);

  // 2) Música en bucle con fundido cruzado hasta cubrir el vídeo.
  const bed = join(tmp, "music-bed.wav");
  await loopMusic(paths.music, total, bed, tmp);

  // 3) Nivel libre (intro/outro) y ducking por envolvente según los tiempos reales de la voz.
  const m = await measureLoudness(bed);
  const freeGain = cfg.music.musicFreeLufs - m.integrated;
  const duckReduction = cfg.music.musicFreeLufs - (cfg.music.voiceLufs - cfg.music.duckDb); // dB que baja bajo la voz
  const vStart = intro + (ts.scenes[0]?.start ?? 0);
  const vEnd = intro + ts.totalSeconds;
  const ramp = 1.2;
  const env = `-${duckReduction.toFixed(2)}*min(max((t-${(vStart - ramp).toFixed(3)})/${ramp},0),1)*min(max((${(vEnd + ramp).toFixed(3)}-t)/${ramp},0),1)`;
  const music = join(tmp, "music-ducked.wav");
  await ffmpeg([
    "-i", bed,
    "-af", `volume=${freeGain.toFixed(2)}dB,volume='pow(10,(${env})/20)':eval=frame,afade=t=in:d=2,afade=t=out:st=${(total - 4).toFixed(3)}:d=4`,
    "-ar", "48000", "-ac", "2", music,
  ]);

  // 4) Efectos de sonido opcionales (sutiles).
  const sfxInputs: { file: string; at: number }[] = [];
  if (cfg.sfx.enabled && cfg.voice.provider !== "mock") {
    const sfxDir = ensureDir(join(paths.audioDir, "sfx"));
    const withSfx = file.scenes.filter((s) => s.sfx).slice(0, cfg.sfx.maxPerEpisode);
    for (const s of withSfx) {
      const out = join(sfxDir, `${pad(s.id)}.mp3`);
      const timing = ts.scenes.find((x) => x.id === s.id)!;
      if (!existsSync(out)) {
        const { usd } = await generateSfx(cfg, s.sfx!, Math.min(8, timing.end - timing.start), out);
        cost.add("sfx", { provider: "elevenlabs", description: `SFX escena ${s.id}: ${s.sfx}`, quantity: 1, unit: "efecto", usd });
      }
      sfxInputs.push({ file: out, at: intro + timing.start });
    }
  }

  // 5) Mezcla y normalización final a −14 LUFS (dos pasadas).
  const pre = join(tmp, "premix.wav");
  const inputs = ["-i", voice, "-i", music, ...sfxInputs.flatMap((s) => ["-i", s.file])];
  const sfxChains = sfxInputs.map(
    (s, i) => `[${i + 2}:a]aresample=48000,aformat=channel_layouts=stereo,volume=-22dB,afade=t=in:d=0.5,adelay=${Math.round(s.at * 1000)}:all=1[s${i}]`,
  );
  const mixIns = ["[0:a]", "[1:a]", ...sfxInputs.map((_, i) => `[s${i}]`)].join("");
  await ffmpeg([
    ...inputs,
    "-filter_complex", [...sfxChains, `${mixIns}amix=inputs=${2 + sfxInputs.length}:normalize=0:duration=first[out]`].join(";"),
    "-map", "[out]", "-ar", "48000", "-ac", "2", pre,
  ]);
  // Normalización final: ganancia + limitador (pico real ≤ −1,5 dBTP), medir y corregir el resto.
  // loudnorm por sí solo se queda corto cuando los picos de una voz muy grave no le dejan subir.
  let src = pre;
  for (let pass = 1; pass <= 3; pass++) {
    const m = await measureLoudness(src);
    const gain = cfg.music.finalLufs - m.integrated;
    if (pass > 1 && Math.abs(gain) < 0.3) break;
    const next = join(tmp, `final-${pass}.wav`);
    await ffmpeg(["-i", src, "-af", `volume=${gain.toFixed(2)}dB,alimiter=limit=0.79:attack=4:release=60:level=false`, "-ar", "48000", "-ac", "2", "-c:a", "pcm_s16le", next]);
    src = next;
  }
  await ffmpeg(["-i", src, "-c:a", "pcm_s16le", paths.mix]);
  const l = await measureLoudness(paths.mix);
  log.ok(`mix.wav: ${(await durationOf(paths.mix)).toFixed(1)} s, ${l.integrated} LUFS, pico ${l.truePeak} dBTP (música −${duckReduction.toFixed(0)} dB bajo la voz)`);
}

const VOICE_CHAIN = "highpass=f=60,acompressor=threshold=-20dB:ratio=3:attack=15:release=250:makeup=2";

/** Repite la pista con fundidos cruzados de 4 s hasta alcanzar `seconds`. */
export async function loopMusic(src: string, seconds: number, out: string, tmp: string) {
  const len = await durationOf(src);
  const xf = Math.min(4, len / 4);
  const copies = Math.max(1, Math.ceil((seconds - xf) / (len - xf)));
  const norm = join(tmp, "music-src.wav");
  await ffmpeg(["-i", src, "-ar", "48000", "-ac", "2", norm]);
  if (copies === 1) {
    await ffmpeg(["-i", norm, "-af", `apad=whole_dur=${seconds.toFixed(3)}`, "-t", seconds.toFixed(3), out]);
    return;
  }
  const ins = Array.from({ length: copies }, () => ["-i", norm]).flat();
  const chain: string[] = [];
  let last = "[0:a]";
  for (let i = 1; i < copies; i++) {
    const label = `[x${i}]`;
    chain.push(`${last}[${i}:a]acrossfade=d=${xf.toFixed(2)}:c1=tri:c2=tri${label}`);
    last = label;
  }
  await ffmpeg([...ins, "-filter_complex", chain.join(";"), "-map", last, "-t", seconds.toFixed(3), out]);
}
