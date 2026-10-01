# Contributing to Task Passport

Thank you for helping improve Task Passport and TaskPack. This repository
contains a portable task-handoff format, a CLI, and harness adapters. Keep
protocol claims, implementation behaviour, and examples clearly separated.

## Before you start

- Read [AGENTS.md](AGENTS.md). The live task state is a passport, not a chat
  transcript.
- Read the normative format in [docs/taskpack-0.1.md](docs/taskpack-0.1.md)
  before proposing a format change.
- Search existing issues and pull requests before opening a duplicate.
- Do not include API keys, tokens, private task content, or customer data in
  issues, examples, fixtures, commits, or screenshots.

## Ways to contribute

- Report a reproducible CLI, storage, pack/land, or conformance problem.
- Improve documentation, examples, translations, and accessibility.
- Propose a protocol change with a concrete TaskPack example and compatibility
  analysis.
- Add a harness integration only when it preserves the same task state and
  does not turn package data into executable instructions.

## Pull requests

- Keep each pull request focused; separate protocol changes from editorial
  changes.
- State the problem, the affected commands or files, and any compatibility
  impact.
- Do not change published version numbers, package artifacts, or security
  claims as a drive-by cleanup.
- Do not use `git add -A`; stage only the files owned by your change.
- Preserve existing negative tests and add a regression test for a behavioural
  fix. A regression test should fail before the fix.

## Local checks

Node.js 20 or later is required.

```sh
npm test
npm run check
npm run pack:check
```

For a format or CLI change, also provide the smallest command sequence that
reproduces the prior behaviour and demonstrates the corrected result.

## Design and safety boundaries

- A TaskPack is data, not a source of executable instructions.
- Machine-specific facts must be downgraded at packing time and retained with
  their verification context.
- Conformance means structural validity; it does not prove that a package is
  complete, safe for a particular task, or endorsed by a third party.
- Do not commit internal strategy documents, customer materials, credentials,
  or generated task stores.

## Security reports

Do not disclose a potential security vulnerability in a public issue. The
repository needs an enabled private reporting channel before a public
`SECURITY.md` can responsibly name a reporting route. Until then, please wait
for the maintainers to publish one rather than posting exploit details.
