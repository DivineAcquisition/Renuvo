/**
 * OpenRouter: the models a person chooses from other providers in chat (lib/ai/chatModels.ts), and the
 * stand-in when Anthropic is down or rate limited (never after a refusal). It speaks the OpenAI chat-completions format, so the conversation is converted both ways: the run
 * engine keeps one shape (Anthropic's content blocks) whichever model answered. Tool results already
 * carried out travel with the conversation, so the stand-in continues from them and repeats nothing.
 *
 * Reasoning blocks are dropped in conversion. Uploaded PDFs and images are sent as files.
 * Requests ask OpenRouter to use only providers that do not collect data (`data_collection: "deny"`).
 *
 * Model IDs are from OpenRouter's public model list (2026-11-16). Live calls are checked after deploy.
 */
import type { ChatModel, ModelMessage, ModelReply } from "../chat/model";
import { ModelError } from "../chat/model";
import { AiError } from "./errors";
import { providerFetch, readJson } from "./http";
import type { ModelEntry } from "./registry";

type Block = { type: string; text?: string; id?: string; name?: string; input?: unknown; tool_use_id?: string; content?: unknown; is_error?: boolean; title?: string; source?: { type: string; media_type?: string; data?: string } };
type UserPart = { type: "text"; text: string } | { type: "image_url"; image_url: { url: string } } | { type: "file"; file: { filename: string; file_data: string } };
type OpenAiMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string | UserPart[] }
  | { role: "assistant"; content: string | null; tool_calls?: { id: string; type: "function"; function: { name: string; arguments: string } }[] }
  | { role: "tool"; tool_call_id: string; content: string };

const textOf = (content: unknown): string => {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map((part) => (typeof part === "string" ? part : (part as Block).type === "text" ? ((part as Block).text ?? "") : (part as Block).type === "document" || (part as Block).type === "image" ? "[An attached file is not available to this model.]" : "")).join("\n");
  return "";
};

/** Anthropic-shaped conversation to OpenAI chat messages. */
export function toOpenAi(system: string, messages: ModelMessage[]): OpenAiMessage[] {
  const out: OpenAiMessage[] = [{ role: "system", content: system }];
  for (const message of messages) {
    if (typeof message.content === "string") {
      out.push(message.role === "user" ? { role: "user", content: message.content } : { role: "assistant", content: message.content });
      continue;
    }
    const blocks = (message.content as Block[]) ?? [];
    if (message.role === "assistant") {
      const text = blocks.filter((block) => block.type === "text").map((block) => block.text ?? "").join("");
      const calls = blocks.filter((block) => block.type === "tool_use").map((block) => ({ id: block.id!, type: "function" as const, function: { name: block.name!, arguments: JSON.stringify(block.input ?? {}) } }));
      out.push({ role: "assistant", content: text || null, ...(calls.length ? { tool_calls: calls } : {}) });
    } else {
      for (const block of blocks.filter((row) => row.type === "tool_result")) out.push({ role: "tool", tool_call_id: block.tool_use_id!, content: textOf(block.content) });
      // Uploaded PDFs and images travel as files, the way OpenRouter takes them; words stay words.
      const files: UserPart[] = [];
      for (const block of blocks) {
        const data = block.source?.type === "base64" ? block.source.data : undefined;
        if (!data) continue;
        if (block.type === "image") files.push({ type: "image_url", image_url: { url: `data:${block.source!.media_type ?? "image/png"};base64,${data}` } });
        else if (block.type === "document") files.push({ type: "file", file: { filename: (block.title ?? "document.pdf").replace(/[^\w .()-]/g, "_").slice(0, 120) || "document.pdf", file_data: `data:application/pdf;base64,${data}` } });
      }
      const rest = textOf(blocks.filter((row) => row.type !== "tool_result" && row.type !== "image" && row.type !== "document"));
      if (files.length) out.push({ role: "user", content: [...files, ...(rest.trim() ? [{ type: "text" as const, text: rest }] : [])] });
      else if (rest.trim()) out.push({ role: "user", content: rest });
    }
  }
  return out;
}

type Completion = {
  model?: string;
  choices?: { finish_reason?: string; message?: { content?: string | null; tool_calls?: { id: string; function: { name: string; arguments: string } }[] } }[];
  usage?: { prompt_tokens?: number; completion_tokens?: number; cost?: number };
};

/** An OpenAI-format completion back into the engine's shape. Unparseable tool arguments fail closed. */
export function fromOpenAi(body: Completion, fallbackModel: string): ModelReply {
  const choice = body.choices?.[0];
  if (!choice?.message) throw new ModelError("The model returned no answer.", true);
  const text = choice.message.content ?? "";
  const toolCalls = (choice.message.tool_calls ?? []).map((call) => {
    let input: unknown;
    try {
      input = JSON.parse(call.function.arguments || "{}");
    } catch {
      throw new ModelError("The model's action could not be read, so it was not carried out.", false);
    }
    return { id: call.id, name: call.function.name, input };
  });
  const content = [...(text ? [{ type: "text", text }] : []), ...toolCalls.map((call) => ({ type: "tool_use", id: call.id, name: call.name, input: call.input }))];
  const finish = choice.finish_reason ?? "stop";
  const stop: ModelReply["stop"] = finish === "content_filter" ? "refusal" : finish === "length" ? "max_tokens" : toolCalls.length ? "tool_use" : "end";
  return { stop, text, toolCalls, content, usage: { inputTokens: body.usage?.prompt_tokens ?? 0, outputTokens: body.usage?.completion_tokens ?? 0 }, model: `openrouter:${body.model ?? fallbackModel}` };
}

const hasPdf = (messages: ModelMessage[]) => messages.some((message) => Array.isArray(message.content) && (message.content as Block[]).some((block) => block.type === "document"));

export function openRouterChatModel(entry: ModelEntry): ChatModel {
  return {
    name: "openrouter",
    async respond(request) {
      const key = process.env.OPENROUTER_API_KEY?.trim();
      if (!key) throw new ModelError("OpenRouter is not connected on this deployment.", false);
      try {
        const response = await providerFetch("openrouter", "https://openrouter.ai/api/v1/chat/completions", {
          method: "POST",
          timeoutMs: entry.timeoutMs,
          signal: request.signal,
          headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", "X-Title": "Selestial" },
          body: JSON.stringify({
            model: entry.model,
            messages: toOpenAi(request.system, request.messages),
            tools: request.tools.map((tool) => ({ type: "function", function: { name: tool.name, description: tool.description, parameters: tool.input_schema } })),
            tool_choice: "auto",
            max_completion_tokens: request.maxTokens,
            provider: { data_collection: "deny" },
            // A model without native PDF input gets the PDF's text from OpenRouter's own extraction.
            ...(entry.pdfEngine && hasPdf(request.messages) ? { plugins: [{ id: "file-parser", pdf: { engine: entry.pdfEngine } }] } : {}),
          }),
        });
        const reply = fromOpenAi(await readJson<Completion>(response), entry.model);
        if (reply.text) request.onText(reply.text);
        return reply;
      } catch (error) {
        if (error instanceof ModelError) throw error;
        if (error instanceof AiError) throw new ModelError(error.kind === "cancelled" ? "Stopped." : `${entry.model} could not answer: ${error.words}`, error.fallbackEligible);
        throw new ModelError(`${entry.model} could not answer.`, true);
      }
    },
    toolResults(results) {
      return { role: "user", content: results.map((result) => ({ type: "tool_result", tool_use_id: result.id, content: result.content, is_error: result.isError })) };
    },
  };
}
