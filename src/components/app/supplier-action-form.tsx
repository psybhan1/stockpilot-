"use client";

import { useState } from "react";

type Action = "CONFIRMED" | "OUT_OF_STOCK" | "DELAYED";

export function SupplierActionForm({
  token,
  supplierName,
}: {
  token: string;
  supplierName: string;
}) {
  const [selected, setSelected] = useState<Action | null>(null);
  const [eta, setEta] = useState("");
  const [note, setNote] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "done" | "error">(
    "idle"
  );
  const [error, setError] = useState<string | null>(null);

  if (status === "done") {
    return (
      <div
        style={{
          background: "#ecfdf5",
          border: "1px solid #a7f3d0",
          borderRadius: 12,
          padding: "24px 20px",
          textAlign: "center",
        }}
      >
        <div style={{ fontSize: 44, lineHeight: 1 }}>
          {selected === "CONFIRMED" ? "✅" : selected === "OUT_OF_STOCK" ? "⚠️" : "⏰"}
        </div>
        <div
          style={{
            marginTop: 8,
            fontSize: 18,
            fontWeight: 600,
            color: "#065f46",
          }}
        >
          Thanks, {supplierName}.
        </div>
        <div style={{ marginTop: 4, fontSize: 14, color: "#047857" }}>
          We've logged your response — the business has been notified in real
          time. You can close this page.
        </div>
      </div>
    );
  }

  const submit = async (action: Action) => {
    if ((action === "DELAYED" || action === "CONFIRMED") && eta.trim() === "" && action === "DELAYED") {
      setError("Please provide the delivery date we should expect.");
      setSelected(action);
      return;
    }
    setStatus("sending");
    setError(null);
    try {
      const res = await fetch("/api/suppliers/action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token,
          action,
          eta: eta.trim() || undefined,
          note: note.trim() || undefined,
        }),
      });
      const payload = (await res.json()) as { ok?: boolean; message?: string };
      if (!res.ok || !payload.ok) {
        throw new Error(payload.message ?? "Something went wrong");
      }
      setSelected(action);
      setStatus("done");
    } catch (err) {
      setStatus("error");
      setError(err instanceof Error ? err.message : "Unknown error");
    }
  };

  return (
    <div>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr",
          gap: 10,
          marginBottom: 16,
        }}
      >
        <ActionButton
          icon="✅"
          label="Confirm order"
          helper="We'll fulfil as requested."
          tone="green"
          disabled={status === "sending"}
          selected={selected === "CONFIRMED"}
          onClick={() => {
            setSelected("CONFIRMED");
            setError(null);
          }}
        />
        <ActionButton
          icon="⏰"
          label="Delayed — can deliver on a different date"
          helper="We can fulfil, just not in the usual window."
          tone="amber"
          disabled={status === "sending"}
          selected={selected === "DELAYED"}
          onClick={() => {
            setSelected("DELAYED");
            setError(null);
          }}
        />
        <ActionButton
          icon="⚠️"
          label="Out of stock — can't fulfil"
          helper="The business will be notified so they can reorder elsewhere."
          tone="red"
          disabled={status === "sending"}
          selected={selected === "OUT_OF_STOCK"}
          onClick={() => {
            setSelected("OUT_OF_STOCK");
            setError(null);
          }}
        />
      </div>

      {selected ? (
        <div style={{ display: "grid", gap: 12, marginBottom: 12 }}>
          {(selected === "DELAYED" || selected === "CONFIRMED") && (
            <label style={{ display: "grid", gap: 6 }}>
              <span style={{ fontSize: 13, color: "#4b5563", fontWeight: 500 }}>
                {selected === "DELAYED"
                  ? "Expected delivery date / time"
                  : "Delivery date / time (optional)"}
              </span>
              <input
                type="text"
                value={eta}
                onChange={(e) => setEta(e.target.value)}
                placeholder="e.g. Friday by 2pm, or 2026-04-19"
                style={{
                  padding: "10px 12px",
                  border: "1px solid #d1d5db",
                  borderRadius: 10,
                  fontSize: 14,
                  outline: "none",
                }}
              />
            </label>
          )}
          <label style={{ display: "grid", gap: 6 }}>
            <span style={{ fontSize: 13, color: "#4b5563", fontWeight: 500 }}>
              Note (optional)
            </span>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={
                selected === "OUT_OF_STOCK"
                  ? "e.g. Back in stock next Monday, suggest substituting X…"
                  : selected === "DELAYED"
                  ? "e.g. Partial quantity available now, rest by Friday…"
                  : "Anything to pass along to the team"
              }
              rows={3}
              style={{
                padding: "10px 12px",
                border: "1px solid #d1d5db",
                borderRadius: 10,
                fontSize: 14,
                outline: "none",
                resize: "vertical",
                fontFamily: "inherit",
              }}
            />
          </label>

          <button
            type="button"
            onClick={() => submit(selected)}
            disabled={status === "sending"}
            style={{
              padding: "12px 14px",
              background: status === "sending" ? "#9ca3af" : "#111827",
              color: "white",
              border: "none",
              borderRadius: 10,
              fontSize: 15,
              fontWeight: 600,
              cursor: status === "sending" ? "wait" : "pointer",
            }}
          >
            {status === "sending"
              ? "Sending…"
              : selected === "CONFIRMED"
              ? "Send confirmation"
              : selected === "DELAYED"
              ? "Let the business know about the delay"
              : "Let the business know"}
          </button>
        </div>
      ) : null}

      {error ? (
        <div
          style={{
            padding: "10px 14px",
            borderRadius: 10,
            background: "#fef2f2",
            border: "1px solid #fecaca",
            color: "#991b1b",
            fontSize: 13,
          }}
        >
          {error}
        </div>
      ) : null}
    </div>
  );
}

function ActionButton({
  icon,
  label,
  helper,
  tone,
  selected,
  disabled,
  onClick,
}: {
  icon: string;
  label: string;
  helper: string;
  tone: "green" | "amber" | "red";
  selected: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  const ring =
    tone === "green" ? "#10b981" : tone === "amber" ? "#f59e0b" : "#ef4444";
  const background = selected
    ? tone === "green"
      ? "#ecfdf5"
      : tone === "amber"
      ? "#fffbeb"
      : "#fef2f2"
    : "white";
  const border = selected ? ring : "#e5e7eb";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        textAlign: "left",
        padding: "14px 16px",
        background,
        border: `2px solid ${border}`,
        borderRadius: 12,
        cursor: disabled ? "not-allowed" : "pointer",
        opacity: disabled && !selected ? 0.6 : 1,
        transition: "border-color .15s, background-color .15s",
        display: "flex",
        gap: 12,
        alignItems: "flex-start",
      }}
    >
      <span style={{ fontSize: 22, lineHeight: 1 }}>{icon}</span>
      <span style={{ flex: 1 }}>
        <span
          style={{
            display: "block",
            fontWeight: 600,
            color: "#111827",
            fontSize: 15,
          }}
        >
          {label}
        </span>
        <span
          style={{
            display: "block",
            marginTop: 2,
            color: "#6b7280",
            fontSize: 13,
          }}
        >
          {helper}
        </span>
      </span>
    </button>
  );
}
