import { writeFileSync } from "node:fs";
import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";
import type { ChannelConfig } from "../../core/config.js";
import { retry, streamToBuffer } from "../../core/util.js";

/** Efecto de sonido sutil (viento, pasos, campanas…) con ElevenLabs. */
export async function generateSfx(cfg: ChannelConfig, text: string, seconds: number, outPath: string) {
  const client = new ElevenLabsClient();
  const stream = await retry("ElevenLabs SFX", () =>
    client.textToSoundEffects.convert({
      text,
      modelId: cfg.sfx.modelId as never,
      durationSeconds: Math.min(30, Math.max(0.5, seconds)),
      promptInfluence: 0.4,
    }),
  );
  writeFileSync(outPath, await streamToBuffer(stream));
  return { usd: cfg.pricing.elevenlabsSfxPerGeneration };
}
