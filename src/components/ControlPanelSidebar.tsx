import React, { useState } from "react";
import {
  Gift,
  Lock,
  Search,
  Settings,
  ShieldCheck,
  HelpCircle,
  UserCircle,
  UserPlus,
  X,
  Zap,
} from "./icons";
import logoIcon from "../assets/icon.png";
import { useTranslation } from "react-i18next";
import { preventOrphanWord } from "../utils/orphanWord";
import { cn } from "./lib/utils";
import SupportDropdown from "./ui/SupportDropdown";
import { getCachedPlatform } from "../utils/platform";
import type { UpsellDecision } from "../lib/upsell";
import { isAgentAllowed, isPolicyActionAllowed } from "../stores/policyRules";
import { usePolicyStore } from "../stores/policyStore";
import { isMowBuild, MOW_PROFILE } from "../config/mowProfile";
import {
  getAllowedControlPanelNavItems,
  type ControlPanelView,
} from "./control-panel/controlPanelNavModel";

const platform = getCachedPlatform();

export type { ControlPanelView };

interface ControlPanelSidebarProps {
  activeView: ControlPanelView;
  onViewChange: (view: ControlPanelView) => void;
  onOpenSettings: () => void;
  onOpenSearch?: () => void;
  onOpenReferrals?: () => void;
  onInviteTeam?: () => void;
  onUpgrade?: () => void;
  isOverLimit?: boolean;
  userName?: string | null;
  userEmail?: string | null;
  userImage?: string | null;
  isSignedIn?: boolean;
  authLoaded?: boolean;
  upsell: UpsellDecision;
  updateAction?: React.ReactNode;
  collapseToggle?: React.ReactNode;
}

export default function ControlPanelSidebar({
  activeView,
  onViewChange,
  onOpenSettings,
  onOpenSearch,
  onOpenReferrals,
  onInviteTeam,
  onUpgrade,
  isOverLimit,
  userName,
  userEmail,
  userImage,
  isSignedIn,
  authLoaded,
  upsell,
  updateAction,
  collapseToggle,
}: ControlPanelSidebarProps) {
  const { t } = useTranslation();
  const [upgradeDismissed, setUpgradeDismissed] = useState(
    () => localStorage.getItem("upgradeProDismissed") === "true"
  );

  const showLimitBanner =
    !isMowBuild() && upsell === "show" && Boolean(isSignedIn) && Boolean(isOverLimit);
  const showUpgradeBanner =
    !isMowBuild() && upsell === "show" && !showLimitBanner && !upgradeDismissed;

  const agentAllowed = usePolicyStore(isAgentAllowed);
  const policyActionsAllowed = usePolicyStore((state) => isPolicyActionAllowed(state));
  const navItems = getAllowedControlPanelNavItems({ agentAllowed, policyActionsAllowed });

  return (
    <aside
      className="cp-shell-sidebar flex h-full w-[var(--cp-shell-sidebar-width)] shrink-0 flex-col border-r"
      aria-label={t("controlPanel.compactNav.viewsMenuLabel")}
    >
      <div
        className="h-10 w-full shrink-0"
        style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
      />

      <div className="flex items-center justify-between gap-2 px-3.5 pb-3 pt-1">
        <p className="cp-shell-product-label min-w-0 truncate text-sm font-semibold tracking-tight">
          {isMowBuild() ? MOW_PROFILE.productName : MOW_PROFILE.upstreamName}
        </p>
        {collapseToggle}
      </div>

      {onOpenSearch ? (
        <div className="px-2.5 pb-1">
          <button
            type="button"
            onClick={onOpenSearch}
            className="cp-shell-search-trigger group flex h-11 w-full items-center gap-2 rounded-md border px-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            <Search size={14} className="shrink-0 opacity-60" aria-hidden="true" />
            <span className="flex-1 truncate text-sm opacity-70">
              {t("commandSearch.shortPlaceholder")}
            </span>
            <div className="flex shrink-0 items-center gap-0.5">
              <kbd className="rounded border px-1 py-px font-mono text-[10px] leading-tight opacity-60">
                {platform === "darwin" ? "⌘" : "Ctrl"}
              </kbd>
              <kbd className="rounded border px-1 py-px font-mono text-[10px] leading-tight opacity-60">
                K
              </kbd>
            </div>
          </button>
        </div>
      ) : null}

      <nav className="flex flex-col gap-0.5 px-2.5 pb-2">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = activeView === item.id;

          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onViewChange(item.id)}
              aria-current={isActive ? "page" : undefined}
              className={cn(
                "cp-shell-nav-item group flex h-11 w-full items-center gap-2.5 rounded-md px-3 text-left text-sm outline-none",
                "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
                isActive && "cp-shell-nav-item--active font-medium"
              )}
            >
              <Icon size={16} className="shrink-0 opacity-70" aria-hidden="true" />
              <span>{t(item.labelKey)}</span>
            </button>
          );
        })}
      </nav>

      <div className="flex-1" />

      {showLimitBanner ? (
        <div className="px-2.5 pb-2">
          <div className="cp-shell-banner rounded-lg border p-3">
            <div className="flex flex-col items-center text-center">
              <img
                src={logoIcon}
                alt=""
                className="mb-2 h-7 w-7 rounded-md"
                width={28}
                height={28}
              />
              <p className="mb-0.5 text-xs font-medium">{t("sidebar.limitReached")}</p>
              <p className="mb-2.5 text-[11px] leading-snug opacity-70">
                {t("sidebar.limitReachedDescription")}
              </p>
              <button
                type="button"
                onClick={onUpgrade}
                className="h-9 w-full rounded-md bg-primary text-xs font-medium text-primary-foreground hover:bg-primary/90"
              >
                {t("sidebar.viewPlans")}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {showUpgradeBanner ? (
        <div className="px-2.5 pb-2">
          <div className="cp-shell-banner relative rounded-lg border p-3">
            <button
              type="button"
              onClick={() => {
                setUpgradeDismissed(true);
                localStorage.setItem("upgradeProDismissed", "true");
              }}
              aria-label={t("common.dismiss")}
              className="absolute end-2 top-2 rounded-sm p-0.5 opacity-60 hover:bg-foreground/5 hover:opacity-100"
            >
              <X size={12} aria-hidden="true" />
            </button>
            <img
              src={logoIcon}
              alt=""
              className="mb-2.5 h-7 w-7 rounded-md"
              width={28}
              height={28}
            />
            <p className="mb-0.5 text-[13px] font-semibold">{t("sidebar.upgradeTitle")}</p>
            <p className="mb-2.5 text-xs leading-snug opacity-70">
              {t("sidebar.upgradeDescription")}
            </p>
            <div className="mb-3 space-y-1.5">
              {(
                [
                  [Zap, t("sidebar.upgradeInstantSetup")],
                  [Lock, t("sidebar.upgradeZeroRetention")],
                  [ShieldCheck, t("sidebar.upgradeEnterpriseSecurity")],
                ] as const
              ).map(([Icon, label]) => (
                <div key={label} className="flex items-start gap-1.5">
                  <Icon size={12} className="mt-px shrink-0 opacity-60" aria-hidden="true" />
                  <span className="text-[11px] leading-snug opacity-80">{label}</span>
                </div>
              ))}
            </div>
            <button
              type="button"
              onClick={onUpgrade}
              className="h-9 w-full rounded-md bg-primary text-xs font-medium text-primary-foreground hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {t("sidebar.learnMore")}
            </button>
          </div>
        </div>
      ) : null}

      <div className="space-y-0.5 px-2.5 pb-2.5">
        {updateAction ? (
          <div
            className="px-0.5 pb-1"
            style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
          >
            {updateAction}
          </div>
        ) : null}

        {onInviteTeam ? (
          <button
            type="button"
            onClick={onInviteTeam}
            aria-label={t("sidebar.inviteTeam")}
            className="cp-shell-footer-item flex h-11 w-full items-center gap-2.5 rounded-md px-3 text-left text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            <UserPlus size={16} className="shrink-0 opacity-70" aria-hidden="true" />
            <span>{t("sidebar.inviteTeam")}</span>
          </button>
        ) : null}

        {isSignedIn && onOpenReferrals && !isMowBuild() ? (
          <button
            type="button"
            onClick={onOpenReferrals}
            aria-label={t("sidebar.referral")}
            className="cp-shell-footer-item flex h-11 w-full items-center gap-2.5 rounded-md px-3 text-left text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            <Gift size={16} className="shrink-0 opacity-70" aria-hidden="true" />
            <span>{t("sidebar.referral")}</span>
          </button>
        ) : null}

        <button
          type="button"
          onClick={onOpenSettings}
          aria-label={t("sidebar.settings")}
          className="cp-shell-footer-item flex h-11 w-full items-center gap-2.5 rounded-md px-3 text-left text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          <Settings size={16} className="shrink-0 opacity-70" aria-hidden="true" />
          <span>{t("sidebar.settings")}</span>
        </button>

        <SupportDropdown
          trigger={
            <button
              type="button"
              aria-label={t("sidebar.support")}
              className="cp-shell-footer-item flex h-11 w-full items-center gap-2.5 rounded-md px-3 text-left text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
              <HelpCircle size={16} className="shrink-0 opacity-70" aria-hidden="true" />
              <span>{t("sidebar.support")}</span>
            </button>
          }
        />

        {isMowBuild() ? (
          <p className="cp-shell-fork-disclosure px-3 pt-1.5 text-[11px] leading-snug">
            {preventOrphanWord(t("controlPanel.shell.forkDisclosureNoAccount"))}
            <br />
            {preventOrphanWord(
              t("controlPanel.shell.forkDisclosureUnofficial", {
                upstreamName: MOW_PROFILE.upstreamName,
              })
            )}
            <br />
            {preventOrphanWord(t("controlPanel.shell.forkDisclosureNotAffiliated"))}
          </p>
        ) : null}

        {!isMowBuild() ? (
          <>
            <div className="cp-shell-footer-divider mx-1 my-1.5 h-px" />
            <div className="flex items-center gap-2.5 rounded-md px-3 py-1.5">
              {userImage ? (
                <img
                  src={userImage}
                  alt=""
                  className="h-6 w-6 shrink-0 rounded-full object-cover"
                  width={24}
                  height={24}
                />
              ) : (
                <UserCircle size={18} className="shrink-0 opacity-50" aria-hidden="true" />
              )}
              <div className="min-w-0 flex-1">
                {isSignedIn && (userName || userEmail) ? (
                  <>
                    <p dir="auto" className="truncate text-xs leading-tight opacity-80">
                      {userName || t("sidebar.defaultUser")}
                    </p>
                    {userEmail ? (
                      <p className="truncate text-xs leading-tight opacity-55">
                        <bdi dir="ltr">{userEmail}</bdi>
                      </p>
                    ) : null}
                  </>
                ) : authLoaded && !isSignedIn ? (
                  <p className="text-xs opacity-55">{t("sidebar.notSignedIn")}</p>
                ) : null}
              </div>
            </div>
          </>
        ) : null}
      </div>
    </aside>
  );
}
