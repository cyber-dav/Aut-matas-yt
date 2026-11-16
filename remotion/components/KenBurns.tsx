import React from "react";
import { AbsoluteFill, Easing, Img, interpolate, staticFile, useCurrentFrame } from "remotion";
import type { Camera } from "../types";

/**
 * Imagen fija con movimiento suave de cámara. `durationInFrames` es la duración visible
 * de la escena (incluidos los fundidos), `fade` los fotogramas de fundido de entrada/salida.
 */
export const KenBurns: React.FC<{
  src: string;
  camera: Camera;
  durationInFrames: number;
  fade: number;
  fadeIn?: boolean;
  fadeOut?: boolean;
  /** Para vertical: la imagen 16:9 se recorta en el centro y se mueve más en horizontal. */
  vertical?: boolean;
}> = ({ src, camera, durationInFrames, fade, fadeIn = true, fadeOut = true, vertical = false }) => {
  const frame = useCurrentFrame();
  const t = interpolate(frame, [0, durationInFrames], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
    easing: Easing.bezier(0.33, 0, 0.67, 1),
  });
  const zoom = 0.08;
  const base = 1.06;
  const scale =
    camera === "zoom-in" ? base + zoom * t : camera === "zoom-out" ? base + zoom * (1 - t) : base + 0.04;
  const panRange = vertical ? 18 : 3.5; // % del ancho
  const x =
    camera === "pan-left" ? panRange * (0.5 - t) : camera === "pan-right" ? panRange * (t - 0.5) : 0;
  const opacity = Math.min(
    fadeIn && fade > 0 ? interpolate(frame, [0, fade], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" }) : 1,
    fadeOut && fade > 0
      ? interpolate(frame, [durationInFrames - fade, durationInFrames], [1, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" })
      : 1,
  );

  return (
    <AbsoluteFill style={{ opacity, overflow: "hidden", backgroundColor: "#0b0806" }}>
      <Img
        src={staticFile(src)}
        style={{
          position: "absolute",
          width: "100%",
          height: "100%",
          objectFit: "cover",
          scale: String(scale),
          translate: `${x}% 0%`,
        }}
      />
      {/* Viñeta para unificar el estilo y mejorar la legibilidad de subtítulos */}
      <AbsoluteFill
        style={{
          background:
            "radial-gradient(ellipse at center, rgba(0,0,0,0) 55%, rgba(0,0,0,0.55) 100%), linear-gradient(to bottom, rgba(0,0,0,0) 65%, rgba(0,0,0,0.45) 100%)",
        }}
      />
    </AbsoluteFill>
  );
};
