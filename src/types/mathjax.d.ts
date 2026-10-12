declare module "mathjax" {
  const MathJax: {
    init(config: Record<string, unknown>): Promise<unknown>;
    tex2svgPromise(latex: string, options: { display: boolean }): Promise<unknown>;
    startup: { adaptor: { firstChild(node: unknown): unknown; outerHTML(node: unknown): string } };
  };
  export default MathJax;
}
