import React from "react";
import { AbsoluteFill, Easing, interpolate, Sequence, useCurrentFrame, useVideoConfig } from "remotion";
import { Audio } from "@remotion/media";
import { staticFile } from "remotion";
import { KenBurns } from "./components/KenBurns";
import { ACCENT, Lower, PAPER, SERIF, SANS, Subtitles } from "./components/Text";
import type { EpisodeProps } from "./types";

export const Episode: React.FC<EpisodeProps> = (p) => {
  const { fps } = useVideoConfig();
  const fade = Math.round(p.crossfadeSeconds * fps);
  const total = Math.round(p.totalSeconds * fps);
  const outroFrom = Math.round((p.totalSeconds - p.outroSeconds) * fps);

  return (
    <AbsoluteFill style={{ backgroundColor: "#0b0806" }}>
      {p.scenes.map((s, i) => {
        // Cada escena se solapa con la siguiente durante el fundido.
        const from = Math.max(0, Math.round(s.start * fps) - (i === 0 ? 0 : Math.round(fade / 2)));
        const to = Math.min(outroFrom + fade, Math.round(s.end * fps) + Math.round(fade / 2));
        const dur = Math.max(1, to - from);
        return (
          <Sequence key={s.id} from={from} durationInFrames={dur} name={`Escena ${s.id}`}>
            <KenBurns src={s.image} camera={s.camera} durationInFrames={dur} fade={fade} />
            {s.onScreenText ? (
              <Sequence from={Math.round(fade / 2)} durationInFrames={dur} layout="none">
                <Lower text={s.onScreenText} durationInFrames={dur} />
              </Sequence>
            ) : null}
          </Sequence>
        );
      })}

      <Sequence durationInFrames={Math.round(p.introSeconds * fps) + fade} name="Intro">
        <Intro channelName={p.channelName} title={p.title} durationInFrames={Math.round(p.introSeconds * fps) + fade} />
      </Sequence>

      <Sequence from={outroFrom} durationInFrames={total - outroFrom} name="Outro">
        <Outro channelName={p.channelName} image={p.outroImage} durationInFrames={total - outroFrom} />
      </Sequence>

      <Subtitles cues={p.cues} />
      <Audio src={staticFile(p.audio)} />
    </AbsoluteFill>
  );
};

const Intro: React.FC<{ channelName: string; title: string; durationInFrames: number }> = ({ channelName, title, durationInFrames }) => {
  const frame = useCurrentFrame();
  const opacity = interpolate(frame, [0, 15, durationInFrames - 18, durationInFrames], [0, 1, 1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const spacing = interpolate(frame, [0, durationInFrames], [14, 22], { extrapolateRight: "clamp" });
  const line = interpolate(frame, [8, 40], [0, 360], { extrapolateLeft: "clamp", extrapolateRight: "clamp", easing: Easing.bezier(0.16, 1, 0.3, 1) });
  return (
    <AbsoluteFill style={{ backgroundColor: "#0b0806", opacity, justifyContent: "center", alignItems: "center", gap: 28 }}>
      <div style={{ fontFamily: SERIF, fontWeight: 700, fontSize: 110, color: PAPER, letterSpacing: spacing, textTransform: "uppercase" }}>
        {channelName}
      </div>
      <div style={{ width: line, height: 3, backgroundColor: ACCENT }} />
      <div style={{ fontFamily: SERIF, fontStyle: "italic", fontSize: 46, color: "#c9b99a", maxWidth: 1400, textAlign: "center" }}>
        {title}
      </div>
    </AbsoluteFill>
  );
};

/** Pantalla final: deja libre la zona de tarjetas de YouTube (vídeo y suscripción). */
const Outro: React.FC<{ channelName: string; image: string; durationInFrames: number }> = ({ channelName, image, durationInFrames }) => {
  const frame = useCurrentFrame();
  const fadeIn = interpolate(frame, [0, 20], [0, 1], { extrapolateRight: "clamp" });
  return (
    <AbsoluteFill style={{ opacity: fadeIn }}>
      <AbsoluteFill style={{ filter: "blur(6px) brightness(0.35)" }}>
        <KenBurns src={image} camera="zoom-in" durationInFrames={durationInFrames} fade={0} />
      </AbsoluteFill>
      <AbsoluteFill style={{ alignItems: "center", paddingTop: 110 }}>
        <div style={{ fontFamily: SERIF, fontWeight: 700, fontSize: 72, color: PAPER, letterSpacing: 10, textTransform: "uppercase" }}>
          {channelName}
        </div>
        <div style={{ marginTop: 14, fontFamily: SANS, fontSize: 34, color: "#c9b99a" }}>
          Sigue investigando con nosotros
        </div>
      </AbsoluteFill>
      {/* Huecos guía para las tarjetas finales (se verán solo como marcos tenues) */}
      <AbsoluteFill style={{ flexDirection: "row", justifyContent: "center", alignItems: "center", gap: 120, paddingTop: 140 }}>
        <div style={{ width: 760, height: 428, border: "2px solid rgba(239,228,207,0.25)", borderRadius: 8 }} />
        <div style={{ width: 340, height: 340, border: "2px solid rgba(239,228,207,0.25)", borderRadius: "50%" }} />
      </AbsoluteFill>
    </AbsoluteFill>
  );
};
