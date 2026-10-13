type MockResponse = {
  id: string;
  model: string;
  created?: number;
  created_at?: number;
  stop_reason?: string;
  usage?: Record<string, unknown>;
  content?: { type: string; text: string }[];
  choices?: {
    index: number;
    message: {
      content?: string | null;
      tool_calls?: { id: string; function: { name: string; arguments: string } }[];
    };
    finish_reason: string;
  }[];
  output?: {
    type: string;
    id: string;
    call_id?: string;
    name?: string;
    arguments?: string;
    encrypted_content?: string | null;
    summary?: { text: string }[];
    content?: { type: string; text: string }[];
  }[];
};

export function eventStream(events: unknown[], done = false): Response {
  const body = events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("");
  return new Response(body + (done ? "data: [DONE]\n\n" : ""), {
    headers: { "content-type": "text/event-stream" },
  });
}

function fragments(text: string) {
  const middle = Math.max(1, Math.floor(text.length / 2));
  return [text.slice(0, middle), text.slice(middle)].filter(Boolean);
}

// Convert existing completion fixtures into actual SSE events, splitting text
// and tool arguments so tests exercise incremental parsing and final usage.
export function modelStreamResponse(value: unknown): Response {
  const response = value as MockResponse;
  if (response.choices) {
    const base = {
      id: response.id,
      model: response.model,
      created: response.created ?? 1,
      object: "chat.completion.chunk",
    };
    const events: unknown[] = [];
    for (const choice of response.choices) {
      const chunk = (delta: unknown, finish_reason: string | null = null) => {
        events.push({ ...base, choices: [{ index: choice.index, delta, finish_reason }] });
      };
      chunk({ role: "assistant", content: "" });
      for (const content of fragments(choice.message.content ?? "")) chunk({ content });
      for (const [index, call] of (choice.message.tool_calls ?? []).entries()) {
        const [first = "", ...rest] = fragments(call.function.arguments);
        chunk({
          tool_calls: [
            {
              index,
              id: call.id,
              type: "function",
              function: { name: call.function.name, arguments: first },
            },
          ],
        });
        for (const argumentsPart of rest)
          chunk({ tool_calls: [{ index, function: { arguments: argumentsPart } }] });
      }
      chunk({}, choice.finish_reason);
    }
    if (response.usage) events.push({ ...base, choices: [], usage: response.usage });
    return eventStream(events, true);
  }
  if (response.output) {
    const events: unknown[] = [
      {
        type: "response.created",
        response: { id: response.id, model: response.model, created_at: response.created_at ?? 1 },
      },
    ];
    for (const [output_index, item] of response.output.entries()) {
      const added = item.type === "function_call" ? { ...item, arguments: "" } : item;
      events.push({ type: "response.output_item.added", output_index, item: added });
      if (item.type === "function_call") {
        for (const delta of fragments(item.arguments ?? ""))
          events.push({
            type: "response.function_call_arguments.delta",
            output_index,
            item_id: item.id,
            delta,
          });
      } else if (item.type === "reasoning") {
        for (const [summary_index, summary] of (item.summary ?? []).entries()) {
          events.push({
            type: "response.reasoning_summary_part.added",
            output_index,
            item_id: item.id,
            summary_index,
          });
          for (const delta of fragments(summary.text))
            events.push({
              type: "response.reasoning_summary_text.delta",
              output_index,
              item_id: item.id,
              summary_index,
              delta,
            });
        }
      } else if (item.type === "message") {
        for (const part of item.content ?? [])
          for (const delta of fragments(part.text))
            events.push({
              type: "response.output_text.delta",
              output_index,
              item_id: item.id,
              delta,
            });
      }
      events.push({
        type: "response.output_item.done",
        output_index,
        item: { ...item, status: "completed" },
      });
    }
    events.push({ type: "response.completed", response: { usage: response.usage } });
    return eventStream(events);
  }
  if (response.content) {
    const events: unknown[] = [
      {
        type: "message_start",
        message: {
          id: response.id,
          type: "message",
          role: "assistant",
          model: response.model,
          content: [],
          usage: response.usage ?? { input_tokens: 1, output_tokens: 0 },
        },
      },
    ];
    for (const [index, part] of response.content.entries()) {
      events.push({
        type: "content_block_start",
        index,
        content_block: { type: "text", text: "" },
      });
      for (const text of fragments(part.text))
        events.push({ type: "content_block_delta", index, delta: { type: "text_delta", text } });
      events.push({ type: "content_block_stop", index });
    }
    events.push({
      type: "message_delta",
      delta: { stop_reason: response.stop_reason ?? "end_turn", stop_sequence: null },
      usage: { output_tokens: response.usage?.output_tokens ?? 1 },
    });
    events.push({ type: "message_stop" });
    return eventStream(events);
  }
  throw new Error("Unsupported streaming fixture");
}
