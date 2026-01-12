import i18n, { languageLocaleMap } from "../i18n";

// 현재 언어에 따른 로케일 반환
export const getLocale = (language: string): string => {
  return languageLocaleMap[language] || "en-US";
};

export const formatTime = (timestamp: string): string => {
  const date = new Date(timestamp);
  const currentLanguage = i18n.language || "en";
  const locale = getLocale(currentLanguage);

  return date.toLocaleString(locale, {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
};

export const formatTimeShort = (timestamp: string): string => {
  const date = new Date(timestamp);
  const currentLanguage = i18n.language || "en";
  const locale = getLocale(currentLanguage);

  return date.toLocaleTimeString(locale, {
    hour: "numeric",
    minute: "2-digit",
  });
};

export const formatDuration = (minutes: number): string => {
  if (minutes < 1) {
    return i18n.t("time.lessThanMinute", { ns: "components" });
  }

  const days = Math.floor(minutes / (60 * 24));
  const hours = Math.floor((minutes % (60 * 24)) / 60);
  const mins = Math.floor(minutes % 60);

  const parts: string[] = [];

  if (days > 0) {
    const unit = days === 1 ? i18n.t("time.day", { ns: "components" }) : i18n.t("time.days", { ns: "components" });
    parts.push(`${days} ${unit}`);
  }

  if (hours > 0) {
    const unit = hours === 1 ? i18n.t("time.hour", { ns: "components" }) : i18n.t("time.hours", { ns: "components" });
    parts.push(`${hours} ${unit}`);
  }

  if (mins > 0) {
    const unit = mins === 1 ? i18n.t("time.minute", { ns: "components" }) : i18n.t("time.minutes", { ns: "components" });
    parts.push(`${mins} ${unit}`);
  }

  return parts.join(" ");
};
