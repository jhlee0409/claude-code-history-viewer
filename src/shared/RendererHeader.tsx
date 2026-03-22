import { ChevronRight, X } from "lucide-react";
import { useToggle } from "../hooks";
import { createContext, useContext } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { layout } from "@/components/renderers";

const ContentContext = createContext<{
  isOpen: boolean;
  toggle: () => void;
  hasError?: boolean;
  enableToggle?: boolean;
}>({
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
};

const ContentProvider = ({
  children,
  hasError,
  enableToggle,
  expandKey,
}: ContentProviderProps) => {
  const [isOpen, toggle] = useToggle(expandKey ?? "renderer");

  return (
    <ContentContext.Provider value={{ isOpen, toggle, hasError, enableToggle }}>
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
};

const RendererWrapper = ({
  children,
  className,
  hasError = false,
  enableToggle = true,
  expandKey,
}: RendererWrapperProps) => {
  return (
    <ContentProvider hasError={hasError} enableToggle={enableToggle} expandKey={expandKey}>
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
  rightContent?: React.ReactNode;
};

const RendererHeader = ({
  title,
  icon,
  titleClassName,
  rightContent,
}: RendererHeaderProps) => {
  const { isOpen, toggle, hasError, enableToggle } = useContext(ContentContext);
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
        <div className={cn("flex items-center shrink-0 ml-auto", layout.iconGap, layout.smallText)}>
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
      <button
        type="button"
        onClick={toggle}
        aria-expanded={isOpen}
        className={cn(
          "flex items-center text-left flex-1 min-w-[10ch]",
          layout.iconGap,
          "hover:bg-muted/50 transition-colors rounded-sm -m-1 p-1"
        )}
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
      </button>
      {rightContent && (
        <div
          className={cn("flex items-center shrink-0 ml-auto", layout.iconGap, layout.smallText)}
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
  const { isOpen, enableToggle } = useContext(ContentContext);

  if (!enableToggle) {
    return <div className={layout.contentPadding}>{children}</div>;
  }

  return isOpen ? <div className={layout.contentPadding}>{children}</div> : null;
};

export const Renderer = Object.assign(RendererWrapper, {
  Header: RendererHeader,
  Content: RendererContent,
});
