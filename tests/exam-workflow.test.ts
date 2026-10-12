import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import type { ExamInventory, QuestionBounds, QuestionTranscription } from "@/contracts/exams";
import type { ExamModel, StructuredRequest } from "@/server/ai/deepseek";
import { parseExam,validateInventory } from "@/server/exams/parser";
import { materializeTranscription, validateBounds } from "@/server/exams/question-pipeline";
import { solutionIssues } from "@/server/exams/solutions";
import { ExamModelCallError } from "@/server/ai/deepseek";

const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map((d) => rm(d, { recursive: true, force: true }))); });
const r1 = { page: 1, x: 0.1, y: 0.1, width: 0.5, height: 0.5 };
const r2 = { ...r1, page: 2 };
const inventory: ExamInventory = {
  title: "跨页试卷", subject: "数学", grade: null, instructions: [], totalQuestions: 1, totalPoints: 10,
  pages: [1, 2].map((page) => ({ page, documentType: "question_paper" })), sections: [{ title: "填空", points: 10 }],
  questions: [{ number: "1", section: "填空", points: 10, pointsOrigin: "inferred", pointsReason: "本节一题共10分", pages: [1, 2] }], findings: [],
};
const bounds: QuestionBounds = { regions: [r1, r2], figures: [{ id: "figure-1", kind: "table", region: { ...r2, width: 0.2, height: 0.2 }, contaminated: false }], findings: [] };
const transcription: QuestionTranscription = {
  type: "fill_blank", blocks: [{ type: "text", text: "根据数据表填两个空：____、____。" }, { type: "figure", figureId: "figure-1", caption: "数据表" }, { type: "text", text: "表后条件。" }],
  options: [], parts: [], answerTargets: [1, 2].map((blankIndex) => ({ key: `blank-${blankIndex}`, blankIndex, partLabel: null, parentLabel: null })), findings: [],
};
async function inputs() {
  const dir = await mkdtemp(join(tmpdir(), "workflow-")); directories.push(dir);
  const files = [join(dir, "p1.png"), join(dir, "p2.png")];
  for (const file of files) await sharp({ create: { width: 400, height: 300, channels: 3, background: "white" } }).png().toFile(file);
  return { dir, files, outputDir: join(dir, "output") };
}
function model(name: string, handler: (request: StructuredRequest<unknown>) => Promise<unknown> | unknown): ExamModel {
  return { name, async generate(request) {
    return { output: request.schema.parse(await handler(request as StructuredRequest<unknown>)), inputTokens: 1, outputTokens: 1 };
  } };
}
describe("isolated paper workflow", () => {
  it("re-localizes clipped evidence while keeping full pages away from the transcription agent", async () => {
    const input = await inputs(); let located = 0, transcribed = 0;
    const cropWidths: number[] = [];
    const fixture = model("fixture", async (request) => {
      if (request.name === "exam_orientation") return { clockwiseDegrees:"0" };
      if (request.name === "exam_inventory") return inventory;
      if (request.name === "exam_question_bounds") {
        located++;
        if (located === 2) expect(JSON.stringify(request.content)).toContain("last line is clipped");
        return { ...bounds,regions:[{...r1,width:located===1?0.5:0.6},r2] };
      }
      expect(request.name).toBe("exam_question_transcription");
      const image = Array.isArray(request.content) ? request.content.find((c) => c.type === "file") : null;
      if (!image || image.type !== "file") throw new Error("Missing crop");
      expect(image.mediaType).toBe("image/png");cropWidths.push((await sharp(image.data as Uint8Array).metadata()).width!);
      return { ...transcription,findings:++transcribed === 1 ? [{severity:"warning",code:"missing_text",message:"last line is clipped",questionNumber:"1"}] : [] };
    });
    const exam = await parseExam({ ...input,model:fixture,generateAnswers:false });
    expect(located).toBe(2);expect(cropWidths).toEqual([200,240]);
    expect(exam.questions[0].status).toBe("ready");expect(exam.questions[0].regions[0].width).toBe(0.6);
    expect(exam.verification.findings.some((f)=>f.code==="missing_text")).toBe(false);
  });
  it("retries a timed-out transcription once from the same crops with a shorter agent run", async () => {
    const input = await inputs();let attempts=0;
    const fixture = model("fixture", (request) => {
      if (request.name === "exam_orientation") return {clockwiseDegrees:"0"};
      if (request.name === "exam_inventory") return inventory;
      if (request.name === "exam_question_bounds") return bounds;
      if (++attempts === 1) throw new ExamModelCallError(Object.assign(new Error(),{name:"TimeoutError"}),{calls:1,inputTokens:2,outputTokens:1,cachedInputTokens:0,cacheWriteTokens:0});
      expect(request.maxSteps).toBe(2);expect(request.tools).toBeUndefined();return transcription;
    });
    const exam=await parseExam({...input,model:fixture,generateAnswers:false});
    expect(attempts).toBe(2);expect(exam.questions[0].status).toBe("ready");expect(exam.verification.usage.calls).toBe(6);
  });
  it("uses fine bounds across pages, ordered material insertions and four independent models", async () => {
    const input = await inputs(); const calls: string[] = [];
    const overview = model("overview", (request) => { calls.push(request.name); return request.name === "exam_orientation" ? { clockwiseDegrees: "0" } : inventory; });
    const localization = model("locator", (request) => { calls.push(request.name); return bounds; });
    const text = model("text-agent", async (request) => {
      calls.push(request.name); expect(request.agent).toBe(true);
      expect(request.tools?.inspect_crop).toBeDefined();
      if (!Array.isArray(request.content)) throw new Error("Expected crop evidence");
      const images = request.content.filter((c) => c.type === "file"); expect(images).toHaveLength(2);
      for (const img of images) if (img.type === "file") {
        expect(img.mediaType).toBe("image/png");
        const meta = await sharp(img.data as Uint8Array).metadata(); expect(meta.width).toBe(200); expect(meta.height).toBe(150);
      }
      return transcription;
    });
    const solver = model("solver", async (request) => {
      calls.push(request.name);
      if (!Array.isArray(request.content)) throw new Error("Expected solver material");
      const images = request.content.filter((c) => c.type === "file"); expect(images).toHaveLength(1);
      if (images[0].type === "file") expect((await sharp(images[0].data as Uint8Array).metadata()).width).toBe(80);
      return { answer: "10、20", selectedOptions: [], explanation: "查表。", rubric: "每空5分", sufficient: true, issues: [],
        units: [10,20].map((answer,i) => ({ targetKey: `blank-${i+1}`,answer:String(answer),selectedOptions:[],explanation:"查表。" })) };
    });
    const exam = await parseExam({ ...input, model: overview, models: { localization, transcription: text, solution: solver } });
    expect(exam.questions[0].regions).toEqual(bounds.regions);
    expect(exam.questions[0].crops).toHaveLength(2);
    expect(exam.questions[0].blocks.map((b) => b.type)).toEqual(["text","figure","text"]);
    expect(exam.questions[0].pointsOrigin).toBe("inferred"); expect(exam.questions[0].status).toBe("ready");
    expect(exam.questions[0].solution?.units).toHaveLength(2); expect(exam.questions[0].solution?.sufficient).toBe(true);
    expect(exam.pipeline?.models).toMatchObject({ inventory:"overview",localization:"locator",transcription:"text-agent",solution:"solver" });
    expect(calls).toEqual(["exam_orientation","exam_orientation","exam_inventory","exam_question_bounds","exam_question_transcription","exam_solution"]);
    expect(JSON.parse(await readFile(join(input.outputDir,"exam.json"),"utf8")).questions[0].regions).toEqual(bounds.regions);
  });
  it("skips answer generation entirely when no reference is present and the user disables it", async () => {
    const input = await inputs(); const calls: string[] = [];
    const fixture = model("fixture", (request) => { calls.push(request.name); switch(request.name) {
      case "exam_orientation": return {clockwiseDegrees:"0"}; case "exam_inventory": return inventory;
      case "exam_question_bounds": return bounds; case "exam_question_transcription": return transcription;
      default: throw new Error("Unexpected solving call");
    } });
    const exam = await parseExam({ ...input, model: fixture, generateAnswers:false });
    expect(calls).not.toContain("exam_solution"); expect(exam.questions[0].solution).toBeUndefined();
  });
  it("rejects invented, missing and duplicated material IDs without silently reordering images", () => {
    expect(() => materializeTranscription({ ...transcription,blocks:[{type:"figure",figureId:"invented",caption:"x"}] },bounds)).toThrow(/Unknown/);
    expect(() => materializeTranscription({ ...transcription,blocks:[transcription.blocks[0]] },bounds)).toThrow(/Missing/);
    expect(() => materializeTranscription({ ...transcription,blocks:[transcription.blocks[1],transcription.blocks[1]] },bounds)).toThrow(/duplicate/);
    expect(() => validateBounds({ ...bounds,regions:[r1] },inventory.questions[0])).toThrow(/cover/);
    expect(() => validateBounds({ ...bounds,figures:[{...bounds.figures[0],region:{...r2,x:0.9}}] },inventory.questions[0])).toThrow(/Invalid/);
  });
  it("rejects a sufficient solution that omits one blank or its explanation", () => {
    const question = { id:"q",number:"1",section:"填空",type:"fill_blank" as const,points:10,blocks:[],parts:[],options:[],materialRefs:[],regions:[r1],status:"ready" as const,answerTargets:transcription.answerTargets };
    const solution = { answer:"10",selectedOptions:[],explanation:"计算。",rubric:"",sufficient:true,issues:[],model:"fixture",origin:"ai" as const,units:[{targetKey:"blank-1",answer:"10",selectedOptions:[],explanation:"计算。"}] };
    expect(solutionIssues(question,solution)).toContain("标准答案未完整覆盖每个小问或填空。");
  });
  it("checks numeric score totals and refuses an empty inventory when stems are visible", () => {
    const pages=[1,2].map(page=>({page,key:"",path:"",width:100,height:100,rotation:0,text:"",isPhotograph:false}));
    expect(()=>validateInventory({...inventory,totalPoints:20},pages)).toThrow(/declared paper total/);
    expect(()=>validateInventory({...inventory,sections:[{title:"填空",points:20}]},pages)).toThrow(/Section/);
    expect(()=>validateInventory({...inventory,questions:[],totalQuestions:0,pages:inventory.pages.map(p=>({...p,documentType:"mixed",hasQuestionStems:true}))},pages)).toThrow(/printed question stems/);
  });
  it("excludes answer-key row numbers even when the inventory incorrectly lists them as questions", async () => {
    const input = await inputs();
    const calls: string[] = [];
    const fixture = model("fixture", (request) => {
      calls.push(request.name);
      if (request.name === "exam_orientation") return { clockwiseDegrees: "0" };
      if (request.name === "exam_inventory") return { ...inventory, pages: inventory.pages.map((p) => ({ ...p,documentType:"answer_key" })) };
      if (request.name === "exam_reference_page") {
        const page = JSON.stringify(request.content).includes("TARGET FULL PAGE 2") ? 2 : 1;
        return { documentType:"answer_key",title:null,subject:null,grade:null,instructions:[],questions:[],materials:[],findings:[],
          annotations:[{questionNumber:"1",section:"填空",partLabel:null,kind:"reference_answer",blocks:[{type:"text",text:"10、20"}],regions:[{...r1,page}]}] };
      }
      throw new Error("Answer keys cannot enter question localization");
    });
    const exam = await parseExam({ ...input,model:fixture,generateAnswers:false });
    expect(exam.questions).toHaveLength(0);expect(exam.annotations).toHaveLength(2);
    expect(exam.inventory?.totalQuestions).toBe(0);expect(calls).not.toContain("exam_question_bounds");
  });
});
