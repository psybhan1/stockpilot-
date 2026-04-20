import Link from "next/link";

export function MarketingCta({
  href,
  label,
  primary,
}: {
  href: string;
  label: string;
  primary?: boolean;
}) {
  const cls = primary
    ? "inline-flex items-center justify-center rounded-full bg-foreground px-5 py-3 text-sm font-semibold text-background transition hover:bg-foreground/90"
    : "inline-flex items-center justify-center rounded-full border border-border bg-card px-5 py-3 text-sm font-semibold text-foreground transition hover:bg-card/80";
  return (
    <Link href={href} className={cls}>
      {label}
      <span className="ml-1.5" aria-hidden>
        →
      </span>
    </Link>
  );
}
