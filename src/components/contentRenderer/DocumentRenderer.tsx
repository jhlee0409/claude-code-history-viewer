import { memo } from "react";
import { FileText, File, Link } from "lucide-react";
import { useTranslation } from "react-i18next";
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
  const { t } = useTranslation("components");
  const { source, title, context } = document;

  const getSourceInfo = () => {
    if (isBase64PDF(source)) {
      return {
        icon: <FileText className="w-4 h-4 text-red-600" />,
        label: t("documentRenderer.pdf", { defaultValue: "PDF Document" }),
        preview: t("documentRenderer.base64Preview", {
          defaultValue: "Base64 encoded PDF",
        }),
      };
    }
    if (isPlainText(source)) {
      return {
        icon: <File className="w-4 h-4 text-gray-600" />,
        label: t("documentRenderer.plainText", {
          defaultValue: "Plain Text Document",
        }),
        preview: source.data.substring(0, 500) + (source.data.length > 500 ? "..." : ""),
      };
    }
    if (isURLPDF(source)) {
      return {
        icon: <Link className="w-4 h-4 text-blue-600" />,
        label: t("documentRenderer.urlPdf", { defaultValue: "PDF from URL" }),
        preview: source.url,
      };
    }
    return {
      icon: <File className="w-4 h-4 text-gray-600" />,
      label: t("documentRenderer.unknown", { defaultValue: "Document" }),
      preview: null,
    };
  };

  const { icon, label, preview } = getSourceInfo();

  return (
    <div className="bg-slate-50 border border-slate-200 rounded-lg p-3">
      <div className="flex items-center space-x-2 mb-2">
        {icon}
        <span className="text-xs font-medium text-slate-700">{label}</span>
      </div>

      {title && (
        <div className="text-sm font-medium text-slate-800 mb-1">{title}</div>
      )}

      {context && (
        <div className="text-xs text-slate-600 mb-2 italic">{context}</div>
      )}

      {preview && (
        <div className="mt-2">
          {isURLPDF(source) ? (
            <a
              href={source.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-blue-600 hover:text-blue-800 underline break-all"
            >
              {source.url}
            </a>
          ) : (
            <pre className="text-xs text-slate-600 bg-slate-100 rounded p-2 overflow-x-auto whitespace-pre-wrap">
              {preview}
            </pre>
          )}
        </div>
      )}

      {document.citations?.enabled && (
        <div className="mt-2 text-xs text-slate-500 flex items-center space-x-1">
          <span>
            {t("documentRenderer.citationsEnabled", {
              defaultValue: "Citations enabled",
            })}
          </span>
        </div>
      )}
    </div>
  );
});
