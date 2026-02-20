import { memo } from "react";
import { Terminal, Clock, Play } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Highlight, themes } from "prism-react-renderer";
import { cn } from "@/lib/utils";
import { getVariantStyles, codeTheme, layout } from "@/components/renderers";
import { useTheme } from "@/contexts/theme";
import { getPreStyles, getLineStyles, getTokenStyles } from "@/utils/prismStyles";
import { ToolUseCard } from "./ToolUseCard";

interface BashToolInput {
  command?: string;
  description?: string;
  timeout?: number;
  run_in_background?: boolean;
}

interface Props {
  toolId: string;
  input: BashToolInput;
}

export const BashToolRenderer = memo(function BashToolRenderer({ toolId, input }: Props) {
  const { t } = useTranslation();
  const { isDarkMode } = useTheme();
  const styles = getVariantStyles("terminal");
  const command = input.command ?? "";

  return (
    <ToolUseCard
      title={t("tools.terminal")}
      icon={<Terminal className={cn(layout.iconSize, styles.icon)} />}
      variant="terminal"
      toolId={toolId}
      rightContent={
        <>
          {input.run_in_background && (
            <span className={cn("px-1.5 py-0.5", layout.rounded, "bg-amber-500/20 text-amber-600 dark:text-amber-400")}>
              {t("taskOperation.background")}
            </span>
          )}
          {input.timeout != null && (
            <span className="flex items-center gap-1 text-muted-foreground">
              <Clock className={layout.iconSizeSmall} />
              {(input.timeout / 1000).toFixed(0)}
              {t("rendererLabels.secondsShort")}
            </span>
          )}
        </>
      }
    >
      {input.description && (
        <div className={cn("mb-2 text-muted-foreground", layout.smallText)}>
          {input.description}
        </div>
      )}
      <div className={cn(layout.rounded, "overflow-hidden")}>
        <div className={cn("px-3 py-1 flex items-center gap-1.5 bg-zinc-800 dark:bg-zinc-900", layout.smallText, "text-zinc-400")}>
          <Play className="w-3 h-3" />
          <span>{t("taskOperation.command")}</span>
        </div>
        <Highlight
          theme={isDarkMode ? themes.vsDark : themes.vsLight}
          code={command}
          language="bash"
        >
          {({ className, style, tokens, getLineProps, getTokenProps }) => (
            <pre
              className={className}
              style={getPreStyles(isDarkMode, style, {
                fontSize: codeTheme.fontSize,
                padding: codeTheme.padding,
                overflowX: "auto",
              })}
            >
              {tokens.map((line, i) => {
                const lineProps = getLineProps({ line });
                return (
                  <div key={i} {...lineProps} style={getLineStyles(lineProps.style)}>
                    {line.map((token, j) => {
                      const tokenProps = getTokenProps({ token });
                      return (
                        <span key={j} {...tokenProps} style={getTokenStyles(isDarkMode, tokenProps.style)} />
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
