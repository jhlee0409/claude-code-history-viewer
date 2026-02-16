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
};

const ContentProvider = ({
  children,
  hasError,
  enableToggle,
}: ContentProviderProps) => {
  const [isOpen, toggle] = useToggle();

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
};

const RendererWrapper = ({
  children,
  className,
  hasError = false,
  enableToggle = true,
}: RendererWrapperProps) => {
  return (
    <ContentProvider hasError={hasError} enableToggle={enableToggle}>
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
      <div className={cn("flex items-center justify-between", layout.headerPadding, layout.headerHeight)}>
        <div className={cn("flex items-center", layout.iconGap)}>
          {hasError ? (
            <X className={cn(layout.iconSize, "shrink-0 text-destructive")} />
          ) : (
            icon
          )}
          <span
            className={cn(
              layout.titleText,
              titleClassName,
              hasError && "text-destructive"
            )}
          >
            {`${title} ${hasError ? t('common.errorOccurred') : ""}`}
          </span>
        </div>
        <div className={cn("flex items-center shrink-0 overflow-hidden", layout.iconGap, layout.smallText)}>
          {rightContent}
        </div>
      </div>
    );
  }
  return (
    <button
      type="button"
      onClick={toggle}
      className={cn(
        "w-full flex items-center justify-between text-left",
        layout.headerPadding,
        layout.headerHeight,
        "hover:bg-muted/50 transition-colors"
      )}
    >
      <div className={cn("flex items-center", layout.iconGap)}>
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
            titleClassName,
            hasError && "text-destructive"
          )}
        >
          {`${title} ${hasError ? t('common.errorOccurred') : ""}`}
        </span>
      </div>
      <div className={cn("flex items-center shrink-0 overflow-hidden", layout.iconGap, layout.smallText)}>
        {rightContent}
      </div>
    </button>
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
