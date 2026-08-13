---
name: task-passport
description: Continue durable task state across WorkBuddy, Claude Code, Codex, DeepSeek Harness, and other MCP-capable AI harnesses. Use when a user gives a TP- passport id, asks to hand off or resume work in another agent, wants current task progress, or needs a safe checkpoint that will not overwrite newer work.
---

# Task Passport

Carry the current verified state, not the previous model's transcript. Treat the passport id and state version as identity and concurrency controls.

## Resume a task

1. If the user provides an exact `TP-...` id, call `task_passport_open` for that id.
2. If no exact id is provided, call `task_passport_list`. Continue automatically only when the user's name resolves to exactly one passport; otherwise ask them to choose.
3. Read the goal, current state, verified facts, decisions with reasons, next steps, artifact references, and state version.
4. Continue from the first relevant next step. Do not inherit claims that are not recorded as verified facts.

Never guess the most recent passport. Never treat a local display number such as "task 1" as a global identity.

## Checkpoint work

1. Re-open the passport immediately before writing if the work was long-running.
2. Record changed state, newly verified facts with reproducible sources, decisions with reasons, artifact references, and concrete next steps.
3. Call `task_passport_checkpoint` with the exact `expected_version` obtained from the latest open.
4. If the write reports a version conflict, reopen, merge the newer state deliberately, and retry. Never force an overwrite.

Do not claim success merely because an action returned success; checkpoint the observed result.

## Handle long documents and projects

Do not paste a whole document, repository, or chat transcript into the passport. Keep the passport bounded and store large content as an artifact. Record its path or URL, revision or hash, relevant section, and a concise status summary.

A task passport transfers task identity and state. It does not transfer repository files, runtime dependencies, permissions, or secret values. Use Git, a shared workspace, or an artifact store for those, then reference the exact revision from the passport.
