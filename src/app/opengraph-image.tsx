import { ImageResponse } from "next/og";

export const size = {
  width: 1200,
  height: 630,
};

export const contentType = "image/png";

export default function OpenGraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          display: "flex",
          height: "100%",
          width: "100%",
          background:
            "radial-gradient(circle at 18% 10%, rgba(245,158,11,0.18), transparent 26%), linear-gradient(180deg, #fffaf3 0%, #f7f4ee 100%)",
          color: "#1c1917",
          padding: "52px",
          fontFamily: "Inter, Segoe UI, sans-serif",
        }}
      >
        <div
          style={{
            display: "flex",
            width: "100%",
            borderRadius: 36,
            border: "1px solid rgba(120,113,108,0.14)",
            background: "rgba(255,255,255,0.76)",
            boxShadow: "0 24px 80px rgba(28,25,23,0.08)",
            padding: "42px",
            justifyContent: "space-between",
            gap: 40,
          }}
        >
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              justifyContent: "space-between",
              maxWidth: 660,
            }}
          >
            <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
                <div
                  style={{
                    display: "flex",
                    height: 78,
                    width: 78,
                    alignItems: "center",
                    justifyContent: "center",
                    borderRadius: 22,
                    background:
                      "linear-gradient(145deg, rgba(124,45,18,1) 0%, rgba(217,119,6,1) 100%)",
                    color: "white",
                    fontSize: 36,
                    fontWeight: 700,
                  }}
                >
                  SP
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  <div
                    style={{
                      fontSize: 18,
                      textTransform: "uppercase",
                      letterSpacing: "0.28em",
                      color: "#b45309",
                    }}
                  >
                    Inventory operating system
                  </div>
                  <div style={{ fontSize: 34, fontWeight: 700 }}>StockPilot</div>
                </div>
              </div>
              <div style={{ fontSize: 64, lineHeight: 1.02, fontWeight: 700 }}>
                Prevent stockouts before the rush turns into supplier chaos.
              </div>
              <div style={{ fontSize: 28, lineHeight: 1.4, color: "#57534e" }}>
                AI-assisted inventory math, fast stock counts, approval-first reordering, and
                calmer daily operations for cafes, bakeries, and small restaurants.
              </div>
            </div>
            <div style={{ display: "flex", gap: 14 }}>
              {["Deterministic ledger", "Square sales sync", "Approval-first orders"].map(
                (item) => (
                  <div
                    key={item}
                    style={{
                      borderRadius: 9999,
                      border: "1px solid rgba(120,113,108,0.16)",
                      background: "rgba(255,255,255,0.74)",
                      padding: "14px 20px",
                      fontSize: 22,
                      color: "#44403c",
                    }}
                  >
                    {item}
                  </div>
                )
              )}
            </div>
          </div>

          <div
            style={{
              display: "flex",
              width: 320,
              flexDirection: "column",
              gap: 16,
            }}
          >
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 14,
                borderRadius: 28,
                background: "#292524",
                color: "white",
                padding: "24px",
              }}
            >
              <div
                style={{
                  fontSize: 18,
                  textTransform: "uppercase",
                  letterSpacing: "0.2em",
                  color: "rgba(255,255,255,0.55)",
                }}
              >
                Today
              </div>
              <div style={{ fontSize: 34, fontWeight: 700 }}>3 items need attention</div>
              <div style={{ fontSize: 22, lineHeight: 1.35, color: "rgba(255,255,255,0.74)" }}>
                Oat milk, hot cup lids, and vanilla syrup are trending toward stockout before the
                next supplier window.
              </div>
            </div>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 12,
                borderRadius: 28,
                border: "1px solid rgba(120,113,108,0.16)",
                background: "rgba(255,255,255,0.78)",
                padding: "24px",
              }}
            >
              <div style={{ fontSize: 18, color: "#78716c" }}>Quick flows</div>
              <div style={{ fontSize: 24, fontWeight: 600 }}>Count stock</div>
              <div style={{ fontSize: 24, fontWeight: 600 }}>Review orders</div>
              <div style={{ fontSize: 24, fontWeight: 600 }}>Approve supplier work</div>
            </div>
          </div>
        </div>
      </div>
    ),
    size
  );
}
