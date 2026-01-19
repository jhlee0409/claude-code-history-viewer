"use client";

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { FileEdit } from "lucide-react";
import * as Diff from "diff";

type DiffMode =
  | "chars"
  | "words"
  | "wordsWithSpace"
  | "lines"
  | "trimmedLines"
  | "sentences";

type Props = {
  oldText: string;
  newText: string;
  diffMode?: DiffMode;
  title?: string;
};

export const AdvancedTextDiff = ({
  oldText,
  newText,
  diffMode = "lines",
  title,
}: Props) => {
  const { t } = useTranslation("components");
  const [currentMode, setCurrentMode] = useState<DiffMode>(diffMode);
  const [isExpanded, setIsExpanded] = useState(false);

  const defaultTitle = title || t("advancedTextDiff.textChanges");

  const getDiffResults = () => {
    switch (currentMode) {
      case "lines":
        return Diff.diffLines(oldText, newText);
      case "trimmedLines":
        return Diff.diffTrimmedLines(oldText, newText);
      case "chars":
        return Diff.diffChars(oldText, newText);
      case "words":
        return Diff.diffWords(oldText, newText);
      case "wordsWithSpace":
        return Diff.diffWordsWithSpace(oldText, newText);
      case "sentences":
        return Diff.diffSentences(oldText, newText);
      default:
        return Diff.diffWords(oldText, newText);
    }
  };

  const diffResults = getDiffResults();
  const stats = diffResults.reduce(
    (acc, part) => {
      if (part.added) acc.additions++;
      else if (part.removed) acc.deletions++;
      else acc.unchanged++;
      return acc;
    },
    { additions: 0, deletions: 0, unchanged: 0 }
  );

  const renderDiffPart = (part: Diff.Change, index: number) => {
    const baseClasses = "inline";
    let colorClasses = "";
    let title = "";

    if (part.added) {
      colorClasses = "bg-green-100 dark:bg-green-900 text-green-800 dark:text-green-200 border-l-2 border-green-400 dark:border-green-500";
      title = t("advancedTextDiff.added");
    } else if (part.removed) {
      colorClasses = "bg-red-100 dark:bg-red-900 text-red-800 dark:text-red-200 border-l-2 border-red-400 dark:border-red-500";
      title = t("advancedTextDiff.removed");
    } else {
      colorClasses = "text-gray-700 dark:text-gray-300";
      title = t("advancedTextDiff.unchanged");
    }

    // 긴 텍스트는 줄바꿈 허용
    const content =
      currentMode === "lines" || currentMode === "trimmedLines"
        ? part.value
        : part.value;

    return (
      <span
        key={index}
        className={`${baseClasses} ${colorClasses} px-1 rounded`}
        title={title}
        style={{
          whiteSpace:
            currentMode === "lines" || currentMode === "trimmedLines"
              ? "pre-wrap"
              : "pre-wrap",
          wordBreak: "break-word",
        }}
      >
        {content}
      </span>
    );
  };

  const getModeLabel = (mode: string) => {
    return t(`advancedTextDiff.modes.${mode}`, { defaultValue: mode }) || mode;
  };

  const shouldCollapse =
    diffResults.length > 20 || oldText.length + newText.length > 1000;

  return (
    <div className="mt-2 p-3 bg-amber-50 dark:bg-amber-950 border border-amber-200 dark:border-amber-800 rounded-lg">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center space-x-2">
          <FileEdit className="w-4 h-4 text-amber-600 dark:text-amber-400" />
          <span className="font-medium text-amber-800 dark:text-amber-200">{defaultTitle}</span>
        </div>
        {shouldCollapse && (
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="text-xs px-2 py-1 bg-amber-100 dark:bg-amber-900 hover:bg-amber-200 dark:hover:bg-amber-800 text-amber-700 dark:text-amber-300 rounded transition-colors"
          >
            {isExpanded
              ? t("advancedTextDiff.collapse")
              : t("advancedTextDiff.expand")}
          </button>
        )}
      </div>

      {/* Diff Mode Selector */}
      <div className="mb-3">
        <div className="text-xs font-medium text-gray-600 dark:text-gray-400 mb-2">
          {t("advancedTextDiff.comparisonMethod")}
        </div>
        <div className="flex flex-wrap gap-1">
          {(
            [
              "lines",
              "trimmedLines",
              "chars",
              "words",
              "wordsWithSpace",
              "sentences",
            ] as const
          ).map((mode) => (
            <button
              key={mode}
              onClick={() => setCurrentMode(mode)}
              className={`px-2 py-1 text-xs rounded transition-colors ${
                currentMode === mode
                  ? "bg-amber-200 dark:bg-amber-800 text-amber-800 dark:text-amber-200 font-medium"
                  : "bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600"
              }`}
            >
              {getModeLabel(mode)}
            </button>
          ))}
        </div>
      </div>

      {/* Statistics */}
      <div className="mb-3 grid grid-cols-3 gap-2 text-xs">
        <div className="bg-white dark:bg-gray-800 p-2 rounded border dark:border-gray-600">
          <div className="text-gray-600 dark:text-gray-400">{t("advancedTextDiff.additions")}</div>
          <div className="font-medium text-green-600 dark:text-green-400">+{stats.additions}</div>
        </div>
        <div className="bg-white dark:bg-gray-800 p-2 rounded border dark:border-gray-600">
          <div className="text-gray-600 dark:text-gray-400">{t("advancedTextDiff.deletions")}</div>
          <div className="font-medium text-red-600 dark:text-red-400">-{stats.deletions}</div>
        </div>
        <div className="bg-white dark:bg-gray-800 p-2 rounded border dark:border-gray-600">
          <div className="text-gray-600 dark:text-gray-400">{t("advancedTextDiff.same")}</div>
          <div className="font-medium text-gray-600 dark:text-gray-400">{stats.unchanged}</div>
        </div>
      </div>

      {/* Diff Content */}
      {(!shouldCollapse || isExpanded) && (
        <div className="bg-white dark:bg-gray-800 p-3 rounded border dark:border-gray-600 max-h-96 overflow-y-auto">
          <div className="font-mono text-sm leading-relaxed">
            {diffResults.map((part, index) => renderDiffPart(part, index))}
          </div>
        </div>
      )}

      {shouldCollapse && !isExpanded && (
        <div className="bg-white dark:bg-gray-800 p-3 rounded border dark:border-gray-600 text-center">
          <div className="text-sm text-gray-500 dark:text-gray-400">
            {t("advancedTextDiff.manyChanges")}
          </div>
          <div className="text-xs text-gray-400 dark:text-gray-500 mt-1">
            {t("advancedTextDiff.changeSummary", {
              count: diffResults.length,
              chars: oldText.length + newText.length,
            })}
          </div>
        </div>
      )}
    </div>
  );
};


