import { basename, join } from "node:path";
import { durationOf } from "../core/ffmpeg.js";
import { bundleWith, renderVideo } from "../core/render.js";
import { buildCues, toSrt } from "../core/subtitles.js";
import { ScenesFile, type TimestampsFile } from "../core/types.js";
import { fmtTime, log, readJson, writeJson, writeText } from "../core/util.js";
import type { EpisodeProps, TimelineScene } from "../../remotion/types.js";
import { imageForScene } from "./s5-images.js";
import type { Stage, StageCtx } from "./types.js";

/** Construye la línea de tiempo (escenas con tiempos reales + subtítulos) del vídeo largo. */
export function buildTimeline(ctx: StageCtx): { props: EpisodeProps; files: Record<string, string> } {
  const { paths, cfg } = ctx;
  const file = ScenesFile.parse(readJson(paths.scenes));
  const ts = readJson<TimestampsFile>(paths.timestamps);
  const intro = cfg.video.introSeconds;
  const files: Record<string, string> = { "mix.wav": paths.mix };
  const scenes: TimelineScene[] = file.scenes.map((s) => {
    const t = ts.scenes.find((x) => x.id === s.id);
    if (!t) throw new Error(`Escena ${s.id} sin timestamps; rehaz la fase voice`);
    const img = imageForScene(paths, s);
    const rel = `images/${basename(img)}`;
    files[rel] = img;
    return { id: s.id, image: rel, camera: s.camera, start: intro + t.start, end: intro + t.end, onScreenText: s.onScreenText ?? null };
  });
  const words = ts.scenes.flatMap((s) => s.words);
  const cues = buildCues(words, intro, cfg.video.subtitleMaxCharsPerLine);
  const totalSeconds = intro + ts.totalSeconds + cfg.video.outroSeconds;
  const props: EpisodeProps = {
    channelName: cfg.channel.name,
    tagline: cfg.channel.tagline,
    title: file.title,
    fps: cfg.video.fps,
    width: cfg.video.width,
    height: cfg.video.height,
    introSeconds: intro,
    outroSeconds: cfg.video.outroSeconds,
    crossfadeSeconds: cfg.video.crossfadeSeconds,
    totalSeconds,
    audio: "mix.wav",
    scenes,
    cues,
    outroImage: scenes[scenes.length - 1].image,
  };
  return { props, files };
}

export const renderStage: Stage = {
  name: "render",
  label: "Fase 6c — Montaje (Remotion)",
  requiresApproval: true,
  outputs: (c) => [c.paths.video],
  async run(ctx) {
    const { paths } = ctx;
    const { props, files } = buildTimeline(ctx);
    writeJson(paths.timeline, props);
    writeText(paths.subtitlesSrt, toSrt(props.cues));
    log.info(`Vídeo de ${fmtTime(props.totalSeconds)} con ${props.scenes.length} escenas y ${props.cues.length} subtítulos`);
    log.info("Empaquetando Remotion…");
    const serveUrl = await bundleWith(join(paths.cacheDir, "public-episode"), files);
    await renderVideo({ serveUrl, compositionId: "Episode", props, out: paths.video, label: "Render" });
    log.ok(`06-render/video.mp4 (${fmtTime(await durationOf(paths.video))}) + subtitles.srt`);
  },
};
