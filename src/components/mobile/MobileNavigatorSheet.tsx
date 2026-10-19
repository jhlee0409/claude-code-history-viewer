import { useState } from "react";
import { ListTree } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { MessageNavigator } from "@/components/MessageNavigator";
import type { ClaudeMessage } from "@/types";

interface MobileNavigatorSheetProps {
  messages: ClaudeMessage[];
}

export function MobileNavigatorSheet({ messages }: MobileNavigatorSheetProps) {
  const { t } = useTranslation();
  const [isOpen, setIsOpen] = useState(false);

  return (
    <>
      {/* FAB button */}
      <button
        onClick={() => setIsOpen(true)}
        className="fixed bottom-20 right-4 z-30 md:hidden w-12 h-12 rounded-full bg-accent text-accent-foreground shadow-lg flex items-center justify-center hover:bg-accent/90 transition-colors"
        aria-label={t("common.mobile.openNavigator")}
      >
        <ListTree className="w-4 h-4" />
      </button>

      {/* Bottom Sheet */}
      <Sheet open={isOpen} onOpenChange={setIsOpen}>
        <SheetContent side="bottom" className="max-h-[75vh] p-0 rounded-t-xl" showCloseButton={false}>
          {/* Drag handle + title */}
          <div className="flex flex-col items-center pt-2 pb-1 border-b border-border/50">
            <div className="w-10 h-1 rounded-full bg-muted-foreground/30 mb-2" />
            <SheetTitle className="text-body font-semibold text-foreground">
              {t("common.mobile.openNavigator")}
            </SheetTitle>
          </div>
          <div className="h-[calc(75vh-2rem)] overflow-hidden">
            <MessageNavigator
              messages={messages}
              isResizing={false}
              onResizeStart={() => {}}
              isCollapsed={false}
              onToggleCollapse={() => {}}
              asideId="mobile-message-navigator"
            />
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
