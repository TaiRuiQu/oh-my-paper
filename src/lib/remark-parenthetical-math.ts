import type { Extension, State, Tokenizer, Token } from "micromark-util-types";
import type { Processor } from "unified";

declare module "unified" {
  interface Data {
    micromarkExtensions?: Extension[];
  }
}

declare module "micromark-util-types" {
  interface TokenTypeMap {
    mathText: "mathText";
    mathTextData: "mathTextData";
    mathTextSequence: "mathTextSequence";
  }
}

/** Parse \(…\) before Markdown consumes the backslashes as punctuation escapes. */
export function remarkParentheticalMath(this: Processor) {
  const data = this.data();
  const extensions = data.micromarkExtensions ?? (data.micromarkExtensions = []);
  // Reuse remark-math's inlineMath compilation and the existing KaTeX renderer.
  // A syntax extension naturally leaves fenced/indented/inline code untouched.
  extensions.push({ text: { 92: { name: "parentheticalMath", tokenize } } });
}

const tokenize: Tokenizer = function (effects, ok, nok) {
  let sequence: Token;
  return start;

  function start(code: number | null): ReturnType<State> {
    effects.enter("mathText");
    effects.enter("mathTextSequence");
    effects.consume(code);
    return open;
  }

  function open(code: number | null): ReturnType<State> {
    if (code !== 40) return nok(code);
    effects.consume(code);
    effects.exit("mathTextSequence");
    return content;
  }

  function content(code: number | null): ReturnType<State> {
    if (code === null) return nok(code);
    if (code === 92) {
      sequence = effects.enter("mathTextSequence");
      effects.consume(code);
      return close;
    }
    effects.enter("mathTextData");
    return data(code);
  }

  function data(code: number | null): ReturnType<State> {
    if (code === null || code === 92) {
      effects.exit("mathTextData");
      return content(code);
    }
    effects.consume(code);
    return data;
  }

  function close(code: number | null): ReturnType<State> {
    if (code === 41) {
      effects.consume(code);
      effects.exit("mathTextSequence");
      effects.exit("mathText");
      return ok;
    }
    // A TeX command or a doubled backslash is content, not a closing marker.
    sequence.type = "mathTextData";
    if (code === 92) effects.consume(code);
    effects.exit("mathTextData");
    return code === 92 ? content : content(code);
  }
};
