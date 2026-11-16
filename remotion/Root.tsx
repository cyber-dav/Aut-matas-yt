import React from "react";
import { Composition, Still } from "remotion";
import "@fontsource/cormorant-garamond/600.css";
import "@fontsource/cormorant-garamond/700.css";
import "@fontsource/cormorant-garamond/600-italic.css";
import "@fontsource/source-sans-3/600.css";
import "@fontsource/source-sans-3/800.css";
import "@fontsource/source-sans-3/900.css";
import { Episode } from "./Episode";
import { Short } from "./Short";
import { Thumbnail } from "./Thumbnail";
import type { EpisodeProps, ShortProps, ThumbnailProps } from "./types";

const demoEpisode: EpisodeProps = {
  channelName: "Canal",
  tagline: "",
  title: "Título",
  fps: 30,
  width: 1920,
  height: 1080,
  introSeconds: 3,
  outroSeconds: 10,
  crossfadeSeconds: 0.5,
  totalSeconds: 20,
  audio: "mix.wav",
  scenes: [],
  cues: [],
  outroImage: "",
};

const demoShort: ShortProps = {
  channelName: "Canal",
  fps: 30,
  totalSeconds: 45,
  audio: "short.wav",
  hook: "",
  cta: "",
  ctaSeconds: 3,
  scenes: [],
  cues: [],
};

const demoThumb: ThumbnailProps = { image: "", text: "¿ASESINO O MITO?", channelName: "Canal", align: "left" };

export const Root: React.FC = () => (
  <>
    <Composition
      id="Episode"
      component={Episode}
      defaultProps={demoEpisode}
      fps={30}
      width={1920}
      height={1080}
      durationInFrames={600}
      calculateMetadata={({ props }) => ({
        durationInFrames: Math.round(props.totalSeconds * props.fps),
        fps: props.fps,
        width: props.width,
        height: props.height,
      })}
    />
    <Composition
      id="Short"
      component={Short}
      defaultProps={demoShort}
      fps={30}
      width={1080}
      height={1920}
      durationInFrames={1350}
      calculateMetadata={({ props }) => ({
        durationInFrames: Math.round(props.totalSeconds * props.fps),
        fps: props.fps,
      })}
    />
    <Still id="Thumbnail" component={Thumbnail} defaultProps={demoThumb} width={1280} height={720} />
  </>
);
