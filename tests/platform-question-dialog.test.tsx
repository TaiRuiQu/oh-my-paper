// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { createPortal } from "react-dom";
import { expect, it, vi } from "vitest";
import { QuestionEditor } from "@/components/platform/questions";
it("submits a local question inside a portal without submitting the surrounding paper", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const parent = document.createElement("div"),
    portal = document.createElement("div");
  document.body.append(parent, portal);
  const outerSubmit = vi.fn((event: React.FormEvent) => event.preventDefault());
  const mutate = vi.fn(async () => ({ id: "local" }));
  const root = createRoot(parent);
  await act(async () =>
    root.render(
      <form onSubmit={outerSubmit}>
        {createPortal(
          <QuestionEditor
            question={null}
            defaults={{ subject: "数学", grade: "高中一年级" }}
            mutate={mutate}
            pending={false}
            close={() => {}}
          />,
          portal,
        )}
      </form>,
    ),
  );
  await act(async () => {
    portal
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  expect(mutate).toHaveBeenCalledOnce();
  expect(outerSubmit).not.toHaveBeenCalled();
  await act(async () => root.unmount());
  parent.remove();
  portal.remove();
});
