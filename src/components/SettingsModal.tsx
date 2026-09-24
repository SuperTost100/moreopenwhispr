import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { usePolicyStore } from "../stores/policyStore";
import { ShieldCheck } from "./icons";
import SidebarModal from "./ui/SidebarModal";
import SettingsPage, { AccountAvatar, SettingsSectionType } from "./SettingsPage";
import { useAuth } from "../hooks/useAuth";
import { isMowBuild } from "../config/mowProfile";
import { resolveLegacySubTab, resolveSettingsSection } from "./settings/settingsRouting";
import { useSettingsSidebarItems } from "./settings/useSettingsSidebarItems";

export type { SettingsSectionType };

interface SettingsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialSection?: string;
}

export default function SettingsModal({ open, onOpenChange, initialSection }: SettingsModalProps) {
  const { t } = useTranslation();
  const { isSignedIn, user } = useAuth();
  const policyManaged = usePolicyStore((s) => s.managed);
  const sidebarItems = useSettingsSidebarItems();

  const [activeSection, setActiveSection] = React.useState<SettingsSectionType>(() =>
    resolveSettingsSection(initialSection)
  );
  const [initialSubTab, setInitialSubTab] = useState<string | undefined>(() =>
    resolveLegacySubTab(initialSection)
  );
  const [prevOpen, setPrevOpen] = useState(open);

  if (open && !prevOpen && initialSection) {
    setPrevOpen(open);
    setActiveSection(resolveSettingsSection(initialSection));
    setInitialSubTab(resolveLegacySubTab(initialSection));
  } else if (open !== prevOpen) {
    setPrevOpen(open);
    if (!open) setInitialSubTab(undefined);
  }

  const handleSectionChange = (section: SettingsSectionType) => {
    setActiveSection(section);
    setInitialSubTab(undefined);
  };

  return (
    <SidebarModal<SettingsSectionType>
      open={open}
      onOpenChange={onOpenChange}
      title={t("settingsModal.title")}
      sidebarItems={sidebarItems}
      activeSection={activeSection}
      onSectionChange={handleSectionChange}
      header={
        !isMowBuild() && isSignedIn && user ? (
          <div className="flex flex-col items-center gap-2 pb-2 text-center">
            <AccountAvatar image={user.image} name={user.name || t("settingsPage.account.user")} />
            <div className="min-w-0 w-full">
              <p dir="auto" className="text-[13px] font-semibold text-foreground truncate">
                {user.name || t("settingsPage.account.user")}
              </p>
              <p className="text-xs text-muted-foreground truncate">
                <bdi dir="ltr">{user.email}</bdi>
              </p>
            </div>
          </div>
        ) : undefined
      }
      notice={
        policyManaged ? (
          <>
            <ShieldCheck className="h-4 w-4 shrink-0" />
            {t("settingsModal.managedByOrg")}
          </>
        ) : undefined
      }
    >
      <SettingsPage
        activeSection={activeSection}
        onNavigateToSection={handleSectionChange}
        initialSubTab={initialSubTab}
      />
    </SidebarModal>
  );
}
