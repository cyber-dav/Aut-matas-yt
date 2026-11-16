import { test } from "node:test";
import assert from "node:assert/strict";
import { splitSentences } from "./local.js";

test("splitSentences corta por frases y trocea frases muy largas por comas", () => {
  const t = "Era septiembre. ¿Quién lo sabía? Nadie, salvo él. " + "una cláusula larga, ".repeat(20) + "fin.";
  const parts = splitSentences(t, 120);
  assert.equal(parts[0], "Era septiembre.");
  assert.equal(parts[1], "¿Quién lo sabía?");
  assert.ok(parts.every((p) => p.length <= 120));
  assert.equal(parts.join(" ").replace(/\s+/g, " "), t.trim().replace(/\s+/g, " "));
});
