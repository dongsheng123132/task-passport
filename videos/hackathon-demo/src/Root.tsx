import "./index.css";
import { AbsoluteFill, Composition, Sequence } from "remotion";
import { Intro } from "./Intro";
import { Outro } from "./Outro";
import { Scene4 } from "./Scene4";

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="FullVideo"
        component={FullVideo}
        durationInFrames={6300}
        fps={30}
        width={1920}
        height={1080}
      />
      <Composition
        id="Intro"
        component={Intro}
        durationInFrames={2700}
        fps={30}
        width={1920}
        height={1080}
      />
      <Composition
        id="Outro"
        component={Outro}
        durationInFrames={900}
        fps={30}
        width={1920}
        height={1080}
      />
      <Composition
        id="Scene4"
        component={Scene4}
        durationInFrames={2700}
        fps={30}
        width={1920}
        height={1080}
      />
    </>
  );
};

/* 完整视频：Intro(90s) + Scene4(90s) + Outro(30s) = 210s */
const FullVideo: React.FC = () => {
  return (
    <AbsoluteFill>
      <Sequence from={0} durationInFrames={2700}>
        <Intro />
      </Sequence>
      <Sequence from={2700} durationInFrames={2700}>
        <Scene4 />
      </Sequence>
      <Sequence from={5400} durationInFrames={900}>
        <Outro />
      </Sequence>
    </AbsoluteFill>
  );
};
