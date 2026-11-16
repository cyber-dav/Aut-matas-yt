import { test } from "node:test";
import assert from "node:assert/strict";
import { buildCues, wrap } from "./subtitles.js";
import { alignmentToWords } from "../stages/s4-voice.js";
import { unverifiedTerms } from "../stages/qa.js";
import { slugify } from "./paths.js";

test("alignmentToWords agrupa caracteres en palabras con tiempos y desplazamiento", () => {
  const text = "Hola, Allariz.";
  const chars = [...text];
  const w = alignmentToWords({ characters: chars, starts: chars.map((_, i) => i * 0.1), ends: chars.map((_, i) => i * 0.1 + 0.1) }, 10);
  assert.deepEqual(w.map((x) => x.text), ["Hola,", "Allariz."]);
  assert.equal(w[0].start, 10);
  assert.ok(Math.abs(w[1].end - 11.4) < 1e-9);
});

test("wrap reparte en 2 líneas equilibradas sin pasar el máximo", () => {
  const lines = wrap("En mil ochocientos cincuenta y dos un buhonero gallego confesó".split(" "), 42);
  assert.equal(lines.length, 2);
  lines.forEach((l) => assert.ok(l.length <= 42));
});

test("buildCues: máx. 2 líneas, corta en fin de frase y no se solapan", () => {
  const words = "Era un buhonero. Nadie sospechaba de él. Hasta que en mil ochocientos cincuenta y dos todo cambió para siempre en la sierra".split(" ")
    .map((t, i) => ({ text: t, start: i * 0.4, end: i * 0.4 + 0.35 }));
  const cues = buildCues(words, 3, 42);
  assert.ok(cues.length >= 3);
  assert.equal(cues[0].lines.join(" "), "Era un buhonero.");
  assert.equal(cues[0].start, 3);
  for (let i = 0; i < cues.length; i++) {
    assert.ok(cues[i].lines.length <= 2);
    if (cues[i + 1]) assert.ok(cues[i].end <= cues[i + 1].start);
  }
});

test("unverifiedTerms detecta nombres y cifras ausentes en la investigación", () => {
  const research = "Manuel Blanco Romasanta fue juzgado en Allariz en 1853.";
  const script = "# T\n## Gancho\nEn Allariz juzgaron a Romasanta. Lo defendió Napoleón en 1999.";
  const out = unverifiedTerms(script, research);
  assert.ok(out.includes("Napoleón"));
  assert.ok(out.includes("1999"));
  assert.ok(!out.includes("Romasanta"));
});

test("slugify", () => {
  assert.equal(slugify("El hombre lobo de Allariz: el asesino que juró transformarse en bestia"), "el-hombre-lobo-de-allariz");
  assert.equal(slugify("¿Dónde está la cabeza de Goya?"), "donde-esta-la-cabeza-de-goya");
});
