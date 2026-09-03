import { ImageResponse } from "next/og";

export const runtime = "edge";
export const alt = "Renuvo — What are your customers really saying about you?";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OgImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: 72,
          background: "linear-gradient(180deg, #FBFBFE 0%, #EBE7FF 100%)",
          color: "#07070B",
          fontFamily: "ui-sans-serif, system-ui, sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <div
            style={{
              width: 48,
              height: 48,
              borderRadius: 14,
              background: "linear-gradient(135deg, #AE9DFD, #7E67F2)",
            }}
          />
          <div style={{ fontSize: 28, letterSpacing: -0.5 }}>Renuvo</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 20, maxWidth: 920 }}>
          <div style={{ fontSize: 64, lineHeight: 1.05, letterSpacing: -1.6, fontWeight: 500 }}>
            What are your customers really saying about you?
          </div>
          <div style={{ fontSize: 26, color: "#6B6B76", lineHeight: 1.35, maxWidth: 780 }}>
            Forward the complaints you already get. See the patterns before they cost you customers.
          </div>
        </div>
        <div style={{ fontSize: 20, color: "#7E67F2" }}>renuvo.io</div>
      </div>
    ),
    { ...size },
  );
}
