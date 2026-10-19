/**
 * Skip links: one per landmark the current screen actually renders. Each link
 * is gated on its target's real render condition, not on a proxy for it, so
 * no link in the tab order points at an id that is not in the document.
 *
 * The pane offsets (`24rem`, `35rem`) apply from `md` up: on a phone a link
 * that far right widened the page past the viewport, and WebKit drew a
 * horizontal scrollbar over the bottom tab bar.
 */
import { useTranslation } from "react-i18next";

interface SkipLinksProps {
  /**
   * The desktop explorer owns `#project-explorer`; on mobile the id exists
   * only inside the navigation drawer, and only while it is open.
   */
  hasProjectExplorer: boolean;
  /**
   * The inspector renders only beside a transcript, while the selected
   * session survives switching to other screens; keyed to the session alone,
   * the link pointed at nothing there (#518).
   */
  hasInspector: boolean;
}

export const SkipLinks = ({
  hasProjectExplorer,
  hasInspector,
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
          className="absolute left-2 top-2 -translate-y-[calc(100%+1rem)] focus:translate-y-0 z-[700] rounded-md border border-border bg-card px-3 py-2 text-body font-medium text-foreground transition-transform"
        >
          {t("common.a11y.skipToProjects", {
            defaultValue: "Skip to project explorer",
          })}
        </a>
      )}
      <a
        href="#main-content"
        className="absolute left-2 md:left-[24rem] top-2 -translate-y-[calc(100%+1rem)] focus:translate-y-0 z-[700] rounded-md border border-border bg-card px-3 py-2 text-body font-medium text-foreground transition-transform"
      >
        {t("common.a11y.skipToMain", {
          defaultValue: "Skip to main content",
        })}
      </a>
      {hasInspector && (
        <a
          href="#inspector"
          className="absolute left-2 md:left-[35rem] top-2 -translate-y-[calc(100%+1rem)] focus:translate-y-0 z-[700] rounded-md border border-border bg-card px-3 py-2 text-body font-medium text-foreground transition-transform"
        >
          {t("common.a11y.skipToInspector", {
            defaultValue: "Skip to inspector",
          })}
        </a>
      )}
      <a
        href="#app-settings-button"
        className="absolute right-2 top-2 -translate-y-[calc(100%+1rem)] focus:translate-y-0 z-[700] rounded-md border border-border bg-card px-3 py-2 text-body font-medium text-foreground transition-transform"
      >
        {t("common.a11y.skipToSettings", {
          defaultValue: "Skip to settings",
        })}
      </a>
    </nav>
  );
};
