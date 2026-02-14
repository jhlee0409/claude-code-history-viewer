import { memo } from "react";
import { FileText, BookOpen } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Highlight, themes } from "prism-react-renderer";
import { Renderer } from "@/shared/RendererHeader";
import { cn } from "@/lib/utils";
import { getVariantStyles, codeTheme, layout } from "@/components/renderers";
import { useTheme } from "@/contexts/theme";
import { getPreStyles, getLineStyles, getTokenStyles } from "@/utils/prismStyles";

interface NotebookEditToolInput {
  notebook_path?: string;
  cell_number?: number;
  cell_id?: string;
  new_source?: string;
  cell_type?: string;
  edit_mode?: string;
}

interface Props {
  toolId: string;
  input: NotebookEditToolInput;
}

export const NotebookEditToolRenderer = memo(function NotebookEditToolRenderer({ toolId, input }: Props) {
  const { t } = useTranslation();
  const { isDarkMode } = useTheme();
  const styles = getVariantStyles("code");
  const language = input.cell_type === "markdown" ? "markdown" : "python";

  return (
    <Renderer className={styles.container}>
      <Renderer.Header
        title={t("tools.notebookEdit", { defaultValue: "NotebookEdit" })}
        icon={<BookOpen className={cn(layout.iconSize, styles.icon)} />}
        titleClassName={styles.title}
        rightContent={
          <div className={cn("flex items-center gap-2", layout.smallText)}>
            {input.edit_mode && (
              <span className={cn("px-1.5 py-0.5", layout.rounded, styles.badge, styles.badgeText)}>
                {input.edit_mode}
              </span>
            )}
            {input.cell_type && (
              <span className={cn("px-1.5 py-0.5", layout.rounded, "bg-muted text-muted-foreground")}>
                {input.cell_type}
              </span>
            )}
            {toolId && (
              <code className={cn(layout.monoText, "px-2 py-0.5", layout.rounded, styles.badge, styles.badgeText)}>
                ID: {toolId}
              </code>
            )}
          </div>
        }
      />
      <Renderer.Content>
        <div className={cn("p-2 border bg-card border-border", layout.rounded, "mb-2")}>
          <div className={cn("flex items-center", layout.iconSpacing)}>
            <FileText className={cn(layout.iconSizeSmall, "text-info")} />
            <code className={cn(layout.bodyText, "font-mono text-info break-all")}>{input.notebook_path ?? ""}</code>
          </div>
          <div className={cn("mt-1 flex gap-3", layout.smallText, "text-muted-foreground")}>
            {input.cell_number != null && <span>Cell #{input.cell_number}</span>}
            {input.cell_id && <span>ID: {input.cell_id}</span>}
          </div>
        </div>
        {input.new_source && (
          <div className={cn(layout.rounded, "overflow-auto", layout.contentMaxHeight)}>
            <Highlight
              theme={isDarkMode ? themes.vsDark : themes.vsLight}
              code={input.new_source}
              language={language}
            >
              {({ className, style, tokens, getLineProps, getTokenProps }) => (
                <pre
                  className={className}
                  style={getPreStyles(isDarkMode, style, {
                    fontSize: codeTheme.fontSize,
                    padding: codeTheme.padding,
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
        )}
      </Renderer.Content>
    </Renderer>
  );
});
