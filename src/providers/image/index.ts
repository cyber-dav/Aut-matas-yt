import { writeFileSync } from "node:fs";
import { fal } from "@fal-ai/client";
import type { ChannelConfig } from "../../core/config.js";
import { ffmpeg } from "../../core/ffmpeg.js";
import { retry } from "../../core/util.js";

/** Interfaz común: cualquier proveedor de imágenes (fal, Replicate, OpenAI…) implementa esto. */
export interface ImageRequest {
  prompt: string;
  width: number;
  height: number;
  seed?: number;
}

export interface ImageProvider {
  readonly name: string;
  /** Genera la imagen y la guarda en `outPath` (PNG). Devuelve el coste estimado en USD. */
  generate(req: ImageRequest, outPath: string): Promise<{ usd: number }>;
}

class FalImageProvider implements ImageProvider {
  readonly name = "fal";
  constructor(private cfg: ChannelConfig) {
    if (!process.env.FAL_KEY) throw new Error("Falta FAL_KEY en .env");
    fal.config({ credentials: process.env.FAL_KEY });
  }

  async generate(req: ImageRequest, outPath: string) {
    const result = await retry("fal.ai", () =>
      fal.subscribe(this.cfg.images.model, {
        input: {
          prompt: req.prompt,
          image_size: { width: req.width, height: req.height },
          num_images: 1,
          output_format: "png",
          enable_safety_checker: true,
          ...(req.seed !== undefined ? { seed: req.seed } : {}),
        },
        logs: false,
      }),
    );
    const data = result.data as { images?: { url: string }[]; has_nsfw_concepts?: boolean[] };
    const url = data.images?.[0]?.url;
    if (!url) throw new Error(`fal no devolvió imagen (request ${result.requestId})`);
    if (data.has_nsfw_concepts?.[0]) throw new Error("fal marcó la imagen como no apta; revisa el prompt");
    const buf = await retry("descarga imagen", async () => {
      const r = await fetch(url);
      if (!r.ok) throw Object.assign(new Error(`HTTP ${r.status}`), { status: r.status });
      return Buffer.from(await r.arrayBuffer());
    });
    writeFileSync(outPath, buf);
    return { usd: this.cfg.pricing.falPerImage };
  }
}

/** Imágenes de prueba (degradado sepia con número) para probar montaje sin gastar. */
class MockImageProvider implements ImageProvider {
  readonly name = "mock";
  async generate(req: ImageRequest, outPath: string) {
    const hue = Math.abs(hash(req.prompt)) % 40;
    await ffmpeg([
      "-f", "lavfi", "-i", `gradients=s=${req.width}x${req.height}:c0=0x1a120b:c1=0x5a3a22:x0=0:y0=0:x1=${req.width}:y1=${req.height}:seed=${hue}`,
      "-f", "lavfi", "-i", `noise=alls=20:allf=t,nullsrc=s=${req.width}x${req.height}`,
      "-filter_complex", "[0][1]blend=all_mode=overlay:all_opacity=0.15,vignette=PI/4",
      "-frames:v", "1", outPath,
    ]).catch(async () => {
      await ffmpeg(["-f", "lavfi", "-i", `color=c=0x3b2a1a:s=${req.width}x${req.height}`, "-vf", "vignette=PI/4", "-frames:v", "1", outPath]);
    });
    return { usd: 0 };
  }
}

function hash(s: string): number {
  let h = 0;
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) | 0;
  return h;
}

export function getImageProvider(cfg: ChannelConfig): ImageProvider {
  switch (cfg.images.provider) {
    case "mock":
      return new MockImageProvider();
    case "fal":
      return new FalImageProvider(cfg);
  }
}

/** Prompt final = escena + biblia de estilo + prohibiciones. */
export function buildImagePrompt(cfg: ChannelConfig, scenePrompt: string, extra = ""): string {
  return [scenePrompt.trim().replace(/\.$/, ""), extra, cfg.images.styleBibleEn, cfg.images.negative]
    .filter(Boolean)
    .join(". ");
}
