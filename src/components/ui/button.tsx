import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "../lib/utils";

const buttonVariants = cva(
  [
    "inline-flex items-center justify-center gap-2 whitespace-nowrap",
    // Buttons are not pills (spec: only toggles/avatars/status dots/circular
    // icon buttons get 999px — a caller opts a specific icon button into that
    // with rounded-full in its own className).
    "rounded-md text-sm font-medium cursor-pointer select-none",
    "transition-[background-color,border-color,color,transform] duration-200 ease-out",
    "outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
    "disabled:pointer-events-none disabled:opacity-50 disabled:cursor-not-allowed",
    "[&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4 [&_svg]:shrink-0 shrink-0",
  ].join(" "),
  {
    variants: {
      variant: {
        // Primary CTA — flat fill, no glass rim or gradient.
        default: [
          "font-semibold tracking-[0.005em]",
          "bg-primary text-primary-foreground border border-transparent",
          "hover:bg-primary-hover",
          "active:scale-[0.98]",
        ].join(" "),

        // Success — uses design tokens
        success: [
          "text-success-foreground font-semibold tracking-[0.01em]",
          "bg-success border border-transparent",
          "hover:bg-success/90",
          "active:bg-success/80 active:scale-[0.98]",
        ].join(" "),

        // Destructive — uses design tokens
        destructive: [
          "text-destructive-foreground font-semibold tracking-[0.01em]",
          "bg-destructive border border-transparent",
          "hover:bg-destructive/90",
          "active:bg-destructive/80 active:scale-[0.98]",
        ].join(" "),

        // Outline — flat, hairline border, no blur or shadow
        outline: [
          "font-medium",
          "text-foreground bg-transparent",
          "border border-border",
          "hover:bg-muted hover:border-border-hover",
          "active:scale-[0.98]",
        ].join(" "),

        // Outline flat — transparent with thin border, quieter text
        "outline-flat": [
          "font-medium",
          "text-muted-foreground bg-transparent",
          "border border-border",
          "hover:text-foreground hover:border-border-hover hover:bg-muted",
          "active:scale-[0.98]",
        ].join(" "),

        // Secondary — uses design tokens
        secondary: [
          "font-medium",
          "text-foreground bg-secondary",
          "border border-border",
          "hover:bg-muted",
          "active:scale-[0.98]",
        ].join(" "),

        // Ghost — uses design tokens
        ghost: [
          "font-medium",
          "text-foreground bg-transparent",
          "hover:bg-muted",
          "active:scale-[0.98]",
        ].join(" "),

        // Link — uses design tokens
        link: [
          "font-medium",
          "text-primary",
          "hover:text-primary/80 hover:underline",
          "underline-offset-4",
        ].join(" "),

        // Social button for auth flows — flat, no glassmorphism
        social: [
          "font-medium",
          "text-foreground bg-surface-1",
          "border border-border",
          "hover:bg-surface-2 hover:border-border-hover",
          "active:scale-[0.98]",
        ].join(" "),
      },
      size: {
        default: "h-9 px-4 py-2",
        sm: "h-8 px-3 text-xs gap-1.5",
        lg: "h-11 px-6 text-sm",
        icon: "size-9 rounded-md",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
);

function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
  }) {
  const Comp = asChild ? Slot : "button";

  return (
    <Comp
      data-slot="button"
      data-variant={variant ?? "default"}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { Button };
