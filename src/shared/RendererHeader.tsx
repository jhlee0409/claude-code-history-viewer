import { ChevronRight, X } from "lucide-react";
import { useToggle } from "../hooks";
import { createContext, useContext } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "../utils/cn";
import { COLORS } from "../constants/colors";

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
          "mt-2 border rounded-lg overflow-hidden",
          className,
          hasError &&
            `${COLORS.semantic.error.bg} ${COLORS.semantic.error.border}`
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
  const { t } = useTranslation("common");

  if (!enableToggle) {
    return (
      <div className={cn("flex items-center justify-between px-3 py-2")}>
        <div className="flex items-center gap-2">
          {hasError ? (
            <X className={`w-4 h-4 shrink-0 ${COLORS.semantic.error.icon}`} />
          ) : (
            icon
          )}
          <span
            className={cn(
              "text-xs font-medium",
              titleClassName,
              hasError && COLORS.semantic.error.textDark
            )}
          >
            {`${title} ${hasError ? t("errorOccurred") : ""}`}
          </span>
        </div>
        {rightContent}
      </div>
    );
  }
  return (
    <button
      type="button"
      onClick={toggle}
      className={cn(
        "w-full flex items-center justify-between px-3 py-2 text-left",
        "hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors"
      )}
    >
      <div className="flex items-center gap-2">
        <ChevronRight
          className={cn(
            "w-4 h-4 shrink-0 transition-transform duration-200",
            COLORS.ui.text.muted,
            isOpen && "rotate-90"
          )}
        />
        {hasError ? (
          <X className={`w-4 h-4 shrink-0 ${COLORS.semantic.error.icon}`} />
        ) : (
          icon
        )}
        <span
          className={cn(
            "text-xs font-medium",
            titleClassName,
            hasError && COLORS.semantic.error.textDark
          )}
        >
          {`${title} ${hasError ? t("errorOccurred") : ""}`}
        </span>
      </div>
      {rightContent}
    </button>
  );
};

type RendererContentProps = {
  children: React.ReactNode;
};

const RendererContent = ({ children }: RendererContentProps) => {
  const { isOpen, enableToggle } = useContext(ContentContext);

  if (!enableToggle) {
    return <div className="px-3 pb-3">{children}</div>;
  }

  return isOpen ? <div className="px-3 pb-3">{children}</div> : null;
};

export const Renderer = Object.assign(RendererWrapper, {
  Header: RendererHeader,
  Content: RendererContent,
});
