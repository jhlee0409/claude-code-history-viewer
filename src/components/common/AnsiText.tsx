import { useMemo } from "react";
import { ansiToHtml } from "@/utils/ansiToHtml";

interface AnsiTextProps {
  text: string;
  className?: string;
}

/**
 * Renders text with ANSI codes as styled HTML.
 * Always escapes HTML entities for XSS safety.
 * 
 * Note: ansiToHtml() always returns HTML-safe output via the converter's
 * escapeXML: true setting. This escaping happens even for plain text without
 * ANSI codes, which is why dangerouslySetInnerHTML is safe to use here
 * unconditionally.
 */
export const AnsiText = ({ text, className }: AnsiTextProps) => {
  const html = useMemo(() => ansiToHtml(text), [text]);

  return (
    <span
      className={className}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
};
