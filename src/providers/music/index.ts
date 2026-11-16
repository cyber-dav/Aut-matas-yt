import { readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";
import type { ChannelConfig } from "../../core/config.js";
import { ffmpeg } from "../../core/ffmpeg.js";
import { ROOT } from "../../core/paths.js";
import { retry, streamToBuffer } from "../../core/util.js";

export interface MusicResult {
  source: "elevenlabs" | "library" | "generated-drone";
  detail: string;
  usd: number;
}

/** Genera una pista instrumental con ElevenLabs Music (máx. 10 min por petición). */
export async function composeElevenLabs(cfg: ChannelConfig, prompt: string, seconds: number, outPath: string): Promise<MusicResult> {
  const client = new ElevenLabsClient();
  const ms = Math.round(Math.min(600, Math.max(10, seconds)) * 1000);
  const stream = await retry("ElevenLabs Music", () =>
    client.music.compose({
      prompt,
      musicLengthMs: ms,
      modelId: cfg.music.modelId as never,
      forceInstrumental: true,
      outputFormat: "mp3_44100_192" as never,
    }),
  );
  writeFileSync(outPath, await streamToBuffer(stream));
  return {
    source: "elevenlabs",
    detail: `${cfg.music.modelId}, ${ms / 1000} s: «${prompt}»`,
    usd: (ms / 60000) * cfg.pricing.elevenlabsMusicPerMinute,
  };
}

/** Respaldo: la primera pista de assets/music/ (Biblioteca de audio de YouTube), o un drone sintético si no hay ninguna. */
export async function libraryTrack(cfg: ChannelConfig, outPath: string, seed: string): Promise<MusicResult> {
  const dir = join(ROOT, cfg.music.fallbackDir);
  const tracks = readdirSync(dir).filter((f) => /\.(mp3|wav|m4a|ogg|flac)$/i.test(f)).sort();
  if (tracks.length > 0) {
    const pick = tracks[Math.abs([...seed].reduce((a, c) => (a * 31 + c.charCodeAt(0)) | 0, 0)) % tracks.length];
    await ffmpeg(["-i", join(dir, pick), "-vn", "-ar", "44100", "-ac", "2", "-b:a", "192k", outPath]);
    return { source: "library", detail: `assets/music/${pick}`, usd: 0 };
  }
  // Drone grave sintético (solo para pruebas; no es música para publicar).
  await ffmpeg([
    "-f", "lavfi", "-i", "sine=f=55:d=120", "-f", "lavfi", "-i", "sine=f=82.4:d=120", "-f", "lavfi", "-i", "anoisesrc=color=brown:amplitude=0.05:d=120",
    "-filter_complex", "[0][1][2]amix=inputs=3,lowpass=f=400,tremolo=f=0.15:d=0.4,afade=t=in:d=3,afade=t=out:st=117:d=3",
    "-ac", "2", "-ar", "44100", "-b:a", "192k", outPath,
  ]);
  return { source: "generated-drone", detail: "drone sintético de prueba (añade pistas a assets/music/)", usd: 0 };
}
