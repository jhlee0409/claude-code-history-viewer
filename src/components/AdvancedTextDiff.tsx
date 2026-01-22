"use client";

import { useState } from "react";
import { useTranslation } from "react-i18next";
import { FileEdit } from "lucide-react";
import * as Diff from "diff";
import { layout } from "@/components/renderers";

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
      colorClasses = "text-foreground";
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
    <div className="mt-2 p-3 bg-muted/50 border border-border rounded-lg">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center space-x-2">
          <FileEdit className={`${layout.iconSize} text-tool-code`} />
          <span className={`${layout.titleText} text-foreground`}>{defaultTitle}</span>
        </div>
        {shouldCollapse && (
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className={`${layout.smallText} px-2 py-1 bg-secondary hover:bg-secondary/80 text-foreground rounded transition-colors`}
          >
            {isExpanded
              ? t("advancedTextDiff.collapse")
              : t("advancedTextDiff.expand")}
          </button>
        )}
      </div>

      {/* Diff Mode Selector */}
      <div className="mb-3">
        <div className={`${layout.smallText} font-medium text-muted-foreground mb-2`}>
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
              className={`px-2 py-1 ${layout.smallText} rounded transition-colors ${
                currentMode === mode
                  ? "bg-accent text-accent-foreground font-medium"
                  : "bg-secondary text-foreground hover:bg-secondary/80"
              }`}
            >
              {getModeLabel(mode)}
            </button>
          ))}
        </div>
      </div>

      {/* Statistics */}
      <div className={`mb-3 grid grid-cols-3 gap-2 ${layout.smallText}`}>
        <div className="bg-card p-2 rounded border border-border">
          <div className="text-muted-foreground">{t("advancedTextDiff.additions")}</div>
          <div className="font-medium text-success">+{stats.additions}</div>
        </div>
        <div className="bg-card p-2 rounded border border-border">
          <div className="text-muted-foreground">{t("advancedTextDiff.deletions")}</div>
          <div className="font-medium text-destructive">-{stats.deletions}</div>
        </div>
        <div className="bg-card p-2 rounded border border-border">
          <div className="text-muted-foreground">{t("advancedTextDiff.same")}</div>
          <div className="font-medium text-muted-foreground">{stats.unchanged}</div>
        </div>
      </div>

      {/* Diff Content */}
      {(!shouldCollapse || isExpanded) && (
        <div className="bg-card p-3 rounded border border-border max-h-96 overflow-y-auto">
          <div className={`${layout.monoText} leading-relaxed`}>
            {diffResults.map((part, index) => renderDiffPart(part, index))}
          </div>
        </div>
      )}

      {shouldCollapse && !isExpanded && (
        <div className="bg-card p-3 rounded border border-border text-center">
          <div className={`${layout.bodyText} text-muted-foreground`}>
            {t("advancedTextDiff.manyChanges")}
          </div>
          <div className={`${layout.smallText} text-muted-foreground mt-1`}>
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


