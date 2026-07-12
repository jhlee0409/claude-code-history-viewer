/**
 * Prism syntax highlighting with a size guard.
 *
 * Below HIGHLIGHT_MAX_CHARS this renders the standard prism-react-renderer
 * block (one div per line, one span per token). Above it, tokenization is
 * skipped entirely — the content renders as a plain (still truncation-guarded)
 * <pre> with a notice, because tokenizing e.g. a 20k-line Write payload
 * creates tens of thousands of DOM nodes inside a single virtualized row.
 */

import React from "react";
import { Highlight, themes } from "prism-react-renderer";
import { useTranslation } from "react-i18next";
import {
  getPreStyles,
  getLineStyles,
  getTokenStyles,
} from "../../utils/prismStyles";
import {
  isTooLargeToHighlight,
  formatCharSize,
} from "../../utils/contentSizeGuard";
import { TruncatedPre } from "./TruncatedPre";

interface CodeHighlightProps {
  code: string;
  language: string;
  isDarkMode: boolean;
  /** Extra styles merged into the <pre> (fontSize, padding, ...). */
  preOverrides?: React.CSSProperties;
}

export const CodeHighlight: React.FC<CodeHighlightProps> = ({
  code,
  language,
  isDarkMode,
  preOverrides,
}) => {
  const { t } = useTranslation();

  if (isTooLargeToHighlight(code)) {
    return (
      <div>
        <div className="px-2 py-1 text-xs text-muted-foreground">
          {t("sizeGuard.highlightDisabled", {
            size: formatCharSize(code.length),
            defaultValue:
              "Syntax highlighting disabled for large content ({{size}})",
          })}
        </div>
        <TruncatedPre
          content={code}
          style={getPreStyles(isDarkMode, {}, preOverrides)}
        />
      </div>
    );
  }

  return (
    <Highlight
      theme={isDarkMode ? themes.vsDark : themes.vsLight}
      code={code}
      language={language}
    >
      {({ className, style, tokens, getLineProps, getTokenProps }) => (
        <pre
          className={className}
          style={getPreStyles(isDarkMode, style, preOverrides)}
        >
          {tokens.map((line, i) => {
            const lineProps = getLineProps({ line });
            return (
              <div key={i} {...lineProps} style={getLineStyles(lineProps.style)}>
                {line.map((token, j) => {
                  const tokenProps = getTokenProps({ token });
                  return (
                    <span
                      key={j}
                      {...tokenProps}
                      style={getTokenStyles(isDarkMode, tokenProps.style)}
                    />
                  );
                })}
              </div>
            );
          })}
        </pre>
      )}
    </Highlight>
  );
};
