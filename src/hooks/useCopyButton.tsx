import { useState } from "react";
import { RefreshCw, Check, X, Clipboard } from "lucide-react";
import { useTranslation } from "react-i18next";
import { TooltipButton } from "../shared/TooltipButton";

interface CopyState {
  [key: string]: "idle" | "copying" | "success" | "error";
}

export const useCopyButton = () => {
  const { t } = useTranslation('components');
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
  const renderCopyButton = (
    text: string,
    id: string,
    label: string = t('copyButton.copy'),
    iconOnly: boolean = false
  ) => {
    const state = copyStates[id] || "idle";

    if (iconOnly) {
      return (
        <TooltipButton
          onClick={() => copyToClipboard(text, id)}
          disabled={state === "copying"}
          className={`p-1 rounded transition-colors ${
            state === "success"
              ? "text-green-600 dark:text-green-400"
              : state === "error"
              ? "text-red-600 dark:text-red-400"
              : "text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
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

    return (
      <TooltipButton
        onClick={() => copyToClipboard(text, id)}
        disabled={state === "copying"}
        className={`flex items-center space-x-1 px-2 py-1 text-xs rounded transition-colors ${
          state === "success"
            ? "bg-green-100 text-green-700"
            : state === "error"
            ? "bg-red-100 text-red-700"
            : "bg-gray-100 hover:bg-gray-200 text-gray-700"
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
