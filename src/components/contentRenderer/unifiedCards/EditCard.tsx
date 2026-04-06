import { memo } from "react";
import { FileEditRenderer } from "../../toolResultRenderer/FileEditRenderer";
import type { Props } from "./shared";
import { str } from "./shared";

export const EditCard = memo(function EditCard({ toolUse }: Props) {
  const input = (toolUse.input as Record<string, unknown>) ?? {};

  return (
    <FileEditRenderer
      toolResult={{
        filePath: str(input, "file_path") ?? "",
        oldString: str(input, "old_string") ?? "",
        newString: str(input, "new_string") ?? "",
        replaceAll: input.replace_all === true,
        originalFile: "",
        userModified: false,
      }}
    />
  );
});
