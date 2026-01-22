/**
 * ImageRenderer Component
 *
 * Renders image content from Claude messages with preview and fullscreen modal support.
 * Handles both base64-encoded images and external URLs.
 */
import React, { useState, useEffect, useCallback } from "react";
import { Image, ZoomIn, Download, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { layout } from "@/components/renderers";

interface ImageRendererProps {
  imageUrl: string;
  alt?: string;
}

export const ImageRenderer: React.FC<ImageRendererProps> = ({
  imageUrl,
  alt = "Claude generated image",
}) => {
  const { t } = useTranslation("components");
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [imageError, setImageError] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  const handleImageError = () => {
    setImageError(true);
    setIsLoading(false);
  };

  const handleImageLoad = () => {
    setIsLoading(false);
  };

  const handleDownload = useCallback(() => {
    if (imageUrl.startsWith("data:image/")) {
      // base64 이미지 다운로드
      const link = document.createElement("a");
      link.href = imageUrl;
      link.download = `claude-image-${Date.now()}.png`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } else {
      // 외부 URL 이미지
      window.open(imageUrl, "_blank");
    }
  }, [imageUrl]);

  const openModal = useCallback(() => setIsModalOpen(true), []);
  const closeModal = useCallback(() => setIsModalOpen(false), []);

  // ESC 키로 모달 닫기 & 스크롤 락
  useEffect(() => {
    if (!isModalOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        closeModal();
      }
    };

    // 스크롤 락
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = originalOverflow;
    };
  }, [isModalOpen, closeModal]);

  if (imageError) {
    return (
      <div className={cn("bg-muted border border-border text-center", layout.rounded, layout.containerPadding)}>
        <div className={cn("flex items-center justify-center mb-2", layout.iconGap)}>
          <Image className={cn(layout.iconSize, "text-muted-foreground")} />
        </div>
        <p className={cn(layout.bodyText, "text-muted-foreground")}>
          {t("imageRenderer.cannotLoadImage")}
        </p>
        <p className={cn(layout.smallText, "text-muted-foreground mt-1 break-all")}>{imageUrl}</p>
      </div>
    );
  }

  return (
    <>
      {/* 이미지 컨테이너 */}
      <div className={cn("bg-muted/50 border border-border my-2", layout.rounded, layout.containerPadding)}>
        <div className="flex items-center justify-between mb-2">
          <div className={cn("flex items-center", layout.iconSpacing)}>
            <Image className={cn(layout.iconSize, "text-foreground/70")} />
            <span className={cn(layout.titleText, "text-foreground/80")}>
              {t("imageRenderer.image")}
            </span>
          </div>

          <div className={cn("flex items-center", layout.iconGap)}>
            <button
              onClick={openModal}
              className={cn("p-1 hover:bg-accent/50 transition-colors", layout.rounded)}
              title={t("imageRenderer.viewFullscreen")}
              aria-label={t("imageRenderer.viewFullscreen")}
            >
              <ZoomIn className={cn(layout.iconSize, "text-foreground/70")} />
            </button>
            <button
              onClick={handleDownload}
              className={cn("p-1 hover:bg-accent/50 transition-colors", layout.rounded)}
              title={t("imageRenderer.downloadImage")}
              aria-label={t("imageRenderer.downloadImage")}
            >
              <Download className={cn(layout.iconSize, "text-foreground/70")} />
            </button>
          </div>
        </div>

        {/* 이미지 미리보기 */}
        <div className="relative group">
          {isLoading && (
            <div className={cn("absolute inset-0 flex items-center justify-center bg-muted", layout.rounded)}>
              <div className={cn(layout.iconSize, "border-2 border-primary border-t-transparent rounded-full animate-spin")} />
            </div>
          )}
          <img
            src={imageUrl}
            alt={alt}
            onError={handleImageError}
            onLoad={handleImageLoad}
            onClick={openModal}
            className={cn(
              "w-full h-auto cursor-pointer hover:opacity-90 transition-opacity",
              layout.rounded,
              isLoading && "opacity-0"
            )}
            style={{ maxHeight: "400px", objectFit: "contain" }}
          />

          {/* 호버 오버레이 */}
          <div
            onClick={openModal}
            className={cn(
              "absolute inset-0 bg-black/0 group-hover:bg-black/10 dark:group-hover:bg-white/10",
              "transition-all flex items-center justify-center opacity-0 group-hover:opacity-100",
              "cursor-pointer",
              layout.rounded
            )}
          >
            <div className={cn("bg-background/90 rounded-full shadow-md", layout.containerPadding)}>
              <ZoomIn className={cn(layout.iconSize, "text-foreground/80")} />
            </div>
          </div>
        </div>
      </div>

      {/* 모달 */}
      {isModalOpen && (
        <div
          className="fixed inset-0 bg-black/80 flex items-center justify-center z-50 p-4"
          onClick={closeModal}
          role="dialog"
          aria-modal="true"
          aria-label={t("imageRenderer.viewFullscreen")}
        >
          <div
            className="relative w-full h-full flex items-center justify-center"
            onClick={(e) => e.stopPropagation()}
          >
            {/* 닫기 버튼 */}
            <button
              onClick={closeModal}
              className={cn(
                "absolute top-4 right-4 bg-background/90 rounded-full",
                layout.containerPadding,
                "hover:bg-background transition-all z-10 shadow-md"
              )}
              aria-label={t("imageRenderer.close")}
            >
              <X className={cn(layout.iconSize, "text-foreground/80")} />
            </button>

            {/* 다운로드 버튼 */}
            <button
              onClick={handleDownload}
              className={cn(
                "absolute top-4 right-16 bg-background/90 rounded-full",
                layout.containerPadding,
                "hover:bg-background transition-all z-10 shadow-md"
              )}
              aria-label={t("imageRenderer.downloadImage")}
            >
              <Download className={cn(layout.iconSize, "text-foreground/80")} />
            </button>

            {/* 전체 화면 이미지 */}
            <img
              src={imageUrl}
              alt={alt}
              className={cn("max-w-[90vw] max-h-[90vh] object-contain", layout.rounded)}
              onClick={closeModal}
            />
          </div>
        </div>
      )}
    </>
  );
};
