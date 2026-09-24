import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { ProviderIcon } from "../ui/ProviderIcon";
import type { ProviderTabItem } from "../ui/ProviderTabs";
import { cn } from "../lib/utils";

interface SettingsProviderChipsProps {
  providers: ProviderTabItem[];
  selectedId: string;
  onSelect: (id: string) => void;
  renderIcon?: (providerId: string) => ReactNode;
  /** Use a responsive grid when there are many providers (cloud STT / LLM lists). */
  layout?: "grid" | "row";
}

export function SettingsProviderChips({
  providers,
  selectedId,
  onSelect,
  renderIcon,
  layout = "row",
}: SettingsProviderChipsProps) {
  const { t } = useTranslation();

  return (
    <div
      className={cn(
        "w-full gap-2",
        layout === "grid"
          ? "grid grid-cols-[repeat(auto-fill,minmax(min(100%,7.75rem),1fr))]"
          : "flex flex-wrap"
      )}
    >
      {providers.map((provider) => {
        const isSelected = selectedId === provider.id;
        const isDisabled = !!provider.disabled;

        return (
          <button
            key={provider.id}
            type="button"
            disabled={isDisabled}
            aria-disabled={isDisabled}
            title={isDisabled ? provider.disabledLabel : undefined}
            onClick={() => {
              if (isDisabled) return;
              onSelect(provider.id);
            }}
            className={cn(
              "flex min-h-9 items-center justify-center gap-1.5 rounded-md border px-2.5 py-2 text-xs font-medium transition-colors duration-150",
              layout === "row" && "min-w-[7.75rem] flex-1",
              isDisabled
                ? "cursor-not-allowed border-border bg-muted/40 text-muted-foreground opacity-60"
                : isSelected
                  ? "border-primary bg-primary-soft text-foreground [&_svg]:text-primary"
                  : "border-border bg-card text-muted-foreground hover:bg-muted hover:text-foreground"
            )}
          >
            {renderIcon ? renderIcon(provider.id) : <ProviderIcon provider={provider.id} />}
            <span className="truncate">{provider.name}</span>
            {provider.recommended && (
              <span className="text-[10px] font-medium text-primary/80 shrink-0">
                {t("common.recommended")}
              </span>
            )}
            {isDisabled && provider.disabledLabel && (
              <span className="text-[10px] text-muted-foreground shrink-0">
                {provider.disabledLabel}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
