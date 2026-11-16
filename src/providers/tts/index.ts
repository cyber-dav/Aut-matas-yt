import { readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";
import type { ChannelConfig } from "../../core/config.js";
import { ffmpeg } from "../../core/ffmpeg.js";
import { retry } from "../../core/util.js";

export interface Alignment {
  characters: string[];
  starts: number[];
  ends: number[];
}

export interface TtsResult {
  audio: Buffer; // mp3
  alignment: Alignment;
  billedChars: number;
}

export interface TtsProvider {
  synthesize(text: string, ctx: { previousText?: string; nextText?: string }): Promise<TtsResult>;
}

class ElevenLabsTts implements TtsProvider {
  private client = new ElevenLabsClient();
  constructor(private cfg: ChannelConfig) {}

  async synthesize(text: string, ctx: { previousText?: string; nextText?: string }): Promise<TtsResult> {
    const v = this.cfg.voice;
    // Ajustes de voz: eleven_v4 solo admite stability y similarity_boost.
    const isV4 = v.modelId.startsWith("eleven_v4");
    const res = await retry("ElevenLabs TTS", () =>
      this.client.textToSpeech.convertWithTimestamps(v.voiceId, {
        text,
        modelId: v.modelId,
        // eleven_multilingual_v2 no admite language_code
        ...(v.modelId === "eleven_multilingual_v2" ? {} : { languageCode: v.languageCode }),
        outputFormat: v.outputFormat as never,
        previousText: ctx.previousText,
        nextText: ctx.nextText,
        applyTextNormalization: "auto",
        voiceSettings: isV4
          ? { stability: v.stability, similarityBoost: v.similarityBoost }
          : { stability: v.stability, similarityBoost: v.similarityBoost, style: v.style, speed: v.speed, useSpeakerBoost: true },
      }),
    );
    const a = res.alignment ?? res.normalizedAlignment;
    if (!a) throw new Error("ElevenLabs no devolvió timestamps (alignment)");
    return {
      audio: Buffer.from(res.audioBase64, "base64"),
      alignment: { characters: a.characters, starts: a.characterStartTimesSeconds, ends: a.characterEndTimesSeconds },
      billedChars: text.length,
    };
  }
}

/** Voz simulada para probar el pipeline sin gastar: ruido suave con timestamps sintéticos (~15 caracteres/s). */
class MockTts implements TtsProvider {
  async synthesize(text: string): Promise<TtsResult> {
    const cps = 15;
    const dur = Math.max(0.6, text.length / cps);
    const tmp = join(tmpdir(), `mocktts-${process.pid}-${Math.random().toString(36).slice(2)}.mp3`);
    await ffmpeg([
      "-f", "lavfi", "-i", `anoisesrc=color=pink:amplitude=0.08:duration=${dur.toFixed(3)}`,
      "-af", "tremolo=f=4:d=0.7", "-ar", "44100", "-ac", "1", "-b:a", "128k", tmp,
    ]);
    const audio = readFileSync(tmp);
    rmSync(tmp, { force: true });
    const characters = [...text];
    const step = dur / Math.max(1, characters.length);
    return {
      audio,
      alignment: {
        characters,
        starts: characters.map((_, i) => i * step),
        ends: characters.map((_, i) => (i + 1) * step),
      },
      billedChars: 0,
    };
  }
}

export function getTts(cfg: ChannelConfig): TtsProvider {
  return cfg.voice.provider === "mock" ? new MockTts() : new ElevenLabsTts(cfg);
}
