import { Check } from "lucide-react";
import { Highlight } from "prism-react-renderer";
import { useTranslation } from "react-i18next";
import { Renderer } from "../../shared/RendererHeader";
import { layout } from "@/components/renderers";
import { useTheme } from "@/contexts/theme";
import { getCodeTheme, getCodePreStyles } from "@/utils/codeThemeStyles";

type Props = {
  toolResult: Record<string, unknown>;
};

export const FallbackRenderer = ({ toolResult }: Props) => {
  const { t } = useTranslation();
  const { isDarkMode } = useTheme();
  return (
    <Renderer className="bg-card border-border">
      <Renderer.Header
        title={t("toolResult.toolExecutionResult")}
        icon={<Check className="w-4 h-4 text-muted-foreground" />}
        titleClassName="text-foreground/80"
      />
      <Renderer.Content>
        <div className={layout.bodyText}>
          <Highlight
            theme={getCodeTheme(isDarkMode)}
            code={JSON.stringify(toolResult, null, 2)}
            language="json"
          >
            {({ className, style, tokens, getLineProps, getTokenProps }) => (
              <pre
                className={className}
                style={{
                  ...style,
                  ...getCodePreStyles(isDarkMode),
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
      </Renderer.Content>
    </Renderer>
  );
};
