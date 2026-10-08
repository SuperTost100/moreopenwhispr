import React from "react";
import { useTranslation } from "react-i18next";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "../icons";
import { cn } from "../lib/utils";
import { InfoBox } from "./InfoBox";
import { SettingsLayoutProvider } from "./useSettingsLayout";
import { useDismissGuard } from "./useDismissGuard";
import SidebarNavRail from "./SidebarNavRail";

export interface SidebarItem<T extends string> {
  id: T;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  group?: string;
  description?: string;
  badge?: string;
  badgeVariant?: "default" | "new" | "update" | "dot";
  shortcut?: string;
}

interface SidebarModalProps<T extends string> {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  sidebarItems: SidebarItem<T>[];
  activeSection: T;
  onSectionChange: (section: T) => void;
  children: React.ReactNode;
  sidebarWidth?: string;
  version?: string;
  /** Rendered above the nav (hidden in compact mode), e.g. account identity. */
  header?: React.ReactNode;
  /**
   * Account-level notice, e.g. an organization-managed policy. Sits under the
   * header in the sidebar; when the sidebar is compact it collapses to an icon
   * badge beside the close button with `description` as its tooltip.
   */
  notice?: { icon: React.ReactNode; label: string; description: string };
}

export default function SidebarModal<T extends string>({
  open,
  onOpenChange,
  title,
  sidebarItems,
  activeSection,
  onSectionChange,
  children,
  sidebarWidth = "w-52",
  version,
  header,
  notice,
}: SidebarModalProps<T>) {
  const { t } = useTranslation();
  const { registerContent, shouldBlockDismiss } = useDismissGuard<HTMLDivElement>();

  const [isCompact, setIsCompact] = React.useState(false);
  const observerRef = React.useRef<ResizeObserver | null>(null);

  // Every section shares this scroller; start each one at its top.
  const scrollerRef = React.useRef<HTMLDivElement | null>(null);
  React.useLayoutEffect(() => {
    if (scrollerRef.current) scrollerRef.current.scrollTop = 0;
  }, [activeSection]);

  const containerRef = React.useCallback((el: HTMLDivElement | null) => {
    if (observerRef.current) {
      observerRef.current.disconnect();
      observerRef.current = null;
    }
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? 0;
      setIsCompact(width > 0 && width < 800);
    });
    observer.observe(el);
    observerRef.current = observer;
  }, []);

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/60 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content
          ref={registerContent}
          // Radix focuses the first tabbable on open, which is the close button;
          // focus the dialog itself so the X doesn't open wearing a focus ring.
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            (e.currentTarget as HTMLElement).focus();
          }}
          onEscapeKeyDown={(e) => {
            if (document.querySelector("[data-capturing]")) e.preventDefault();
          }}
          onInteractOutside={(e) => {
            // A dropdown open over this panel makes the panel inert, so the
            // click that closes the dropdown lands on the overlay and would
            // otherwise take the whole settings modal with it.
            if (shouldBlockDismiss(e)) e.preventDefault();
          }}
          className="fixed left-[50%] top-[50%] z-50 max-h-[85vh] w-[90vw] max-w-4xl translate-x-[-50%] translate-y-[-50%] rounded-xl p-0 overflow-hidden outline-none bg-card border border-border shadow-elevated duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-98 data-[state=open]:zoom-in-98"
        >
          <div className="relative h-full max-h-[85vh] overflow-hidden">
            <div className="absolute end-4 top-4 z-10 flex items-center gap-2">
              {notice && isCompact && (
                <InfoBox title={notice.description} className="rounded-md p-1.25 text-primary">
                  {notice.icon}
                  <span className="sr-only">{notice.description}</span>
                </InfoBox>
              )}
              <DialogPrimitive.Close className="rounded-md p-1.5 opacity-40 ring-offset-background transition-[opacity,background-color] hover:opacity-100 bg-transparent hover:bg-muted dark:hover:bg-surface-raised outline-none focus-visible:ring-2 focus-visible:ring-ring/30 focus-visible:ring-offset-1">
                <X className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="sr-only">{t("common.close")}</span>
              </DialogPrimitive.Close>
            </div>

            <div ref={containerRef} className="flex h-[85vh]">
              <DialogPrimitive.Title className="sr-only">{title}</DialogPrimitive.Title>

              {/* Sidebar */}
              <SidebarNavRail
                sidebarItems={sidebarItems}
                activeSection={activeSection}
                onSectionChange={onSectionChange}
                isCompact={isCompact}
                sidebarWidth={sidebarWidth}
                version={version}
                header={header}
                notice={notice}
              />

              {/* Main Content */}
              <div ref={scrollerRef} className="flex-1 overflow-y-auto bg-background">
                <SettingsLayoutProvider value={{ isCompact }}>
                  {/* The close button (and compact notice badge) float over this column's top corner
                      (top-4, 26px tall); pt-[22px] centres a text-xs heading (line-height 1.15) on that row. */}
                  <div className={`${isCompact ? "p-4" : "p-6"} pt-[22px]`}>{children}</div>
                </SettingsLayoutProvider>
              </div>
            </div>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
