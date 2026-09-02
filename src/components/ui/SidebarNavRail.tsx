import React from "react";
import type { SidebarItem } from "./SidebarModal";

interface SidebarNavRailProps<T extends string> {
  sidebarItems: SidebarItem<T>[];
  activeSection: T;
  onSectionChange: (section: T) => void;
  isCompact: boolean;
  sidebarWidth?: string;
  version?: string;
  /** Rendered above the nav (hidden in compact mode), e.g. account identity. */
  header?: React.ReactNode;
  /**
   * "modal" (default) keeps the rail's own tinted chrome background, as used
   * inside SidebarModal. "view" matches the rail's background to the content
   * pane so it reads as in-page secondary navigation rather than a second
   * chrome band, for use inside a non-modal shell (SettingsView). This is the
   * ONLY visual difference between the two variants — everything else (nav
   * item states, spacing, borders) is shared so the modal stays unaffected.
   */
  variant?: "modal" | "view";
}

/**
 * The settings section rail: grouped nav buttons over an optional identity
 * header and version footer. Extracted out of SidebarModal so the same rail
 * can be reused, un-restyled, by a non-modal shell (SettingsView).
 */
export default function SidebarNavRail<T extends string>({
  sidebarItems,
  activeSection,
  onSectionChange,
  isCompact,
  sidebarWidth = "w-52",
  version,
  header,
  variant = "modal",
}: SidebarNavRailProps<T>) {
  // Group items by their group property
  const groupedItems = React.useMemo(() => {
    const groups: { label: string | null; items: SidebarItem<T>[] }[] = [];
    let currentGroup: string | null | undefined = undefined;

    for (const item of sidebarItems) {
      const group = item.group ?? null;
      if (group !== currentGroup) {
        groups.push({ label: group, items: [item] });
        currentGroup = group;
      } else {
        groups[groups.length - 1].items.push(item);
      }
    }

    return groups;
  }, [sidebarItems]);

  const renderBadge = (item: SidebarItem<T>) => {
    if (!item.badge && item.badgeVariant !== "dot") return null;

    if (item.badgeVariant === "dot") {
      return <span className="ml-auto h-1.5 w-1.5 rounded-full bg-primary shrink-0" />;
    }

    return (
      <span
        className={`ml-auto text-xs font-semibold uppercase tracking-wider px-1.5 py-px rounded-sm shrink-0 ${
          item.badgeVariant === "new"
            ? "bg-primary/10 text-primary dark:bg-primary/15"
            : item.badgeVariant === "update"
              ? "bg-warning/10 text-warning dark:bg-warning/15"
              : "bg-muted text-muted-foreground"
        }`}
      >
        {item.badge}
      </span>
    );
  };

  const actualSidebarWidth = isCompact ? "w-12" : sidebarWidth;
  const railBg =
    variant === "view" ? "bg-background dark:bg-surface-1" : "bg-surface-1 dark:bg-surface-0";

  return (
    <div
      className={`${actualSidebarWidth} shrink-0 border-r border-border/40 dark:border-border-subtle flex flex-col ${railBg} transition-[width] duration-200 ease-out`}
    >
      {/* Identity / custom header */}
      {header && !isCompact && <div className="px-4 pt-5 pb-1">{header}</div>}

      {/* Navigation */}
      <nav
        className={`relative flex-1 pb-2 overflow-y-auto ${isCompact ? "px-1.5 pt-4" : "px-2 pt-3"}`}
      >
        {groupedItems.map((group, groupIndex) => (
          <div key={groupIndex} className={groupIndex > 0 ? "mt-4" : ""}>
            {!isCompact && group.label && (
              <div className="px-2 pb-1">
                <span className="text-[11px] font-medium text-muted-foreground/70 dark:text-muted-foreground/65">
                  {group.label}
                </span>
              </div>
            )}
            <div className="space-y-px">
              {group.items.map((item) => {
                const Icon = item.icon;
                const isActive = activeSection === item.id;

                return (
                  <button
                    key={item.id}
                    data-section-id={item.id}
                    onClick={() => onSectionChange(item.id)}
                    // Always set, not just in compact mode: a handful of long
                    // translations (e.g. Russian "privacyData") truncate even
                    // at full label width, so the tooltip is the only way to
                    // read them in full. No visual effect either way.
                    title={item.label}
                    className={`group relative w-full flex items-center text-left text-xs rounded-md transition-colors duration-100 outline-none ${
                      isCompact ? "justify-center px-0 py-2" : "gap-2 px-2 py-1.5"
                    } ${
                      isActive
                        ? "text-foreground bg-muted dark:bg-surface-raised"
                        : "text-muted-foreground dark:text-foreground/75 hover:text-foreground hover:bg-muted/50 dark:hover:bg-surface-2"
                    }`}
                  >
                    <Icon
                      className={`h-4 w-4 shrink-0 transition-colors duration-100 ${
                        isActive
                          ? "text-primary"
                          : "text-muted-foreground/70 dark:text-foreground/55 group-hover:text-foreground/80"
                      }`}
                    />
                    {!isCompact && (
                      <>
                        <span
                          className={`flex-1 truncate leading-tight ${isActive ? "font-medium" : "font-normal"}`}
                        >
                          {item.label}
                        </span>
                        {renderBadge(item)}
                        {item.shortcut && !item.badge && (
                          <kbd className="ml-auto text-xs text-muted-foreground/25 font-mono shrink-0">
                            {item.shortcut}
                          </kbd>
                        )}
                      </>
                    )}
                    {isCompact && item.badgeVariant === "dot" && (
                      <span className="absolute top-1.5 right-1.5 h-1.5 w-1.5 rounded-full bg-primary" />
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      {/* Footer / version */}
      {version && (
        <div
          className={`border-t border-border/20 dark:border-border-subtle ${
            isCompact ? "flex justify-center py-2.5" : "px-3 py-2.5"
          }`}
        >
          <div className="flex items-center gap-1.5">
            <div className="h-1 w-1 rounded-full bg-success/60" />
            {!isCompact && (
              <span className="text-xs text-muted-foreground/40 tabular-nums tracking-wide">
                v{version}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
