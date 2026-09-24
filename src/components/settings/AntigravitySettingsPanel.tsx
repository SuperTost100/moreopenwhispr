import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { SettingsPanel, SettingsPanelRow, SettingsRow } from "../ui/SettingsSection";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";

type DictationMode = "fast" | "polished";
type TranscriptionMode = "smart" | "verbatim";

type CatalogModel = {
  id: string;
  displayName: string;
  tag?: string | null;
  supportsAudio?: boolean;
  supportsImages?: boolean;
};

interface AntigravitySettingsPanelProps {
  dictationMode: DictationMode;
  setDictationMode: (mode: DictationMode) => void;
  transcriptionMode: TranscriptionMode;
  setTranscriptionMode: (mode: TranscriptionMode) => void;
  sttModel: string;
  setSttModel: (model: string) => void;
  cleanupModel: string;
  setCleanupModel: (model: string) => void;
  chatModel: string;
  setChatModel: (model: string) => void;
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

function ModelSelectRow({
  label,
  description,
  value,
  onChange,
  models,
  filterAudio,
  automaticLabel,
}: {
  label: string;
  description: string;
  value: string;
  onChange: (value: string) => void;
  models: CatalogModel[];
  filterAudio?: boolean;
  automaticLabel: string;
}) {
  const options = useMemo(() => {
    const list = filterAudio ? models.filter((m) => m.supportsAudio) : models;
    return [{ id: "auto", displayName: automaticLabel, tag: null as string | null }, ...list];
  }, [automaticLabel, filterAudio, models]);

  const selected = options.find((m) => m.id === value) || options[0];

  return (
    <SettingsPanelRow>
      <SettingsRow label={label} description={description}>
        <Select value={value || "auto"} onValueChange={onChange}>
          <SelectTrigger className="h-7 w-52 max-w-full text-xs rounded-lg px-2.5 [&>svg]:h-3 [&>svg]:w-3">
            <SelectValue>
              {selected?.displayName}
              {selected?.tag ? ` · ${selected.tag}` : ""}
            </SelectValue>
          </SelectTrigger>
          <SelectContent>
            {options.map((model) => (
              <SelectItem key={model.id} value={model.id} className="text-xs">
                {model.displayName}
                {model.tag ? ` · ${model.tag}` : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </SettingsRow>
    </SettingsPanelRow>
  );
}

export function AntigravitySettingsPanel({
  dictationMode,
  setDictationMode,
  transcriptionMode,
  setTranscriptionMode,
  sttModel,
  setSttModel,
  cleanupModel,
  setCleanupModel,
  chatModel,
  setChatModel,
}: AntigravitySettingsPanelProps) {
  const { t } = useTranslation();
  const [catalogModels, setCatalogModels] = useState<CatalogModel[]>([]);
  const [resolverNotice, setResolverNotice] = useState<string | null>(null);

  const loadModels = useCallback(async () => {
    const response = await window.electronAPI?.antigravityListModels?.({ refresh: false });
    if (response?.models) {
      setCatalogModels(response.models as CatalogModel[]);
    }
  }, []);

  useEffect(() => {
    loadModels().catch(() => {});
  }, [loadModels]);

  useEffect(() => {
    const explicit = sttModel && sttModel !== "auto";
    if (!explicit) {
      setResolverNotice(null);
      return;
    }
    const inCatalog = catalogModels.some((m) => m.id === sttModel && m.supportsAudio);
    if (!inCatalog && catalogModels.length > 0) {
      setResolverNotice(
        t("settingsPage.transcription.antigravity.backendModel.resolverNotice", {
          model: catalogModels.find((m) => m.supportsAudio)?.displayName || sttModel,
        })
      );
    } else {
      setResolverNotice(null);
    }
  }, [catalogModels, sttModel, t]);

  const automaticLabel = t("settingsPage.transcription.antigravity.backendModel.automatic");

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
          description={t(
            "settingsPage.transcription.antigravity.transcriptionFidelity.description"
          )}
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
      <ModelSelectRow
        label={t("settingsPage.transcription.antigravity.backendModel.sttLabel")}
        description={t("settingsPage.transcription.antigravity.backendModel.sttDescription")}
        value={sttModel || "auto"}
        onChange={setSttModel}
        models={catalogModels}
        filterAudio
        automaticLabel={automaticLabel}
      />
      <ModelSelectRow
        label={t("settingsPage.transcription.antigravity.backendModel.cleanupLabel")}
        description={t("settingsPage.transcription.antigravity.backendModel.cleanupDescription")}
        value={cleanupModel || "auto"}
        onChange={setCleanupModel}
        models={catalogModels}
        automaticLabel={automaticLabel}
      />
      <ModelSelectRow
        label={t("settingsPage.transcription.antigravity.backendModel.chatLabel")}
        description={t("settingsPage.transcription.antigravity.backendModel.chatDescription")}
        value={chatModel || "auto"}
        onChange={setChatModel}
        models={catalogModels}
        automaticLabel={automaticLabel}
      />
      {resolverNotice ? (
        <p className="px-3 pb-2 text-xs text-muted-foreground">{resolverNotice}</p>
      ) : null}
    </SettingsPanel>
  );
}
