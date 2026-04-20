import { Coffee } from "lucide-react";

/**
 * Recipe / menu-item image with a branded empty state. If we have an
 * imageUrl we render it; otherwise a warm gradient + soft coffee glyph
 * so the grid doesn't look like placeholder letters.
 *
 * Square can take a minute to ship new image urls, and AI gen is
 * gated behind the menu-image button — so this empty state exists
 * deliberately and should feel like the product, not a dev stub.
 */
export function MenuImage({
  src,
  alt,
  size = "md",
  className = "",
}: {
  src: string | null | undefined;
  alt: string;
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const sizeClass =
    size === "sm"
      ? "size-10"
      : size === "lg"
        ? "size-28"
        : "size-16 sm:size-20";
  const glyphClass =
    size === "sm" ? "size-4" : size === "lg" ? "size-10" : "size-6 sm:size-7";

  if (src) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={src}
        alt={alt}
        className={`${sizeClass} rounded-2xl object-cover ${className}`}
      />
    );
  }
  return (
    <div
      className={`${sizeClass} flex items-center justify-center rounded-2xl bg-gradient-to-br from-amber-100 via-amber-50 to-orange-100 text-amber-700/60 dark:from-stone-800 dark:via-stone-900 dark:to-stone-950 dark:text-amber-200/40 ${className}`}
      aria-label={`${alt} (no photo yet)`}
    >
      <Coffee className={glyphClass} strokeWidth={1.5} />
    </div>
  );
}
