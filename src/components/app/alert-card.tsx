"use client";

import { useState } from "react";
import { AlertTriangle, Clock, CheckCircle, ChevronRight } from "lucide-react";

type AlertSeverity = "CRITICAL" | "WARNING" | "INFO";

const WINE = "#8B1A34";
const WINE_DEEP = "#5C1022";
const WINE_LIGHT = "#F9EDF0";

const severityConfig = {
  CRITICAL: {
    icon: AlertTriangle,
    bgColor: "rgba(139, 26, 52, 0.1)",
    iconColor: WINE,
    dotColor: "#DC2626",
    badgeBg: "#FEF2F2",
    badgeText: "#DC2626",
    badgeLabel: "Critical Low Stock",
  },
  WARNING: {
    icon: Clock,
    bgColor: "rgba(234, 179, 8, 0.1)",
    iconColor: "#CA8A04",
    dotColor: "#EAB308",
    badgeBg: "#FEFCE8",
    badgeText: "#854D0E",
    badgeLabel: "Low Stock",
  },
  INFO: {
    icon: CheckCircle,
    bgColor: "rgba(139, 26, 52, 0.07)",
    iconColor: WINE,
    dotColor: "#10B981",
    badgeBg: "#F0FDF4",
    badgeText: "#166534",
    badgeLabel: "OK",
  },
};

interface AlertCardProps {
  title: string;
  description: string;
  severity: AlertSeverity;
  actionLabel?: string;
  animDelay?: number;
  onAction?: () => void;
  onDismiss?: () => void;
}

export function AlertCard({
  title,
  description,
  severity,
  actionLabel = "Reorder Now",
  animDelay = 0,
  onAction,
  onDismiss,
}: AlertCardProps) {
  const config = severityConfig[severity];
  const IconComponent = config.icon;
  const [hovered, setHovered] = useState(false);
  const [btnHovered, setBtnHovered] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  if (dismissed) return null;

  return (
    <div
      className="anim-fade-up"
      style={{ animationDelay: `${animDelay}ms` }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "14px",
          padding: "16px 18px",
          background: "#FFFFFF",
          border: `1px solid ${hovered ? "rgba(139, 26, 52, 0.18)" : "rgba(0,0,0,0.07)"}`,
          borderRadius: "14px",
          boxShadow: hovered
            ? "0 8px 28px rgba(139, 26, 52, 0.1)"
            : "0 1px 4px rgba(0,0,0,0.05)",
          transition: "all 0.25s cubic-bezier(0.16, 1, 0.3, 1)",
          transform: hovered ? "translateY(-2px)" : "translateY(0)",
          cursor: "pointer",
        }}
      >
        {/* Severity icon */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: "46px",
            height: "46px",
            borderRadius: "12px",
            background: config.bgColor,
            flexShrink: 0,
            transition: "background 0.25s",
          }}
        >
          <IconComponent
            style={{ width: 22, height: 22, color: config.iconColor }}
          />
        </div>

        {/* Content */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <p
            style={{
              fontSize: "14px",
              fontWeight: 700,
              color: "#1A0A0E",
              margin: 0,
              lineHeight: 1.35,
              letterSpacing: "-0.015em",
            }}
          >
            {title}
          </p>
          {/* Badge */}
          <div style={{ display: "flex", alignItems: "center", gap: "8px", marginTop: "5px" }}>
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: "4px",
                padding: "2px 9px",
                borderRadius: "100px",
                fontSize: "11px",
                fontWeight: 600,
                background: config.badgeBg,
                color: config.badgeText,
              }}
            >
              <span
                style={{
                  width: 5,
                  height: 5,
                  borderRadius: "50%",
                  background: config.dotColor,
                  flexShrink: 0,
                  display: "inline-block",
                }}
              />
              {config.badgeLabel}: {description}
            </span>
          </div>
        </div>

        {/* Actions */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "flex-end",
            gap: "6px",
            flexShrink: 0,
          }}
        >
          <button
            onClick={(e) => {
              e.stopPropagation();
              onAction?.();
            }}
            onMouseEnter={() => setBtnHovered(true)}
            onMouseLeave={() => setBtnHovered(false)}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "4px",
              padding: "8px 16px",
              borderRadius: "8px",
              border: "none",
              background: btnHovered ? WINE_DEEP : WINE,
              color: "#FFFFFF",
              fontSize: "12px",
              fontWeight: 700,
              letterSpacing: "0.01em",
              cursor: "pointer",
              transition: "all 0.2s cubic-bezier(0.16, 1, 0.3, 1)",
              transform: btnHovered ? "scale(1.03)" : "scale(1)",
              boxShadow: btnHovered
                ? "0 4px 16px rgba(139, 26, 52, 0.4)"
                : "0 2px 8px rgba(139, 26, 52, 0.2)",
            }}
          >
            {actionLabel}
            <ChevronRight style={{ width: 13, height: 13 }} />
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              setDismissed(true);
              onDismiss?.();
            }}
            style={{
              background: "none",
              border: "none",
              fontSize: "11px",
              fontWeight: 500,
              color: "#9CA3AF",
              cursor: "pointer",
              padding: "2px 4px",
              transition: "color 0.15s",
            }}
            onMouseEnter={(e) => ((e.target as HTMLElement).style.color = "#6B7280")}
            onMouseLeave={(e) => ((e.target as HTMLElement).style.color = "#9CA3AF")}
          >
            Dismiss
          </button>
        </div>
      </div>
    </div>
  );
}
