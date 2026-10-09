import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "../lib/utils";

type StatusState = "checking" | "missing" | "signedOut" | "signedIn" | "unknown";

const MESSAGE_KEYS: Record<StatusState, string> = {
  checking: "reasoning.antigravity.checking",
  missing: "reasoning.antigravity.missing",
  signedOut: "reasoning.antigravity.signedOut",
  signedIn: "reasoning.antigravity.signedIn",
  unknown: "reasoning.antigravity.unknown",
};

/**
 * Whether Antigravity will actually work: agy installed AND signed in. Finding
 * the binary alone used to read as "ready" even when `agy auth login` had
 * never run, and the first dictation was where the user found out.
 */
const TONES = {
  default: {
    text: "text-muted-foreground",
    action: "text-foreground hover:text-primary",
  },
  // Onboarding draws on its own canvas tokens, not the app's.
  onboarding: {
    text: "text-[var(--onboarding-text-secondary)]",
    action: "text-[var(--onboarding-text-primary)] hover:text-[var(--onboarding-text-secondary)]",
  },
} as const;

export function AntigravityStatus({
  className,
  variant = "default",
}: {
  className?: string;
  variant?: keyof typeof TONES;
}) {
  const { t } = useTranslation();
  const [state, setState] = useState<StatusState>("checking");
  const latest = useRef(0);

  const check = useCallback(async () => {
    const run = ++latest.current;
    setState("checking");
    let next: StatusState = "unknown";
    try {
      const status = await window.electronAPI?.antigravityStatus?.();
      if (status) next = status.state;
      else {
        // Older preload without the status call: fall back to the binary check.
        const available = await window.electronAPI?.checkAntigravityAvailable?.();
        next = available?.available ? "unknown" : "missing";
      }
    } catch {
      next = "unknown";
    }
    if (run === latest.current) setState(next);
  }, []);

  useEffect(() => {
    void check();
    return () => {
      latest.current += 1;
    };
  }, [check]);

  const isProblem = state === "missing" || state === "signedOut";
  // The onboarding card already promises "no API key"; it only needs a line
  // when something stands in the way.
  if (variant === "onboarding" && (state === "checking" || state === "signedIn")) return null;

  return (
    <p
      role="status"
      aria-live="polite"
      className={cn(
        "flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-xs",
        isProblem ? "text-destructive" : TONES[variant].text,
        className
      )}
    >
      <span>{t(MESSAGE_KEYS[state])}</span>
      {state !== "checking" && state !== "signedIn" ? (
        <button
          type="button"
          onClick={() => void check()}
          className={cn(
            "rounded-sm font-medium underline underline-offset-2 outline-none focus-visible:ring-2 focus-visible:ring-ring",
            TONES[variant].action
          )}
        >
          {t("reasoning.antigravity.checkAgain")}
        </button>
      ) : null}
    </p>
  );
}
