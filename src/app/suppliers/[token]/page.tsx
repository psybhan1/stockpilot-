/**
 * Public supplier-facing page reached via the signed link we embed
 * in every PO email. No login, no auth beyond the token itself —
 * the supplier sees the order summary and three big action buttons.
 */

import { notFound } from "next/navigation";
import Link from "next/link";

import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { verifySupplierActionToken } from "@/lib/supplier-action-token";
import { SupplierActionForm } from "@/components/app/supplier-action-form";

type Props = {
  params: Promise<{ token: string }>;
};

export default async function SupplierActionPage({ params }: Props) {
  const { token } = await params;
  const verification = verifySupplierActionToken(token);

  if (!verification.ok) {
    return (
      <ErrorShell
        title="This link has expired or isn't valid"
        detail={
          verification.reason === "expired"
            ? "For security, the link in your purchase-order email only works for a limited window. Please reply to that email directly or contact the business."
            : "We couldn't verify this link. Please reply to the original email from the business instead."
        }
      />
    );
  }

  const po = await db.purchaseOrder.findUnique({
    where: { id: verification.payload.poId },
    include: {
      supplier: { select: { name: true, contactName: true } },
      location: { select: { name: true, business: { select: { name: true } } } },
      lines: {
        select: {
          description: true,
          quantityOrdered: true,
          purchaseUnit: true,
          inventoryItem: { select: { name: true } },
        },
      },
      communications: {
        where: { direction: "INBOUND" },
        select: { id: true, metadata: true, createdAt: true },
        orderBy: { createdAt: "desc" },
        take: 1,
      },
    },
  });

  if (!po) notFound();

  const businessName =
    po.location?.business?.name?.trim() || po.location?.name?.trim() || "The business";
  const locationLabel = po.location?.name?.trim() || null;
  const alreadyResponded = po.communications[0];
  const previousAction =
    alreadyResponded?.metadata && typeof alreadyResponded.metadata === "object"
      ? ((alreadyResponded.metadata as Record<string, unknown>).intent as string | undefined)
      : undefined;

  return (
    <div
      style={{
        minHeight: "100vh",
        background: "linear-gradient(180deg, #f3f4f6, #e5e7eb)",
        fontFamily:
          "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
        color: "#111827",
        padding: "32px 12px",
      }}
    >
      <div
        style={{
          maxWidth: 640,
          margin: "0 auto",
          background: "white",
          borderRadius: 16,
          boxShadow:
            "0 1px 2px rgba(0,0,0,0.04), 0 10px 30px rgba(17,24,39,0.08)",
          overflow: "hidden",
        }}
      >
        <div style={{ padding: "28px 32px 8px 32px" }}>
          <div
            style={{
              fontSize: 12,
              letterSpacing: ".14em",
              textTransform: "uppercase",
              color: "#6b7280",
              fontWeight: 600,
            }}
          >
            Purchase Order
          </div>
          <div
            style={{
              marginTop: 6,
              fontSize: 26,
              fontWeight: 600,
              color: "#111827",
            }}
          >
            {po.orderNumber}
          </div>
          <div
            style={{
              marginTop: 4,
              fontSize: 14,
              color: "#6b7280",
            }}
          >
            From {businessName}
            {locationLabel ? ` — ${locationLabel}` : ""}
          </div>
        </div>

        <div style={{ padding: "16px 32px 0 32px" }}>
          <div
            style={{
              background: "#f9fafb",
              borderRadius: 12,
              border: "1px solid #e5e7eb",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                padding: "10px 16px",
                fontSize: 11,
                textTransform: "uppercase",
                letterSpacing: ".08em",
                color: "#6b7280",
                fontWeight: 600,
                borderBottom: "1px solid #e5e7eb",
              }}
            >
              Items requested
            </div>
            {po.lines.map((line, idx) => (
              <div
                key={idx}
                style={{
                  padding: "12px 16px",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  borderBottom:
                    idx === po.lines.length - 1 ? "none" : "1px solid #eef0f3",
                  background: idx % 2 === 0 ? "white" : "#fafafa",
                }}
              >
                <div style={{ fontWeight: 500 }}>
                  {line.description || line.inventoryItem.name}
                </div>
                <div
                  style={{
                    fontVariantNumeric: "tabular-nums",
                    color: "#111827",
                    fontWeight: 500,
                  }}
                >
                  {line.quantityOrdered} {line.purchaseUnit.toLowerCase()}
                </div>
              </div>
            ))}
          </div>
        </div>

        {alreadyResponded && previousAction ? (
          <div
            style={{
              margin: "20px 32px 0",
              padding: "12px 16px",
              background: "#ecfdf5",
              border: "1px solid #a7f3d0",
              borderRadius: 10,
              color: "#065f46",
              fontSize: 14,
            }}
          >
            You've already responded ({previousAction.replace(/_/g, " ").toLowerCase()}) on{" "}
            {new Date(alreadyResponded.createdAt).toLocaleString()}. You can
            submit a new response below and it will supersede the earlier one.
          </div>
        ) : null}

        <div style={{ padding: "20px 32px 28px 32px" }}>
          <div style={{ fontSize: 15, marginBottom: 14, color: "#111827" }}>
            Hi {po.supplier.contactName?.trim() || po.supplier.name},
            <br />
            Thanks for checking in. Pick an option below and we'll update the
            order in our system immediately.
          </div>
          <SupplierActionForm token={token} supplierName={po.supplier.name} />
        </div>

        <div
          style={{
            padding: "14px 32px 22px 32px",
            borderTop: "1px solid #f1f5f9",
            fontSize: 12,
            color: "#9ca3af",
          }}
        >
          This page replaces the need to reply to the email. Sent by{" "}
          {businessName} via StockPilot.{" "}
          {env.APP_URL ? (
            <Link href={env.APP_URL} style={{ color: "#9ca3af" }}>
              stockpilot
            </Link>
          ) : (
            "stockpilot"
          )}
        </div>
      </div>
    </div>
  );
}

function ErrorShell({ title, detail }: { title: string; detail: string }) {
  return (
    <div
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        background: "#f3f4f6",
        fontFamily:
          "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
        padding: 24,
      }}
    >
      <div
        style={{
          maxWidth: 520,
          background: "white",
          borderRadius: 16,
          padding: "32px 32px 28px 32px",
          boxShadow: "0 1px 2px rgba(0,0,0,0.04), 0 10px 30px rgba(17,24,39,0.08)",
        }}
      >
        <div style={{ fontSize: 22, fontWeight: 600, marginBottom: 10 }}>{title}</div>
        <div style={{ color: "#4b5563", fontSize: 15, lineHeight: 1.55 }}>
          {detail}
        </div>
      </div>
    </div>
  );
}
