import { existsSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
export const EPISODES_DIR = join(ROOT, "episodes");

/** Rutas de todos los artefactos de un episodio. */
export function episodePaths(slug: string) {
  const dir = join(EPISODES_DIR, slug);
  return {
    slug,
    dir,
    brief: join(dir, "00-brief.json"),
    research: join(dir, "01-research.md"),
    sources: join(dir, "01-sources.json"),
    script: join(dir, "02-script.md"),
    scenes: join(dir, "03-scenes.json"),
    audioDir: join(dir, "04-audio"),
    audioScene: (id: number) => join(dir, "04-audio", "scenes", `${pad(id)}.mp3`),
    audioSceneTs: (id: number) => join(dir, "04-audio", "scenes", `${pad(id)}.json`),
    narration: join(dir, "04-audio", "narration.wav"),
    timestamps: join(dir, "04-audio", "timestamps.json"),
    music: join(dir, "04-audio", "music.mp3"),
    musicMeta: join(dir, "04-audio", "music.json"),
    mix: join(dir, "04-audio", "mix.wav"),
    imagesDir: join(dir, "05-images"),
    image: (id: number) => join(dir, "05-images", `${pad(id)}.png`),
    renderDir: join(dir, "06-render"),
    video: join(dir, "06-render", "video.mp4"),
    subtitlesSrt: join(dir, "06-render", "subtitles.srt"),
    timeline: join(dir, "06-render", "timeline.json"),
    thumbsDir: join(dir, "07-thumbnail"),
    metadata: join(dir, "08-metadata.md"),
    shortsDir: join(dir, "09-shorts"),
    approved: join(dir, "APPROVED"),
    cost: join(dir, "cost.json"),
    qa: join(dir, "QA.md"),
    cacheDir: join(dir, ".cache"),
  };
}

export type EpisodePaths = ReturnType<typeof episodePaths>;

export function pad(n: number, width = 3): string {
  return String(n).padStart(width, "0");
}

export function ensureDir(p: string): string {
  if (!existsSync(p)) mkdirSync(p, { recursive: true });
  return p;
}

/** Convierte un tema en slug: «El hombre lobo de Allariz: …» → el-hombre-lobo-de-allariz */
export function slugify(topic: string, maxWords = 6): string {
  const base = topic.split(/[:¿?¡!]/).map((s) => s.trim()).filter(Boolean)[0] ?? topic;
  return base
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .split(/\s+/)
    .slice(0, maxWords)
    .join("-");
}
