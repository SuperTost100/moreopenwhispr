import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { SettingsPanel, SettingsPanelRow, SettingsRow } from "../ui/SettingsSection";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";
import { RefreshCw } from "../icons";

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
  label,
}: {
  value: T;
  options: { id: T; label: string }[];
  onChange: (value: T) => void;
  label: string;
}) {
  // Same track, indicator and padding as ActivationModeSelector (Tap / Hold):
  // two equal grid columns, so the indicator covers exactly one option and
  // one full-width translate (mirrored in RTL) moves it to the other.
  return (
    <div
      role="group"
      aria-label={label}
      className="relative grid grid-cols-2 rounded-md border p-0.5 bg-surface-1 border-border-subtle"
    >
      <div
        className={`absolute inset-y-0.5 start-0.5 w-[calc(50%-2px)] rounded border bg-surface-raised border-border-subtle transition-transform duration-200 ease-out ${
          value === options[1].id ? "translate-x-full rtl:-translate-x-full" : "translate-x-0"
        }`}
      />
      {options.map(({ id, label }) => (
        <button
          key={id}
          type="button"
          aria-pressed={value === id}
          onClick={() => onChange(id)}
          className={`relative z-10 flex items-center justify-center whitespace-nowrap rounded px-3.5 py-1.5 text-xs font-medium transition-colors duration-150 cursor-pointer ${
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
    const all = [{ id: "auto", displayName: automaticLabel, tag: null as string | null }, ...list];
    // A pick that is no longer in the catalog stays listed under its own id;
    // showing "Automatic" for it would hide which model requests really use.
    if (value && value !== "auto" && !all.some((m) => m.id === value)) {
      all.push({ id: value, displayName: value, tag: null });
    }
    return all;
  }, [automaticLabel, filterAudio, models, value]);

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
  const [refreshing, setRefreshing] = useState(false);
  const [refreshFailed, setRefreshFailed] = useState(false);

  const loadModels = useCallback(async (refresh: boolean) => {
    const response = await window.electronAPI?.antigravityListModels?.({ refresh });
    if (response?.models) {
      setCatalogModels(response.models as CatalogModel[]);
    }
    return response;
  }, []);

  useEffect(() => {
    loadModels(false).catch(() => {});
  }, [loadModels]);

  const refreshModels = useCallback(async () => {
    setRefreshing(true);
    setRefreshFailed(false);
    try {
      const response = await loadModels(true);
      setRefreshFailed(!response || Boolean(response.refreshError));
    } catch {
      setRefreshFailed(true);
    } finally {
      setRefreshing(false);
    }
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
            label={t("settingsPage.transcription.antigravity.dictationStyle.label")}
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
            label={t("settingsPage.transcription.antigravity.transcriptionFidelity.label")}
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
      <SettingsPanelRow>
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
          <p className="min-w-0 flex-1 text-xs text-muted-foreground" role="status">
            {refreshFailed
              ? t("settingsPage.transcription.antigravity.backendModel.refreshFailed")
              : resolverNotice}
          </p>
          <button
            type="button"
            onClick={() => void refreshModels()}
            disabled={refreshing}
            className="inline-flex h-7 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md border border-border bg-card px-2.5 text-xs font-medium text-foreground outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default disabled:opacity-60"
          >
            <RefreshCw
              size={12}
              className={refreshing ? "animate-spin" : undefined}
              aria-hidden="true"
            />
            {refreshing
              ? t("settingsPage.transcription.antigravity.backendModel.refreshing")
              : t("settingsPage.transcription.antigravity.backendModel.refresh")}
          </button>
        </div>
      </SettingsPanelRow>
    </SettingsPanel>
  );
}
