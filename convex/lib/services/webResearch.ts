/**
 * The one call that searches the web for a research brief, through Anthropic's web search tool. It
 * returns the model's text and every page the search actually retrieved; research.ts screens the claims
 * against those pages. At most 5 searches, the limit the research brief's credit rate covers.
 *
 * NOT VERIFIED against the live API in this build: no key was available. The request shape follows the
 * installed SDK's types for web_search_20260209.
 */
import Anthropic from "@anthropic-ai/sdk";

import { resolve } from "../ai/registry";
import type { FoundPage } from "./research";
import { RESEARCH_RULES } from "./research";

export class ResearchError extends Error {}

export async function searchAndWrite(input: { question: string; geography: string; service: string | null }): Promise<{ text: string; pages: FoundPage[]; usage: { inputTokens: number; outputTokens: number }; model: string }> {
  const resolved = resolve("chat");
  if (!resolved.ready) throw new ResearchError("Web research isn't available right now: no AI model is connected.");
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) throw new ResearchError("Web research isn't available right now.");
  const client = new Anthropic({ apiKey, timeout: 180_000, maxRetries: 2 });
  const user = [`Question: ${input.question}`, `Where: ${input.geography || "not given"}`, input.service ? `The company's service in question:\n${input.service}` : null].filter(Boolean).join("\n\n");
  const messages: Anthropic.MessageParam[] = [{ role: "user", content: user }];
  const pages = new Map<string, FoundPage>();
  let text = "";
  let inputTokens = 0;
  let outputTokens = 0;
  let model = resolved.model.model;
  // The server may pause a long search turn; continuing it is the same request, not a new search budget.
  for (let turn = 0; turn < 4; turn += 1) {
    let response: Anthropic.Message;
    try {
      response = await client.messages.create({
        model: resolved.model.model,
        max_tokens: 8000,
        system: RESEARCH_RULES,
        tools: [{ type: "web_search_20260209", name: "web_search", max_uses: 5 }],
        messages,
      });
    } catch (error) {
      if (error instanceof Anthropic.RateLimitError) throw new ResearchError("The model is busy right now. Try again in a few minutes.");
      if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) throw new ResearchError("Web research isn't available right now.");
      throw new ResearchError("The research could not be finished. Nothing was charged.");
    }
    inputTokens += response.usage.input_tokens;
    outputTokens += response.usage.output_tokens;
    model = response.model;
    for (const block of response.content) {
      if (block.type === "web_search_tool_result" && Array.isArray(block.content)) {
        for (const result of block.content) if (!pages.has(result.url)) pages.set(result.url, { url: result.url, title: result.title ?? null, pageAge: result.page_age ?? null });
      }
      if (block.type === "text") {
        text += block.text;
        for (const citation of block.citations ?? []) {
          if (citation.type === "web_search_result_location" && !pages.has(citation.url)) pages.set(citation.url, { url: citation.url, title: citation.title ?? null, pageAge: null });
        }
      }
    }
    if (response.stop_reason === "pause_turn") {
      messages.push({ role: "assistant", content: response.content });
      continue;
    }
    if (response.stop_reason === "refusal") throw new ResearchError("The model declined this research request.");
    break;
  }
  return { text, pages: [...pages.values()], usage: { inputTokens, outputTokens }, model };
}
