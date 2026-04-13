"use client";

import { AlertTriangle, Zap, Package, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";

type AlertSeverity = "CRITICAL" | "WARNING" | "INFO";

const severityConfig = {
  CRITICAL: {
    icon: AlertTriangle,
    bgColor: "rgba(248, 113, 113, 0.1)",
    iconColor: "#EF4444",
    textColor: "#DC2626",
    label: "Critical Low Stock",
  },
  WARNING: {
    icon: AlertCircle,
    bgColor: "rgba(245, 158, 11, 0.1)",
    iconColor: "#F59E0B",
    textColor: "#D97706",
    label: "Low Stock",
  },
  INFO: {
    icon: Package,
    bgColor: "rgba(59, 130, 246, 0.1)",
    iconColor: "#3B82F6",
    textColor: "#1D4ED8",
    label: "Info",
  },
};

interface AlertCardProps {
  title: string;
  description: string;
  severity: AlertSeverity;
  actionLabel?: string;
  onAction?: () => void;
  onDismiss?: () => void;
}

export function AlertCard({
  title,
  description,
  severity,
  actionLabel = "Reorder Now",
  onAction,
  onDismiss,
}: AlertCardProps) {
  const config = severityConfig[severity];
  const IconComponent = config.icon;

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "16px",
        padding: "16px",
        background: "#FFFFFF",
        border: "1px solid rgba(0, 0, 0, 0.08)",
        borderRadius: "12px",
        boxShadow: "0 1px 3px rgba(0, 0, 0, 0.05)",
      }}
    >
      {/* Icon */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          width: "48px",
          height: "48px",
          borderRadius: "8px",
          background: config.bgColor,
          flexShrink: 0,
        }}
      >
        <IconComponent style={{ width: 24, height: 24, color: config.iconColor }} />
      </div>

      {/* Content */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <h3
          style={{
            fontSize: "15px",
            fontWeight: 700,
            color: "#0A0B14",
            margin: 0,
            lineHeight: 1.3,
          }}
        >
          {title}
        </h3>
        <p
          style={{
            fontSize: "13px",
            color: config.textColor,
            margin: "4px 0 0 0",
            fontWeight: 500,
          }}
        >
          {config.label}
        </p>
        <p
          style={{
            fontSize: "12px",
            color: "#6B7280",
            margin: "3px 0 0 0",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {description}
        </p>
      </div>

      {/* Actions */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "8px",
          alignItems: "flex-end",
          flexShrink: 0,
        }}
      >
        <Button
          onClick={onAction}
          style={{
            background: "#3B82F6",
            color: "#FFFFFF",
            border: "none",
            borderRadius: "6px",
            padding: "8px 16px",
            fontSize: "12px",
            fontWeight: 600,
            cursor: "pointer",
            transition: "background 0.2s",
          }}
          onMouseEnter={(e) =>
            ((e.target as HTMLElement).style.background = "#2563EB")
          }
          onMouseLeave={(e) =>
            ((e.target as HTMLElement).style.background = "#3B82F6")
          }
        >
          {actionLabel}
        </Button>
        {onDismiss && (
          <button
            onClick={onDismiss}
            style={{
              background: "none",
              border: "none",
              fontSize: "12px",
              color: "#9CA3AF",
              cursor: "pointer",
              padding: "4px 8px",
              transition: "color 0.2s",
            }}
            onMouseEnter={(e) =>
              ((e.target as HTMLElement).style.color = "#6B7280")
            }
            onMouseLeave={(e) =>
              ((e.target as HTMLElement).style.color = "#9CA3AF")
            }
          >
            Dismiss
          </button>
        )}
      </div>
    </div>
  );
}
