import {
  AbsoluteFill,
  Easing,
  interpolate,
  Sequence,
  useCurrentFrame,
} from "remotion";

const CANVAS = "#020617";
const GREEN = "#22c55e";
const RED = "#ef4444";
const MUTED = "#94a3b8";
const CYAN = "#7dd3fc";
const AMBER = "#fbbf24";

const fade = (frame: number, start: number, dur = 15) =>
  interpolate(frame, [start, start + dur], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

const rise = (frame: number, start: number, dist = 30, dur = 22) =>
  interpolate(frame, [start, start + dur], [dist, 0], {
    easing: Easing.out(Easing.cubic),
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

/* 终端组件：真实输出逐行滚入 */
function Terminal({
  frame,
  start,
  lines,
  promptPrefix = "$ ",
  height = 620,
  fontSize = 21,
  lineDelay = 9,
}: {
  frame: number;
  start: number;
  lines: Array<{ text: string; color?: string; isPrompt?: boolean }>;
  promptPrefix?: string;
  height?: number;
  fontSize?: number;
  lineDelay?: number;
}) {
  return (
    <div
      style={{
        background: "#0b1120",
        border: "1px solid #1e293b",
        borderRadius: 14,
        padding: "24px 30px",
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
        fontSize,
        lineHeight: 1.75,
        color: "#e2e8f0",
        width: 1760,
        height,
        overflow: "hidden",
      }}
    >
      {lines.map((line, i) => {
        const t = start + i * lineDelay;
        const o = fade(frame, t, 8);
        const y = rise(frame, t, 12, 12);
        if (o <= 0.01) return null;
        return (
          <div key={i} style={{ opacity: o, transform: `translateY(${y}px)`, whiteSpace: "pre-wrap" }}>
            {line.isPrompt ? (
              <>
                <span style={{ color: GREEN }}>{promptPrefix}</span>
                <span style={{ color: "#f8fafc" }}>{line.text}</span>
              </>
            ) : (
              <span style={{ color: line.color ?? "#e2e8f0" }}>{line.text}</span>
            )}
          </div>
        );
      })}
    </div>
  );
}

/* 4a — Agent A 建护照 + pack（真实输出） */
const ACT1_LINES: Array<{ text: string; color?: string; isPrompt?: boolean }> = [
  { text: "node cli.js new --title \"Ship the docs site before Friday\" --goal \"Deploy...\"", isPrompt: true },
  { text: '{ "passport_id": "TP-K8SZ-X5P6", "state_version": 1,', color: "#a5b4fc" },
  { text: '  "title": "Ship the docs site before Friday",', color: "#a5b4fc" },
  { text: '  "goal": "Deploy the new docs site to production with zero broken links",', color: "#a5b4fc" },
  { text: '  "current_state": "Draft written. Build script failing on asset paths.",', color: "#a5b4fc" },
  { text: '  "next_steps": ["Fix asset paths, run link checker, deploy"] }', color: "#a5b4fc" },
  { text: "", color: MUTED },
  { text: "node cli.js pack TP-K8SZ-X5P6 --out handoff.taskpack.json --flat --actor \"Agent A\"", isPrompt: true },
  { text: '{ "ok": true, "pack": "handoff.taskpack.json", "encoding": "flat",', color: GREEN },
  { text: '  "passport_id": "TP-K8SZ-X5P6", "state_version": 1, "logged": true,', color: GREEN },
  { text: '  "pack_sha256": "efb5f727f75dae5caa9a59f630347db5c3eb4b0ca7840f78c03b477cc3152e84" }', color: GREEN },
];

function Act1() {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill style={{ background: CANVAS, padding: 80, flexDirection: "column" }}>
      <div style={{ opacity: fade(frame, 0, 20), fontSize: 44, fontWeight: 700, color: "#f8fafc", marginBottom: 8 }}>
        Agent A — Claude Code, working on the task
      </div>
      <div style={{ opacity: fade(frame, 20, 20), fontSize: 26, color: MUTED, marginBottom: 40, fontFamily: "Segoe UI, sans-serif" }}>
        Passport holds goal · state · verified facts · decisions · next steps
      </div>
      <Terminal frame={frame} start={70} lines={ACT1_LINES} height={520} />
      <div
        style={{
          opacity: fade(frame, 70 + ACT1_LINES.length * 9 + 40),
          marginTop: 40,
          fontSize: 34,
          color: "#fbbf24",
          fontWeight: 600,
          textAlign: "center",
        }}
      >
        ⚠ Laptop battery at 2% … Agent A is about to disappear
      </div>
    </AbsoluteFill>
  );
}

/* 4b — 崩溃过渡 */
function CrashBridge() {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill style={{ background: "#7f1d1d", justifyContent: "center", alignItems: "center", flexDirection: "column" }}>
      <div style={{ opacity: fade(frame, 20, 15), fontSize: 110, fontWeight: 900, color: "#fecaca" }}>SHUTDOWN</div>
      <div style={{ opacity: fade(frame, 60, 15), fontSize: 36, color: "#fecaca", marginTop: 20 }}>
        Agent A is gone. The machine is different.
      </div>
      <div style={{ opacity: fade(frame, 110, 15), fontSize: 30, color: "#fca5a5", marginTop: 40, fontFamily: "Segoe UI, sans-serif" }}>
        All that survives: <b>handoff.taskpack.json</b>
      </div>
    </AbsoluteFill>
  );
}

/* 4c — Agent B = Gemini land/open/continue/pack（真实输出） */
const ACT2_LINES: Array<{ text: string; color?: string; isPrompt?: boolean }> = [
  { text: "python examples/gemini/adk_agent.py land handoff.taskpack.json", isPrompt: true },
  { text: '{ "ok": true, "passport_id": "TP-ECJQ-V7H2",', color: GREEN },
  { text: '  "lineage": { "root_id": "TP-K8SZ-X5P6", "from_version": 1 },', color: GREEN },
  { text: '  "from": { "actor": "Agent A", "machine": "zjzhfs" } }', color: GREEN },
  { text: "", color: MUTED },
  { text: "python examples/gemini/adk_agent.py open", isPrompt: true },
  { text: '{ "passport_id": "TP-ECJQ-V7H2", "state_version": 2,', color: "#a5b4fc" },
  { text: '  "goal": "Deploy the new docs site to production with zero broken links",', color: "#a5b4fc" },
  { text: '  "current_state": "搬家自 Agent A@zjzhfs（血缘 TP-K8SZ-X5P6@1）。\\n\\nDraft written...",', color: "#a5b4fc" },
  { text: '  "next_steps": ["Fix asset paths, run link checker, deploy"] }', color: "#a5b4fc" },
  { text: "", color: MUTED },
  { text: "python examples/gemini/adk_agent.py continue \"Fix the asset paths and run the link checker\" --mock", isPrompt: true },
  { text: '{ "state_version": 3,', color: GREEN },
  { text: '  "current_state": "...\\n[Agent B/Gemini 2026-08-18T17:41:40Z] 已执行：Fix the asset paths...",', color: GREEN },
  { text: "", color: MUTED },
  { text: "python examples/gemini/adk_agent.py pack --out receipt.taskpack.json --actor \"Agent B\"", isPrompt: true },
  { text: '{ "ok": true, "pack": "receipt.taskpack.json", "encoding": "bagit-zip",', color: GREEN },
  { text: '  "passport_id": "TP-ECJQ-V7H2", "state_version": 3, "logged": true }', color: GREEN },
];

function Act2() {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill style={{ background: CANVAS, padding: 80, flexDirection: "column" }}>
      <div style={{ opacity: fade(frame, 0, 20), fontSize: 44, fontWeight: 700, color: "#f8fafc", marginBottom: 8 }}>
        Agent B = Gemini — Google ADK · Vertex AI gemini-3.5-flash
      </div>
      <div style={{ opacity: fade(frame, 20, 20), fontSize: 26, color: MUTED, marginBottom: 40, fontFamily: "Segoe UI, sans-serif" }}>
        lands the file → reads state → executes the next step → checkpoints → packs a receipt
      </div>
      <Terminal frame={frame} start={70} lines={ACT2_LINES} height={640} fontSize={19} lineDelay={8} />
      <div
        style={{
          opacity: fade(frame, 70 + ACT2_LINES.length * 8 + 50),
          marginTop: 36,
          fontSize: 30,
          color: CYAN,
          textAlign: "center",
          fontFamily: "ui-monospace, monospace",
        }}
      >
        state_version 1 → 2 → 3 · the task never restarted from zero
      </div>
    </AbsoluteFill>
  );
}

/* 4d — GCP 证据：真实 curl 响应 + 三硬性要求 */
function GcpEvidence() {
  const frame = useCurrentFrame();
  return (
    <AbsoluteFill style={{ background: CANVAS, padding: 80, flexDirection: "column" }}>
      <div style={{ opacity: fade(frame, 0, 20), fontSize: 44, fontWeight: 700, color: "#f8fafc", marginBottom: 10 }}>
        Proof: Gemini 3.5 is really running on Vertex AI
      </div>
      <div
        style={{
          opacity: fade(frame, 20, 20),
          marginBottom: 36,
          fontFamily: "ui-monospace, monospace",
          fontSize: 20,
          color: MUTED,
          background: "#0b1120",
          border: "1px solid #1e293b",
          borderRadius: 10,
          padding: "14px 20px",
        }}
      >
        POST /v1/projects/clawme-488709/locations/asia-northeast1/publishers/google/models/<b>gemini-3.5-flash</b>:generateContent
      </div>
      <div
        style={{
          opacity: fade(frame, 60, 25),
          background: "#0b1120",
          border: "1px solid #14532d",
          borderRadius: 14,
          padding: "26px 34px",
          fontFamily: "ui-monospace, monospace",
          fontSize: 26,
          lineHeight: 1.8,
          width: 1760,
        }}
      >
        <div style={{ color: "#a5b4fc" }}>{'  "model": "gemini-3.5-flash",'}</div>
        <div style={{ color: GREEN }}>{'  "reply": "I am alive",'}</div>
        <div style={{ color: "#a5b4fc" }}>{'  "prompt_tokens": 7, "total_tokens": 131'}</div>
        <div style={{ color: GREEN, marginTop: 10 }}>✓ Google Agent Framework: ADK + GenAI SDK</div>
        <div style={{ color: GREEN }}>✓ Google Cloud: Firestore provider + Vertex AI runtime</div>
      </div>
      <div
        style={{
          opacity: fade(frame, 220, 25),
          marginTop: 50,
          display: "flex",
          gap: 40,
          alignItems: "center",
        }}
      >
        <span style={{ fontSize: 30, color: "#f8fafc", fontFamily: "Segoe UI, sans-serif" }}>The receipt lands anywhere:</span>
        <span style={{ fontSize: 26, color: CYAN, fontFamily: "ui-monospace, monospace" }}>
          node cli.js land receipt.taskpack.json --into TP-ECJQ-V7H2
        </span>
      </div>
      <div
        style={{
          opacity: fade(frame, 320, 25),
          marginTop: 40,
          fontSize: 34,
          fontWeight: 700,
          color: AMBER,
          textAlign: "center",
        }}
      >
        Agents shouldn&apos;t restart from zero.
      </div>
    </AbsoluteFill>
  );
}

/* Scene 4 组合：90 秒 */
export const Scene4: React.FC = () => {
  return (
    <AbsoluteFill>
      <Sequence from={0} durationInFrames={600}>
        <Act1 />
      </Sequence>
      <Sequence from={600} durationInFrames={210}>
        <CrashBridge />
      </Sequence>
      <Sequence from={810} durationInFrames={1050}>
        <Act2 />
      </Sequence>
      <Sequence from={1860} durationInFrames={840}>
        <GcpEvidence />
      </Sequence>
    </AbsoluteFill>
  );
};
