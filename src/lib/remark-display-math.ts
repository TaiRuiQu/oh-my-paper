import type { Parent, Paragraph, Root, RootContent } from "mdast";
import type { Processor } from "unified";

export function remarkDisplayMath(this: Processor) {
  // remark-math's fenced block syntax treats text following an opening $$ as
  // metadata and requires the closing fence on its own line. Its inline
  // tokenizer already supports paired $$ across lines and respects code.
  for (const extension of this.data().micromarkExtensions ?? []) {
    const flow = extension.flow?.[36];
    if (flow && !Array.isArray(flow) && flow.name === "mathFlow") delete extension.flow![36];
  }
  return (tree: Root, file: { value: unknown }) => {
    const source = String(file.value);
    function visit(parent: Parent) {
      const children: RootContent[] = [];
      for (const node of parent.children) {
        if (node.type !== "paragraph") {
          if ("children" in node) visit(node as Parent);
          children.push(node as RootContent);
          continue;
        }
        let inline: Paragraph["children"] = [];
        const flush = () => {
          if (inline.length) children.push({ type: "paragraph", children: inline });
          inline = [];
        };
        for (const child of node.children) {
          const offset = child.position?.start.offset;
          if (
            child.type === "inlineMath" &&
            offset !== undefined &&
            source.slice(offset, offset + 2) === "$$"
          ) {
            flush();
            children.push({
              type: "math",
              value: child.value.trim(),
              meta: null,
              data: {
                hName: "div",
                hChildren: [
                  {
                    type: "element",
                    tagName: "code",
                    properties: { className: ["language-math", "math-display"] },
                    children: [{ type: "text", value: child.value.trim() }],
                  },
                ],
              },
            });
          } else inline.push(child);
        }
        flush();
      }
      parent.children = children;
    }
    visit(tree);
  };
}
