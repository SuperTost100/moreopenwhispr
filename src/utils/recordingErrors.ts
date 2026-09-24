import { TFunction } from "i18next";

type RecordingError = {
  code?: string;
  title: string;
  description?: string;
  messageKey?: string;
  /** Toast variant; defaults to destructive for genuine failures. */
  variant?: "default" | "destructive";
  resetTime?: string;
};

export function getRecordingErrorTitle(error: RecordingError, t: TFunction): string {
  if (error.code?.startsWith("SELECTION_EDIT_")) {
    return t("hooks.audioRecording.selectionEditing.notAppliedTitle");
  }
  if (error.code === "NETWORK_ERROR") return t(error.title);
  if (error.code === "AUTH_EXPIRED" || error.code === "AUTH_REQUIRED") {
    return t("hooks.audioRecording.errorTitles.sessionExpired");
  }
  if (error.code === "AGY_AUTH_REQUIRED") {
    return t("hooks.audioRecording.errorTitles.antigravityAuthRequired");
  }
  if (error.code === "AGY_TIMEOUT") {
    return t("hooks.audioRecording.errorTitles.antigravityTimeout");
  }
  if (error.code === "AGY_MODEL_UNAVAILABLE") {
    return t("hooks.audioRecording.errorTitles.antigravityModelUnavailable");
  }
  if (error.code === "OFFLINE") return t("hooks.audioRecording.errorTitles.offline");
  if (error.code === "AGENT_REASONING_FAILED") {
    return t("hooks.audioRecording.errorTitles.agentUnavailable");
  }
  if (error.code === "SCREEN_CONTEXT_SKIPPED") {
    return t("hooks.audioRecording.errorTitles.screenContextSkipped");
  }
  if (error.code === "LIMIT_REACHED")
    return t("hooks.audioRecording.errorTitles.dailyLimitReached");
  if (error.code === "PROVIDER_RATE_LIMITED")
    return t("hooks.audioRecording.errorTitles.providerRateLimited");
  if (error.code === "QUOTA_EXCEEDED" || error.code === "AGY_RATE_LIMITED") {
    return t("hooks.audioRecording.errorTitles.antigravityQuotaExceeded");
  }
  return error.title;
}

export function getRecordingErrorDescription(error: RecordingError, t: TFunction): string {
  if (error.code === "AGY_AUTH_REQUIRED") {
    return t("hooks.audioRecording.errorDescriptions.antigravityAuthRequired");
  }
  if (error.code === "AGY_TIMEOUT") {
    return t("hooks.audioRecording.errorDescriptions.antigravityTimeout");
  }
  if (error.code === "AGY_MODEL_UNAVAILABLE") {
    return t("hooks.audioRecording.errorDescriptions.antigravityModelUnavailable");
  }
  if (
    error.code === "QUOTA_EXCEEDED" ||
    (error.code === "AGY_RATE_LIMITED" && error.messageKey?.includes("antigravityQuota"))
  ) {
    return t("hooks.audioRecording.errorDescriptions.antigravityQuotaExceeded", {
      resetTime: error.resetTime ? formatResetTime(error.resetTime, t) : "",
    });
  }
  if (error.messageKey) return t(error.messageKey);
  return error.description ?? "";
}

function formatResetTime(iso: string, t: TFunction): string {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return iso;
  return t("hooks.audioRecording.errorDescriptions.antigravityQuotaResetAt", {
    time: new Date(ms).toLocaleString(),
  });
}
