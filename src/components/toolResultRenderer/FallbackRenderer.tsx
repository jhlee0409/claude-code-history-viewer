import { Check } from "lucide-react";
import { Highlight, themes } from "prism-react-renderer";
import { useTranslation } from "react-i18next";
import { Renderer } from "../../shared/RendererHeader";
import { layout } from "@/components/renderers";
import { useTheme } from "@/contexts/theme";
import { getPreStyles, getLineStyles, getTokenStyles } from "@/utils/prismStyles";

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
            theme={isDarkMode ? themes.vsDark : themes.vsLight}
            code={JSON.stringify(toolResult, null, 2)}
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
      </Renderer.Content>
    </Renderer>
  );
};
