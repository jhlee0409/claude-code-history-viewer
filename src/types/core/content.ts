/**
 * Core Content Types
 *
 * All content block types that can appear in message.content arrays.
 * Includes text, images, documents, thinking, and citations.
 */

// ============================================================================
// Base Content Types
// ============================================================================

export interface TextContent {
  type: "text";
  text: string;
  citations?: Citation[];
}

export interface ThinkingContent {
  type: "thinking";
  thinking: string;
  signature?: string;
}

/** Redacted thinking block - encrypted by safety systems (pre-Claude 4 models) */
export interface RedactedThinkingContent {
  type: "redacted_thinking";
  data: string;
}

// ============================================================================
// Image Types
// ============================================================================

export interface ImageContent {
  type: "image";
  source: Base64ImageSource | URLImageSource;
}

/** Allowed image MIME types for type safety */
export type ImageMimeType =
  | "image/jpeg"
  | "image/png"
  | "image/gif"
  | "image/webp";

export interface Base64ImageSource {
  type: "base64";
  media_type: ImageMimeType;
  data: string;
}

export interface URLImageSource {
  type: "url";
  url: string;
}

// ============================================================================
// Document Types
// ============================================================================

export interface DocumentContent {
  type: "document";
  source: Base64PDFSource | PlainTextSource | URLPDFSource;
  title?: string;
  context?: string;
  citations?: CitationsConfig;
}

export interface Base64PDFSource {
  type: "base64";
  media_type: "application/pdf";
  data: string;
}

export interface PlainTextSource {
  type: "text";
  media_type: "text/plain";
  data: string;
}

export interface URLPDFSource {
  type: "url";
  url: string;
}

export interface CitationsConfig {
  enabled: boolean;
}

// ============================================================================
// Citation Types
// ============================================================================

/** Citation structure for referencing source documents */
export interface Citation {
  type: "char_location" | "page_location" | "content_block_location";
  cited_text: string;
  document_index: number;
  document_title?: string;
  // char_location specific
  start_char_index?: number;
  end_char_index?: number;
  // page_location specific (1-indexed)
  start_page_number?: number;
  end_page_number?: number;
  // content_block_location specific (0-indexed)
  start_block_index?: number;
  end_block_index?: number;
}

// ============================================================================
// Search Result Types
// ============================================================================

/** Search result content block */
export interface SearchResultContent {
  type: "search_result";
  title: string;
  source: string;
  content: TextContent[];
}
