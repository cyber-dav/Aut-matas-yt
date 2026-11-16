import { copyFileSync, existsSync, linkSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { bundle } from "@remotion/bundler";
import { renderMedia, renderStill, selectComposition } from "@remotion/renderer";
import { ensureDir, ROOT } from "./paths.js";
import { log } from "./util.js";

/**
 * Prepara una carpeta «public» para Remotion con enlaces duros a los archivos necesarios
 * (sin duplicar espacio) y empaqueta el proyecto. Devuelve la URL del bundle.
 */
export async function bundleWith(publicDir: string, files: Record<string, string>): Promise<string> {
  rmSync(publicDir, { recursive: true, force: true });
  ensureDir(publicDir);
  for (const [rel, src] of Object.entries(files)) {
    const dest = join(publicDir, rel);
    ensureDir(dirname(dest));
    if (!existsSync(src)) throw new Error(`Falta el archivo para el render: ${src}`);
    try {
      linkSync(src, dest);
    } catch {
      copyFileSync(src, dest);
    }
  }
  return bundle({
    entryPoint: join(ROOT, "remotion", "index.ts"),
    publicDir,
    outDir: join(dirname(publicDir), "bundle"),
    onProgress: () => undefined,
  });
}

export async function renderVideo(opts: {
  serveUrl: string;
  compositionId: "Episode" | "Short";
  props: Record<string, unknown>;
  out: string;
  label: string;
}) {
  const composition = await selectComposition({ serveUrl: opts.serveUrl, id: opts.compositionId, inputProps: opts.props });
  ensureDir(dirname(opts.out));
  let last = -1;
  const started = Date.now();
  await renderMedia({
    composition,
    serveUrl: opts.serveUrl,
    codec: "h264",
    audioCodec: "aac",
    audioBitrate: "192k",
    crf: 18,
    pixelFormat: "yuv420p",
    outputLocation: opts.out,
    inputProps: opts.props,
    chromiumOptions: { gl: "swangle" },
    onProgress: ({ progress }) => {
      const pct = Math.floor(progress * 100);
      if (pct >= last + 5) {
        last = pct;
        const elapsed = (Date.now() - started) / 1000;
        const eta = progress > 0.02 ? (elapsed / progress - elapsed) / 60 : NaN;
        log.info(`${opts.label}: ${pct}%${Number.isFinite(eta) ? ` (quedan ~${eta.toFixed(0)} min)` : ""}`);
      }
    },
  });
}

export async function renderThumb(opts: { serveUrl: string; props: Record<string, unknown>; out: string }) {
  const composition = await selectComposition({ serveUrl: opts.serveUrl, id: "Thumbnail", inputProps: opts.props });
  await renderStill({ composition, serveUrl: opts.serveUrl, output: opts.out, inputProps: opts.props, imageFormat: "jpeg", jpegQuality: 92 });
}
