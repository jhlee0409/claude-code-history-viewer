import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useTranslation } from "react-i18next";
import { GithubIcon, MailIcon, InfoIcon } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  Button,
  Input,
  Label,
  Textarea,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Switch,
} from "@/components/ui";

interface FeedbackData {
  subject: string;
  body: string;
  include_system_info: boolean;
  feedback_type: string;
}

interface SystemInfo {
  app_version: string;
  os_type: string;
  os_version: string;
  arch: string;
}

interface FeedbackModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const FeedbackModal = ({ isOpen, onClose }: FeedbackModalProps) => {
  const { t } = useTranslation();
  const [feedbackType, setFeedbackType] = useState<string>("bug");
  const [subject, setSubject] = useState<string>("");
  const [body, setBody] = useState<string>("");
  const [includeSystemInfo, setIncludeSystemInfo] = useState<boolean>(true);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [systemInfo, setSystemInfo] = useState<SystemInfo | null>(null);

  const feedbackTypes = [
    { value: "bug", label: t("feedback.types.bug") },
    { value: "feature", label: t("feedback.types.feature") },
    { value: "improvement", label: t("feedback.types.improvement") },
    { value: "other", label: t("feedback.types.other") },
  ];

  const loadSystemInfo = async () => {
    try {
      const info = await invoke<SystemInfo>("get_system_info");
      setSystemInfo(info);
    } catch (error) {
      console.error("Failed to load system info:", error);
      alert(t("feedback.systemInfoError"));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedSubject = subject.trim();
    const trimmedBody = body.trim();

    if (!trimmedSubject || !trimmedBody) {
      return;
    }

    if (trimmedSubject.length > 100 || trimmedBody.length > 1000) {
      return;
    }

    setIsSubmitting(true);
    try {
      const feedbackData: FeedbackData = {
        subject: trimmedSubject,
        body: trimmedBody,
        include_system_info: includeSystemInfo,
        feedback_type: feedbackType,
      };

      await invoke("send_feedback", { feedback: feedbackData });

      setSubject("");
      setBody("");
      onClose();
    } catch (error) {
      console.error("Failed to send feedback:", error);
      alert(t("feedback.sendError"));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleOpenGitHub = async () => {
    try {
      const trimmedSubject = subject.trim();
      const trimmedBody = body.trim();

      if (trimmedSubject.length > 100 || trimmedBody.length > 1000) {
        alert(t("feedback.lengthExceeded"));
        return;
      }

      const feedback =
        trimmedSubject && trimmedBody
          ? {
              subject: trimmedSubject,
              body: trimmedBody,
              include_system_info: includeSystemInfo,
              feedback_type: feedbackType,
            }
          : null;

      await invoke("open_github_issues", { feedback });
    } catch (error) {
      console.error("Failed to open GitHub:", error);
      alert(t("feedback.openGitHubError"));
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader className="pb-2">
          <DialogTitle>{t("feedback.title")}</DialogTitle>
          <DialogDescription className="text-xs">
            {t("feedback.description", "Share your feedback to help us improve")}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-3">
          {/* Feedback Type & Subject - Side by Side */}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="feedbackType" className="text-xs">{t("feedback.type")}</Label>
              <Select value={feedbackType} onValueChange={setFeedbackType}>
                <SelectTrigger id="feedbackType" className="h-8 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {feedbackTypes.map((type) => (
                    <SelectItem key={type.value} value={type.value} className="text-xs">
                      {type.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="subject" className="text-xs">{t("feedback.subjectRequired")}</Label>
              <Input
                id="subject"
                type="text"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder={t("feedback.subjectPlaceholder")}
                required
                className="h-8 text-xs"
              />
            </div>
          </div>

          {/* Content */}
          <div className="space-y-1.5">
            <Label htmlFor="body" className="text-xs">{t("feedback.contentRequired")}</Label>
            <Textarea
              id="body"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder={
                feedbackType === "bug"
                  ? t("feedback.placeholders.bug")
                  : feedbackType === "feature"
                  ? t("feedback.placeholders.feature")
                  : t("feedback.placeholders.default")
              }
              rows={4}
              required
              className="min-h-[100px] text-xs"
            />
          </div>

          {/* Include System Info */}
          <div className="flex items-center gap-2">
            <Switch
              id="includeSystemInfo"
              checked={includeSystemInfo}
              onCheckedChange={setIncludeSystemInfo}
            />
            <Label htmlFor="includeSystemInfo" className="cursor-pointer text-xs">
              {t("feedback.includeSystemInfo")}
            </Label>
            {includeSystemInfo && !systemInfo && (
              <Button
                type="button"
                variant="link"
                size="sm"
                onClick={loadSystemInfo}
                className="h-auto p-0 text-xs"
              >
                {t("feedback.preview")}
              </Button>
            )}
          </div>

          {/* System Info Preview */}
          {includeSystemInfo && systemInfo && (
            <div className="rounded-md border border-border bg-muted/50 p-2.5 text-xs">
              <div className="flex items-center gap-1.5 font-medium text-foreground mb-1.5">
                <InfoIcon className="h-3 w-3" />
                {t("feedback.systemInfoPreview")}
              </div>
              <div className="space-y-0.5 text-muted-foreground text-[11px]">
                <div>{t("feedback.appVersion", { version: systemInfo.app_version })}</div>
                <div>{t("feedback.os", { os: systemInfo.os_type, version: systemInfo.os_version })}</div>
                <div>{t("feedback.architecture", { arch: systemInfo.arch })}</div>
              </div>
            </div>
          )}

          {/* Action Buttons */}
          <DialogFooter className="flex-row gap-2 pt-2">
            <Button
              type="submit"
              disabled={isSubmitting || !subject.trim() || !body.trim()}
              size="sm"
              className="flex-1"
            >
              <MailIcon className="h-3.5 w-3.5" />
              {isSubmitting ? t("feedback.sendingEmail") : t("feedback.sendEmail")}
            </Button>

            <Button
              type="button"
              variant="secondary"
              onClick={handleOpenGitHub}
              size="sm"
              className="flex-1"
            >
              <GithubIcon className="h-3.5 w-3.5" />
              {t("feedback.openGitHub")}
            </Button>
          </DialogFooter>
        </form>

        {/* Help Tips - Compact */}
        <div className="rounded-md border border-border bg-card p-2.5 text-xs">
          <div className="font-medium text-foreground mb-1">
            {t("feedback.tips")}
          </div>
          <ul className="list-disc list-inside space-y-0.5 text-muted-foreground text-[11px] ml-1">
            <li>{t("feedback.tipBugReport")}</li>
            <li>{t("feedback.tipFeatureRequest")}</li>
            <li>{t("feedback.tipScreenshot")}</li>
          </ul>
        </div>
      </DialogContent>
    </Dialog>
  );
};
