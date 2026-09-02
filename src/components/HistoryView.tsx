import { Fragment, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "./ui/button";
import { Loader2, Sparkles, Cloud, X, Trash2, Archive } from "lucide-react";
import TranscriptionItem from "./ui/TranscriptionItem";
import type { TranscriptionItem as TranscriptionItemType } from "../types/electron";
import { formatHotkeyLabel, parseHotkeyList } from "../utils/hotkeys";
import { formatDateGroup } from "../utils/dateFormatting";
import { useUpcomingEvents } from "../hooks/useUpcomingEvents";
import UpcomingMeetings from "./UpcomingMeetings";
import ConfiguredProcessingRoute from "./control-panel/ConfiguredProcessingRoute";
import { useSettingsStore } from "../stores/settingsStore";
import { effectiveLocalHistoryEnabled } from "../stores/policyRules";
import { usePolicyStore } from "../stores/policyStore";

interface HistoryViewProps {
  history: TranscriptionItemType[];
  isLoading: boolean;
  hotkey: string;
  showCloudMigrationBanner: boolean;
  setShowCloudMigrationBanner: (show: boolean) => void;
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
}

export default function HistoryView({
  history,
  isLoading,
  hotkey,
  showCloudMigrationBanner,
  setShowCloudMigrationBanner,
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
  const personalDataRetentionEnabled = useSettingsStore((s) => s.dataRetentionEnabled);
  const dataRetentionEnabled = usePolicyStore((policyState) =>
    effectiveLocalHistoryEnabled(policyState, personalDataRetentionEnabled)
  );
  const { events, isLoading: eventsLoading, isConnected } = useUpcomingEvents();

  const groupedHistory = useMemo(() => {
    if (history.length === 0) return [];

    const groups: { label: string; items: TranscriptionItemType[] }[] = [];
    let currentLabel: string | null = null;

    for (const item of history) {
      const label = formatDateGroup(item.timestamp, t);

      if (label !== currentLabel) {
        groups.push({ label, items: [item] });
        currentLabel = label;
      } else {
        groups[groups.length - 1].items.push(item);
      }
    }

    return groups;
  }, [history, t]);

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

        {showCloudMigrationBanner && (
          <div className="cp-history__banner cp-history__banner--info">
            <button
              type="button"
              onClick={() => {
                setShowCloudMigrationBanner(false);
                localStorage.setItem("cloudMigrationShown", "true");
              }}
              aria-label={t("common.close")}
              className="cp-history__banner-dismiss"
            >
              <X size={16} aria-hidden="true" />
            </button>
            <div className="cp-history__banner-body">
              <div className="cp-history__banner-icon" aria-hidden="true">
                <Cloud size={16} />
              </div>
              <div className="cp-history__banner-copy">
                <p className="cp-history__banner-title">{t("controlPanel.cloudMigration.title")}</p>
                <p className="cp-history__banner-description">
                  {t("controlPanel.cloudMigration.description")}
                </p>
                <Button
                  variant="default"
                  size="sm"
                  className="cp-history__banner-action"
                  onClick={() => {
                    setShowCloudMigrationBanner(false);
                    localStorage.setItem("cloudMigrationShown", "true");
                    onOpenSettings("transcription");
                  }}
                >
                  {t("controlPanel.cloudMigration.viewSettings")}
                </Button>
              </div>
            </div>
          </div>
        )}

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
                <div className="cp-history__empty-state">
                  <svg
                    className="cp-history__empty-art"
                    width="64"
                    height="64"
                    viewBox="0 0 64 64"
                    fill="none"
                    aria-hidden="true"
                  >
                    <rect
                      x="24"
                      y="6"
                      width="16"
                      height="28"
                      rx="8"
                      fill="currentColor"
                      fillOpacity={0.04}
                      stroke="currentColor"
                      strokeOpacity={0.1}
                    />
                    <rect
                      x="28"
                      y="12"
                      width="8"
                      height="3"
                      rx="1.5"
                      fill="currentColor"
                      fillOpacity={0.06}
                    />
                    <path
                      d="M18 28c0 7.7 6.3 14 14 14s14-6.3 14-14"
                      fill="none"
                      stroke="currentColor"
                      strokeOpacity={0.07}
                      strokeWidth={1.5}
                      strokeLinecap="round"
                    />
                    <line
                      x1="32"
                      y1="42"
                      x2="32"
                      y2="50"
                      stroke="currentColor"
                      strokeOpacity={0.07}
                      strokeWidth={1.5}
                      strokeLinecap="round"
                    />
                    <line
                      x1="26"
                      y1="50"
                      x2="38"
                      y2="50"
                      stroke="currentColor"
                      strokeOpacity={0.07}
                      strokeWidth={1.5}
                      strokeLinecap="round"
                    />
                    <path
                      d="M12 20a2 2 0 0 1 0 8"
                      stroke="currentColor"
                      strokeOpacity={0.04}
                      strokeWidth={1.5}
                      strokeLinecap="round"
                    />
                    <path
                      d="M8 18a2 2 0 0 1 0 12"
                      stroke="currentColor"
                      strokeOpacity={0.03}
                      strokeWidth={1.5}
                      strokeLinecap="round"
                    />
                    <path
                      d="M52 20a2 2 0 0 0 0 8"
                      stroke="currentColor"
                      strokeOpacity={0.04}
                      strokeWidth={1.5}
                      strokeLinecap="round"
                    />
                    <path
                      d="M56 18a2 2 0 0 0 0 12"
                      stroke="currentColor"
                      strokeOpacity={0.03}
                      strokeWidth={1.5}
                      strokeLinecap="round"
                    />
                  </svg>
                  <h3 className="cp-history__empty-title">{t("controlPanel.history.empty")}</h3>
                  <div className="cp-history__empty-hint">
                    <span>{t("controlPanel.history.press")}</span>
                    {parseHotkeyList(hotkey).map((hk, index) => (
                      <Fragment key={hk}>
                        {index > 0 && <span className="cp-history__empty-sep">/</span>}
                        <kbd className="cp-history__hotkey">{formatHotkeyLabel(hk)}</kbd>
                      </Fragment>
                    ))}
                    <span>{t("controlPanel.history.toStart")}</span>
                  </div>
                </div>
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

          <aside className="cp-history__meetings" aria-label={t("upcoming.title")}>
            <div className="cp-history__meetings-sticky">
              <UpcomingMeetings
                events={events}
                isLoading={eventsLoading}
                isConnected={isConnected}
                onConnectCalendar={onOpenIntegrations}
              />
            </div>
          </aside>
        </div>
      </div>
    </section>
  );
}
