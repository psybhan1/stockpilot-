"use client";

import { useState } from "react";
import { AlertCard } from "@/components/app/alert-card";
import {
  Home,
  Bell,
  Package,
  Users,
  User,
  TrendingDown,
  ShoppingCart,
  ClipboardList,
  ArrowRight,
} from "lucide-react";

const WINE = "#8B1A34";
const WINE_DEEP = "#5C1022";
const WINE_LIGHT = "#F9EDF0";

const alerts = [
  {
    title: "Single Origin Ethiopian Yirgacheffe Beans",
    description: "1.5 kg",
    severity: "CRITICAL" as const,
  },
  {
    title: "Oat Milk – Barista Edition",
    description: "3 Cases",
    severity: "WARNING" as const,
  },
  {
    title: "Espresso Machine Cleaning Tablets",
    description: "1 Bottle",
    severity: "CRITICAL" as const,
  },
  {
    title: "Disposable Bio-Cups (8oz)",
    description: "2 Sleeves",
    severity: "WARNING" as const,
  },
  {
    title: "Single Origin Kenya AA",
    description: "2 kg",
    severity: "CRITICAL" as const,
  },
];

const metrics = [
  { label: "Items tracked", value: "142", sub: "across all categories" },
  { label: "Running low",   value: "8",   sub: "need attention soon", accent: true },
  { label: "Urgent",        value: "3",   sub: "immediate action", critical: true },
  { label: "Pending orders",value: "5",   sub: "awaiting approval" },
];

const quickActions = [
  { icon: ClipboardList, label: "Count Stock",    desc: "Confirm uncertain items" },
  { icon: Package,       label: "Inventory",      desc: "Search and review all items" },
  { icon: ShoppingCart,  label: "Orders",         desc: "Review supplier actions" },
];

const navItems = [
  { icon: Home,     label: "Home" },
  { icon: Bell,     label: "Alerts",    badge: 5 },
  { icon: Package,  label: "Inventory" },
  { icon: Users,    label: "Suppliers" },
  { icon: User,     label: "Profile" },
];

export default function DashboardPage() {
  const [activeNav, setActiveNav] = useState("Alerts");

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "#FBF8F9",
        fontFamily: "var(--font-inter, system-ui, sans-serif)",
        paddingBottom: "88px",
      }}
    >
      {/* ── Top Header ── */}
      <header
        className="anim-fade-in"
        style={{
          background: "#FFFFFF",
          borderBottom: "1px solid rgba(139, 26, 52, 0.09)",
          padding: "0 20px",
          position: "sticky",
          top: 0,
          zIndex: 40,
          backdropFilter: "blur(20px)",
        }}
      >
        <div
          style={{
            maxWidth: "720px",
            margin: "0 auto",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            height: "60px",
          }}
        >
          {/* Logo */}
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <div
              style={{
                width: 32,
                height: 32,
                borderRadius: "9px",
                background: `linear-gradient(135deg, ${WINE} 0%, ${WINE_DEEP} 100%)`,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                boxShadow: "0 4px 12px rgba(139,26,52,0.3)",
              }}
            >
              <span
                style={{
                  fontSize: "11px",
                  fontWeight: 800,
                  color: "#fff",
                  letterSpacing: "-0.02em",
                }}
              >
                SP
              </span>
            </div>
            <span
              style={{
                fontSize: "16px",
                fontWeight: 800,
                color: "#1A0A0E",
                letterSpacing: "-0.03em",
              }}
            >
              StockPilot
            </span>
          </div>

          {/* Avatar */}
          <div
            style={{
              width: 34,
              height: 34,
              borderRadius: "50%",
              background: `linear-gradient(135deg, ${WINE} 0%, ${WINE_DEEP} 100%)`,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: "12px",
              fontWeight: 700,
              color: "#fff",
              cursor: "pointer",
              boxShadow: "0 2px 8px rgba(139,26,52,0.25)",
            }}
          >
            RA
          </div>
        </div>
      </header>

      <div style={{ maxWidth: "720px", margin: "0 auto", padding: "24px 20px" }}>

        {/* ── Greeting ── */}
        <div className="anim-fade-up" style={{ marginBottom: "24px" }}>
          <p style={{ fontSize: "13px", fontWeight: 500, color: "#9C7A85", margin: 0 }}>
            Monday, 14 April
          </p>
          <h1
            style={{
              fontSize: "26px",
              fontWeight: 800,
              color: "#1A0A0E",
              margin: "4px 0 0 0",
              letterSpacing: "-0.04em",
              lineHeight: 1.2,
            }}
          >
            Good morning, Rafael
          </h1>
          <p style={{ fontSize: "14px", color: "#7A6870", margin: "4px 0 0 0" }}>
            You have{" "}
            <span style={{ fontWeight: 700, color: WINE }}>3 urgent alerts</span>{" "}
            needing immediate attention.
          </p>
        </div>

        {/* ── Metrics ── */}
        <div
          className="anim-fade-up d-100"
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(2, 1fr)",
            gap: "10px",
            marginBottom: "24px",
          }}
        >
          {metrics.map((m, i) => (
            <div
              key={m.label}
              className={`anim-fade-up d-${(i + 1) * 50 as 50 | 100 | 150 | 200}`}
              style={{
                background: m.critical
                  ? "linear-gradient(135deg, #FEF2F2 0%, #FEE2E2 100%)"
                  : m.accent
                  ? "linear-gradient(135deg, #FFFBEB 0%, #FEF3C7 100%)"
                  : "#FFFFFF",
                border: m.critical
                  ? "1px solid rgba(220, 38, 38, 0.15)"
                  : m.accent
                  ? "1px solid rgba(234, 179, 8, 0.2)"
                  : "1px solid rgba(0,0,0,0.07)",
                borderRadius: "14px",
                padding: "16px",
                boxShadow: "0 1px 4px rgba(0,0,0,0.04)",
              }}
            >
              <p
                style={{
                  fontSize: "11px",
                  fontWeight: 600,
                  color: m.critical ? "#DC2626" : m.accent ? "#B45309" : "#7A6870",
                  margin: 0,
                  textTransform: "uppercase",
                  letterSpacing: "0.08em",
                }}
              >
                {m.label}
              </p>
              <p
                style={{
                  fontSize: "2.4rem",
                  fontWeight: 800,
                  color: m.critical ? "#B91C1C" : m.accent ? "#92400E" : "#1A0A0E",
                  margin: "6px 0 0 0",
                  lineHeight: 1,
                  letterSpacing: "-0.04em",
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {m.value}
              </p>
              <p
                style={{
                  fontSize: "11px",
                  color: m.critical ? "#EF4444" : m.accent ? "#D97706" : "#9C7A85",
                  margin: "4px 0 0 0",
                }}
              >
                {m.sub}
              </p>
            </div>
          ))}
        </div>

        {/* ── Quick Actions ── */}
        <div
          className="anim-fade-up d-200"
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(3, 1fr)",
            gap: "10px",
            marginBottom: "28px",
          }}
        >
          {quickActions.map((action, i) => {
            const IconComp = action.icon;
            return (
              <button
                key={action.label}
                className={`anim-fade-up d-${(i + 2) * 100 as 200 | 300 | 400}`}
                style={{
                  background: "#FFFFFF",
                  border: "1px solid rgba(0,0,0,0.07)",
                  borderRadius: "14px",
                  padding: "16px 12px",
                  cursor: "pointer",
                  textAlign: "left",
                  transition: "all 0.25s cubic-bezier(0.16, 1, 0.3, 1)",
                }}
                onMouseEnter={(e) => {
                  const el = e.currentTarget;
                  el.style.border = `1px solid rgba(139, 26, 52, 0.2)`;
                  el.style.boxShadow = "0 8px 24px rgba(139, 26, 52, 0.1)";
                  el.style.transform = "translateY(-2px)";
                }}
                onMouseLeave={(e) => {
                  const el = e.currentTarget;
                  el.style.border = "1px solid rgba(0,0,0,0.07)";
                  el.style.boxShadow = "none";
                  el.style.transform = "translateY(0)";
                }}
              >
                <div
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: "10px",
                    background: WINE_LIGHT,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    marginBottom: "10px",
                  }}
                >
                  <IconComp style={{ width: 18, height: 18, color: WINE }} />
                </div>
                <p
                  style={{
                    fontSize: "13px",
                    fontWeight: 700,
                    color: "#1A0A0E",
                    margin: 0,
                    letterSpacing: "-0.01em",
                  }}
                >
                  {action.label}
                </p>
                <p
                  style={{
                    fontSize: "11px",
                    color: "#9C7A85",
                    margin: "3px 0 0 0",
                    lineHeight: 1.4,
                  }}
                >
                  {action.desc}
                </p>
              </button>
            );
          })}
        </div>

        {/* ── Urgent Alerts ── */}
        <div className="anim-fade-up d-300">
          {/* Section header */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              marginBottom: "14px",
            }}
          >
            <div>
              <h2
                style={{
                  fontSize: "18px",
                  fontWeight: 800,
                  color: "#1A0A0E",
                  margin: 0,
                  letterSpacing: "-0.03em",
                }}
              >
                Urgent Alerts
              </h2>
              <p style={{ fontSize: "13px", color: "#9C7A85", margin: "2px 0 0 0" }}>
                Immediate action required
              </p>
            </div>
            <button
              style={{
                display: "flex",
                alignItems: "center",
                gap: "4px",
                background: "none",
                border: "none",
                color: WINE,
                fontSize: "13px",
                fontWeight: 600,
                cursor: "pointer",
                padding: "4px 0",
              }}
            >
              View all <ArrowRight style={{ width: 14, height: 14 }} />
            </button>
          </div>

          {/* Alert cards */}
          <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
            {alerts.map((alert, i) => (
              <AlertCard
                key={i}
                title={alert.title}
                description={alert.description}
                severity={alert.severity}
                animDelay={i * 60}
                actionLabel="Reorder Now"
              />
            ))}
          </div>
        </div>
      </div>

      {/* ── Bottom Navigation ── */}
      <nav
        style={{
          position: "fixed",
          bottom: 0,
          left: 0,
          right: 0,
          background: "rgba(255,255,255,0.96)",
          backdropFilter: "blur(20px)",
          borderTop: "1px solid rgba(139,26,52,0.09)",
          zIndex: 50,
        }}
      >
        <div
          style={{
            maxWidth: "720px",
            margin: "0 auto",
            display: "grid",
            gridTemplateColumns: "repeat(5, 1fr)",
            padding: "8px 8px 12px",
          }}
        >
          {navItems.map((item) => {
            const IconComp = item.icon;
            const isActive = activeNav === item.label;
            return (
              <button
                key={item.label}
                onClick={() => setActiveNav(item.label)}
                style={{
                  background: "none",
                  border: "none",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  gap: "4px",
                  padding: "8px 4px",
                  cursor: "pointer",
                  borderRadius: "10px",
                  position: "relative",
                  transition: "all 0.2s",
                }}
              >
                <div style={{ position: "relative" }}>
                  <IconComp
                    style={{
                      width: 20,
                      height: 20,
                      color: isActive ? WINE : "#9C7A85",
                      transition: "color 0.2s",
                    }}
                  />
                  {item.badge && (
                    <span
                      style={{
                        position: "absolute",
                        top: "-4px",
                        right: "-6px",
                        minWidth: "16px",
                        height: "16px",
                        background: WINE,
                        color: "#fff",
                        borderRadius: "100px",
                        fontSize: "9px",
                        fontWeight: 700,
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        padding: "0 3px",
                        border: "2px solid #fff",
                      }}
                    >
                      {item.badge}
                    </span>
                  )}
                </div>
                <span
                  style={{
                    fontSize: "10px",
                    fontWeight: isActive ? 700 : 500,
                    color: isActive ? WINE : "#9C7A85",
                    transition: "all 0.2s",
                    letterSpacing: "0.01em",
                  }}
                >
                  {item.label}
                </span>
                {/* Active indicator */}
                {isActive && (
                  <span
                    style={{
                      position: "absolute",
                      top: 0,
                      left: "50%",
                      transform: "translateX(-50%)",
                      width: "20px",
                      height: "2px",
                      background: WINE,
                      borderRadius: "0 0 4px 4px",
                    }}
                  />
                )}
              </button>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
