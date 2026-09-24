import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Check } from "../icons";
import { cn } from "../lib/utils";
import { Button } from "../ui/button";
import type { ActionProcessingState } from "../../hooks/useActionProcessing";
import type { NoteActionProgress } from "../../stores/actionProcessingStore";

interface ActionProcessingOverlayProps {
  state: ActionProcessingState;
  actionName: string | null;
  /** Set while a long note is summarised in parts. */
  progress?: NoteActionProgress | null;
  /** Offered while processing: a run in parts takes minutes, and only quitting stopped it before. */
  onCancel?: () => void;
}

export default function ActionProcessingOverlay({
  state,
  actionName,
  progress = null,
  onCancel,
}: ActionProcessingOverlayProps) {
  const { t } = useTranslation();
  // A mount mid-run is a note switch (NoteEditor is keyed by note id); the
  // overlay must show without waiting for a state change that already happened.
  const [visible, setVisible] = useState(state !== "idle");
  const [prevState, setPrevState] = useState(state);

  if (state !== prevState) {
    setPrevState(state);
    if (state === "processing" || state === "success") {
      setVisible(true);
    }
  }

  useEffect(() => {
    if (state !== "idle") return;
    const id = setTimeout(() => setVisible(false), 300);
    return () => clearTimeout(id);
  }, [state]);

  if (!visible) return null;

  const isSuccess = state === "success";
  const isFadingOut = state === "idle";

  return (
    <div
      className={cn(
        "absolute inset-0 z-[5] flex items-center justify-center",
        "bg-background/80",
        "transition-opacity duration-300",
        isFadingOut && "opacity-0 pointer-events-none"
      )}
      style={!isFadingOut ? { animation: "float-up 0.25s ease-out" } : undefined}
    >
      <div
        className={cn(
          "absolute left-0 right-0 h-px pointer-events-none",
          isSuccess ? "bg-success/50" : "bg-primary/40"
        )}
        style={{
          animation: isSuccess ? "none" : "scanner-sweep 2.5s ease-in-out infinite",
          ...(isSuccess ? { top: "50%" } : {}),
        }}
      />

      <div
        className={cn(
          "relative flex flex-col items-center gap-2.5",
          isSuccess ? "bg-success-soft border border-success/30" : "bg-card border border-border",
          "rounded-xl px-6 py-3 shadow-elevated",
          "transition-colors duration-300"
        )}
      >
        {isSuccess ? (
          <div className="flex items-center gap-2">
            <Check size={13} className="text-success/70" />
            <span className="text-xs font-medium text-success/70 tracking-tight">
              {t("notes.actions.done")}
            </span>
          </div>
        ) : (
          <>
            <span className="text-xs font-medium text-primary tracking-tight">{actionName}</span>
            {progress ? (
              <span className="text-[11px] text-muted-foreground tracking-tight">
                {t("notes.actions.chunkProgress", { step: progress.step, total: progress.total })}
              </span>
            ) : null}
            <div className="w-32 h-0.5 bg-muted rounded-full overflow-hidden">
              <div
                className="h-full w-1/3 bg-primary/50 rounded-full"
                style={{ animation: "indeterminate 1.5s ease-in-out infinite" }}
                data-scanner-progress=""
              />
            </div>
            {onCancel ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={onCancel}
                className="h-6 px-2 text-[11px] text-muted-foreground hover:text-foreground hover:bg-muted"
              >
                {t("common.cancel")}
              </Button>
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
