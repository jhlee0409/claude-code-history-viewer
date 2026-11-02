import { api } from "@/services/api";
import { getApiBase, isTauri } from "@/utils/platform";

export interface ReadingDocument {
  document_id: string;
  capability: string;
  bridge_nonce: string;
  renderer_version: string;
}

export async function prepareReadingDocument(sessionPath: string, forceRefresh: boolean) {
  const document = await api<ReadingDocument>("prepare_reading_document", { sessionPath, forceRefresh });
  if (![document.document_id, document.capability, document.bridge_nonce, document.renderer_version]
    .every((value) => typeof value === "string" && value.length > 0)) {
    throw new Error("Invalid reading document response");
  }
  return document;
}

export async function readingDocumentUrl(document: ReadingDocument): Promise<string> {
  const id = encodeURIComponent(document.document_id);
  const capability = encodeURIComponent(document.capability);
  if (isTauri()) {
    const { convertFileSrc } = await import("@tauri-apps/api/core");
    return `${convertFileSrc(document.document_id, "reading")}?capability=${capability}`;
  }
  return `${getApiBase()}/api/reading_documents/${id}?capability=${capability}`;
}

export function exportReadingDocument(document: ReadingDocument) {
  return api<string>("export_reading_document", {
    documentId: document.document_id,
    capability: document.capability,
  });
}
