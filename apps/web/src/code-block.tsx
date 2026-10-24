import { createHighlighter, type ThemedToken } from "shiki";
import { createJavaScriptRegexEngine } from "shiki/engine/javascript";
import { CopyButton } from "./copy-button";

const highlighter = createHighlighter({
  langs: ["typescript", "shell"],
  themes: ["github-dark"],
  engine: createJavaScriptRegexEngine(),
});

export async function CodeBlock({ code, title = "taskwish.ts", language = "ts" }: { code: string; title?: string; language?: string }) {
  const lang = language === "sh" ? "shell" : "typescript";
  const tokens: ThemedToken[][] = (await highlighter).codeToTokens(code, { lang, theme: "github-dark" }).tokens;

  return (
    <div className="code-window">
      <div className="code-bar"><span><i />{title}</span><CopyButton value={code} label="Copy code" /></div>
      <pre data-language={language}>{tokens.map((line, lineIndex) => <span className="code-line" key={`line-${lineIndex}`}>{line.map((token, tokenIndex) => <span key={`token-${lineIndex}-${tokenIndex}`} style={{ color: token.color }}>{token.content}</span>)}{lineIndex < tokens.length - 1 ? "\n" : null}</span>)}</pre>
    </div>
  );
}
