# Hermes 模型能力对比（只读）

## 目标

比较两个模型对 fail-closed 协议代码审查的能力。不得修改任何文件、不得运行项目命令、不得联网搜索，也不得声称完成了修复。

## 被审查伪代码

```js
const schema = {
  type: 'object', additionalProperties: false,
  required: ['plan'], properties: { request_id: { type: 'string' } }
};

export function execute(req) {
  if (!schema.required.every((k) => k in req)) return { code: 'BAD_REQUEST' };
  if (Date.parse(req.approval.expires_at) < Date.now()) return { code: 'EXPIRED' };
  if (!req.intent_ref.includes('://')) return { code: 'EXECUTION_DISABLED' };
  return { code: 'HANDOFF_DENIED', evidence_refs: req.evidence_refs };
}
```

## 输出格式

仅输出 JSON，字段固定为：`findings`（数组）、`severity`、`recommended_tests`（数组）、`verdict`。
每个 finding 必须包含 `issue`、`why`、`minimal_fix`。找出所有会导致 schema 不可满足、fail-open / NaN 绕过、危险 intent 接受或敏感 evidence 回显的问题；不要虚构代码中不存在的缺陷。
