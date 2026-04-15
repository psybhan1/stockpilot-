import {
  AlertTriangle,
  BarChart3,
  Bell,
  Blocks,
  ClipboardCheck,
  CreditCard,
  Home,
  PackageOpen,
  Receipt,
  Rocket,
  ScanBarcode,
  Settings,
  ShoppingCart,
  Store,
  Users,
  Workflow,
} from "lucide-react";

import { Role } from "@/lib/domain-enums";

/**
 * The app has two tiers of navigation:
 *
 *   primaryNav   — 4 big tabs you see in the top bar. Reflect the
 *                  jobs-to-be-done: see what needs doing, count stock,
 *                  approve orders, manage the menu.
 *
 *   secondaryNav — surfaced behind a gear icon dropdown. Config +
 *                  less-frequent flows (suppliers, POS mapping,
 *                  notifications, alerts history, settings).
 *
 * The old 11-item flat list was overwhelming. Users don't want to
 * think about "POS mapping" or "Agent tasks" — they want to see
 * what's urgent and act. Primary nav is task-led; secondary is for
 * tinkering with setup.
 */

export type NavItem = {
  href: string;
  label: string;
  shortLabel?: string;
  icon: typeof Home;
  minimumRole: Role;
  primaryMobile?: boolean;
  description?: string;
};

export const primaryNav: readonly NavItem[] = [
  {
    href: "/dashboard",
    label: "Today",
    icon: Home,
    minimumRole: Role.STAFF,
    primaryMobile: true,
    description: "What needs your attention right now.",
  },
  {
    href: "/inventory",
    label: "Stock",
    icon: PackageOpen,
    minimumRole: Role.STAFF,
    primaryMobile: true,
    description: "Every item, live stock levels, counts.",
  },
  {
    href: "/purchase-orders",
    label: "Orders",
    icon: Receipt,
    minimumRole: Role.SUPERVISOR,
    primaryMobile: true,
    description: "Approve reorders and track deliveries.",
  },
  {
    href: "/recipes",
    label: "Menu",
    icon: Blocks,
    minimumRole: Role.SUPERVISOR,
    primaryMobile: true,
    description: "Dishes, drinks, and what they use.",
  },
] as const;

export const secondaryNav: readonly NavItem[] = [
  {
    href: "/stock-count",
    label: "Count",
    icon: ClipboardCheck,
    minimumRole: Role.STAFF,
    description: "Confirm uncertain stock levels.",
  },
  {
    href: "/suppliers",
    label: "Suppliers",
    icon: Users,
    minimumRole: Role.MANAGER,
    description: "Contacts, lead times, ordering mode.",
  },
  {
    href: "/alerts",
    label: "Alerts",
    icon: AlertTriangle,
    minimumRole: Role.SUPERVISOR,
    description: "Low stock + issues requiring review.",
  },
  {
    href: "/notifications",
    label: "Messages",
    icon: Bell,
    minimumRole: Role.MANAGER,
    description: "Delivery status of bot + email notices.",
  },
  {
    href: "/agent-tasks",
    label: "Assistant",
    icon: Workflow,
    minimumRole: Role.MANAGER,
    description: "Automated ordering queue.",
  },
  {
    href: "/pos-mapping",
    label: "Sales link",
    icon: Store,
    minimumRole: Role.MANAGER,
    description: "Connect menu items to POS products.",
  },
  {
    href: "/analytics",
    label: "Analytics",
    icon: BarChart3,
    minimumRole: Role.SUPERVISOR,
    description: "Supplier scorecards, spend, and trends.",
  },
  {
    href: "/onboarding",
    label: "Getting started",
    icon: Rocket,
    minimumRole: Role.MANAGER,
    description: "Setup checklist — connect Gmail, Telegram, items.",
  },
  {
    href: "/billing",
    label: "Billing",
    icon: CreditCard,
    minimumRole: Role.MANAGER,
    description: "Plan, invoices, and subscription.",
  },
  {
    href: "/settings",
    label: "Settings",
    icon: Settings,
    minimumRole: Role.MANAGER,
    description: "Integrations, channels, account.",
  },
] as const;

/** Back-compat alias (old code imports `navigationItems`). */
export const navigationItems: readonly NavItem[] = [
  ...primaryNav,
  ...secondaryNav,
];

export const assistantPrompts = [
  "What are we likely to run out of this weekend?",
  "Why is oat milk trending down faster this week?",
  "Draft an order for dairy and packaging.",
];

export const productName = "StockPilot";
