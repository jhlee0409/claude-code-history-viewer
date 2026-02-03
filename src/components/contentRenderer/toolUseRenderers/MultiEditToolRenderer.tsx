import { memo } from "react";
import { FileText, Edit } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Renderer } from "@/shared/RendererHeader";
import { cn } from "@/lib/utils";
import { getVariantStyles, layout } from "@/components/renderers";
import { FileEditRenderer } from "@/components/toolResultRenderer/FileEditRenderer";

interface EditEntry {
  old_string?: string;
  new_string?: string;
  replace_all?: boolean;
}

interface MultiEditToolInput {
  file_path?: string;
  edits?: EditEntry[];
}

interface Props {
  toolId: string;
  input: MultiEditToolInput;
}

export const MultiEditToolRenderer = memo(function MultiEditToolRenderer({ toolId, input }: Props) {
  const { t } = useTranslation();
  const styles = getVariantStyles("code");
  const filePath = input.file_path ?? "";
  const edits = input.edits ?? [];

  return (
    <Renderer className={styles.container}>
      <Renderer.Header
        title={t("tools.multiEdit", { defaultValue: "MultiEdit" })}
        icon={<Edit className={cn(layout.iconSize, styles.icon)} />}
        titleClassName={styles.title}
        rightContent={
          <div className={cn("flex items-center gap-2", layout.smallText)}>
            <span className={cn("px-1.5 py-0.5", layout.rounded, styles.badge, styles.badgeText)}>
              {t("taskOperation.editCount", { count: edits.length })}
            </span>
            {toolId && (
              <code className={cn(layout.monoText, "px-2 py-0.5", layout.rounded, styles.badge, styles.badgeText)}>
                ID: {toolId}
              </code>
            )}
          </div>
        }
      />
      <Renderer.Content>
        <div className={cn("mb-3 p-2 border bg-card border-border", layout.rounded)}>
          <div className={cn("flex items-center", layout.iconSpacing)}>
            <FileText className={cn(layout.iconSizeSmall, "text-info")} />
            <code className={cn(layout.bodyText, "font-mono text-info break-all")}>{filePath}</code>
          </div>
        </div>
        <div className="space-y-2">
          {edits.map((edit, i) => (
            <FileEditRenderer
              key={i}
              toolResult={{
                filePath,
                oldString: typeof edit.old_string === "string" ? edit.old_string : "",
                newString: typeof edit.new_string === "string" ? edit.new_string : "",
                replaceAll: edit.replace_all ?? false,
                originalFile: "",
                userModified: false,
              }}
            />
          ))}
        </div>
      </Renderer.Content>
    </Renderer>
  );
});
