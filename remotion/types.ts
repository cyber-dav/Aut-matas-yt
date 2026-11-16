/** Props compartidas entre el pipeline (Node) y las composiciones de Remotion. */

export type Camera = "zoom-in" | "zoom-out" | "pan-left" | "pan-right";

export interface TimelineScene {
  id: number;
  /** Ruta relativa a la carpeta public del render (staticFile). */
  image: string;
  camera: Camera;
  /** Segundos absolutos en el vídeo final. */
  start: number;
  end: number;
  onScreenText?: string | null;
}

export interface TimelineCue {
  start: number;
  end: number;
  lines: string[];
}

export interface EpisodeProps {
  [key: string]: unknown;
  channelName: string;
  tagline: string;
  title: string;
  fps: number;
  width: number;
  height: number;
  introSeconds: number;
  outroSeconds: number;
  crossfadeSeconds: number;
  totalSeconds: number;
  audio: string;
  scenes: TimelineScene[];
  cues: TimelineCue[];
  /** Imagen de fondo de la pantalla final. */
  outroImage: string;
}

export interface ShortProps {
  [key: string]: unknown;
  channelName: string;
  fps: number;
  totalSeconds: number;
  audio: string;
  hook: string;
  cta: string;
  ctaSeconds: number;
  scenes: TimelineScene[];
  cues: TimelineCue[];
}

export interface ThumbnailProps {
  [key: string]: unknown;
  image: string;
  text: string;
  channelName: string;
  /** Posición del texto. */
  align: "left" | "right";
}
