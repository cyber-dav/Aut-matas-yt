import React from "react";
import { AbsoluteFill, Img, staticFile } from "remotion";
import { ACCENT, PAPER, SANS } from "./components/Text";
import type { ThumbnailProps } from "./types";

/** Miniatura 1280×720: ilustración contrastada + 2–4 palabras enormes, legibles en móvil. */
export const Thumbnail: React.FC<ThumbnailProps> = ({ image, text, align }) => {
  const words = text.trim().split(/\s+/);
  const fontSize = words.join(" ").length > 16 ? 108 : 132;
  return (
    <AbsoluteFill style={{ backgroundColor: "#000" }}>
      <Img src={staticFile(image)} style={{ width: "100%", height: "100%", objectFit: "cover", filter: "contrast(1.25) saturate(1.1) brightness(0.95)" }} />
      <AbsoluteFill
        style={{
          background:
            align === "left"
              ? "linear-gradient(to right, rgba(0,0,0,0.85) 0%, rgba(0,0,0,0.55) 45%, rgba(0,0,0,0) 75%)"
              : "linear-gradient(to left, rgba(0,0,0,0.85) 0%, rgba(0,0,0,0.55) 45%, rgba(0,0,0,0) 75%)",
        }}
      />
      <AbsoluteFill style={{ justifyContent: "center", alignItems: align === "left" ? "flex-start" : "flex-end", padding: "0 56px" }}>
        <div style={{ maxWidth: 700, textAlign: align }}>
          {wrapThumb(words).map((line, i) => (
            <div
              key={i}
              style={{
                fontFamily: SANS,
                fontWeight: 900,
                fontSize,
                lineHeight: 0.98,
                textTransform: "uppercase",
                color: i === 0 ? PAPER : "#fff",
                WebkitTextStroke: "3px #000",
                paintOrder: "stroke fill",
                textShadow: "0 6px 0 #000, 0 0 30px rgba(0,0,0,0.9)",
              }}
            >
              {line.split(" ").map((w, j) => (
                <span key={j} style={{ color: /[¿?!¡]/.test(w) || isAccentWord(w) ? "#e33b2e" : undefined }}>
                  {j > 0 ? " " : ""}
                  {w}
                </span>
              ))}
            </div>
          ))}
          <div style={{ marginTop: 18, width: 160, height: 10, backgroundColor: ACCENT, marginLeft: align === "right" ? "auto" : 0 }} />
        </div>
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

const isAccentWord = (w: string) => /^(MITO|MENTIRA|ASESINO|BESTIA|MALDITO|MALDICIÓN|SECRETO|VERDAD)$/i.test(w.replace(/[^\p{L}]/gu, ""));

function wrapThumb(words: string[]): string[] {
  if (words.length <= 2) return words;
  const mid = Math.ceil(words.length / 2);
  return [words.slice(0, mid).join(" "), words.slice(mid).join(" ")];
}
