export type ColorScheme = "purple" | "blue";

export interface ModelPickerStyles {
  container: string;
  header: string;
  modelCard: { selected: string; default: string };
  badges: { selected: string; downloaded: string; recommended: string };
  buttons: { download: string; select: string; delete: string; refresh: string };
}

const FLAT_CARD = {
  selected: "border-primary bg-primary-soft",
  default:
    "border-border bg-card hover:border-border-hover hover:bg-muted transition-colors duration-150",
};

export const MODEL_PICKER_COLORS: Record<ColorScheme, ModelPickerStyles> = {
  purple: {
    container: "rounded-lg overflow-hidden border border-border bg-card",
    header: "font-medium text-foreground tracking-tight",
    modelCard: FLAT_CARD,
    badges: {
      selected:
        "text-[10px] text-primary-foreground bg-primary px-1.5 py-0.5 rounded-sm font-medium",
      downloaded:
        "text-[10px] text-success dark:text-success bg-success-soft px-1.5 py-0.5 rounded-sm",
      recommended: "text-[10px] text-primary bg-primary-soft px-1.5 py-0.5 rounded-sm font-medium",
    },
    buttons: {
      download: "",
      select: "border-primary/25 text-primary hover:bg-primary-soft",
      delete:
        "text-destructive hover:text-destructive/90 hover:bg-destructive-soft border-destructive/25",
      refresh: "border-primary/25 text-primary hover:bg-primary-soft",
    },
  },
  blue: {
    container: "rounded-lg overflow-hidden border border-border bg-card",
    header: "text-sm font-medium text-foreground tracking-tight",
    modelCard: FLAT_CARD,
    badges: {
      selected:
        "text-[10px] text-primary-foreground bg-primary px-1.5 py-0.5 rounded-sm font-medium",
      downloaded: "text-[10px] text-success bg-success-soft px-1.5 py-0.5 rounded-sm font-medium",
      recommended: "text-[10px] bg-primary-soft text-primary px-1.5 py-0.5 rounded-sm font-medium",
    },
    buttons: {
      download: "",
      select: "border-border text-foreground hover:bg-muted",
      delete:
        "text-destructive hover:text-destructive/90 hover:bg-destructive-soft border-destructive/25",
      refresh: "border-border text-foreground hover:bg-muted",
    },
  },
};

export function getModelPickerStyles(colorScheme: ColorScheme): ModelPickerStyles {
  return MODEL_PICKER_COLORS[colorScheme];
}
