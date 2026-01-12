import { X } from "lucide-react";
import { Renderer } from "../../shared/RendererHeader";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { COLORS } from "../../constants/colors";
import { useTranslation } from "react-i18next";

type Props = {
  error: string;
};

export const ErrorRenderer = ({ error }: Props) => {
  const { t } = useTranslation("components");
  // Extract the error details
  const errorMessage = error.replace("Error: ", "");

  return (
    <Renderer
      className={`${COLORS.semantic.error.bg} ${COLORS.semantic.error.border}`}
    >
      <Renderer.Header
        title={t("error.toolExecutionError")}
        icon={<X className={`w-4 h-4 ${COLORS.semantic.error.icon}`} />}
        titleClassName={COLORS.semantic.error.textDark}
      />
      <Renderer.Content>
        <div
          className={`text-sm max-h-80 overflow-y-scroll ${COLORS.semantic.error.text} ${COLORS.semantic.error.bgDark} border ${COLORS.semantic.error.border} rounded-lg p-3 whitespace-pre-wrap`}
        >
          <Markdown remarkPlugins={[remarkGfm]}>{errorMessage}</Markdown>
        </div>
      </Renderer.Content>
    </Renderer>
  );
};
