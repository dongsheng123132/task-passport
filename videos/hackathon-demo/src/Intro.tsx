import {
  AbsoluteFill,
  Easing,
  interpolate,
  Sequence,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";

const INK = "#0f172a";
const CANVAS = "#020617";
const BLUE = "#3b82f6";
const GREEN = "#22c55e";
const ORANGE = "#f97316";
const RED = "#ef4444";
const MUTED = "#94a3b8";

const fade = (frame: number, start: number, dur = 20) =>
  interpolate(frame, [start, start + dur], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

const rise = (frame: number, start: number, dist = 40, dur = 30) =>
  interpolate(frame, [start, start + dur], [dist, 0], {
    easing: Easing.out(Easing.cubic),
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

function BigLine({
  frame,
  start,
  children,
  style,
}: {
  frame: number;
  start: number;
  children: React.ReactNode;
  style?: React.CSSProperties;
}) {
  return (
    <div
      style={{
        opacity: fade(frame, start),
        transform: `translateY(${rise(frame, start)}px)`,
        ...style,
      }}
    >
      {children}
    </div>
  );
}

const Mono = ({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) => (
  <div
    style={{
      fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
      ...style,
    }}
  >
    {children}
  </div>
);

/* ------------------------------------------------------------------ */
/* Scene 1 — Hook (0:00-0:15)                                          */
/* ------------------------------------------------------------------ */
function Scene1() {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill style={{ background: CANVAS, justifyContent: "center", alignItems: "center" }}>
      <BigLine frame={frame} start={15} style={{ fontSize: 52, color: MUTED, fontFamily: "Segoe UI, sans-serif", textAlign: "center", lineHeight: 1.6 }}>
        Your agent was mid-task.<br />
        The laptop closed. The model switched.
      </BigLine>
      <BigLine
        frame={frame}
        start={200}
        style={{
          marginTop: 60,
          fontSize: 84,
          fontWeight: 800,
          color: "#f8fafc",
          fontFamily: "Segoe UI, sans-serif",
          letterSpacing: 1,
        }}
      >
        AGENTS SHOULDN&apos;T RESTART FROM ZERO.
      </BigLine>
    </AbsoluteFill>
  );
}

/* ------------------------------------------------------------------ */
/* Scene 2 — Problem (0:15-0:45)                                       */
/* ------------------------------------------------------------------ */
const LOG_LINES = [
  "building assets ... ok",
  "running link checker ... 3 broken links found",
  "patching asset paths ...",
  "retrying build ...",
  "50% ... 75% ... 90%",
  "✓ build passed",
  "deploying to production ...",
];

function LogStream() {
  const frame = useCurrentFrame();
  const start = 60;
  const step = 45;
  return (
    <Mono
      style={{
        background: "#0b1120",
        border: `1px solid ${"#1e293b"}`,
        borderRadius: 12,
        padding: "22px 28px",
        fontSize: 22,
        color: "#7dd3fc",
        width: 760,
        height: 300,
        overflow: "hidden",
        lineHeight: 1.9,
      }}
    >
      {LOG_LINES.map((line, i) => {
        const t = start + i * step;
        const o = interpolate(frame, [t, t + 10], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
        const y = interpolate(frame, [t, t + 40], [14, 0], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
        if (o <= 0) return null;
        return (
          <div key={i} style={{ opacity: o, transform: `translateY(${y}px)` }}>
            {i < 5 ? "  " : "✓ "}
            <span style={{ color: i < 5 ? "#94a3b8" : GREEN }}>{line}</span>
          </div>
        );
      })}
    </Mono>
  );
}

function Scene2() {
  const frame = useCurrentFrame();
  const crashAt = 500;
  const crash = fade(frame, crashAt, 8);
  const msg = fade(frame, crashAt + 30);
  const pts = fade(frame, crashAt + 110);
  return (
    <AbsoluteFill style={{ background: CANVAS, padding: 80, flexDirection: "column" }}>
      <BigLine frame={frame} start={15} style={{ fontSize: 60, fontWeight: 700, color: "#f8fafc", marginBottom: 50 }}>
        Agent A is running a long task…
      </BigLine>
      <div style={{ display: "flex", gap: 60 }}>
        <LogStream />
        <div style={{ flex: 1 }}>
          <BigLine frame={frame} start={40} style={{ fontSize: 30, color: MUTED, lineHeight: 1.7 }}>
            State lives in a chat transcript.
            <br />
            <span style={{ color: "#f8fafc" }}>Transcripts are not state.</span>
            <br />
            <br />
            Every agent protocol assumes both ends are alive.
            <br />
            A2A needs a live peer. MCP connects tools, not tasks.
          </BigLine>
        </div>
      </div>
      {/* crash overlay */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: "rgba(127,29,29,0.85)",
          opacity: crash,
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          alignItems: "center",
        }}
      >
        <div style={{ fontSize: 130, fontWeight: 900, color: "#fecaca" }}>CRASH</div>
        <div style={{ fontSize: 36, color: "#fecaca", marginTop: 16 }}>laptop closed · agent killed · model switched</div>
      </div>
      <BigLine
        frame={frame}
        start={crashAt + 30}
        style={{
          position: "absolute",
          bottom: 90,
          left: 0,
          right: 0,
          textAlign: "center",
          fontSize: 46,
          fontWeight: 700,
          color: "#f8fafc",
        }}
      >
        The task dies with the agent.
      </BigLine>
    </AbsoluteFill>
  );
}

/* ------------------------------------------------------------------ */
/* Scene 3 — Solution (0:45-1:30)                                      */
/* ------------------------------------------------------------------ */
function Card({
  frame,
  start,
  color,
  title,
  body,
}: {
  frame: number;
  start: number;
  color: string;
  title: string;
  body: string;
}) {
  return (
    <div
      style={{
        opacity: fade(frame, start, 25),
        transform: `translateY(${rise(frame, start, 60, 35)}px)`,
        background: "#0b1120",
        border: `2px solid ${color}`,
        borderRadius: 16,
        padding: "34px 30px",
        width: 420,
        minHeight: 260,
      }}
    >
      <div style={{ fontSize: 24, fontWeight: 700, color, marginBottom: 14, fontFamily: "Segoe UI, sans-serif" }}>
        {title}
      </div>
      <div style={{ fontSize: 22, color: "#cbd5e1", lineHeight: 1.6, fontFamily: "Segoe UI, sans-serif" }}>{body}</div>
    </div>
  );
}

function Scene3() {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill style={{ background: CANVAS, padding: 80, flexDirection: "column" }}>
      <BigLine frame={frame} start={10} style={{ fontSize: 62, fontWeight: 700, color: "#f8fafc", marginBottom: 20 }}>
        Task Passport — the durable state of a long-running task
      </BigLine>
      <BigLine frame={frame} start={40} style={{ fontSize: 30, color: MUTED, marginBottom: 70 }}>
        versioned · locked · lives outside any single harness
      </BigLine>
      <div style={{ display: "flex", gap: 50 }}>
        <Card
          frame={frame}
          start={90}
          color={BLUE}
          title="① Passport"
          body="Goal, current state, verified facts, decisions, next steps. Stays home, keeps a version, rejects stale writes."
        />
        <Card
          frame={frame}
          start={190}
          color={ORANGE}
          title="② pack"
          body="Seal state into ONE portable file — .taskpack or .taskpack.json. Verified machine-facts degrade to unproven at pack time."
        />
        <Card
          frame={frame}
          start={290}
          color={GREEN}
          title="③ land"
          body="Any harness — Gemini, Claude, Codex — reads the file and continues. Not from zero. From the verified state."
        />
      </div>
      <BigLine
        frame={frame}
        start={420}
        style={{
          marginTop: 60,
          fontSize: 26,
          color: MUTED,
          fontFamily: "ui-monospace, monospace",
        }}
      >
        $ node cli.js pack TP-XXXX --out handoff.taskpack.json --flat --actor "Agent A"
      </BigLine>
      <BigLine
        frame={frame}
        start={480}
        style={{
          marginTop: 24,
          fontSize: 26,
          color: "#7dd3fc",
          fontFamily: "ui-monospace, monospace",
        }}
      >
        $ python examples/gemini/adk_agent.py land handoff.taskpack.json
      </BigLine>
    </AbsoluteFill>
  );
}

/* ------------------------------------------------------------------ */
/* Intro 组合                                                            */
/* ------------------------------------------------------------------ */
export const Intro: React.FC = () => {
  return (
    <AbsoluteFill>
      <Sequence from={0} durationInFrames={450}>
        <Scene1 />
      </Sequence>
      <Sequence from={450} durationInFrames={900}>
        <Scene2 />
      </Sequence>
      <Sequence from={1350} durationInFrames={1350}>
        <Scene3 />
      </Sequence>
    </AbsoluteFill>
  );
};
