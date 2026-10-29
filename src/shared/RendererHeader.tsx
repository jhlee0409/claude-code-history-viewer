import { Button } from "@/components/ui/button";
import { ChevronRight, X } from "lucide-react";
import { useToggle } from "../hooks";
import { createContext, useContext, useId } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { layout } from "@/components/renderers";
import { RendererDefaultsContext } from "./rendererDefaults";

const ContentContext = createContext<{
  contentId: string;
  isOpen: boolean;
  toggle: () => void;
  hasError?: boolean;
  enableToggle?: boolean;
}>({
  contentId: "",
  isOpen: false,
  toggle: () => {},
  hasError: false,
  enableToggle: true,
});

type ContentProviderProps = {
  children: React.ReactNode;
  hasError?: boolean;
  enableToggle?: boolean;
  expandKey?: string;
  /** When true, force the content open (e.g. a search match lives inside). */
  autoExpand?: boolean;
  /** Initial open state when the expand registry has no entry for this key. */
  defaultExpanded?: boolean;
};

const ContentProvider = ({
  children,
  hasError,
  enableToggle,
  expandKey,
  autoExpand,
  defaultExpanded,
}: ContentProviderProps) => {
  const contentId = useId();
  const ambient = useContext(RendererDefaultsContext);
  const [isOpen, toggle] = useToggle(
    expandKey ?? "renderer",
    defaultExpanded ?? ambient.defaultExpanded,
  );

  // Reveal collapsed content when a search match is inside it, so the
  // highlighted term is actually visible (#429). `autoExpand` is applied as an
  // ephemeral override rather than written through `setIsOpen`, so it does not
  // mutate the persisted expand registry (which the WYSIWYG capture renderer
  // reads) and cleanly reverts once the search term clears.
  return (
    <ContentContext.Provider
      value={{ contentId, isOpen: isOpen || autoExpand === true, toggle, hasError, enableToggle }}
    >
      {children}
    </ContentContext.Provider>
  );
};

type RendererWrapperProps = {
  children: React.ReactNode;
  className?: string;
  hasError?: boolean;
  enableToggle?: boolean;
  expandKey?: string;
  /** When true, force the content open (e.g. a search match lives inside). */
  autoExpand?: boolean;
  /** Initial open state when the expand registry has no entry for this key. */
  defaultExpanded?: boolean;
};

const RendererWrapper = ({
  children,
  className,
  hasError = false,
  enableToggle = true,
  expandKey,
  autoExpand,
  defaultExpanded,
}: RendererWrapperProps) => {
  return (
    <ContentProvider
      hasError={hasError}
      enableToggle={enableToggle}
      expandKey={expandKey}
      autoExpand={autoExpand}
      defaultExpanded={defaultExpanded}
    >
      <div
        className={cn(
          "mt-1.5 border border-border overflow-hidden",
          layout.rounded,
          className,
          hasError && "bg-destructive/10 border-destructive/50"
        )}
      >
        {children}
      </div>
    </ContentProvider>
  );
};

type RendererHeaderProps = {
  title: string;
  icon: React.ReactNode;
  titleClassName?: string;
  /**
   * Right-hand group (badges, outcome status, copy-ID button). Its box is
   * capped to the header row: a group wider than the card wraps inside it
   * (the group's own `flex-wrap`) instead of being clipped by the card.
   */
  rightContent?: React.ReactNode;
  /** One-line preview of the payload, shown only while collapsed. */
  summary?: string;
};

const RendererHeader = ({
  title,
  icon,
  titleClassName,
  rightContent,
  summary,
}: RendererHeaderProps) => {
  const { contentId, isOpen, toggle, hasError, enableToggle } = useContext(ContentContext);
  const { t } = useTranslation();

  if (!enableToggle) {
    return (
      <div className={cn("flex flex-wrap items-center gap-y-0.5", layout.headerPadding, layout.headerHeight)}>
        <div className={cn("flex items-center flex-1 min-w-[10ch]", layout.iconGap)}>
          {hasError ? (
            <X className={cn(layout.iconSize, "shrink-0 text-destructive")} />
          ) : (
            icon
          )}
          <span
            className={cn(
              layout.titleText,
              "truncate",
              titleClassName,
              hasError && "text-destructive"
            )}
          >
            {`${title} ${hasError ? t('common.errorOccurred') : ""}`}
          </span>
        </div>
        <div className={cn("flex items-center shrink-0 ml-auto max-w-full min-w-0", layout.iconGap, layout.smallText)}>
          {rightContent}
        </div>
      </div>
    );
  }
  return (
    <div
      className={cn(
        "w-full flex flex-wrap items-center gap-y-0.5",
        layout.headerPadding,
        layout.headerHeight
      )}
    >
      <Button variant="ghost" size="sm"
        type="button"
        onClick={toggle}
        aria-expanded={isOpen}
        aria-controls={contentId}
        className={cn("h-auto whitespace-normal justify-start font-normal", cn(
          "flex items-center text-left flex-1 min-w-[10ch]",
          layout.iconGap,
          "hover:bg-muted/50 transition-colors rounded-sm -m-1 p-1"
        ))}
      >
        <ChevronRight
          className={cn(
            layout.iconSize,
            "shrink-0 transition-transform duration-200 text-muted-foreground",
            isOpen && "rotate-90"
          )}
        />
        {hasError ? (
          <X className={cn(layout.iconSize, "shrink-0 text-destructive")} />
        ) : (
          icon
        )}
        <span
          className={cn(
            layout.titleText,
            "truncate",
            titleClassName,
            hasError && "text-destructive"
          )}
        >
          {`${title} ${hasError ? t('common.errorOccurred') : ""}`}
        </span>
        {summary && !isOpen && (
          <span
            className={cn(
              layout.monoText,
              "truncate min-w-0 flex-1 text-muted-foreground opacity-80",
            )}
            title={summary}
          >
            {summary}
          </span>
        )}
      </Button>
      {rightContent && (
        <div
          className={cn("flex items-center shrink-0 ml-auto max-w-full min-w-0", layout.iconGap, layout.smallText)}
          onClick={(e) => e.stopPropagation()}
        >
          {rightContent}
        </div>
      )}
    </div>
  );
};

type RendererContentProps = {
  children: React.ReactNode;
};

const RendererContent = ({ children }: RendererContentProps) => {
  const { contentId, isOpen, enableToggle } = useContext(ContentContext);

  if (!enableToggle) {
    return <div id={contentId} className={layout.contentPadding}>{children}</div>;
  }

  return <div id={contentId} hidden={!isOpen} className={layout.contentPadding}>{isOpen ? children : null}</div>;
};

export const Renderer = Object.assign(RendererWrapper, {
  Header: RendererHeader,
  Content: RendererContent,
});
