/**
 * The inspector's Info tab: what the open session is.
 *
 * Every value comes from data the app already holds: the project and
 * session records the sidebar lists (name, path, provider, times, message
 * count, ids) and, for the models, the session's token totals - the one
 * source that covers the whole session, not just the pages loaded so far.
 * The models row has its own loading and error text; the rest never waits.
 */
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Copy } from "lucide-react";
import { toast } from "sonner";
import { useAppStore } from "@/store/useAppStore";
import { copyTextToClipboard } from "@/utils/clipboard";
import { getProviderLabel } from "@/utils/providers";
import { getProjectDisplayName } from "@/utils/pathUtils";
import type { PathContext } from "@/lib/format/path";
import { PathText } from "@/lib/format/PathText";
import { useSessionTokenStats } from "./useSessionTokenStats";
import { useFormat } from "@/lib/format/useFormat";
import { Num } from "@/lib/format/Num";

/**
 * A moment as date and time, each kept on one line: in a narrow column the
 * pair wraps between them, never inside the time ("01:24:42") or the date.
 * The full form with seconds is the tooltip.
 *
 * A missing or unparseable time (subagent sessions are synthesised with
 * empty first/last times) reads "Unknown", with no `<time>` to mislabel.
 */
const Moment = ({ timestamp }: { timestamp: string }) => {
  const { t } = useTranslation();
  const fmt = useFormat();
  const date = new Date(timestamp);
  if (!timestamp || Number.isNaN(date.getTime())) {
    return <span className="text-muted-foreground">{t("common.unknown")}</span>;
  }
  return (
    <time dateTime={timestamp} title={fmt.dateTimeFull(date)} className="flex flex-wrap gap-x-1.5">
      <span className="whitespace-nowrap"><Num>{fmt.date(date, "long")}</Num></span>
      <span className="whitespace-nowrap"><Num>{fmt.time(date)}</Num></span>
    </time>
  );
};

const Row = ({ label, children }: { label: string; children: ReactNode }) => (
  <div className="space-y-0.5">
    <dt className="text-caption text-muted-foreground">{label}</dt>
    <dd className="min-w-0 text-list text-foreground">{children}</dd>
  </div>
);

/**
 * A value the user may want elsewhere (an id, a path), with a copy button.
 * `display` replaces the plain text (a shortened path); the button always
 * copies `value` whole.
 */
const CopyableValue = ({
  value,
  display,
  copyLabel,
  copiedMessage,
}: {
  value: string;
  display?: ReactNode;
  copyLabel: string;
  copiedMessage: string;
}) => {
  const { t } = useTranslation();
  const copy = async () => {
    try {
      await copyTextToClipboard(value);
      toast.success(copiedMessage);
    } catch {
      toast.error(t("copyButton.error", "Copy failed"));
    }
  };
  return (
    <div className="flex items-start gap-1">
      {display ?? (
        <span className="min-w-0 flex-1 break-all font-mono text-caption text-foreground select-all">
          {value}
        </span>
      )}
      <button
        type="button"
        onClick={() => void copy()}
        aria-label={copyLabel}
        title={copyLabel}
        className="shrink-0 rounded p-0.5 text-muted-foreground transition-colors hover:bg-accent/10 hover:text-foreground"
      >
        <Copy className="w-3.5 h-3.5" />
      </button>
    </div>
  );
};

export const InspectorInfoTab = () => {
  const { t } = useTranslation();
  const fmt = useFormat();
  const session = useAppStore((s) => s.selectedSession);
  const project = useAppStore((s) => s.selectedProject);
  const homeDir = useAppStore((s) => s.homeDir);
  const tokens = useSessionTokenStats();

  if (!session) return null;

  // Paths read relative to the project or `~`, only where the app knows the
  // base for certain (`formatPath`): home comes from the backend, never from
  // the chosen Claude folder. Otherwise they stay whole.
  const pathCtx: PathContext = {
    projectRoot: project?.actual_path,
    homeDir,
  };

  const modelNames = [...new Set((tokens.stats?.model_distribution ?? []).map((m) => m.model_name))];
  const models = (() => {
    if (tokens.error) return <span className="text-muted-foreground">{t("common.inspector.info.modelsUnavailable")}</span>;
    if (tokens.isLoading) return <span className="text-muted-foreground">{t("common.loading")}</span>;
    if (modelNames.length === 0) return <span className="text-muted-foreground">{t("common.inspector.info.noModels")}</span>;
    return (
      <ul className="space-y-0.5">
        {modelNames.map((name) => (
          <li key={name} className="break-all font-mono text-caption">
            {name}
          </li>
        ))}
      </ul>
    );
  })();

  return (
    // Words stay whole (keep-all) in every language; ids and paths opt into
    // breaking anywhere (`break-all`).
    <div className="flex-1 min-h-0 overflow-y-auto p-3 break-keep break-words">
      <dl className="space-y-3">
        {project && (
          <Row label={t("common.inspector.info.project")}>
            <span className="block break-words">{getProjectDisplayName(project)}</span>
            {project.actual_path && (
              <PathText
                path={project.actual_path}
                ctx={pathCtx}
                className="flex text-caption text-muted-foreground"
              />
            )}
          </Row>
        )}
        <Row label={t("common.inspector.info.provider")}>
          {getProviderLabel(t, session.provider ?? project?.provider)}
        </Row>
        <Row label={t("common.inspector.info.models")}>{models}</Row>
        <Row label={t("common.inspector.info.messages")}>
          <span className="tabular-nums"><Num>{fmt.count(session.message_count)}</Num></span>
        </Row>
        <Row label={t("common.inspector.info.created")}>
          <Moment timestamp={session.first_message_time} />
        </Row>
        <Row label={t("common.inspector.info.updated")}>
          <Moment timestamp={session.last_message_time} />
        </Row>
        <Row label={t("common.inspector.info.sessionId")}>
          <CopyableValue
            value={session.actual_session_id}
            copyLabel={t("session.copySessionId", "Copy Session ID")}
            copiedMessage={t("session.copiedSessionId", "Session ID copied")}
          />
        </Row>
        <Row label={t("common.inspector.info.filePath")}>
          <CopyableValue
            value={session.file_path}
            display={
              <PathText
                path={session.file_path}
                ctx={pathCtx}
                className="flex flex-1 text-caption text-foreground select-all"
              />
            }
            copyLabel={t("common.inspector.info.copyFilePath")}
            copiedMessage={t("common.inspector.info.filePathCopied")}
          />
        </Row>
      </dl>
    </div>
  );
};
