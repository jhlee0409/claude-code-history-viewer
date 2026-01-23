import { useState } from "react";
import { RefreshCw, Check, X, Clipboard } from "lucide-react";
import { useTranslation } from "react-i18next";
import { TooltipButton } from "../shared/TooltipButton";

interface CopyState {
  [key: string]: "idle" | "copying" | "success" | "error";
}

export const useCopyButton = () => {
  const { t } = useTranslation();
  // 클립보드 복사 상태 관리
  const [copyStates, setCopyStates] = useState<CopyState>({});

  // 클립보드 복사 헬퍼 함수
  const copyToClipboard = async (text: string, id: string) => {
    setCopyStates((prev) => ({ ...prev, [id]: "copying" }));

    try {
      await navigator.clipboard.writeText(text);
      setCopyStates((prev) => ({ ...prev, [id]: "success" }));

      // 2초 후 상태 초기화
      setTimeout(() => {
        setCopyStates((prev) => ({ ...prev, [id]: "idle" }));
      }, 2000);
    } catch (error) {
      console.error("클립보드 복사 실패:", error);
      setCopyStates((prev) => ({ ...prev, [id]: "error" }));

      // 2초 후 상태 초기화
      setTimeout(() => {
        setCopyStates((prev) => ({ ...prev, [id]: "idle" }));
      }, 2000);
    }
  };

  // 복사 버튼 렌더링 헬퍼
  // Standardized button sizes: icon-only uses w-6 h-6, full button uses h-6
  const renderCopyButton = (
    text: string,
    id: string,
    label: string = t('copyButton.copy'),
    iconOnly: boolean = false
  ) => {
    const state = copyStates[id] || "idle";

    // Icon-only button: compact, consistent size
    if (iconOnly) {
      return (
        <TooltipButton
          type="button"
          aria-label={label}
          onClick={() => copyToClipboard(text, id)}
          disabled={state === "copying"}
          className={`w-6 h-6 flex items-center justify-center rounded transition-colors ${
            state === "success"
              ? "text-success"
              : state === "error"
              ? "text-destructive"
              : "text-muted-foreground hover:text-foreground hover:bg-muted"
          }`}
          content={label}
        >
          {state === "copying" ? (
            <RefreshCw className="w-3.5 h-3.5 animate-spin" />
          ) : state === "success" ? (
            <Check className="w-3.5 h-3.5" />
          ) : state === "error" ? (
            <X className="w-3.5 h-3.5" />
          ) : (
            <Clipboard className="w-3.5 h-3.5" />
          )}
        </TooltipButton>
      );
    }

    // Full button with text: consistent height
    return (
      <TooltipButton
        type="button"
        aria-label={label}
        onClick={() => copyToClipboard(text, id)}
        disabled={state === "copying"}
        className={`h-6 flex items-center gap-1 px-2 text-xs rounded transition-colors ${
          state === "success"
            ? "bg-success/20 text-success"
            : state === "error"
            ? "bg-destructive/20 text-destructive"
            : "bg-secondary text-muted-foreground hover:text-foreground hover:bg-muted"
        }`}
        content={label}
      >
        {state === "copying" ? (
          <>
            <RefreshCw className="w-3 h-3 animate-spin" />
            <span>{t('copyButton.copying')}</span>
          </>
        ) : state === "success" ? (
          <>
            <Check className="w-3 h-3" />
            <span>{t('copyButton.copied')}</span>
          </>
        ) : state === "error" ? (
          <>
            <X className="w-3 h-3" />
            <span>{t('copyButton.error')}</span>
          </>
        ) : (
          <>
            <Clipboard className="w-3 h-3" />
            <span>{label}</span>
          </>
        )}
      </TooltipButton>
    );
  };

  return {
    copyStates,
    copyToClipboard,
    renderCopyButton,
  };
};
