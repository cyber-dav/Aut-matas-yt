import React from "react";
import { AbsoluteFill, interpolate, Sequence, staticFile, useCurrentFrame, useVideoConfig } from "remotion";
import { Audio } from "@remotion/media";
import { KenBurns } from "./components/KenBurns";
import { ACCENT, PAPER, SERIF, Subtitles } from "./components/Text";
import type { ShortProps } from "./types";

export const Short: React.FC<ShortProps> = (p) => {
  const { fps } = useVideoConfig();
  const fade = Math.round(0.3 * fps);
  const total = Math.round(p.totalSeconds * fps);
  const ctaFrom = total - Math.round(p.ctaSeconds * fps);
  return (
    <AbsoluteFill style={{ backgroundColor: "#0b0806" }}>
      {p.scenes.map((s, i) => {
        const from = Math.max(0, Math.round(s.start * fps) - (i === 0 ? 0 : fade));
        const dur = Math.max(1, Math.round(s.end * fps) - from + fade);
        return (
          <Sequence key={s.id} from={from} durationInFrames={dur}>
            <KenBurns src={s.image} camera={s.camera === "zoom-in" || s.camera === "zoom-out" ? (i % 2 ? "pan-left" : "pan-right") : s.camera} durationInFrames={dur} fade={fade} fadeIn={i > 0} vertical />
          </Sequence>
        );
      })}
      <Subtitles cues={p.cues} vertical />
      <Sequence durationInFrames={Math.round(2.6 * fps)}>
        <Hook text={p.hook} />
      </Sequence>
      <Sequence from={ctaFrom}>
        <Cta text={p.cta} channelName={p.channelName} />
      </Sequence>
      <Audio src={staticFile(p.audio)} />
    </AbsoluteFill>
  );
};

/** Gancho visible desde el primer fotograma (sin fundido de entrada). */
const Hook: React.FC<{ text: string }> = ({ text }) => {
  const frame = useCurrentFrame();
  const opacity = interpolate(frame, [60, 78], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
  return (
    <AbsoluteFill style={{ justifyContent: "flex-start", alignItems: "center", paddingTop: 260, opacity }}>
      <div
        style={{
          fontFamily: SERIF,
          fontWeight: 700,
          fontSize: 96,
          lineHeight: 1.05,
          color: PAPER,
          textAlign: "center",
          textTransform: "uppercase",
          padding: "0 60px",
          textShadow: "0 4px 24px rgba(0,0,0,0.95), 0 0 4px #000",
        }}
      >
        {text}
      </div>
      <div style={{ marginTop: 26, width: 220, height: 6, backgroundColor: ACCENT }} />
    </AbsoluteFill>
  );
};

const Cta: React.FC<{ text: string; channelName: string }> = ({ text, channelName }) => {
  const frame = useCurrentFrame();
  const opacity = interpolate(frame, [0, 10], [0, 1], { extrapolateRight: "clamp" });
  return (
    <AbsoluteFill style={{ backgroundColor: "rgba(8,6,4,0.78)", justifyContent: "center", alignItems: "center", opacity, gap: 30, padding: 60 }}>
      <div style={{ fontFamily: SERIF, fontWeight: 700, fontSize: 84, color: PAPER, textAlign: "center", lineHeight: 1.1 }}>{text}</div>
      <div style={{ width: 200, height: 5, backgroundColor: ACCENT }} />
      <div style={{ fontFamily: SERIF, fontSize: 54, color: "#c9b99a", letterSpacing: 6, textTransform: "uppercase" }}>{channelName}</div>
    </AbsoluteFill>
  );
};
