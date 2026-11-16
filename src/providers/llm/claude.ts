import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { z } from "zod";
import type { ChannelConfig } from "../../core/config.js";
import { log } from "../../core/util.js";

/**
 * Cliente de Claude para investigación, guion, escenas y metadatos.
 * - Opus 5.5 con pensamiento adaptativo (siempre activo) y esfuerzo configurable.
 * - Respaldo en servidor ante rechazos («fallbacks: default»).
 * - Streaming para no chocar con timeouts en salidas largas.
 */

const BETAS = ["server-side-fallback-2026-07-01"];

export interface LlmUsage {
  inputTokens: number;
  outputTokens: number;
  webSearches: number;
}

export interface LlmResult<T> {
  value: T;
  usage: LlmUsage;
  /** URLs de las búsquedas web (solo investigación). */
  urls: string[];
}

let client: Anthropic | undefined;
function getClient(): Anthropic {
  return (client ??= new Anthropic({ maxRetries: 4 }));
}

type BetaMessage = Anthropic.Beta.Messages.BetaMessage;

function addUsage(acc: LlmUsage, msg: BetaMessage) {
  acc.inputTokens += msg.usage.input_tokens + (msg.usage.cache_creation_input_tokens ?? 0) + (msg.usage.cache_read_input_tokens ?? 0);
  acc.outputTokens += msg.usage.output_tokens;
  acc.webSearches += msg.usage.server_tool_use?.web_search_requests ?? 0;
}

function assertNotRefused(msg: BetaMessage, what: string) {
  if (msg.stop_reason === "refusal") {
    const d = msg.stop_details;
    throw new Error(`Claude rechazó la petición (${what}): ${d && "category" in d ? d.category : ""} ${d && "explanation" in d ? d.explanation : ""}`);
  }
  if (msg.stop_reason === "max_tokens") {
    throw new Error(`La respuesta de Claude se cortó por max_tokens (${what}). Sube max_tokens o divide la tarea.`);
  }
}

function textOf(msg: BetaMessage): string {
  return msg.content
    .filter((b): b is Anthropic.Beta.Messages.BetaTextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
}

/** Investigación con búsqueda web en el servidor de Anthropic. Devuelve markdown. */
export async function researchWithWeb(cfg: ChannelConfig, system: string, prompt: string): Promise<LlmResult<string>> {
  const usage: LlmUsage = { inputTokens: 0, outputTokens: 0, webSearches: 0 };
  const messages: Anthropic.Beta.Messages.BetaMessageParam[] = [{ role: "user", content: prompt }];
  const urls = new Set<string>();
  let finalText = "";

  for (let turn = 0; turn < 8; turn++) {
    const stream = getClient().beta.messages.stream({
      model: cfg.llm.model,
      max_tokens: 64000,
      betas: BETAS,
      fallbacks: "default",
      output_config: { effort: cfg.llm.effort },
      system,
      tools: [{ type: "web_search_20260209", name: "web_search", max_uses: cfg.llm.maxWebSearches }],
      messages,
    });
    const msg = await stream.finalMessage();
    addUsage(usage, msg);
    for (const b of msg.content) {
      if (b.type === "web_search_tool_result" && Array.isArray(b.content)) {
        for (const r of b.content) if (r.type === "web_search_result") urls.add(r.url);
      }
    }
    finalText += textOf(msg);
    if (msg.stop_reason === "pause_turn") {
      log.info("La búsqueda continúa (pause_turn)…");
      messages.push({ role: "assistant", content: msg.content as Anthropic.Beta.Messages.BetaContentBlockParam[] });
      finalText = "";
      continue;
    }
    assertNotRefused(msg, "investigación");
    break;
  }
  return { value: finalText.trim(), usage, urls: [...urls] };
}

/** Texto libre largo (guion). */
export async function generateText(cfg: ChannelConfig, system: string, prompt: string): Promise<LlmResult<string>> {
  const usage: LlmUsage = { inputTokens: 0, outputTokens: 0, webSearches: 0 };
  const msg = await getClient()
    .beta.messages.stream({
      model: cfg.llm.model,
      max_tokens: 32000,
      betas: BETAS,
      fallbacks: "default",
      output_config: { effort: cfg.llm.effort },
      system,
      messages: [{ role: "user", content: prompt }],
    })
    .finalMessage();
  addUsage(usage, msg);
  assertNotRefused(msg, "texto");
  return { value: textOf(msg).trim(), usage, urls: [] };
}

/** Salida estructurada validada con Zod (escenas, metadatos, miniaturas…). */
export async function generateJson<S extends z.ZodType>(
  cfg: ChannelConfig,
  schema: S,
  system: string,
  prompt: string,
): Promise<LlmResult<z.infer<S>>> {
  const usage: LlmUsage = { inputTokens: 0, outputTokens: 0, webSearches: 0 };
  const msg = await getClient()
    .beta.messages.stream({
      model: cfg.llm.model,
      max_tokens: 64000,
      betas: BETAS,
      fallbacks: "default",
      output_config: { effort: cfg.llm.effort, format: betaZodOutputFormat(schema) },
      system,
      messages: [{ role: "user", content: prompt }],
    })
    .finalMessage();
  addUsage(usage, msg);
  assertNotRefused(msg, "JSON");
  const value = schema.parse(JSON.parse(textOf(msg)));
  return { value, usage, urls: [] };
}

export function llmCostUsd(cfg: ChannelConfig, u: LlmUsage): number {
  const p = cfg.pricing;
  return (
    (u.inputTokens / 1e6) * p.anthropicInputPerMTok +
    (u.outputTokens / 1e6) * p.anthropicOutputPerMTok +
    (u.webSearches / 1000) * p.anthropicWebSearchPer1k
  );
}
