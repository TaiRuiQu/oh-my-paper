import type { ServerResponse } from "node:http";

// A protocol fixture exercises the real SDK tool loop, worker, storage and website.
// It deliberately submits too early once, then corrects the validation errors.
export function recognitionFixtureResponse(
  input: { input?: unknown[]; tools?: { name: string }[]; stream?: boolean },
  res: ServerResponse,
  calls: string[],
) {
  if (!input.tools?.some((t) => t.name === "read_pages")) return false;
  const context = JSON.stringify(input.input);
  const template = context.includes("fixed template");
  const prior = (input.input ?? []).filter(
    (i): i is { type: string; name: string } =>
      !!i && typeof i === "object" && "type" in i && i.type === "function_call",
  );
  const region = { page: 1, x: 0.06, y: 0.2, width: 0.8, height: 0.16 };
  let tools: { name: string; input: unknown }[];
  if (!prior.length) tools = [{ name: "read_pages", input: { pages: [1] } }];
  else if (!prior.some((c) => c.name === "finish"))
    tools = [{ name: "finish", input: { questionCount: template ? 1 : 0, summary: "检查" } }];
  else if (!prior.some((c) => c.name === "save_document"))
    tools = [
      {
        name: "save_document",
        input: {
          title: "合成测试卷",
          subject: "数学",
          grade: null,
          instructions: [],
          sections: [{ title: "一、计算与选择题", points: 5 }],
          pages: [
            {
              page: 1,
              documentType: template ? "answer_sheet" : "question_paper",
              hasQuestionStems: !template,
              annotationKinds: ["student_answer"],
            },
          ],
          materials: [],
          findings: [],
        },
      },
      ...(template
        ? []
        : [
            {
              name: "save_questions",
              input: {
                questions: [
                  {
                    order: 1,
                    number: "1",
                    section: "一、计算与选择题",
                    type: "fill_blank",
                    markdown: "计算：2 + 3 = ____。",
                    points: 5,
                    pointsOrigin: "printed",
                    pointsReason: "",
                    regions: [region],
                    options: [],
                    parts: [],
                    materialRefs: [],
                    figures: [],
                    answerTargets: [
                      { key: "main", partLabel: null, parentLabel: null, blankIndex: 1 },
                    ],
                  },
                ],
              },
            },
          ]),
      {
        name: "save_annotations",
        input: {
          annotations: [
            {
              id: "a1",
              questionNumber: "1",
              section: "一、计算与选择题",
              partLabel: null,
              kind: "student_answer",
              markdown: template ? "4\n![手写作答证据](answer-figure)" : "4",
              regions: [region],
              figures: template
                ? [{ id: "answer-figure", caption: "手写作答证据", region, contaminated: true }]
                : [],
            },
          ],
        },
      },
    ];
  else
    tools = [
      { name: "finish", input: { questionCount: 1, summary: "已识别题目并分离学生作答。" } },
    ];
  const output = tools.map((t, i) => ({
    type: "function_call",
    id: `fc_${prior.length}_${i}`,
    call_id: `call_${prior.length}_${i}`,
    name: t.name,
    arguments: JSON.stringify(t.input),
    status: "completed",
  }));
  calls.push(...tools.map((t) => t.name));
  const response = {
    id: `resp_${prior.length}`,
    created_at: 1,
    model: "fixture-vision",
    status: "completed",
    output,
    usage: {
      input_tokens: 12,
      output_tokens: 8,
      total_tokens: 20,
      input_tokens_details: { cached_tokens: 4 },
    },
  };
  if (!input.stream) {
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify(response));
    return true;
  }
  res.setHeader("content-type", "text/event-stream");
  const send = (data: unknown) => res.write(`data: ${JSON.stringify(data)}\n\n`);
  send({ type: "response.created", response: { ...response, status: "in_progress", output: [] } });
  output.forEach((item, output_index) => {
    send({ type: "response.output_item.added", output_index, item: { ...item, arguments: "" } });
    send({
      type: "response.function_call_arguments.delta",
      output_index,
      item_id: item.id,
      delta: item.arguments,
    });
    send({ type: "response.output_item.done", output_index, item });
  });
  send({ type: "response.completed", response });
  res.end();
  return true;
}
