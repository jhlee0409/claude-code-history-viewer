/**
 * Skip links: one per landmark the current screen actually renders. Each link
 * is gated on its target's real render condition, not on a proxy for it, so
 * no link in the tab order points at an id that is not in the document.
 */
import { useTranslation } from "react-i18next";

interface SkipLinksProps {
  /**
   * The desktop explorer owns `#project-explorer`; on mobile the id exists
   * only inside the navigation drawer, and only while it is open.
   */
  hasProjectExplorer: boolean;
  hasSessionsPane: boolean;
  hasRecentEditsDock: boolean;
  /**
   * The navigator renders only beside a transcript, while the selected
   * session survives switching to other screens; keyed to the session alone,
   * the link pointed at nothing there (#518).
   */
  hasMessageNavigator: boolean;
}

export const SkipLinks = ({
  hasProjectExplorer,
  hasSessionsPane,
  hasRecentEditsDock,
  hasMessageNavigator,
}: SkipLinksProps) => {
  const { t } = useTranslation();
  return (
    <nav
      aria-label={t("common.a11y.skipNavigation", {
        defaultValue: "Skip navigation",
      })}
    >
      {hasProjectExplorer && (
        <a
          href="#project-explorer"
          className="absolute left-2 top-[-40px] z-[700] rounded-md border border-border bg-card px-3 py-2 text-body font-medium text-foreground transition-all focus:top-2"
        >
          {t("common.a11y.skipToProjects", {
            defaultValue: "Skip to project explorer",
          })}
        </a>
      )}
      {hasSessionsPane && (
        <a
          href="#sessions-pane"
          className="absolute left-[13rem] top-[-40px] z-[700] rounded-md border border-border bg-card px-3 py-2 text-body font-medium text-foreground transition-all focus:top-2"
        >
          {t("common.a11y.skipToSessions", { defaultValue: "Skip to sessions" })}
        </a>
      )}
      <a
        href="#main-content"
        className="absolute left-[24rem] top-[-40px] z-[700] rounded-md border border-border bg-card px-3 py-2 text-body font-medium text-foreground transition-all focus:top-2"
      >
        {t("common.a11y.skipToMain", {
          defaultValue: "Skip to main content",
        })}
      </a>
      {hasRecentEditsDock && (
        <a
          href="#recent-edits-dock"
          className="absolute left-[47rem] top-[-40px] z-[700] hidden rounded-md border border-border bg-card px-3 py-2 text-body font-medium text-foreground transition-all focus:top-2 xl:block"
        >
          {t("common.a11y.skipToRecentEdits", {
            defaultValue: "Skip to recent edits",
          })}
        </a>
      )}
      {hasMessageNavigator && (
        <a
          href="#message-navigator"
          className="absolute left-[35rem] top-[-40px] z-[700] rounded-md border border-border bg-card px-3 py-2 text-body font-medium text-foreground transition-all focus:top-2"
        >
          {t("common.a11y.skipToNavigator", {
            defaultValue: "Skip to message navigator",
          })}
        </a>
      )}
      <a
        href="#app-settings-button"
        className="absolute right-2 top-[-40px] z-[700] rounded-md border border-border bg-card px-3 py-2 text-body font-medium text-foreground transition-all focus:top-2"
      >
        {t("common.a11y.skipToSettings", {
          defaultValue: "Skip to settings",
        })}
      </a>
    </nav>
  );
};
