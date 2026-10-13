// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AiProviderSettings } from "@/components/ai-provider-settings";
import { AI_PURPOSES, type AiPurpose, type ProviderSummary } from "@/contracts/ai-providers";
const request = vi.hoisted(() => vi.fn());
vi.mock("@/lib/http-client", () => ({
  apiRequest: request,
  jsonBody: (value: unknown) => ({ body: JSON.stringify(value) }),
}));
const provider: ProviderSummary = {
  id: "provider",
  name: "测试提供商",
  apiType: "openai_chat",
  baseURL: "https://example.invalid/v1",
  structuredOutputs: true,
  maxOutputTokens: 16000,
  timeoutSeconds: 60,
  maxConcurrency: 3,
  models: [
    { id: "one", name: "model-one", reasoningEfforts: ["default", "high"] },
    { id: "two", name: "model-two", reasoningEfforts: ["low", "medium"] },
  ],
  selections: {
    exam: { modelId: "one", reasoningEffort: "high" },
    grading: { modelId: "two", reasoningEffort: "low" },
    answer: { modelId: "two", reasoningEffort: "medium" },
  },
};
let root: Root, container: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  root = createRoot(container);
  request.mockResolvedValue({ providers: [provider] });
});
afterEach(() => {
  act(() => root.unmount());
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});
function render(providers = [provider]) {
  act(() => root.render(<AiProviderSettings initialProviders={providers} />));
}
describe("independent AI model assignments", () => {
  it("uses display names in selectors and retains API codes in the model editor", () => {
    render([
      {
        ...provider,
        models: provider.models.map((model, index) => ({
          ...model,
          displayName: index ? "深度解答" : "轻量解析",
        })),
      },
    ]);
    const selected = container.querySelector<HTMLSelectElement>("#model-purpose-exam")!;
    expect(selected.selectedOptions[0].textContent).toBe("轻量解析");
    act(() => container.querySelector<HTMLButtonElement>(".provider-section button")!.click());
    expect(container.querySelector<HTMLInputElement>("#model-0")!.value).toBe("model-one");
    expect(container.querySelector<HTMLInputElement>("#model-display-0")!.value).toBe("轻量解析");
    expect(container.textContent).toContain("API 模型代码");
  });
  it("shows each saved model and its supported effort options", () => {
    render();
    for (const purpose of Object.keys(AI_PURPOSES) as AiPurpose[]) {
      const selection = provider.selections[purpose]!;
      expect(container.querySelector<HTMLSelectElement>(`#model-purpose-${purpose}`)?.value).toBe(
        selection.modelId,
      );
      expect(container.querySelector<HTMLSelectElement>(`#effort-purpose-${purpose}`)?.value).toBe(
        selection.reasoningEffort,
      );
      expect(
        container.querySelector(`form[aria-label="${AI_PURPOSES[purpose]}"] button`)?.textContent,
      ).toBe("已保存");
    }
  });
  it.each(Object.keys(AI_PURPOSES) as AiPurpose[])(
    "saves only the selected %s purpose",
    async (purpose) => {
      render();
      const form = container.querySelector<HTMLFormElement>(
        `form[aria-label="${AI_PURPOSES[purpose]}"]`,
      )!;
      const model = form.querySelector<HTMLSelectElement>(`#model-purpose-${purpose}`)!;
      const next = model.value === "one" ? "two" : "one";
      act(() => {
        model.value = next;
        model.dispatchEvent(new Event("change", { bubbles: true }));
      });
      const effort = next === "two" ? "low" : "default";
      expect(form.querySelector<HTMLSelectElement>(`#effort-purpose-${purpose}`)?.value).toBe(
        effort,
      );
      await act(async () => {
        form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      });
      expect(request).toHaveBeenCalledWith("/api/admin/ai/providers/provider/activate", {
        method: "POST",
        body: JSON.stringify({ purpose, modelId: next, reasoningEffort: effort }),
      });
      for (const other of (Object.keys(AI_PURPOSES) as AiPurpose[]).filter(
        (item) => item !== purpose,
      ))
        expect(container.querySelector<HTMLSelectElement>(`#model-purpose-${other}`)?.value).toBe(
          provider.selections[other]!.modelId,
        );
    },
  );
  it("explains missing configuration and disables saving until a model exists", () => {
    render([]);
    expect(container.textContent).toContain("先添加提供商和模型");
    expect(container.querySelectorAll(".model-assignment button:disabled")).toHaveLength(3);
  });
});
