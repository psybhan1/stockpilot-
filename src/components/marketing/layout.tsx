import Link from "next/link";

export function MarketingNav() {
  return (
    <header className="sticky top-0 z-30 border-b border-border/60 bg-background/80 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3">
        <Link href="/" className="flex items-center gap-2">
          <LogoMark />
          <span className="text-base font-semibold tracking-tight">StockPilot</span>
        </Link>
        <nav className="hidden items-center gap-6 text-sm text-muted-foreground md:flex">
          <a href="#how" className="hover:text-foreground">
            How it works
          </a>
          <a href="#pricing" className="hover:text-foreground">
            Pricing
          </a>
          <a href="#faq" className="hover:text-foreground">
            FAQ
          </a>
        </nav>
        <div className="flex items-center gap-2">
          <Link
            href="/login"
            className="hidden rounded-full px-3 py-1.5 text-sm text-muted-foreground hover:text-foreground sm:inline-flex"
          >
            Log in
          </Link>
          <Link
            href="/login"
            className="inline-flex items-center justify-center rounded-full bg-foreground px-4 py-2 text-sm font-medium text-background transition hover:bg-foreground/90"
          >
            Start free
          </Link>
        </div>
      </div>
    </header>
  );
}

export function MarketingFooter() {
  return (
    <footer className="border-t border-border/60 bg-card/40">
      <div className="mx-auto max-w-6xl px-6 py-12">
        <div className="flex flex-wrap items-start justify-between gap-8">
          <div className="max-w-xs">
            <div className="flex items-center gap-2">
              <LogoMark />
              <span className="text-base font-semibold tracking-tight">StockPilot</span>
            </div>
            <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
              Inventory operations for cafés, bakeries, and small kitchens. Built so you never open a spreadsheet at 7am again.
            </p>
          </div>
          <FooterColumn
            title="Product"
            links={[
              { label: "Features", href: "/#how" },
              { label: "Pricing", href: "/#pricing" },
              { label: "Log in", href: "/login" },
            ]}
          />
          <FooterColumn
            title="Company"
            links={[
              { label: "Contact", href: "mailto:hello@stockpilot.app" },
              { label: "Privacy", href: "/privacy" },
              { label: "Terms", href: "/terms" },
            ]}
          />
          <FooterColumn
            title="Status"
            links={[
              { label: "System status", href: "mailto:hello@stockpilot.app" },
              { label: "Book a demo", href: "mailto:hello@stockpilot.app" },
            ]}
          />
        </div>
        <div className="mt-10 flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground">
          <span>© {new Date().getFullYear()} StockPilot, Inc. Made for operators.</span>
          <span>Based in Toronto · Works globally</span>
        </div>
      </div>
    </footer>
  );
}

function FooterColumn({
  title,
  links,
}: {
  title: string;
  links: { label: string; href: string }[];
}) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
        {title}
      </p>
      <ul className="mt-3 space-y-2 text-sm">
        {links.map((link) => (
          <li key={link.label}>
            <Link
              href={link.href}
              className="text-foreground/80 hover:text-foreground"
            >
              {link.label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

function LogoMark() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 32 32"
      width={24}
      height={24}
      aria-hidden
      className="shrink-0"
    >
      <defs>
        <linearGradient id="sp-grad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#0A0A0A" />
          <stop offset="100%" stopColor="#57534E" />
        </linearGradient>
      </defs>
      <rect x="2" y="2" width="28" height="28" rx="8" fill="url(#sp-grad)" />
      <path
        d="M9 20 L14 13 L18 17 L23 10"
        stroke="#F5F3EE"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  );
}
