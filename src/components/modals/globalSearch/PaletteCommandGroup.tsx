/**
 * The "Commands" group of the ⌘K palette (plan T6b): every manifest command
 * the palette offers here, filtered by the query (`paletteEntries`), as cmdk
 * items. Disabled commands stay listed but cannot be picked, so the user
 * sees what exists and that it does not apply right now.
 */
import { Command as CommandPrimitive } from "cmdk";
import { useTranslation } from "react-i18next";
import { currentKeyEnvironment, shortcutLabel } from "@/commands/keys";
import type { CommandId } from "@/commands/manifest";
import { commandItemValue, type PaletteEntry } from "@/commands/paletteQuery";

interface PaletteCommandGroupProps {
  /** The commands to list (`paletteEntries`), already filtered by the query. */
  entries: readonly PaletteEntry[];
  onRun: (id: CommandId) => void;
}

export function PaletteCommandGroup({ entries, onRun }: PaletteCommandGroupProps) {
  const { t } = useTranslation();
  const env = currentKeyEnvironment();

  if (entries.length === 0) return null;

  return (
    <CommandPrimitive.Group
      heading={t("common.command.groupHeading")}
      className="py-2 [&_[cmdk-group-heading]]:px-4 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-list [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground"
    >
      {entries.map(({ command, title, enabled }) => {
        const Glyph = command.icon;
        const keys = shortcutLabel(command.shortcut, env);
        return (
          <CommandPrimitive.Item
            key={command.id}
            value={commandItemValue(command.id)}
            disabled={!enabled}
            onSelect={() => onRun(command.id)}
            className="flex items-center gap-3 px-4 py-2 text-body text-foreground cursor-pointer data-[selected=true]:bg-muted data-[disabled=true]:cursor-default data-[disabled=true]:text-muted-foreground/60"
          >
            <Glyph className="w-4 h-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span className="flex-1 truncate">{title}</span>
            {keys && (
              <kbd className="px-1.5 py-0.5 bg-muted rounded border border-border font-mono text-caption text-muted-foreground">
                {keys}
              </kbd>
            )}
          </CommandPrimitive.Item>
        );
      })}
    </CommandPrimitive.Group>
  );
}
