import React from "react";
import { useTranslation } from "react-i18next";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "../icons";
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
  /** Full-width banner above every section, e.g. an organization-managed notice. */
  notice?: React.ReactNode;
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
            <DialogPrimitive.Close className="absolute end-4 top-4 z-10 rounded-md p-1.5 opacity-40 ring-offset-background transition-[opacity,background-color] hover:opacity-100 bg-transparent hover:bg-muted outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2">
              <X className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="sr-only">{t("common.close")}</span>
            </DialogPrimitive.Close>

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
              />

              {/* Main Content */}
              <div className="flex-1 overflow-y-auto bg-background">
                <SettingsLayoutProvider value={{ isCompact }}>
                  <div className={isCompact ? "p-4" : "p-6"}>
                    {/* Starts just below the close button, which floats over this column's top corner. */}
                    {notice && (
                      <InfoBox
                        className={`mb-6 flex items-center gap-2.5 rounded-lg px-4 py-3 text-sm text-primary ${
                          isCompact ? "mt-8" : "mt-6"
                        }`}
                      >
                        {notice}
                      </InfoBox>
                    )}
                    {children}
                  </div>
                </SettingsLayoutProvider>
              </div>
            </div>
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
