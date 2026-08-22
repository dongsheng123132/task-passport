#!/usr/bin/env python3
"""
adk_agent.py — Agent B = Gemini 接收端示例（Task Passport × Google ADK）

这是「agents shouldn't restart from zero」的演示接收端：
Agent A 用任意 harness 把任务 pack 成一个 TaskPack 文件，
本脚本作为 Agent B（Gemini + Google ADK）land 收下、读状态、
执行下一步、checkpoint 写回、再 pack 发回。

用法（在仓库根目录运行，node cli.js 从那里调用）：
    python examples/gemini/adk_agent.py land <包文件> [--store <目录>]
    python examples/gemini/adk_agent.py open [--passport <TP-ID>] [--store <目录>]
    python examples/gemini/adk_agent.py continue "下一步指令" [--passport <TP-ID>] [--store <目录>] [--mock]
    python examples/gemini/adk_agent.py pack --out <文件> --actor <名字> [--passport <TP-ID>] [--store <目录>]

真实 Gemini 调用走 Vertex AI（已实测）：
    POST /v1/projects/{project}/locations/asia-northeast1/publishers/google/models/gemini-3.5-flash:generateContent
    header: x-goog-api-key: <GEMINI_API_KEY>
环境变量：GEMINI_API_KEY（或 GOOGLE_API_KEY）必填，除非 --mock。
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
from pathlib import Path

# ---------------------------------------------------------------------------
# 已实测的 Vertex AI 配置（2026-08-18，gemini-3.5-flash 在 asia-northeast1 可用）
# ---------------------------------------------------------------------------
DEFAULT_PROJECT = "clawme-488709"
DEFAULT_LOCATION = "asia-northeast1"
DEFAULT_MODEL = "gemini-3.5-flash"
VERTEX_BASE = "https://{location}-aiplatform.googleapis.com/v1"
GENERATE_ENDPOINT = (
    "{base}/projects/{project}/locations/{location}"
    "/publishers/google/models/{model}:generateContent"
)


def repo_root() -> Path:
    """仓库根目录 = 本文件的上上级目录（examples/gemini/ -> 仓库根）。"""
    return Path(__file__).resolve().parent.parent.parent


def run_cli(args: list[str], store: str | None = None) -> dict:
    """调用仓库里的 node cli.js，stdout 是 JSON。"""
    cmd = ["node", str(repo_root() / "cli.js"), *args]
    env = dict(os.environ)
    if store:
        env["TASK_PASSPORT_STORE"] = store
    proc = subprocess.run(
        cmd, capture_output=True, text=True, env=env, cwd=str(repo_root())
    )
    if proc.returncode != 0:
        raise RuntimeError(
            f"cli.js {' '.join(args)} failed ({proc.returncode}):\n{proc.stderr or proc.stdout}"
        )
    try:
        return json.loads(proc.stdout)
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"cli.js returned non-JSON: {proc.stdout[:500]}") from exc


# ---------------------------------------------------------------------------
# Task Passport 工具（注册给 ADK Agent 调用）
# ---------------------------------------------------------------------------
class PassportTools:
    """把 task-passport CLI 包成 ADK 可调用的工具集合。

    真实模式里这些会被注册为 Google ADK 的 @tool；mock 模式里由
    RuleBasedModel 顺序调用，避免依赖 Google API。
    """

    def __init__(self, store: str | None = None):
        self.store = store

    def land(self, pack_file: str) -> str:
        """收下别人发来的 TaskPack 文件，开一本新护照。返回新护照摘要。"""
        result = run_cli(["land", pack_file], self.store)
        return json.dumps(result, ensure_ascii=False, indent=2)

    def open(self, passport_id: str | None = None) -> str:
        """读取当前任务护照的状态：目标、当前状态、已验证事实、下一步。"""
        result = run_cli(["open", passport_id], self.store)
        return json.dumps(result, ensure_ascii=False, indent=2)

    def checkpoint(self, state_file: str, expected_version: int) -> str:
        """工作完成后写回护照（带版本冲突检测，过期写入会被拒绝）。"""
        result = run_cli(
            ["checkpoint", "--file", state_file, "--expected-version", str(expected_version)],
            self.store,
        )
        return json.dumps(result, ensure_ascii=False, indent=2)

    def pack(self, passport_id: str, out: str, actor: str) -> str:
        """把做完的状态封包发回给 Agent A。"""
        result = run_cli(
            ["pack", passport_id, "--out", out, "--actor", actor], self.store
        )
        return json.dumps(result, ensure_ascii=False, indent=2)


# ---------------------------------------------------------------------------
# Gemini 真实调用（google-genai / Vertex AI）
# ---------------------------------------------------------------------------
def call_gemini(prompt: str, api_key: str | None = None) -> str:
    """用 google-genai 调 Vertex AI 的 gemini-3.5-flash。

    失败时给出清晰报错；未安装 google-genai 时提示安装。
    """
    key = api_key or os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")
    if not key:
        raise RuntimeError(
            "需要 GEMINI_API_KEY（或 GOOGLE_API_KEY）环境变量。"
            "申请：console.cloud.google.com -> API 密钥 -> 创建绑定服务账号的密钥；"
            "或用 --mock 免 key 演示。"
        )
    try:
        from google import genai
    except ImportError as exc:
        raise RuntimeError(
            "未安装 google-genai。运行：pip install google-genai"
        ) from exc

    client = genai.Client(
        vertexai=True,
        project=DEFAULT_PROJECT,
        location=DEFAULT_LOCATION,
        api_key=key,
    )
    response = client.models.generate_content(
        model=DEFAULT_MODEL,
        contents=prompt,
    )
    return response.text or ""


# ---------------------------------------------------------------------------
# mock 模式：不调 Google API 也能跑通整条链路
# ---------------------------------------------------------------------------
def mock_continue(passport_tools: PassportTools, passport_id: str, instruction: str) -> str:
    """mock 版 continue：顺序执行 open -> 追加一条决策 -> checkpoint。

    真实模式里这一步由 ADK Agent（Gemini）根据指令决定调用哪个工具；
    mock 模式直接执行，用于无 key 演示与测试。
    """
    # 1. 读当前状态
    opened = run_cli(["open", passport_id], passport_tools.store)
    state = opened["state"]
    version = opened["state_version"]
    # 2. 追加一条「执行记录」到 current_state，模拟 Agent B 干了一步
    now = __import__("datetime").datetime.now(__import__("datetime").timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")
    note = f"[Agent B/Gemini {now}] 已执行：{instruction}"
    state["current_state"] = (state.get("current_state") or "") + "\n" + note
    # 3. 写回
    state_file = repo_root() / ".adk-checkpoint-state.json"
    state_file.write_text(json.dumps(state, ensure_ascii=False), encoding="utf-8")
    try:
        return run_cli(
            ["checkpoint", "--file", str(state_file), "--expected-version", str(version)],
            passport_tools.store,
        )
    finally:
        state_file.unlink(missing_ok=True)


# ---------------------------------------------------------------------------
# CLI 入口
# ---------------------------------------------------------------------------
def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="adk_agent",
        description="Task Passport × Google ADK：Agent B = Gemini 接收端",
    )
    sub = parser.add_subparsers(dest="command", required=True)

    p_land = sub.add_parser("land", help="收下 TaskPack 文件")
    p_land.add_argument("pack_file", help=".taskpack 或 .taskpack.json 文件路径")

    p_open = sub.add_parser("open", help="读当前任务状态")
    p_open.add_argument("--passport", help="TP-ID（默认取 store 里最近一本）")

    p_cont = sub.add_parser("continue", help="把下一步指令交给 Agent B 执行")
    p_cont.add_argument("instruction", help='例如 "为 README 补一段快速开始"')
    p_cont.add_argument("--passport", help="TP-ID（默认取 store 里最近一本）")
    p_cont.add_argument("--mock", action="store_true", help="不调 Google API 的演示模式")

    p_pack = sub.add_parser("pack", help="封包发回")
    p_pack.add_argument("--out", required=True, help="输出文件路径")
    p_pack.add_argument("--actor", required=True, help="发送方名字")
    p_pack.add_argument("--passport", help="TP-ID（默认取 store 里最近一本）")

    for p in (p_land, p_open, p_cont, p_pack):
        p.add_argument("--store", help="护照 store 目录（默认用环境变量/本机默认）")
    return parser


def latest_passport(store: str | None) -> str:
    """取 store 里最近更新的一本护照的 ID。"""
    listing = run_cli(["list"], store)
    passports = listing.get("passports", [])
    if not passports:
        raise RuntimeError("store 里没有护照。先用 land 收下一个包，或 node cli.js new 造一本。")
    return passports[-1]["passport_id"]


def main() -> int:
    args = build_parser().parse_args()
    tools = PassportTools(store=args.store)

    if args.command == "land":
        print(tools.land(args.pack_file))
        return 0

    if args.command == "open":
        pid = args.passport or latest_passport(args.store)
        print(tools.open(pid))
        return 0

    if args.command == "continue":
        pid = args.passport or latest_passport(args.store)
        if args.mock:
            result = mock_continue(tools, pid, args.instruction)
            print(json.dumps(result, ensure_ascii=False, indent=2))
        else:
            # 真实模式：让 Gemini 读护照状态后决定动作
            context = tools.open(pid)
            prompt = (
                f"你是一个接手长任务 Agent B（Gemini）。下面是任务护照状态：\n\n"
                f"{context}\n\n"
                f"请执行这条指令：{args.instruction}\n"
                f"用中文回复你打算调用哪个 Task Passport 工具（land/open/checkpoint/pack）以及为什么。"
            )
            print(call_gemini(prompt))
        return 0

    if args.command == "pack":
        pid = args.passport or latest_passport(args.store)
        print(tools.pack(pid, args.out, args.actor))
        return 0

    return 1


if __name__ == "__main__":
    sys.exit(main())
