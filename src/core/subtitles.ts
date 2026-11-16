import type { Cue, WordTiming } from "./types.js";

/**
 * Agrupa palabras en subtítulos de máx. 2 líneas.
 * Corta en fin de frase, en silencios > 0,6 s o cuando no cabe la siguiente palabra.
 */
export function buildCues(words: WordTiming[], offset: number, maxCharsPerLine: number, maxLines = 2): Cue[] {
  const cues: Cue[] = [];
  let cur: WordTiming[] = [];

  const flush = () => {
    if (!cur.length) return;
    cues.push({ start: cur[0].start + offset, end: cur[cur.length - 1].end + offset, lines: wrap(cur.map((w) => w.text), maxCharsPerLine) });
    cur = [];
  };

  for (let i = 0; i < words.length; i++) {
    const w = words[i];
    const prev = cur[cur.length - 1];
    if (prev && w.start - prev.end > 0.6) flush();
    const candidate = [...cur, w].map((x) => x.text);
    if (cur.length && wrap(candidate, maxCharsPerLine).length > maxLines) flush();
    cur.push(w);
    const text = w.text;
    const endsSentence = /[.!?…»]$/.test(text) && !/^(Sr|Sra|Dr|D|Dña|St)\.$/.test(text);
    const endsClause = /[,;:]$/.test(text);
    const len = cur.map((x) => x.text).join(" ").length;
    if (endsSentence && len > 12) flush();
    else if (endsClause && len > maxCharsPerLine * 1.3) flush();
  }
  flush();

  // Mantener cada subtítulo en pantalla hasta el siguiente (máx. +0,5 s) y al menos 0,8 s.
  for (let i = 0; i < cues.length; i++) {
    const next = cues[i + 1];
    const hold = Math.max(cues[i].start + 0.8, cues[i].end + 0.5);
    cues[i].end = next ? Math.min(hold, next.start - 0.02) : hold;
  }
  return cues;
}

/** Reparte palabras en líneas equilibradas de como mucho `max` caracteres. */
export function wrap(words: string[], max: number): string[] {
  const text = words.join(" ");
  if (text.length <= max) return [text];
  // Intentar 2 líneas equilibradas.
  let best: string[] | null = null;
  let bestScore = Infinity;
  for (let i = 1; i < words.length; i++) {
    const a = words.slice(0, i).join(" ");
    const b = words.slice(i).join(" ");
    if (a.length > max || b.length > max) continue;
    const score = Math.abs(a.length - b.length);
    if (score < bestScore) {
      bestScore = score;
      best = [a, b];
    }
  }
  if (best) return best;
  // No cabe en 2: líneas codiciosas.
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    if (line && (line + " " + w).length > max) {
      lines.push(line);
      line = w;
    } else line = line ? line + " " + w : w;
  }
  if (line) lines.push(line);
  return lines;
}

export function toSrt(cues: Cue[]): string {
  const t = (s: number) => {
    const ms = Math.round(s * 1000);
    const h = Math.floor(ms / 3600000);
    const m = Math.floor((ms % 3600000) / 60000);
    const sec = Math.floor((ms % 60000) / 1000);
    const r = ms % 1000;
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")},${String(r).padStart(3, "0")}`;
  };
  return cues.map((c, i) => `${i + 1}\n${t(c.start)} --> ${t(c.end)}\n${c.lines.join("\n")}\n`).join("\n");
}
