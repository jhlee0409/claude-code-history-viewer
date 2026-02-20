import { memo } from "react";
import { FileCode2, PencilLine } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Highlight, themes } from "prism-react-renderer";
import { cn } from "@/lib/utils";
import { getVariantStyles, codeTheme, layout } from "@/components/renderers";
import { useTheme } from "@/contexts/theme";
import { getPreStyles, getLineStyles, getTokenStyles } from "@/utils/prismStyles";
import { ToolUseCard } from "./ToolUseCard";

interface ApplyPatchToolInput {
  patch?: string;
}

interface Props {
  toolId: string;
  input: ApplyPatchToolInput;
}

export const ApplyPatchToolRenderer = memo(function ApplyPatchToolRenderer({
  toolId,
  input,
}: Props) {
  const { t } = useTranslation();
  const { isDarkMode } = useTheme();
  const styles = getVariantStyles("code");
  const patch = input.patch ?? "";
  const lineCount = patch ? patch.split("\n").length : 0;

  return (
    <ToolUseCard
      title={t("tools.fileEdit")}
      icon={<FileCode2 className={cn(layout.iconSize, styles.icon)} />}
      variant="code"
      toolId={toolId}
      rightContent={
        <span className={cn("px-1.5 py-0.5", layout.rounded, styles.badge, styles.badgeText)}>
          {lineCount} {t("toolResult.lines")}
        </span>
      }
    >
      <div className={cn(layout.rounded, "overflow-hidden border border-border")}>
        <div className={cn("px-3 py-1 flex items-center gap-1.5 bg-secondary", layout.smallText, "text-muted-foreground")}>
          <PencilLine className={layout.iconSizeSmall} />
          <span>{t("tools.inputParameters")}</span>
        </div>
        <Highlight
          theme={isDarkMode ? themes.vsDark : themes.vsLight}
          code={patch}
          language="diff"
        >
          {({ className, style, tokens, getLineProps, getTokenProps }) => (
            <pre
              className={className}
              style={getPreStyles(isDarkMode, style, {
                fontSize: codeTheme.fontSize,
                lineHeight: codeTheme.lineHeight,
                maxHeight: "28rem",
                overflow: "auto",
                padding: "0.75rem",
              })}
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
      </div>
    </ToolUseCard>
  );
});
