import { Filter, RotateCcw, User, Bot, MessageSquareText, Brain, Wrench, Terminal } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { useAppStore } from "../../../store/useAppStore";

interface FilterToggleProps {
  active: boolean;
  onClick: () => void;
  label: string;
  icon: React.ReactNode;
}

function FilterToggle({ active, onClick, label, icon }: FilterToggleProps) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex items-center gap-1 px-1.5 py-0.5 rounded text-2xs border transition-colors",
        active
          ? "bg-accent/15 text-accent border-accent/30"
          : "bg-transparent text-zinc-500 border-transparent hover:text-zinc-300 hover:bg-zinc-800/50"
      )}
      aria-pressed={active}
      aria-label={label}
      title={label}
    >
      {icon}
      <span className="hidden sm:inline">{label}</span>
    </button>
  );
}

interface FilterToolbarProps {
  totalCount: number;
  filteredCount: number;
}

export function FilterToolbar({ totalCount, filteredCount }: FilterToolbarProps) {
  const { t } = useTranslation();
  const {
    messageFilter,
    toggleRole,
    toggleContentType,
    resetMessageFilter,
    isMessageFilterActive,
  } = useAppStore();

  const isActive = isMessageFilterActive();

  return (
    <div
      className={cn(
        "flex items-center gap-1.5 px-3 py-1 border-b border-border/30 shrink-0 min-h-[32px] overflow-x-auto",
        isActive && "bg-accent/5"
      )}
    >
      {/* Filter icon + count */}
      <div className="flex items-center gap-1 shrink-0">
        <Filter className={cn("w-3.5 h-3.5 shrink-0", isActive ? "text-accent" : "text-muted-foreground")} />
        <span className={cn("text-2xs tabular-nums whitespace-nowrap", isActive ? "text-accent font-medium" : "text-muted-foreground")}>
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
          icon={<User className="w-3 h-3" />}
        />
        <FilterToggle
          active={messageFilter.roles.assistant}
          onClick={() => toggleRole("assistant")}
          label={t("filter.role.assistant")}
          icon={<Bot className="w-3 h-3" />}
        />
      </div>

      <div className="h-3.5 w-px bg-border/40 shrink-0" />

      {/* Content type filters */}
      <div className="flex items-center gap-0.5 shrink-0">
        <FilterToggle
          active={messageFilter.contentTypes.text}
          onClick={() => toggleContentType("text")}
          label={t("filter.content.text")}
          icon={<MessageSquareText className="w-3 h-3" />}
        />
        <FilterToggle
          active={messageFilter.contentTypes.thinking}
          onClick={() => toggleContentType("thinking")}
          label={t("filter.content.thinking")}
          icon={<Brain className="w-3 h-3" />}
        />
        <FilterToggle
          active={messageFilter.contentTypes.toolCalls}
          onClick={() => toggleContentType("toolCalls")}
          label={t("filter.content.toolCalls")}
          icon={<Wrench className="w-3 h-3" />}
        />
        <FilterToggle
          active={messageFilter.contentTypes.commands}
          onClick={() => toggleContentType("commands")}
          label={t("filter.content.commands")}
          icon={<Terminal className="w-3 h-3" />}
        />
      </div>

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
    </div>
  );
}
