import { Fragment, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "./lib/utils";
import { useUiLocale } from "../hooks/useUiLocale";
import { Button } from "./ui/button";
import { Loader2, Sparkles, X, Mic, Trash2, Archive } from "./icons";
import TranscriptionItem from "./ui/TranscriptionItem";
import EmptyStateCard from "./ui/EmptyStateCard";
import type { TranscriptionItem as TranscriptionItemType } from "../types/electron";
import { formatHotkeyLabel, parseHotkeyList } from "../utils/hotkeys";
import { formatDateGroup } from "../utils/dateFormatting";
import { useUpcomingEvents } from "../hooks/useUpcomingEvents";
import UpcomingMeetings from "./UpcomingMeetings";
import { useCalendarProvidersConfigured } from "../hooks/useCalendarProvidersConfigured";
import ConfiguredProcessingRoute from "./control-panel/ConfiguredProcessingRoute";
import { useSettingsStore } from "../stores/settingsStore";
import { effectiveLocalHistoryEnabled } from "../stores/policyRules";
import { usePolicyStore } from "../stores/policyStore";

const EMPTY_PREVIEW_WIDTHS = ["w-full", "w-4/5", "w-3/5"];

interface HistoryViewProps {
  history: TranscriptionItemType[];
  isLoading: boolean;
  hotkey: string;
  aiCTADismissed: boolean;
  setAiCTADismissed: (dismissed: boolean) => void;
  useCleanupModel: boolean;
  copyToClipboard: (text: string) => void;
  deleteTranscription: (id: number) => void;
  clearAllTranscriptions: () => void;
  onOpenSettings: (section?: string) => void;
  onOpenIntegrations: () => void;
  onShowAudioInFolder: (id: number) => void;
  onRetryTranscription: (id: number, options?: { isRecover?: boolean }) => Promise<void>;
  showDiscarded: boolean;
  onToggleDiscarded: () => void;
  /** Passed by upstream's ControlPanel for its account greeting; unused without accounts. */
  userName?: string | null;
}

export default function HistoryView({
  history,
  isLoading,
  hotkey,
  aiCTADismissed,
  setAiCTADismissed,
  useCleanupModel,
  copyToClipboard,
  deleteTranscription,
  clearAllTranscriptions,
  onOpenSettings,
  onOpenIntegrations,
  onShowAudioInFolder,
  onRetryTranscription,
  showDiscarded,
  onToggleDiscarded,
}: HistoryViewProps) {
  const { t } = useTranslation();
  const locale = useUiLocale();
  const personalDataRetentionEnabled = useSettingsStore((s) => s.dataRetentionEnabled);
  const dataRetentionEnabled = usePolicyStore((policyState) =>
    effectiveLocalHistoryEnabled(policyState, personalDataRetentionEnabled)
  );
  const { events, isLoading: eventsLoading, isConnected } = useUpcomingEvents();
  const calendarProviders = useCalendarProvidersConfigured();
  // Without a calendar this build can connect, "Connect your calendar" would
  // lead to an empty Integrations page, so the column stays hidden.
  const canConnectCalendar =
    calendarProviders.google ||
    calendarProviders.microsoft ||
    window.electronAPI?.getPlatform?.() === "darwin";

  const groupedHistory = useMemo(() => {
    if (history.length === 0) return [];

    const groups: { label: string; items: TranscriptionItemType[] }[] = [];
    let currentLabel: string | null = null;

    for (const item of history) {
      const label = formatDateGroup(item.timestamp, t, locale);

      if (label !== currentLabel) {
        groups.push({ label, items: [item] });
        currentLabel = label;
      } else {
        groups[groups.length - 1].items.push(item);
      }
    }

    return groups;
  }, [history, t, locale]);

  const historyToolbar = (
    <div
      className="cp-history__toolbar"
      role="toolbar"
      aria-label={t("controlPanel.history.toolbarLabel")}
    >
      <button type="button" onClick={onToggleDiscarded} className="cp-history__toolbar-btn">
        <Archive size={16} aria-hidden="true" />
        <span>
          {showDiscarded
            ? t("controlPanel.history.discarded.hide")
            : t("controlPanel.history.discarded.show")}
        </span>
      </button>
      {history.length > 0 && (
        <button
          type="button"
          onClick={clearAllTranscriptions}
          className="cp-history__toolbar-btn cp-history__toolbar-btn--destructive"
        >
          <Trash2 size={16} aria-hidden="true" />
          <span>{t("controlPanel.history.clearAll")}</span>
        </button>
      )}
    </div>
  );

  return (
    <section className="cp-history" aria-labelledby="cp-history-page-title">
      <div className="cp-history__inner">
        <header className="cp-history__page-head">
          <h1 id="cp-history-page-title" className="cp-history__page-title">
            {t("controlPanel.history.pageTitle")}
          </h1>
          <p className="cp-history__page-subtitle">{t("controlPanel.history.pageSubtitle")}</p>
        </header>

        {!useCleanupModel && !aiCTADismissed && (
          <div className="cp-history__banner cp-history__banner--info">
            <button
              type="button"
              onClick={() => {
                localStorage.setItem("aiCTADismissed", "true");
                setAiCTADismissed(true);
              }}
              aria-label={t("common.close")}
              className="cp-history__banner-dismiss"
            >
              <X size={16} aria-hidden="true" />
            </button>
            <div className="cp-history__banner-body">
              <div className="cp-history__banner-icon" aria-hidden="true">
                <Sparkles size={16} />
              </div>
              <div className="cp-history__banner-copy">
                <p className="cp-history__banner-title">{t("controlPanel.aiCta.title")}</p>
                <p className="cp-history__banner-description">
                  {t("controlPanel.aiCta.description")}
                </p>
                <Button
                  variant="default"
                  size="sm"
                  className="cp-history__banner-action"
                  onClick={() => onOpenSettings("intelligence")}
                >
                  {t("controlPanel.aiCta.enable")}
                </Button>
              </div>
            </div>
          </div>
        )}

        <ConfiguredProcessingRoute />

        <div className="cp-history__layout">
          <section className="cp-history__main" aria-labelledby="cp-history-recent-title">
            <header className="cp-history__list-head">
              <h2 id="cp-history-recent-title" className="cp-history__list-title">
                {t("controlPanel.history.recentTitle")}
              </h2>
              {historyToolbar}
            </header>

            {!dataRetentionEnabled && (
              <div className="cp-history__retention-warning" role="status">
                <span className="cp-history__retention-icon" aria-hidden="true">
                  ⊘
                </span>
                <p>{t("controlPanel.history.dataRetentionDisabled")}</p>
              </div>
            )}

            {isLoading && history.length === 0 ? (
              <div className="cp-history__panel cp-history__panel--loading">
                <div className="cp-history__panel-center">
                  <Loader2 size={16} className="cp-history__spinner" aria-hidden="true" />
                  <span>{t("controlPanel.loading")}</span>
                </div>
              </div>
            ) : history.length === 0 ? (
              <div className="cp-history__panel cp-history__panel--empty">
                <EmptyStateCard
                  icon={Mic}
                  title={t("controlPanel.history.empty")}
                  description={t("controlPanel.history.emptyDescription")}
                >
                  {/* Ghost rows preview the list this card becomes. */}
                  <div aria-hidden="true" className="mb-1 w-56 space-y-2">
                    {EMPTY_PREVIEW_WIDTHS.map((width) => (
                      <span key={width} className={cn("block h-2 rounded-full bg-muted", width)} />
                    ))}
                  </div>
                  <span className="inline-flex h-[30px] items-center gap-1.5 rounded-full bg-surface-3 px-3 text-xs font-medium text-foreground/70 dark:bg-surface-3">
                    {t("controlPanel.history.press")}
                    <span dir="ltr" className="inline-flex items-center gap-1">
                      {parseHotkeyList(hotkey).map((hk, index) => (
                        <Fragment key={hk}>
                          {index > 0 && <span className="text-foreground/45">/</span>}
                          <kbd className="rounded-md bg-background px-1.5 py-px font-sans text-[11px] font-medium text-foreground/80 shadow-sm dark:bg-surface-2">
                            {formatHotkeyLabel(hk)}
                          </kbd>
                        </Fragment>
                      ))}
                    </span>
                    {t("controlPanel.history.toStart")}
                  </span>
                </EmptyStateCard>
              </div>
            ) : (
              <div className="cp-history__groups">
                {groupedHistory.map((group, index) => (
                  <section
                    key={group.label}
                    className="cp-history__group"
                    aria-labelledby={`cp-history-date-${index}`}
                  >
                    <div className="cp-history__date-head">
                      <h3 id={`cp-history-date-${index}`} className="cp-history__date-label">
                        {group.label}
                      </h3>
                    </div>
                    <div className="cp-history__items">
                      {group.items.map((item) => (
                        <TranscriptionItem
                          key={item.id}
                          item={item}
                          onCopy={copyToClipboard}
                          onDelete={deleteTranscription}
                          onShowAudioInFolder={onShowAudioInFolder}
                          onRetryTranscription={onRetryTranscription}
                          onOpenSettings={() => onOpenSettings("transcription")}
                        />
                      ))}
                    </div>
                  </section>
                ))}
              </div>
            )}
          </section>

          {(isConnected || canConnectCalendar) && (
            <aside className="cp-history__meetings" aria-labelledby="cp-history-upcoming-title">
              <div className="cp-history__meetings-sticky">
                {/* Same header box as "Recent dictations", so both titles share a baseline. */}
                <header className="cp-history__list-head">
                  <h2 id="cp-history-upcoming-title" className="cp-history__list-title">
                    {t("upcoming.title")}
                  </h2>
                </header>
                <UpcomingMeetings
                  events={events}
                  isLoading={eventsLoading}
                  isConnected={isConnected}
                  onConnectCalendar={onOpenIntegrations}
                />
              </div>
            </aside>
          )}
        </div>
      </div>
    </section>
  );
}
