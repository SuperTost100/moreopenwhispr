import React from "react";
import { ChevronDown, Gift, HelpCircle, Search, Settings } from "../icons";
import { useTranslation } from "react-i18next";
import { cn } from "../lib/utils";
import { Button } from "../ui/button";
import SupportDropdown from "../ui/SupportDropdown";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu";
import {
  CONTROL_PANEL_NAV_ITEMS,
  getAllowedControlPanelNavItems,
  getControlPanelNavLabelKey,
  type ControlPanelView,
} from "./controlPanelNavModel";
import { isMowBuild, MOW_PROFILE } from "../../config/mowProfile";

interface ControlPanelCompactNavProps {
  activeView: ControlPanelView;
  onViewChange: (view: ControlPanelView) => void;
  onOpenSettings: () => void;
  onOpenSearch?: () => void;
  onOpenReferrals?: () => void;
  isSignedIn?: boolean;
  agentAllowed: boolean;
  policyActionsAllowed: boolean;
  updateAction?: React.ReactNode;
}

export default function ControlPanelCompactNav({
  activeView,
  onViewChange,
  onOpenSettings,
  onOpenSearch,
  onOpenReferrals,
  isSignedIn,
  agentAllowed,
  policyActionsAllowed,
  updateAction,
}: ControlPanelCompactNavProps) {
  const { t } = useTranslation();
  const navItems = getAllowedControlPanelNavItems({ agentAllowed, policyActionsAllowed });
  // The active view (e.g. "settings") isn't always one of the filtered
  // navItems, so the label always comes from the view id itself rather than
  // an index into that list (which mislabeled Settings as the first tab).
  const activeLabelKey = getControlPanelNavLabelKey(activeView);
  const ActiveIcon =
    activeView === "settings"
      ? Settings
      : CONTROL_PANEL_NAV_ITEMS.find((item) => item.id === activeView)?.icon;
  const showReferrals = Boolean(isSignedIn && onOpenReferrals && !isMowBuild());

  const iconButtonClass =
    "cp-shell-compact-nav-icon-btn h-11 w-11 shrink-0 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

  return (
    <div className="cp-shell-compact-nav-block">
      <nav
        className="cp-shell-compact-nav flex min-w-0 flex-wrap items-center gap-1 px-2 pb-2"
        aria-label={t("controlPanel.compactNav.viewsMenuLabel")}
        style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
      >
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className={cn(
                "cp-shell-compact-nav-trigger flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-md border px-3 text-left text-sm font-medium outline-none",
                "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
              )}
              aria-label={t("controlPanel.compactNav.viewsMenu")}
            >
              {ActiveIcon ? <ActiveIcon size={16} className="shrink-0" aria-hidden="true" /> : null}
              <span className="truncate">{t(activeLabelKey)}</span>
              <ChevronDown size={14} className="ml-auto shrink-0 opacity-60" aria-hidden="true" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="min-w-[12rem]">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = activeView === item.id;
              return (
                <DropdownMenuItem
                  key={item.id}
                  onClick={() => onViewChange(item.id)}
                  className="min-h-11 gap-2"
                  aria-current={isActive ? "page" : undefined}
                >
                  <Icon size={16} className="shrink-0" aria-hidden="true" />
                  <span>{t(item.labelKey)}</span>
                </DropdownMenuItem>
              );
            })}
          </DropdownMenuContent>
        </DropdownMenu>

        {onOpenSearch ? (
          <Button
            type="button"
            variant="outline"
            size="icon"
            className={iconButtonClass}
            onClick={onOpenSearch}
            aria-label={t("commandSearch.shortPlaceholder")}
          >
            <Search size={18} aria-hidden="true" />
          </Button>
        ) : null}

        <Button
          type="button"
          variant="outline"
          size="icon"
          className={iconButtonClass}
          onClick={onOpenSettings}
          aria-label={t("sidebar.settings")}
        >
          <Settings size={18} aria-hidden="true" />
        </Button>

        <SupportDropdown
          trigger={
            <Button
              type="button"
              variant="outline"
              size="icon"
              className={iconButtonClass}
              aria-label={t("sidebar.support")}
            >
              <HelpCircle size={18} aria-hidden="true" />
            </Button>
          }
        />

        {updateAction ? (
          <div className="shrink-0 [&_button]:min-h-11 [&_button]:h-11">{updateAction}</div>
        ) : null}

        {showReferrals ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                className={cn(
                  "cp-shell-compact-nav-trigger flex h-11 shrink-0 items-center rounded-md border px-3 text-sm font-medium outline-none",
                  "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                )}
                aria-label={t("controlPanel.compactNav.moreLabel")}
              >
                {t("controlPanel.compactNav.moreLabel")}
                <ChevronDown size={14} className="ml-1 shrink-0 opacity-60" aria-hidden="true" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-[12rem]">
              <DropdownMenuItem onClick={onOpenReferrals} className="min-h-11 gap-2">
                <Gift size={16} className="shrink-0" aria-hidden="true" />
                <span>{t("sidebar.referral")}</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </nav>
      {isMowBuild() ? (
        <p className="cp-shell-fork-disclosure cp-shell-compact-nav-disclosure px-3 pb-2 text-[11px] leading-snug">
          {t("controlPanel.shell.forkDisclosureNoAccount")}{" "}
          {t("controlPanel.shell.forkDisclosureUnofficial", {
            upstreamName: MOW_PROFILE.upstreamName,
          })}{" "}
          {t("controlPanel.shell.forkDisclosureNotAffiliated")}
        </p>
      ) : null}
    </div>
  );
}

export type { ControlPanelView };
