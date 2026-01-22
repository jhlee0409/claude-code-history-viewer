import React from "react";
import { Highlight, themes } from "prism-react-renderer";
import { useTranslation } from "react-i18next";
import { ToolIcon } from "../ToolIcon";
import { layout } from "@/components/renderers";
import { cn } from "@/lib/utils";

interface ClaudeToolUseDisplayProps {
  toolUse: Record<string, unknown>;
}

export const ClaudeToolUseDisplay: React.FC<ClaudeToolUseDisplayProps> = ({
  toolUse,
}) => {
  const { t } = useTranslation("components");
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
          theme={themes.vsDark}
          code={JSON.stringify(toolUse.parameters || toolUse, null, 2)}
          language="json"
        >
          {({ className, style, tokens, getLineProps, getTokenProps }) => (
            <pre
              className={className}
              style={{
                ...style,
                margin: 0,
                fontSize: "0.8125rem",
                padding: "0.5rem",
              }}
            >
              {tokens.map((line, i) => (
                <div key={i} {...getLineProps({ line, key: i })}>
                  {line.map((token, key) => (
                    <span key={key} {...getTokenProps({ token, key })} />
                  ))}
                </div>
              ))}
            </pre>
          )}
        </Highlight>
      </div>
    </div>
  );
};
