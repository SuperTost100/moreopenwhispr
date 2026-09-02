import type { LucideIcon } from "lucide-react";
import { Blocks, BookOpen, Home, MessageSquare, NotebookPen, Upload } from "lucide-react";
import { isControlPanelViewAllowed } from "../../stores/policyRules.ts";

// "settings" is a real ControlPanelView (the settings view rendered in the
// main content area — see ControlPanel.tsx's openSettings()) but it is NOT a
// CONTROL_PANEL_NAV_ITEMS entry: it has its own dedicated sidebar/compact-nav
// footer button, not a slot in the primary view switcher.
export type ControlPanelView =
  "home" | "chat" | "personal-notes" | "dictionary" | "upload" | "integrations" | "settings";

export interface ControlPanelNavItemDefinition {
  id: ControlPanelView;
  labelKey: string;
  icon: LucideIcon;
}

export const CONTROL_PANEL_NAV_ITEMS: readonly ControlPanelNavItemDefinition[] = [
  { id: "home", labelKey: "sidebar.dictation", icon: Home },
  { id: "chat", labelKey: "sidebar.chat", icon: MessageSquare },
  { id: "personal-notes", labelKey: "sidebar.notes", icon: NotebookPen },
  { id: "upload", labelKey: "sidebar.upload", icon: Upload },
  { id: "dictionary", labelKey: "sidebar.dictionary", icon: BookOpen },
  { id: "integrations", labelKey: "sidebar.integrations", icon: Blocks },
] as const;

export interface ControlPanelNavPolicy {
  agentAllowed: boolean;
  policyActionsAllowed: boolean;
}

export function getAllowedControlPanelNavItems(
  policy: ControlPanelNavPolicy
): ControlPanelNavItemDefinition[] {
  return CONTROL_PANEL_NAV_ITEMS.filter((item) =>
    isControlPanelViewAllowed(item.id, policy.agentAllowed, policy.policyActionsAllowed)
  );
}

export function getControlPanelNavLabelKey(view: ControlPanelView): string {
  return CONTROL_PANEL_NAV_ITEMS.find((item) => item.id === view)?.labelKey ?? "sidebar.dictation";
}
