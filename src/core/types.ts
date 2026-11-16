import { z } from "zod";

export const Brief = z.object({
  topic: z.string(),
  slug: z.string(),
  angle: z.string().optional(),
  createdAt: z.string(),
});
export type Brief = z.infer<typeof Brief>;

export const Camera = z.enum(["zoom-in", "zoom-out", "pan-left", "pan-right"]);
export type Camera = z.infer<typeof Camera>;

export const Scene = z.object({
  id: z.number().int().positive(),
  chapter: z.string(),
  narration: z.string(),
  imagePrompt: z.string(),
  /** Si se indica, reutiliza la imagen de esa escena (ahorro de coste) en vez de generar una nueva. */
  reuseImageOf: z.number().int().positive().nullable().optional(),
  onScreenText: z.string().nullable().optional(),
  camera: Camera,
  /** Duración estimada antes de la voz; tras la fase de voz se usa la duración real. */
  estSeconds: z.number().optional(),
  sfx: z.string().nullable().optional(),
});
export type Scene = z.infer<typeof Scene>;

export const ScenesFile = z.object({
  title: z.string(),
  chapters: z.array(z.object({ title: z.string(), firstSceneId: z.number().int() })),
  scenes: z.array(Scene),
});
export type ScenesFile = z.infer<typeof ScenesFile>;

/** Palabra con tiempos absolutos (segundos) dentro de narration.wav. */
export interface WordTiming {
  text: string;
  start: number;
  end: number;
}

export interface SceneTiming {
  id: number;
  /** Inicio y fin dentro de narration.wav (sin intro). */
  start: number;
  end: number;
  audioSeconds: number;
  words: WordTiming[];
}

export interface TimestampsFile {
  totalSeconds: number;
  scenes: SceneTiming[];
}

/** Subtítulo listo para quemar (tiempos relativos al vídeo final, con intro). */
export interface Cue {
  start: number;
  end: number;
  lines: string[];
}
