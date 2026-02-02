import React from "react";
import { Highlight, themes } from "prism-react-renderer";
import { useTranslation } from "react-i18next";
import { ToolIcon } from "../ToolIcon";
import { layout } from "@/components/renderers";
import { cn } from "@/lib/utils";
import { useTheme } from "@/contexts/theme";
import { getPreStyles, getLineStyles, getTokenStyles } from "@/utils/prismStyles";

interface ClaudeToolUseDisplayProps {
  toolUse: Record<string, unknown>;
}

export const ClaudeToolUseDisplay: React.FC<ClaudeToolUseDisplayProps> = ({
  toolUse,
}) => {
  const { t } = useTranslation();
  const { isDarkMode } = useTheme();
  const toolName = toolUse.name || toolUse.tool || t("claudeToolUseDisplay.unknownTool");

  return (
    <div className={cn("mt-2 bg-muted border border-border", layout.containerPadding, layout.rounded)}>
      <div className={cn("flex items-center mb-2", layout.iconSpacing)}>
        <ToolIcon
          toolName={toolName as string}
          className="text-muted-foreground"
        />
        <span className="font-medium text-foreground">
          {String(toolName)}{" "}
          {typeof toolUse.description === "string" &&
            `- ${toolUse.description}`}
        </span>
      </div>
      <div className={cn("rounded overflow-hidden overflow-y-auto", layout.contentMaxHeight)}>
        <Highlight
          theme={isDarkMode ? themes.vsDark : themes.vsLight}
          code={JSON.stringify(toolUse.input || toolUse.parameters || toolUse, null, 2)}
          language="json"
        >
          {({ className, style, tokens, getLineProps, getTokenProps }) => (
            <pre
              className={className}
              style={getPreStyles(isDarkMode, style, {
                fontSize: "0.8125rem",
                padding: "0.5rem",
              })}
            >
              {tokens.map((line, i) => {
                const lineProps = getLineProps({ line, key: i });
                return (
                  <div key={i} {...lineProps} style={getLineStyles(lineProps.style)}>
                    {line.map((token, key) => {
                      const tokenProps = getTokenProps({ token, key });
                      return (
                        <span
                          key={key}
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
    </div>
  );
};
