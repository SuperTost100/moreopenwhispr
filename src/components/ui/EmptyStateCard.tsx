import type { ComponentType, ReactNode } from "react";
import { cn } from "../lib/utils";

interface EmptyStateCardProps {
  icon: ComponentType<{ size?: number; className?: string }>;
  title?: string;
  description?: string;
  /** Announce the title as a heading when the card is the page's main content. */
  headingLevel?: 2 | 3;
  /** Actions or previews, stacked and centred under the copy. */
  children?: ReactNode;
  className?: string;
}

/** Card-shaped empty state: icon tile, title, one-line description, then the single next action. */
export default function EmptyStateCard({
  icon: Icon,
  title,
  description,
  headingLevel,
  children,
  className,
}: EmptyStateCardProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center rounded-lg border border-border bg-card px-6 py-10 text-center",
        className
      )}
    >
      <span className="flex h-11 w-11 items-center justify-center rounded-md bg-muted text-muted-foreground">
        <Icon size={20} />
      </span>
      {title && (
        <p
          role={headingLevel ? "heading" : undefined}
          aria-level={headingLevel}
          className="mt-4 text-[15px] font-medium text-foreground"
        >
          {title}
        </p>
      )}
      {description && (
        <p className="mt-1 max-w-xs text-[13px] leading-relaxed text-muted-foreground">
          {description}
        </p>
      )}
      {children && <div className="mt-5 flex flex-col items-center gap-2">{children}</div>}
    </div>
  );
}
