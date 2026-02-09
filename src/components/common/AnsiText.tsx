import { useMemo } from "react";
import { ansiToHtml, hasAnsiCodes } from "@/utils/ansiToHtml";

interface AnsiTextProps {
  text: string;
  className?: string;
}

/**
 * Renders text with ANSI codes as styled HTML.
 * Falls back to plain text if no ANSI codes detected.
 */
export const AnsiText = ({ text, className }: AnsiTextProps) => {
  const containsAnsi = useMemo(() => hasAnsiCodes(text), [text]);
  const html = useMemo(() => (containsAnsi ? ansiToHtml(text) : ""), [text, containsAnsi]);

  if (!containsAnsi) {
    return <span className={className}>{text}</span>;
  }

  return (
    <span
      className={className}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
};
