import { ImageResponse } from "next/og";

export const size = {
  width: 180,
  height: 180,
};

export const contentType = "image/png";

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          display: "flex",
          height: "100%",
          width: "100%",
          alignItems: "center",
          justifyContent: "center",
          background:
            "linear-gradient(145deg, rgba(124,45,18,1) 0%, rgba(217,119,6,1) 100%)",
          borderRadius: 44,
          position: "relative",
        }}
      >
        <div
          style={{
            position: "absolute",
            inset: 0,
            background:
              "radial-gradient(circle at 30% 18%, rgba(255,255,255,0.35), transparent 32%)",
            borderRadius: 44,
          }}
        />
        <div
          style={{
            display: "flex",
            height: 96,
            width: 96,
            alignItems: "center",
            justifyContent: "center",
            borderRadius: 9999,
            background: "rgba(255,247,237,0.18)",
            border: "4px solid rgba(255,255,255,0.3)",
          }}
        >
          <div
            style={{
              display: "flex",
              height: 62,
              width: 62,
              alignItems: "center",
              justifyContent: "center",
              borderRadius: 9999,
              background: "white",
              position: "relative",
            }}
          >
            <div
              style={{
                position: "absolute",
                height: 6,
                width: 44,
                borderRadius: 9999,
                background: "#f59e0b",
              }}
            />
            <div
              style={{
                position: "absolute",
                height: 44,
                width: 6,
                borderRadius: 9999,
                background: "#f59e0b",
              }}
            />
            <div
              style={{
                height: 18,
                width: 18,
                borderRadius: 9999,
                background: "#7c2d12",
              }}
            />
          </div>
        </div>
      </div>
    ),
    size
  );
}
