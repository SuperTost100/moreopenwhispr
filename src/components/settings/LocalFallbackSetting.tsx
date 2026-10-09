import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { SettingsPanel, SettingsPanelRow, SettingsRow } from "../ui/SettingsSection";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";
import { Toggle } from "../ui/toggle";
import { getWhisperModelInfo } from "../../models/ModelRegistry";
import { useSettings } from "../../hooks/useSettings";

/**
 * Cloud transcription can retry a failed recording with a downloaded Whisper
 * model (audioManager's allowLocalFallback path), which is what keeps
 * dictation working when an Antigravity quota runs out. Only downloaded
 * models are offered, since a missing one would make the fallback fail too.
 */
export function LocalFallbackSetting() {
  const { t } = useTranslation();
  const {
    allowLocalFallback,
    setAllowLocalFallback,
    fallbackWhisperModel,
    setFallbackWhisperModel,
  } = useSettings();
  const [downloaded, setDownloaded] = useState<string[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    window.electronAPI
      ?.listWhisperModels?.()
      .then((result) => {
        if (cancelled) return;
        const models = Array.isArray(result?.models) ? result.models : [];
        setDownloaded(
          models
            .filter((m: { downloaded?: boolean }) => m.downloaded)
            .map((m: { model: string }) => m.model)
        );
      })
      .catch(() => {
        if (!cancelled) setDownloaded([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // A saved model that was deleted since falls back to the first one left.
  const fallbackModel =
    downloaded && !downloaded.includes(fallbackWhisperModel) ? downloaded[0] : fallbackWhisperModel;
  useEffect(() => {
    if (fallbackModel && fallbackModel !== fallbackWhisperModel) {
      setFallbackWhisperModel(fallbackModel);
    }
  }, [fallbackModel, fallbackWhisperModel, setFallbackWhisperModel]);

  const noModels = downloaded !== null && downloaded.length === 0;
  const label = t("settingsPage.transcription.localFallback.label");

  return (
    <SettingsPanel>
      <SettingsPanelRow>
        <SettingsRow
          label={label}
          description={
            noModels
              ? t("settingsPage.transcription.localFallback.noModels")
              : t("settingsPage.transcription.localFallback.description")
          }
        >
          <Toggle
            checked={allowLocalFallback && !noModels}
            onChange={setAllowLocalFallback}
            disabled={noModels || downloaded === null}
            ariaLabel={label}
          />
        </SettingsRow>
      </SettingsPanelRow>
      {allowLocalFallback && downloaded && downloaded.length > 0 && (
        <SettingsPanelRow>
          <SettingsRow
            label={t("settingsPage.transcription.localFallback.model")}
            description={t("settingsPage.transcription.localFallback.modelDescription")}
          >
            <Select value={fallbackModel} onValueChange={setFallbackWhisperModel}>
              <SelectTrigger className="h-7 w-52 max-w-full text-xs rounded-lg px-2.5 [&>svg]:h-3 [&>svg]:w-3">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {downloaded.map((id) => {
                  const info = getWhisperModelInfo(id);
                  return (
                    <SelectItem key={id} value={id} className="text-xs">
                      {info ? `Whisper ${info.name} · ${info.size}` : id}
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
          </SettingsRow>
        </SettingsPanelRow>
      )}
    </SettingsPanel>
  );
}
