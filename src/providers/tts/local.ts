import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
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

interface WorkerSpec {
  label: string;
  python: string;
  script: string;
  env: Record<string, string>;
  /** Campos extra de cada petición (voz, velocidad…). */
  extra: Record<string, unknown>;
  /** Comprueba el mensaje inicial del worker; devuelve un error o null. */
  checkReady?: (msg: Record<string, unknown>) => string | null;
  installHint: string;
}

/**
 * TTS local en un proceso Python persistente (el modelo se carga una vez).
 * Estos motores no dan timestamps: se sintetiza frase a frase (límites de frase exactos) y las letras
 * se reparten dentro de la zona con voz de cada frase.
 */
class LocalWorkerTts implements TtsProvider {
  private proc?: ChildProcessWithoutNullStreams;
  private queue: ((r: WorkerReply) => void)[] = [];
  private ready?: Promise<void>;
  private chain: Promise<unknown> = Promise.resolve();

  constructor(private spec: WorkerSpec) {
    process.once("exit", () => this.proc?.kill());
  }

  private start(): Promise<void> {
    if (this.ready) return this.ready;
    this.ready = new Promise((resolve, reject) => {
      const proc = spawn(this.spec.python, ["-I", join(ROOT, "scripts", this.spec.script)], {
        env: { ...process.env, ...this.spec.env },
      });
      this.proc = proc;
      let stderr = "";
      proc.stderr.on("data", (d) => (stderr += d));
      proc.on("exit", (code) => {
        if (code) reject(new Error(`${this.spec.label} terminó con código ${code}. ${this.spec.installHint}\n${stderr.slice(-1200)}`));
      });
      const rl = createInterface({ input: proc.stdout });
      let first = true;
      rl.on("line", (line) => {
        let msg: Record<string, unknown>;
        try {
          msg = JSON.parse(line);
        } catch {
          return; // líneas de log de librerías
        }
        if (first) {
          first = false;
          const err = this.spec.checkReady?.(msg) ?? null;
          if (err) reject(new Error(err));
          else resolve();
          return;
        }
        this.queue.shift()?.(msg as unknown as WorkerReply);
      });
    });
    return this.ready;
  }

  private request(text: string, out: string): Promise<WorkerReply> {
    const run = async () => {
      await this.start();
      const reply = new Promise<WorkerReply>((res) => this.queue.push(res));
      this.proc!.stdin.write(JSON.stringify({ text, out, ...this.spec.extra }) + "\n");
      const r = await reply;
      if (!r.ok) throw new Error(`${this.spec.label}: ${r.error}`);
      return r;
    };
    const p = this.chain.then(run, run);
    this.chain = p.catch(() => undefined);
    return p;
  }

  async synthesize(text: string): Promise<TtsResult> {
    const chunks = splitSentences(text);
    const dir = mkdtempSync(join(tmpdir(), "localtts-"));
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

const home = (p: string) => p.replace(/^~/, process.env.HOME ?? "");
const fromRoot = (p: string) => (isAbsolute(p) ? p : join(ROOT, p));

/** Kokoro-82M (motor de la skill media-use de HyperFrames). */
export function kokoroTts(cfg: ChannelConfig): TtsProvider {
  const k = cfg.voice.kokoro;
  return new LocalWorkerTts({
    label: "Kokoro",
    python: process.env.KOKORO_PYTHON || "python3",
    script: "kokoro_worker.py",
    env: { KOKORO_MODEL_DIR: home(k.modelDir) },
    extra: { voice: k.voice, speed: k.speed, lang: k.lang },
    checkReady: (msg) => {
      const voices = msg.voices as string[];
      return voices.includes(k.voice) ? null : `La voz Kokoro «${k.voice}» no existe. Españolas: ${voices.filter((v) => v.startsWith("e")).join(", ")}`;
    },
    installHint: "Instala con «npm run setup:voice».",
  });
}

/** Qwen3-TTS (skill qwen3-tts-mlx): clona la voz del narrador diseñada con «npm run voice:design». */
export function qwen3Tts(cfg: ChannelConfig): TtsProvider {
  const q = cfg.voice.qwen3;
  const ref = fromRoot(q.refAudio);
  const refText = ref.replace(/\.wav$/, ".txt");
  if (!existsSync(ref) || !existsSync(refText)) {
    throw new Error(`Falta la voz de referencia ${q.refAudio} (+ .txt). Créala con «npm run voice:design».`);
  }
  return new LocalWorkerTts({
    label: "Qwen3-TTS",
    python: home(process.env.QWEN3_PYTHON || q.python),
    script: "qwen3_worker.py",
    env: { QWEN3_MODEL: q.model, QWEN3_REF_AUDIO: ref, QWEN3_REF_TEXT: refText, QWEN3_LANGUAGE: q.language, QWEN3_SEED: String(q.seed) },
    extra: {},
    installHint: "Instala con «npm run setup:voice:qwen3».",
  });
}

function pushChar(c: string[], s: number[], e: number[], ch: string, a: number, b: number) {
  c.push(ch);
  s.push(a);
  e.push(b);
}

/** Divide en frases (y frases muy largas por comas) para no superar el límite de los modelos. */
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
