import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline";
import type { ChannelConfig } from "../../core/config.js";
import { ffmpeg } from "../../core/ffmpeg.js";
import { ROOT } from "../../core/paths.js";
import type { Alignment, TtsProvider, TtsResult } from "./index.js";

interface WorkerReply {
  ok: boolean;
  error?: string;
  seconds: number;
  speech_start: number;
  speech_end: number;
}

/**
 * Voz local con Kokoro-82M (el motor de la skill media-use de HyperFrames): gratis, sin clave, sin red.
 * Kokoro no devuelve timestamps, así que se sintetiza frase a frase: los límites de frase son exactos
 * y dentro de cada frase las letras se reparten en la zona con voz (sin silencios de los extremos).
 */
export class KokoroTts implements TtsProvider {
  private proc?: ChildProcessWithoutNullStreams;
  private queue: ((r: WorkerReply) => void)[] = [];
  private ready?: Promise<void>;
  private chain: Promise<unknown> = Promise.resolve();

  constructor(private cfg: ChannelConfig) {
    process.once("exit", () => this.proc?.kill());
  }

  private start(): Promise<void> {
    if (this.ready) return this.ready;
    this.ready = new Promise((resolve, reject) => {
      const python = process.env.KOKORO_PYTHON || "python3";
      const proc = spawn(python, ["-I", join(ROOT, "scripts", "kokoro_worker.py")], {
        env: { ...process.env, KOKORO_MODEL_DIR: this.cfg.voice.kokoro.modelDir.replace(/^~/, process.env.HOME ?? "") },
      });
      this.proc = proc;
      let stderr = "";
      proc.stderr.on("data", (d) => (stderr += d));
      proc.on("exit", (code) => {
        if (code) reject(new Error(`Kokoro terminó con código ${code}. ¿Instalaste «pip install kokoro-onnx soundfile» y el modelo? ${stderr.slice(-800)}`));
      });
      const rl = createInterface({ input: proc.stdout });
      let first = true;
      rl.on("line", (line) => {
        const msg = JSON.parse(line);
        if (first) {
          first = false;
          const voice = this.cfg.voice.kokoro.voice;
          if (!msg.voices.includes(voice)) reject(new Error(`La voz Kokoro «${voice}» no existe. Españolas: ${msg.voices.filter((v: string) => v.startsWith("e")).join(", ")}`));
          else resolve();
          return;
        }
        this.queue.shift()?.(msg);
      });
    });
    return this.ready;
  }

  private request(text: string, out: string): Promise<WorkerReply> {
    // Un único proceso Python atiende las peticiones en orden.
    const run = async () => {
      await this.start();
      const k = this.cfg.voice.kokoro;
      const reply = new Promise<WorkerReply>((res) => this.queue.push(res));
      this.proc!.stdin.write(JSON.stringify({ text, voice: k.voice, speed: k.speed, lang: k.lang, out }) + "\n");
      const r = await reply;
      if (!r.ok) throw new Error(`Kokoro: ${r.error}`);
      return r;
    };
    const p = this.chain.then(run, run);
    this.chain = p.catch(() => undefined);
    return p;
  }

  async synthesize(text: string): Promise<TtsResult> {
    const chunks = splitSentences(text);
    const dir = mkdtempSync(join(tmpdir(), "kokoro-"));
    try {
      const characters: string[] = [];
      const starts: number[] = [];
      const ends: number[] = [];
      const files: string[] = [];
      let offset = 0;
      for (const [i, chunk] of chunks.entries()) {
        const out = join(dir, `c${i}.wav`);
        const r = await this.request(chunk, out);
        files.push(out);
        if (i > 0) pushChar(characters, starts, ends, " ", offset, offset);
        const a = offset + r.speech_start;
        const b = offset + Math.max(r.speech_start + 0.05, r.speech_end);
        const chars = [...chunk];
        const step = (b - a) / chars.length;
        chars.forEach((c, j) => pushChar(characters, starts, ends, c, a + j * step, a + (j + 1) * step));
        offset += r.seconds;
      }
      const list = join(dir, "list.txt");
      writeFileSync(list, files.map((f) => `file '${f}'`).join("\n"));
      const joined = join(dir, "joined.wav");
      await ffmpeg(["-f", "concat", "-safe", "0", "-i", list, "-ar", "44100", "-ac", "1", joined]);
      const alignment: Alignment = { characters, starts, ends };
      return { audio: readFileSync(joined), format: "wav", alignment, billedChars: 0 };
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
}

function pushChar(c: string[], s: number[], e: number[], ch: string, a: number, b: number) {
  c.push(ch);
  s.push(a);
  e.push(b);
}

/** Divide en frases (y frases muy largas por comas) para que Kokoro no supere su límite de fonemas. */
export function splitSentences(text: string, max = 260): string[] {
  const sentences = text
    .replace(/\s+/g, " ")
    .trim()
    .split(/(?<=[.!?…»])\s+(?=[¿¡«"A-ZÁÉÍÓÚÑ0-9])/u)
    .filter(Boolean);
  const out: string[] = [];
  for (const s of sentences) {
    if (s.length <= max) {
      out.push(s);
      continue;
    }
    let cur = "";
    for (const part of s.split(/(?<=[,;:])\s+/)) {
      if (cur && (cur + " " + part).length > max) {
        out.push(cur);
        cur = part;
      } else cur = cur ? `${cur} ${part}` : part;
    }
    if (cur) out.push(cur);
  }
  return out;
}
