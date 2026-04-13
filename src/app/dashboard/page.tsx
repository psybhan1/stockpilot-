"use client";

import { AlertCard } from "@/components/app/alert-card";

export default function DashboardPage() {
  const alerts = [
    {
      title: "Single Origin Ethiopian Yirgacheffe Beans",
      description: "Critical Low Stock: 1.5 kg",
      severity: "CRITICAL" as const,
      actionLabel: "Reorder Now",
    },
    {
      title: "Oat Milk - Barista Edition",
      description: "Low Stock: 3 Cases",
      severity: "WARNING" as const,
      actionLabel: "Reorder Now",
    },
    {
      title: "Espresso Machine Cleaning Tablets",
      description: "Critical Low Stock: 1 Bottle",
      severity: "CRITICAL" as const,
      actionLabel: "Reorder Now",
    },
    {
      title: "Disposable Bio-Cups (8oz)",
      description: "Low Stock: 2 Sleeves",
      severity: "WARNING" as const,
      actionLabel: "Reorder Now",
    },
  ];

  return (
    <div style={{ minHeight: "100vh", background: "#F8F9FC", padding: "24px" }}>
      <div style={{ maxWidth: "800px", margin: "0 auto" }}>
        {/* Header */}
        <div style={{ marginBottom: "32px" }}>
          <h1 style={{ fontSize: "28px", fontWeight: 700, color: "#0A0B14", margin: 0 }}>
            Urgent Alerts
          </h1>
          <p style={{ fontSize: "14px", color: "#6B7280", margin: "6px 0 0 0" }}>
            Immediate action required for low stock items and supplier issues.
          </p>
        </div>

        {/* Alerts List */}
        <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          {alerts.map((alert, i) => (
            <AlertCard
              key={i}
              title={alert.title}
              description={alert.description}
              severity={alert.severity}
              actionLabel={alert.actionLabel}
              onAction={() => console.log(`Reorder ${alert.title}`)}
              onDismiss={() => console.log(`Dismiss ${alert.title}`)}
            />
          ))}
        </div>

        {/* Bottom Navigation (Mobile) */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-around",
            marginTop: "48px",
            paddingTop: "16px",
            borderTop: "1px solid rgba(0,0,0,0.08)",
          }}
        >
          {[
            { label: "Home", icon: "🏠" },
            { label: "Alerts", icon: "🔔" },
            { label: "Inventory", icon: "📦" },
            { label: "Suppliers", icon: "🤝" },
            { label: "Profile", icon: "👤" },
          ].map((item) => (
            <button
              key={item.label}
              style={{
                background: "none",
                border: "none",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: "4px",
                fontSize: "11px",
                color: "#6B7280",
                cursor: "pointer",
              }}
            >
              <span style={{ fontSize: "20px" }}>{item.icon}</span>
              {item.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
