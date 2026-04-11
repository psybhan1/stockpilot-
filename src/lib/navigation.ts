import {
  AlertTriangle,
  BellRing,
  Blocks,
  LayoutDashboard,
  PackageOpen,
  ReceiptText,
  ScanBarcode,
  Settings2,
  ShoppingCart,
  Store,
  Workflow,
} from "lucide-react";
import { Role } from "@/lib/domain-enums";

export const navigationItems = [
  {
    href: "/dashboard",
    label: "Home",
    shortLabel: "Home",
    icon: LayoutDashboard,
    minimumRole: Role.SUPERVISOR,
    primaryMobile: true,
  },
  {
    href: "/inventory",
    label: "Inventory",
    shortLabel: "Stock",
    icon: PackageOpen,
    minimumRole: Role.SUPERVISOR,
    primaryMobile: true,
  },
  {
    href: "/stock-count",
    label: "Count",
    shortLabel: "Count",
    icon: ScanBarcode,
    minimumRole: Role.STAFF,
    primaryMobile: true,
  },
  {
    href: "/purchase-orders",
    label: "Orders",
    shortLabel: "Orders",
    icon: ReceiptText,
    minimumRole: Role.SUPERVISOR,
    primaryMobile: true,
  },
  {
    href: "/alerts",
    label: "Alerts",
    shortLabel: "Alerts",
    icon: AlertTriangle,
    minimumRole: Role.SUPERVISOR,
  },
  {
    href: "/recipes",
    label: "Recipes",
    shortLabel: "Recipes",
    icon: Blocks,
    minimumRole: Role.SUPERVISOR,
  },
  {
    href: "/pos-mapping",
    label: "POS Mapping",
    shortLabel: "POS",
    icon: Store,
    minimumRole: Role.MANAGER,
  },
  {
    href: "/suppliers",
    label: "Suppliers",
    shortLabel: "Suppliers",
    icon: ShoppingCart,
    minimumRole: Role.MANAGER,
  },
  {
    href: "/notifications",
    label: "Notifications",
    shortLabel: "Notify",
    icon: BellRing,
    minimumRole: Role.MANAGER,
  },
  {
    href: "/agent-tasks",
    label: "Agent Tasks",
    shortLabel: "Tasks",
    icon: Workflow,
    minimumRole: Role.MANAGER,
  },
  {
    href: "/settings",
    label: "Settings",
    shortLabel: "Settings",
    icon: Settings2,
    minimumRole: Role.MANAGER,
  },
] as const;

export const assistantPrompts = [
  "What are we likely to run out of this weekend?",
  "Why is oat milk trending down faster this week?",
  "Draft an order for dairy and packaging.",
];

export const productName = "StockPilot";

