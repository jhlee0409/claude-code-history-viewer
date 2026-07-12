/**
 * Plain <pre> with a size guard: content beyond PLAIN_PREVIEW_CHARS is
 * truncated and only rendered in full after an explicit "show all" click.
 * Used for large JSON payloads / raw tool output where the CSS max-height
 * only clips visually but the full text would still enter the DOM.
 */

import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  PLAIN_PREVIEW_CHARS,
  formatCharSize,
} from "../../utils/contentSizeGuard";

interface TruncatedPreProps {
  content: string;
  className?: string;
  style?: React.CSSProperties;
}

export const TruncatedPre: React.FC<TruncatedPreProps> = ({
  content,
  className,
  style,
}) => {
  const { t } = useTranslation();
  const [showAll, setShowAll] = useState(false);

  if (content.length <= PLAIN_PREVIEW_CHARS || showAll) {
    return (
      <pre className={className} style={style}>
        {content}
      </pre>
    );
  }

  return (
    <div>
      <pre className={className} style={style}>
        {content.slice(0, PLAIN_PREVIEW_CHARS)}
      </pre>
      <div className="flex items-center gap-2 px-2 py-1.5 text-xs text-muted-foreground">
        <span>
          {t("sizeGuard.truncated", {
            shown: formatCharSize(PLAIN_PREVIEW_CHARS),
            total: formatCharSize(content.length),
            defaultValue: "Showing {{shown}} of {{total}}",
          })}
        </span>
        <button
          type="button"
          onClick={() => setShowAll(true)}
          className="rounded px-1.5 py-0.5 font-medium text-primary hover:bg-primary/10 transition-colors"
        >
          {t("sizeGuard.showAll", "Show all")}
        </button>
      </div>
    </div>
  );
};
