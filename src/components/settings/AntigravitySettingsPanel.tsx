import { useTranslation } from "react-i18next";
import { SettingsPanel, SettingsPanelRow, SettingsRow } from "../ui/SettingsSection";

type DictationMode = "fast" | "polished";
type TranscriptionMode = "smart" | "verbatim";

interface AntigravitySettingsPanelProps {
  dictationMode: DictationMode;
  setDictationMode: (mode: DictationMode) => void;
  transcriptionMode: TranscriptionMode;
  setTranscriptionMode: (mode: TranscriptionMode) => void;
}

function TwoOptionSelector<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { id: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <div className="relative flex rounded-md border p-0.5 bg-surface-1 border-border-subtle">
      <div
        className={`absolute top-0.5 bottom-0.5 w-[calc(50%-2px)] rounded bg-surface-raised border border-border-subtle transition-transform duration-200 ease-out ${
          value === options[1].id ? "translate-x-[calc(100%+4px)]" : "translate-x-0"
        }`}
      />
      {options.map(({ id, label }) => (
        <button
          key={id}
          type="button"
          onClick={() => onChange(id)}
          className={`relative z-10 flex-1 rounded px-2.5 py-1 text-xs font-medium transition-colors duration-150 cursor-pointer ${
            value === id ? "text-foreground" : "text-muted-foreground hover:text-foreground"
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

export function AntigravitySettingsPanel({
  dictationMode,
  setDictationMode,
  transcriptionMode,
  setTranscriptionMode,
}: AntigravitySettingsPanelProps) {
  const { t } = useTranslation();

  return (
    <SettingsPanel>
      <SettingsPanelRow>
        <SettingsRow
          label={t("settingsPage.transcription.antigravity.dictationStyle.label")}
          description={t("settingsPage.transcription.antigravity.dictationStyle.description")}
        >
          <TwoOptionSelector
            value={dictationMode}
            onChange={setDictationMode}
            options={[
              {
                id: "fast",
                label: t("settingsPage.transcription.antigravity.dictationStyle.fast"),
              },
              {
                id: "polished",
                label: t("settingsPage.transcription.antigravity.dictationStyle.polished"),
              },
            ]}
          />
        </SettingsRow>
      </SettingsPanelRow>
      <SettingsPanelRow>
        <SettingsRow
          label={t("settingsPage.transcription.antigravity.transcriptionFidelity.label")}
          description={t("settingsPage.transcription.antigravity.transcriptionFidelity.description")}
        >
          <TwoOptionSelector
            value={transcriptionMode}
            onChange={setTranscriptionMode}
            options={[
              {
                id: "smart",
                label: t("settingsPage.transcription.antigravity.transcriptionFidelity.smart"),
              },
              {
                id: "verbatim",
                label: t("settingsPage.transcription.antigravity.transcriptionFidelity.verbatim"),
              },
            ]}
          />
        </SettingsRow>
      </SettingsPanelRow>
    </SettingsPanel>
  );
}
