import Prism from "prismjs";
import "prismjs/components/prism-typescript";
import "prismjs/components/prism-javascript";
import "prismjs/components/prism-python";
import "prismjs/components/prism-rust";
import "prismjs/components/prism-json";
import "prismjs/components/prism-css";
import "prismjs/components/prism-scss";
import "prismjs/components/prism-bash";

const LANGUAGES: Record<string, string> = { ts: "typescript", tsx: "typescript", js: "javascript", jsx: "javascript", py: "python", rs: "rust", json: "json", css: "css", scss: "scss", sass: "scss", sh: "bash", zsh: "bash", bash: "bash", html: "markup", htm: "markup" };
const TONES: Record<string, string> = { keyword: "text-code-keyword", boolean: "text-code-keyword", string: "text-code-string", char: "text-code-string", number: "text-code-number", comment: "text-code-comment", function: "text-code-function", "class-name": "text-code-type", builtin: "text-code-type", punctuation: "text-code-punct", operator: "text-code-punct" };
export interface SyntaxRange { start: number; end: number; tone?: string }
/** Tokenize, never inject HTML. Plain/unsupported languages retain exact text. */
export function syntaxRanges(text: string, filePath: string): SyntaxRange[] {
  const language = LANGUAGES[filePath.split(".").pop()?.toLowerCase() ?? ""];
  const grammar = language ? Prism.languages[language] : undefined;
  if (!grammar) return [];
  const out: SyntaxRange[] = [];
  let at = 0;
  const visit = (tokens: string | Prism.Token | (string | Prism.Token)[], inherited?: string) => {
    if (typeof tokens === "string") { out.push({ start: at, end: at + tokens.length, tone: inherited }); at += tokens.length; }
    else if (Array.isArray(tokens)) tokens.forEach(token => visit(token, inherited));
    else visit(tokens.content, TONES[tokens.type] ?? inherited);
  };
  visit(Prism.tokenize(text, grammar));
  return out;
}
