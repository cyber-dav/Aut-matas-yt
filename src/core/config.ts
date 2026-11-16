import { readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { ROOT } from "./paths.js";

const ChannelConfig = z.object({
  channel: z.object({
    name: z.string(),
    tagline: z.string(),
    language: z.string(),
    audience: z.string(),
    tone: z.string(),
  }),
  target: z.object({
    minutes: z.number(),
    minSeconds: z.number(),
    maxSeconds: z.number(),
    wordsMin: z.number(),
    wordsMax: z.number(),
    sceneSecondsMin: z.number(),
    sceneSecondsMax: z.number(),
  }),
  llm: z.object({
    provider: z.enum(["anthropic"]),
    model: z.string(),
    effort: z.enum(["low", "medium", "high", "xhigh", "max"]),
    maxWebSearches: z.number(),
  }),
  voice: z.object({
    provider: z.enum(["kokoro", "elevenlabs", "mock"]),
    kokoro: z.object({ voice: z.string(), speed: z.number(), lang: z.string(), modelDir: z.string() }),
    voiceId: z.string(),
    modelId: z.string(),
    languageCode: z.string(),
    stability: z.number(),
    similarityBoost: z.number(),
    style: z.number(),
    speed: z.number(),
    outputFormat: z.string(),
    pauseSeconds: z.number(),
    sceneGapSeconds: z.number(),
  }),
  images: z.object({
    provider: z.enum(["fal", "mock"]),
    model: z.string(),
    width: z.number(),
    height: z.number(),
    concurrency: z.number(),
    styleBible: z.string(),
    styleBibleEn: z.string(),
    negative: z.string(),
    thumbnailBoost: z.string(),
  }),
  music: z.object({
    provider: z.enum(["elevenlabs", "library"]),
    modelId: z.string(),
    basePrompt: z.string(),
    trackSeconds: z.number(),
    fallbackDir: z.string(),
    duckDb: z.number(),
    musicFreeLufs: z.number(),
    voiceLufs: z.number(),
    finalLufs: z.number(),
    commercialUseConfirmed: z.boolean(),
  }),
  sfx: z.object({
    enabled: z.boolean(),
    modelId: z.string(),
    maxPerEpisode: z.number(),
  }),
  video: z.object({
    width: z.number(),
    height: z.number(),
    fps: z.number(),
    introSeconds: z.number(),
    outroSeconds: z.number(),
    crossfadeSeconds: z.number(),
    subtitleMaxCharsPerLine: z.number(),
  }),
  shorts: z.object({
    count: z.number().min(1).max(3),
    minSeconds: z.number(),
    maxSeconds: z.number(),
  }),
  pricing: z.object({
    elevenlabsTtsPer1kChars: z.number(),
    elevenlabsMusicPerMinute: z.number(),
    elevenlabsSfxPerGeneration: z.number(),
    falPerImage: z.number(),
    anthropicInputPerMTok: z.number(),
    anthropicOutputPerMTok: z.number(),
    anthropicWebSearchPer1k: z.number(),
  }).passthrough(),
});

export type ChannelConfig = z.infer<typeof ChannelConfig>;

let cached: ChannelConfig | undefined;

/** Carga config/channel.json. PIPELINE_MOCK=1 sustituye voz, imágenes y música por generadores locales (sin APIs). */
export function loadConfig(): ChannelConfig {
  if (cached) return cached;
  const raw = JSON.parse(readFileSync(join(ROOT, "config", "channel.json"), "utf8"));
  const cfg = ChannelConfig.parse(raw);
  if (process.env.PIPELINE_MOCK === "1") {
    if (cfg.voice.provider !== "kokoro") cfg.voice.provider = "mock"; // Kokoro es local y gratuito: se mantiene
    cfg.images.provider = "mock";
    cfg.music.provider = "library";
  }
  cached = cfg;
  return cfg;
}
