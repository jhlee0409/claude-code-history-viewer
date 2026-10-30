import { Funnel, RotateCcw, User, Bot, MessageSquareText, Brain, Wrench, SquareTerminal, Zap, Network } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { ChipToggle, ChipToggleGroup } from "@/components/ui/chipToggle";
import { useAppStore } from "../../../store/useAppStore";

interface FilterToggleProps {
  active: boolean;
  onClick: () => void;
  label: string;
  icon: React.ReactNode;
  /** Set when the toggle has no effect; the reason becomes the tooltip. */
  disabledReason?: string;
}

function FilterToggle({ active, onClick, label, icon, disabledReason }: FilterToggleProps) {
  const disabled = disabledReason != null;
  return (
    <ChipToggle
      pressed={active}
      onPressedChange={onClick}
      // aria-disabled keeps the toggle focusable, so its tooltip still says why.
      aria-disabled={disabled || undefined}
      className={cn(
        "flex items-center gap-1 px-1.5 py-0.5 rounded text-caption border transition-colors",
        active
          ? "bg-accent/15 text-accent border-accent/30"
          : "bg-transparent text-muted-foreground border-transparent",
        !active && !disabled && "hover:text-foreground hover:bg-muted/50"
      )}
      aria-label={label}
      title={disabledReason ?? label}
    >
      {icon}
      <span className="hidden sm:inline">{label}</span>
    </ChipToggle>
  );
}

interface FilterToolbarProps {
  totalCount: number;
  filteredCount: number;
  hasParallelTasks: boolean;
}

export function FilterToolbar({ totalCount, filteredCount, hasParallelTasks }: FilterToolbarProps) {
  const { t } = useTranslation();
  const {
    messageFilter,
    toggleRole,
    toggleContentType,
    resetMessageFilter,
    isMessageFilterActive,
    isApiViewOpen,
    toggleApiView,
  } = useAppStore();

  // The API request view ignores message filters, so they are shown inert.
  const filtersOff = isApiViewOpen ? t("messageViewer.apiView.filtersDisabled") : undefined;
  const isActive = !isApiViewOpen && isMessageFilterActive();

  return (
    <ChipToggleGroup
      aria-label={t("filter.title")}
      className={cn(
        "flex flex-wrap items-center gap-1.5 px-3 py-1 border-b border-border/30 shrink-0 min-h-[32px]",
        isActive && "bg-accent/5"
      )}
    >
      {/* Filter icon + count */}
      <div className={cn("flex items-center gap-1 shrink-0", isApiViewOpen && "opacity-40")} title={filtersOff}>
        <Funnel className={cn("w-3.5 h-3.5 shrink-0", isActive ? "text-accent" : "text-muted-foreground")} />
        <span className={cn("text-caption tabular-nums whitespace-nowrap", isActive ? "text-accent font-medium" : "text-muted-foreground")}>
          {isActive
            ? t("filter.showing", { filtered: filteredCount, total: totalCount })
            : totalCount}
        </span>
      </div>

      <div className="h-3.5 w-px bg-border/40 shrink-0" />

      {/* Role filters */}
      <div className="flex items-center gap-0.5 shrink-0">
        <FilterToggle
          active={messageFilter.roles.user}
          onClick={() => toggleRole("user")}
          label={t("filter.role.user")}
          icon={<User className="w-3.5 h-3.5" />}
          disabledReason={filtersOff}
        />
        <FilterToggle
          active={messageFilter.roles.assistant}
          onClick={() => toggleRole("assistant")}
          label={t("filter.role.assistant")}
          icon={<Bot className="w-3.5 h-3.5" />}
          disabledReason={filtersOff}
        />
      </div>

      <div className="h-3.5 w-px bg-border/40 shrink-0" />

      {/* Content type filters */}
      <div className="flex items-center gap-0.5 shrink-0">
        <FilterToggle
          active={messageFilter.contentTypes.text}
          onClick={() => toggleContentType("text")}
          label={t("filter.content.text")}
          icon={<MessageSquareText className="w-3.5 h-3.5" />}
          disabledReason={filtersOff}
        />
        <FilterToggle
          active={messageFilter.contentTypes.thinking}
          onClick={() => toggleContentType("thinking")}
          label={t("filter.content.thinking")}
          icon={<Brain className="w-3.5 h-3.5" />}
          disabledReason={filtersOff}
        />
        <FilterToggle
          active={messageFilter.contentTypes.toolCalls}
          onClick={() => toggleContentType("toolCalls")}
          label={t("filter.content.toolCalls")}
          icon={<Wrench className="w-3.5 h-3.5" />}
          disabledReason={filtersOff}
        />
        <FilterToggle
          active={messageFilter.contentTypes.commands}
          onClick={() => toggleContentType("commands")}
          label={t("filter.content.commands")}
          icon={<SquareTerminal className="w-3.5 h-3.5" />}
          disabledReason={filtersOff}
        />
        {hasParallelTasks && (
          <FilterToggle
            active={messageFilter.contentTypes.parallelTasks}
            onClick={() => toggleContentType("parallelTasks")}
            label={t("filter.content.parallelTasks")}
            icon={<Zap className="w-3.5 h-3.5" />}
            disabledReason={filtersOff}
          />
        )}
      </div>

      <div className="h-3.5 w-px bg-border/40 shrink-0" />
      <FilterToggle
        active={isApiViewOpen}
        onClick={toggleApiView}
        label={t("messageViewer.apiView.toggle")}
        icon={<Network className="w-3.5 h-3.5" />}
      />

      {/* Reset button */}
      {isActive && (
        <>
          <div className="h-3.5 w-px bg-border/40 shrink-0" />
          <button
            onClick={resetMessageFilter}
            className="p-0.5 rounded text-muted-foreground hover:text-foreground hover:bg-accent/10 transition-colors shrink-0"
            aria-label={t("filter.reset")}
            title={t("filter.reset")}
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </button>
        </>
      )}
    </ChipToggleGroup>
  );
}
