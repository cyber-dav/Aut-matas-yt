import React from "react";
import { AbsoluteFill, interpolate, useCurrentFrame, useVideoConfig } from "remotion";
import type { TimelineCue } from "../types";

export const SERIF = "'Cormorant Garamond', Georgia, serif";
export const SANS = "'Source Sans 3', 'Helvetica Neue', Arial, sans-serif";
export const ACCENT = "#9e1b1b";
export const PAPER = "#efe4cf";

/** Subtítulos quemados: máx. 2 líneas, sombra marcada. `vertical` = estilo Shorts (grande y centrado). */
export const Subtitles: React.FC<{ cues: TimelineCue[]; vertical?: boolean }> = ({ cues, vertical = false }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const t = frame / fps;
  const cue = cues.find((c) => t >= c.start && t < c.end);
  if (!cue) return null;
  return (
    <AbsoluteFill
      style={{
        justifyContent: vertical ? "center" : "flex-end",
        alignItems: "center",
        paddingBottom: vertical ? 0 : 70,
        paddingTop: vertical ? 620 : 0,
      }}
    >
      <div
        style={{
          fontFamily: SANS,
          fontWeight: vertical ? 800 : 600,
          fontSize: vertical ? 74 : 48,
          lineHeight: 1.22,
          color: "#fff",
          textAlign: "center",
          maxWidth: vertical ? 940 : 1500,
          padding: vertical ? "0 40px" : "6px 22px",
          textShadow: "0 0 6px rgba(0,0,0,0.95), 0 3px 10px rgba(0,0,0,0.9), 0 0 2px #000",
          WebkitTextStroke: vertical ? "2px rgba(0,0,0,0.65)" : undefined,
          paintOrder: "stroke fill",
          textTransform: vertical ? "uppercase" : undefined,
        }}
      >
        {cue.lines.map((l, i) => (
          <div key={i}>{l}</div>
        ))}
      </div>
    </AbsoluteFill>
  );
};

/** Rótulo elegante (fecha/lugar) en la esquina superior izquierda. */
export const Lower: React.FC<{ text: string; durationInFrames: number }> = ({ text, durationInFrames }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const visible = Math.min(durationInFrames, 5 * fps);
  const opacity = interpolate(frame, [0, 12, visible - 15, visible], [0, 1, 1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const lineW = interpolate(frame, [0, 20], [0, 120], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return (
    <AbsoluteFill style={{ padding: "70px 90px", opacity }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        <div style={{ width: lineW, height: 3, backgroundColor: ACCENT }} />
        <div
          style={{
            fontFamily: SERIF,
            fontStyle: "italic",
            fontWeight: 600,
            fontSize: 44,
            color: PAPER,
            letterSpacing: 1,
            textShadow: "0 2px 12px rgba(0,0,0,0.9)",
          }}
        >
          {text}
        </div>
      </div>
    </AbsoluteFill>
  );
};
