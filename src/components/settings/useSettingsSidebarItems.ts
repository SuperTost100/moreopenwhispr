import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import {
  Sliders,
  Mic,
  Brain,
  UserCircle,
  Wrench,
  Keyboard,
  CreditCard,
  Shield,
  Users,
} from "../icons";
import type { SidebarItem } from "../ui/SidebarModal";
import type { SettingsSectionType } from "../SettingsPage";
import { useAuth } from "../../hooks/useAuth";
import { MOW_ACCOUNT_SETTINGS_SECTIONS, isMowBuild } from "../../config/mowProfile";

/**
 * The settings section rail's items, shared by the modal (SettingsModal, used
 * on the side-panel layout) and the control-panel settings view
 * (SettingsView, used everywhere else) so the two shells never drift.
 */
export function useSettingsSidebarItems(): SidebarItem<SettingsSectionType>[] {
  const { t } = useTranslation();
  const { isSignedIn } = useAuth();

  return useMemo(() => {
    const items: SidebarItem<SettingsSectionType>[] = [
      {
        id: "account",
        label: t("settingsModal.sections.account.label"),
        icon: UserCircle,
        description: t("settingsModal.sections.account.description"),
        group: t("settingsModal.groups.account"),
      },
      {
        id: "plansBilling",
        label: t("settingsModal.sections.plansBilling.label"),
        icon: CreditCard,
        description: t("settingsModal.sections.plansBilling.description"),
        group: t("settingsModal.groups.account"),
      },
      {
        id: "workspace" as const,
        label: t("settingsModal.sections.workspace.label"),
        icon: Users,
        description: t("settingsModal.sections.workspace.description"),
        group: t("settingsModal.groups.account"),
      },
      {
        id: "general",
        label: t("settingsModal.sections.general.label"),
        icon: Sliders,
        description: t("settingsModal.sections.general.description"),
        group: t("settingsModal.groups.app"),
      },
      {
        id: "hotkeys",
        label: t("settingsModal.sections.hotkeys.label"),
        icon: Keyboard,
        description: t("settingsModal.sections.hotkeys.description"),
        group: t("settingsModal.groups.app"),
      },
      {
        id: "speechToText",
        label: t("settingsModal.sections.speechToText.label"),
        icon: Mic,
        description: t("settingsModal.sections.speechToText.description"),
        group: t("settingsModal.groups.aiModels"),
      },
      {
        id: "llms",
        label: t("settingsModal.sections.llms.label"),
        icon: Brain,
        description: t("settingsModal.sections.llms.description"),
        group: t("settingsModal.groups.aiModels"),
      },
      {
        id: "privacyData",
        label: t("settingsModal.sections.privacyData.label"),
        icon: Shield,
        description: t("settingsModal.sections.privacyData.description"),
        group: t("settingsModal.groups.system"),
      },
      {
        id: "system",
        label: t("settingsModal.sections.system.label"),
        icon: Wrench,
        description: t("settingsModal.sections.system.description"),
        group: t("settingsModal.groups.system"),
      },
    ];
    return isMowBuild()
      ? items.filter((item) => !MOW_ACCOUNT_SETTINGS_SECTIONS.has(item.id))
      : isSignedIn
        ? items
        : items.filter((item) => item.id !== "workspace");
  }, [t, isSignedIn]);
}
