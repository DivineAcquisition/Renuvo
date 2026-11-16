/**
 * Claude behind Company Chat (model.ts chooses it when ANTHROPIC_API_KEY is set).
 *
 * One streamed request per step of a run. Text arrives as it is written and is saved as it arrives, so
 * a refresh shows what has been written so far. The assistant's content is passed back unchanged within
 * the run, as the API requires for tool use. Between runs only the visible words are replayed: no
 * reasoning is stored or shown.
 *
 * Refusals fall back to another model server-side ("fallbacks": "default"). Retries for rate limits,
 * server errors and dropped connections are the SDK's own.
 *
 * NOT VERIFIED against the live API in this build: no key was available.
 */
import Anthropic from "@anthropic-ai/sdk";

import { ModelError, type ChatModel, type ModelReply } from "./model";

export const CHAT_MODEL_ID = "claude-opus-5-5";
const BETAS = ["server-side-fallback-2026-07-01"];

export function claudeChatModel(apiKey: string, options: { fetch?: typeof fetch; maxRetries?: number } = {}): ChatModel {
  const client = new Anthropic({ apiKey, timeout: 120_000, maxRetries: options.maxRetries ?? 2, fetch: options.fetch });
  return {
    name: "claude",
    async respond(request): Promise<ModelReply> {
      try {
        const stream = client.beta.messages.stream(
          {
            model: CHAT_MODEL_ID,
            max_tokens: request.maxTokens,
            betas: BETAS,
            fallbacks: "default",
            // A conversation with tools: medium effort is the model's default, stated so it does not drift.
            output_config: { effort: "medium" },
            // The frozen part first, so the prompt cache can reuse it across steps of a run.
            system: [{ type: "text", text: request.system, cache_control: { type: "ephemeral" } }],
            tools: request.tools.map((tool) => ({ name: tool.name, description: tool.description, input_schema: tool.input_schema as Anthropic.Beta.BetaTool.InputSchema, eager_input_streaming: true })),
            messages: request.messages as Anthropic.Beta.BetaMessageParam[],
          },
          { signal: request.signal },
        );
        stream.on("text", (delta) => request.onText(delta));
        const message = await stream.finalMessage();
        const text = message.content.map((block) => (block.type === "text" ? block.text : "")).join("");
        const toolCalls = message.content.flatMap((block) => (block.type === "tool_use" ? [{ id: block.id, name: block.name, input: block.input }] : []));
        const stop = message.stop_reason === "refusal" ? "refusal" : message.stop_reason === "max_tokens" ? "max_tokens" : toolCalls.length > 0 ? "tool_use" : "end";
        return { stop, text, toolCalls, content: message.content, usage: { inputTokens: message.usage.input_tokens + (message.usage.cache_read_input_tokens ?? 0) + (message.usage.cache_creation_input_tokens ?? 0), outputTokens: message.usage.output_tokens }, model: message.model };
      } catch (error) {
        if (error instanceof Anthropic.APIUserAbortError) throw new ModelError("Stopped.", false);
        if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) throw new ModelError("The model provider did not accept this deployment's key. An administrator needs to check ANTHROPIC_API_KEY.", false);
        if (error instanceof Anthropic.RateLimitError) throw new ModelError("The model is busy right now. Try again in a minute.", true);
        if (error instanceof Anthropic.BadRequestError) throw new ModelError("The model could not take this request. Try rephrasing, or start a new chat if this one is very long.", false);
        if (error instanceof Anthropic.APIError) throw new ModelError("The model provider had a problem. Try again.", true);
        // A tool input the stream could not parse, a dropped connection after retries, or anything else.
        throw new ModelError("The answer was interrupted. Try again.", true);
      }
    },
    toolResults(results) {
      return { role: "user", content: results.map((result) => ({ type: "tool_result", tool_use_id: result.id, content: result.content, is_error: result.isError })) };
    },
  };
}
