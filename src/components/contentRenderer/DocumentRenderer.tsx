/**
 * DocumentRenderer Component
 *
 * Renders document content from Claude API, supporting multiple source types:
 * - Base64 encoded PDFs
 * - Plain text documents
 * - URL-linked PDFs
 *
 * Uses design tokens for consistent theming and styling.
 */

import { memo } from "react";
import { FileText, File, Link } from "lucide-react";
import { useTranslation } from "react-i18next";
import { getVariantStyles, layout } from "@/components/renderers";
import { cn } from "@/lib/utils";
import { ToolResultCard } from "./ToolResultCard";
import type {
  DocumentContent,
  Base64PDFSource,
  PlainTextSource,
  URLPDFSource,
} from "../../types";

type Props = {
  document: DocumentContent;
};

const isBase64PDF = (
  source: Base64PDFSource | PlainTextSource | URLPDFSource
): source is Base64PDFSource => {
  return source.type === "base64" && "media_type" in source && source.media_type === "application/pdf";
};

const isPlainText = (
  source: Base64PDFSource | PlainTextSource | URLPDFSource
): source is PlainTextSource => {
  return source.type === "text" && "media_type" in source && source.media_type === "text/plain" && "data" in source && typeof source.data === "string";
};

const isURLPDF = (
  source: Base64PDFSource | PlainTextSource | URLPDFSource
): source is URLPDFSource => {
  return source.type === "url";
};

export const DocumentRenderer = memo(function DocumentRenderer({ document }: Props) {
  const { t } = useTranslation();
  const { source, title, context } = document;
  const documentStyles = getVariantStyles("document");

  const getSourceInfo = () => {
    if (isBase64PDF(source)) {
      return {
        icon: <FileText className={cn(layout.iconSize, "text-tool-document")} />,
        label: t("documentRenderer.pdf"),
        preview: t("documentRenderer.base64Preview"),
      };
    }
    if (isPlainText(source)) {
      return {
        icon: <File className={cn(layout.iconSize, "text-tool-document")} />,
        label: t("documentRenderer.plainText"),
        preview: source.data.substring(0, 500) + (source.data.length > 500 ? "..." : ""),
      };
    }
    if (isURLPDF(source)) {
      return {
        icon: <Link className={cn(layout.iconSize, "text-tool-document")} />,
        label: t("documentRenderer.urlPdf"),
        preview: source.url,
      };
    }
    return {
      icon: <File className={cn(layout.iconSize, "text-tool-document")} />,
      label: t("documentRenderer.unknown"),
      preview: null,
    };
  };

  const { icon, label, preview } = getSourceInfo();

  return (
    <ToolResultCard
      title={label}
      icon={icon}
      variant="document"
    >

      {title && (
        <div className={cn(layout.bodyText, "font-medium mb-1 text-foreground")}>{title}</div>
      )}

      {context && (
        <div className={cn(layout.smallText, "mb-2 italic text-muted-foreground")}>{context}</div>
      )}

      {preview && (
        <div className="mt-2">
          {isURLPDF(source) ? (
            <a
              href={source.url}
              target="_blank"
              rel="noopener noreferrer"
              className={cn(
                layout.bodyText,
                "underline break-all",
                documentStyles.accent,
                "hover:opacity-80 transition-opacity"
              )}
            >
              {source.url}
            </a>
          ) : (
            <pre className={cn(
              "overflow-x-auto whitespace-pre-wrap text-muted-foreground bg-secondary",
              layout.containerPadding,
              layout.smallText,
              layout.rounded
            )}>
              {preview}
            </pre>
          )}
        </div>
      )}

      {document.citations?.enabled && (
        <div className={cn("mt-2 flex items-center", layout.iconSpacing, layout.smallText, "text-muted-foreground")}>
          <span>
            {t("documentRenderer.citationsEnabled")}
          </span>
        </div>
      )}
    </ToolResultCard>
  );
});
