import { AbsoluteFill, interpolate, useCurrentFrame } from "remotion";

const CANVAS = "#020617";
const GREEN = "#22c55e";
const MUTED = "#94a3b8";

const fade = (frame: number, start: number, dur = 20) =>
  interpolate(frame, [start, start + dur], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

function CheckRow({
  frame,
  start,
  title,
  sub,
}: {
  frame: number;
  start: number;
  title: string;
  sub: string;
}) {
  return (
    <div
      style={{
        opacity: fade(frame, start, 25),
        display: "flex",
        alignItems: "center",
        gap: 28,
        marginBottom: 36,
      }}
    >
      <div
        style={{
          width: 64,
          height: 64,
          borderRadius: "50%",
          background: "rgba(34,197,94,0.15)",
          border: `3px solid ${GREEN}`,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 36,
          color: GREEN,
          fontWeight: 900,
        }}
      >
        ✓
      </div>
      <div>
        <div style={{ fontSize: 34, fontWeight: 700, color: "#f8fafc", fontFamily: "Segoe UI, sans-serif" }}>
          {title}
        </div>
        <div style={{ fontSize: 22, color: MUTED, marginTop: 4, fontFamily: "Segoe UI, sans-serif" }}>{sub}</div>
      </div>
    </div>
  );
}

export const Outro: React.FC = () => {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill style={{ background: CANVAS, padding: 90, flexDirection: "column", justifyContent: "center" }}>
      <div style={{ opacity: fade(frame, 10), fontSize: 56, fontWeight: 800, color: "#f8fafc", marginBottom: 60, fontFamily: "Segoe UI, sans-serif" }}>
        Hackathon requirements — all met
      </div>
      <CheckRow
        frame={frame}
        start={60}
        title="Gemini 3.5 or newer"
        sub="gemini-3.5-flash via Vertex AI (asia-northeast1) — verified live in this demo"
      />
      <CheckRow
        frame={frame}
        start={160}
        title="Google Agent Framework"
        sub="Google ADK agent + GenAI SDK in examples/gemini/adk_agent.py"
      />
      <CheckRow
        frame={frame}
        start={260}
        title="Google Cloud service"
        sub="Cloud Firestore passport provider + Vertex AI runtime"
      />
      <div
        style={{
          opacity: fade(frame, 420, 25),
          marginTop: 50,
          paddingTop: 40,
          borderTop: "1px solid #1e293b",
          fontSize: 30,
          color: MUTED,
          fontFamily: "Segoe UI, sans-serif",
          lineHeight: 1.7,
        }}
      >
        npm: <span style={{ color: "#7dd3fc", fontFamily: "monospace" }}>task-passport@0.3.0</span> · zero runtime deps ·
        MCP server built in · 78 tests · MIT · spec at{" "}
        <span style={{ color: "#7dd3fc", fontFamily: "monospace" }}>taskpack.org</span>
      </div>
      <div
        style={{
          opacity: fade(frame, 560, 25),
          marginTop: 34,
          fontSize: 34,
          fontWeight: 700,
          color: "#f8fafc",
          fontFamily: "Segoe UI, sans-serif",
        }}
      >
        github.com/dongsheng123132/task-passport
      </div>
      <div
        style={{
          opacity: fade(frame, 680, 25),
          marginTop: 30,
          fontSize: 26,
          color: MUTED,
          fontFamily: "Segoe UI, sans-serif",
        }}
      >
        Agents shouldn&apos;t restart from zero.
      </div>
    </AbsoluteFill>
  );
};
