import React from "react";
import { useTranslation } from "react-i18next";
import { usePolicyStore } from "../../stores/policyStore";
import { useAuth } from "../../hooks/useAuth";
import { isMowBuild } from "../../config/mowProfile";
import SidebarNavRail from "../ui/SidebarNavRail";
import { SettingsLayoutProvider } from "../ui/useSettingsLayout";
import SettingsPage, { AccountAvatar, type SettingsSectionType } from "../SettingsPage";
import { useSettingsSidebarItems } from "./useSettingsSidebarItems";
import { resolveLegacySubTab, resolveSettingsSection } from "./settingsRouting";

interface SettingsViewProps {
  /** Raw, possibly-legacy section identifier (e.g. "transcription"). Resolved
   * via settingsRouting the same way SettingsModal resolves its `initialSection`. */
  initialSection?: string;
}

/**
 * The control-panel settings VIEW: the same section rail + SettingsPage as
 * SettingsModal, rendered inline in the main content area instead of a
 * dialog. Used whenever the main sidebar is visible (ControlPanel renders
 * SettingsModal instead when isSidePanelLayout is true). Mounts fresh each
 * time activeView becomes "settings", so `initialSection` is resolved once
 * per visit — this is what gives "open Settings" its section-reset semantics.
 */
export default function SettingsView({ initialSection }: SettingsViewProps) {
  const { t } = useTranslation();
  const { isSignedIn, user } = useAuth();
  const policyManaged = usePolicyStore((s) => s.managed);
  const sidebarItems = useSettingsSidebarItems();

  const [activeSection, setActiveSection] = React.useState<SettingsSectionType>(() =>
    resolveSettingsSection(initialSection)
  );
  const [initialSubTab, setInitialSubTab] = React.useState<string | undefined>(() =>
    resolveLegacySubTab(initialSection)
  );

  const handleSectionChange = (section: SettingsSectionType) => {
    setActiveSection(section);
    setInitialSubTab(undefined);
  };

  // One scroller serves every section, so a new section would otherwise open
  // at the previous one's offset, with its heading scrolled out of view.
  const scrollerRef = React.useRef<HTMLDivElement | null>(null);
  React.useLayoutEffect(() => {
    if (scrollerRef.current) scrollerRef.current.scrollTop = 0;
  }, [activeSection]);

  const [isCompact, setIsCompact] = React.useState(false);
  const observerRef = React.useRef<ResizeObserver | null>(null);
  const containerRef = React.useCallback((el: HTMLDivElement | null) => {
    if (observerRef.current) {
      observerRef.current.disconnect();
      observerRef.current = null;
    }
    if (!el) return;
    // Measured against the view's own rail+content row (not the old modal's
    // ~4xl dialog box). With the 180px rail, the tightest real content row —
    // Preferences > Theme's "Choose light, dark, or match your system" label
    // next to the Light/Dark/Auto control — starts wrapping to two lines
    // once the content column drops below ~536px (measured live at 1200x800
    // down to 900x800). 536 + 180 = ~716, rounded up to 720: below that
    // container width the rail collapses to icon-only, handing the content
    // column the extra room instead of at 800px.
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? 0;
      setIsCompact(width > 0 && width < 720);
    });
    observer.observe(el);
    observerRef.current = observer;
  }, []);

  return (
    <section
      className="cp-settings-view flex h-full min-h-0 flex-col"
      aria-labelledby="cp-settings-page-title"
    >
      <header className="cp-settings-view__page-head">
        <h1 id="cp-settings-page-title" className="cp-settings-view__page-title">
          {t("controlPanel.settings.pageTitle")}
        </h1>
        <p className="cp-settings-view__page-subtitle">{t("controlPanel.settings.pageSubtitle")}</p>
      </header>
      <div ref={containerRef} className="flex flex-1 min-h-0">
        <SidebarNavRail
          variant="view"
          sidebarWidth="w-[180px]"
          sidebarItems={sidebarItems}
          activeSection={activeSection}
          onSectionChange={handleSectionChange}
          isCompact={isCompact}
          header={
            !isMowBuild() && isSignedIn && user ? (
              <div className="flex flex-col items-center gap-2 pb-2 text-center">
                <AccountAvatar
                  image={user.image}
                  name={user.name || t("settingsPage.account.user")}
                />
                <div className="min-w-0 w-full">
                  <p className="text-[13px] font-semibold text-foreground truncate">
                    {user.name || t("settingsPage.account.user")}
                  </p>
                  <p className="text-xs text-muted-foreground truncate">{user.email}</p>
                </div>
              </div>
            ) : undefined
          }
        />
        <div ref={scrollerRef} className="flex-1 overflow-y-auto bg-background dark:bg-surface-1">
          <SettingsLayoutProvider value={{ isCompact }}>
            <div className={isCompact ? "p-4" : "p-6"}>
              {policyManaged && (
                <div className="mb-4 rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-800 dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-200">
                  {t("settingsModal.managedByOrg")}
                </div>
              )}
              <SettingsPage
                activeSection={activeSection}
                onNavigateToSection={handleSectionChange}
                initialSubTab={initialSubTab}
              />
            </div>
          </SettingsLayoutProvider>
        </div>
      </div>
    </section>
  );
}
