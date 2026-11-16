import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { ensureDir } from "./paths.js";

export const log = {
  step: (msg: string) => console.log(`\n▶ ${msg}`),
  info: (msg: string) => console.log(`  ${msg}`),
  ok: (msg: string) => console.log(`  ✓ ${msg}`),
  warn: (msg: string) => console.warn(`  ⚠ ${msg}`),
  skip: (msg: string) => console.log(`  ↷ ${msg} (ya existe; usa --force para rehacer)`),
};

export function readJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

export function writeJson(path: string, data: unknown): void {
  ensureDir(dirname(path));
  writeFileSync(path, JSON.stringify(data, null, 2) + "\n");
}

export function writeText(path: string, text: string): void {
  ensureDir(dirname(path));
  writeFileSync(path, text.endsWith("\n") ? text : text + "\n");
}

export function exists(...paths: string[]): boolean {
  return paths.every((p) => existsSync(p));
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Reintenta con espera exponencial. No reintenta errores 4xx salvo 408/409/429. */
export async function retry<T>(
  label: string,
  fn: () => Promise<T>,
  { attempts = 4, baseMs = 2000 }: { attempts?: number; baseMs?: number } = {},
): Promise<T> {
  let lastErr: unknown;
  for (let i = 1; i <= attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const status = (err as { statusCode?: number; status?: number }).statusCode ?? (err as { status?: number }).status;
      const retryable = status === undefined || status >= 500 || [408, 409, 429].includes(status);
      if (!retryable || i === attempts) break;
      const wait = baseMs * 2 ** (i - 1) + Math.random() * 500;
      log.warn(`${label}: intento ${i} falló (${status ?? (err as Error).message}); reintento en ${(wait / 1000).toFixed(1)} s`);
      await sleep(wait);
    }
  }
  throw lastErr;
}

/** Segundos → «m:ss» o «h:mm:ss» (formato de capítulos de YouTube). */
export function fmtTime(sec: number): string {
  const s = Math.floor(sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

export function countWords(text: string): number {
  return text.replace(/\[[^\]]*\]/g, " ").split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
}

export async function streamToBuffer(stream: ReadableStream<Uint8Array>): Promise<Buffer> {
  const chunks: Uint8Array[] = [];
  const reader = stream.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) chunks.push(value);
  }
  return Buffer.concat(chunks);
}
