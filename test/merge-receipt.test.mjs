import test from 'node:test'
import assert from 'node:assert/strict'
import { buildBag, mergeReceipt, recordSentAsks, verifyBag } from '../bag.js'

/**
 * A receipt is the answer coming home. These tests exist because the failure they guard
 * against is silent: answers land somewhere, the original passport still reads `open`,
 * and a human retypes everything while believing the format kept its promise.
 *
 * Most of them are stated so that a WRONG merge fails.
 */

const asker = (overrides = {}) => ({
  spec: '2origin/0.1',
  kind: 'task.origin',
  id: 'TP-ASK1-0001',
  title: '插图方案待定',
  goal: '红点归零',
  version: 4,
  current_state: '卡在两个待定决定上',
  harness: 'task-passport-cli',
  facts: [{ claim: '全稿 530 张插图', scope: 'universal', verified: true }],
  decisions: [],
  artifacts: [],
  next_steps: ['等回执'],
  asks: [
    { id: 'a1', to: '编写组', what: '版式走 A/B/C 哪条', accept: '回复中出现且仅出现 A、B、C 之一', status: 'open', answer: null },
    { id: 'a2', to: '编写组', what: '393 张怎么编号', accept: '明确二选一：逐张排号 / 按组编号', status: 'open', answer: null },
  ],
  ...overrides,
})

/** What the far side sends back: the same asks, some of them answered. */
const receipt = ({ answers = { a1: 'C（组图方案）' }, extraAsks = [], facts, kind = 'receipt', rootId } = {}) => {
  const state = asker()
  const asks = state.asks.map((ask) => (answers[ask.id]
    ? { ...ask, answer: answers[ask.id], status: 'answered' }
    : ask))
  const bag = buildBag({
    state: { ...state, id: rootId ?? state.id, facts: facts ?? state.facts },
    actor: '张老师',
    machine: '客户机',
    kind,
    asks: [...asks, ...extraAsks],
  })
  return verifyBag(bag).passport
}

test('回执把答案写回原护照，asks 从 open 变 answered', () => {
  const { state, report } = mergeReceipt(receipt(), asker())
  assert.deepEqual(report.answered, ['a1'])
  assert.deepEqual(report.still_open, ['a2'])
  const a1 = state.asks.find((ask) => ask.id === 'a1')
  assert.equal(a1.status, 'answered')
  assert.equal(a1.answer, 'C（组图方案）')
  assert.equal(a1.answered_by, '张老师@客户机')
  assert.match(a1.answered_at, /^\d{4}-\d{2}-\d{2}T/)
  assert.equal(state.asks.find((ask) => ask.id === 'a2').status, 'open')
})

test('护照号不变，目标、当前状态、下一步都不被回执改写', () => {
  const target = asker()
  const { state } = mergeReceipt(receipt(), target)
  assert.equal(state.id, 'TP-ASK1-0001')
  assert.equal(state.goal, target.goal)
  // 答案不是重写任务的许可：原 current_state 仍在，只是前面多了一行收件记录。
  assert.ok(state.current_state.includes('卡在两个待定决定上'))
  assert.match(state.current_state, /收到 张老师@客户机 的回执/)
  assert.ok(state.next_steps.includes('等回执'))
})

test('对方反问的问题被收进来，并排到我方 next_steps 最前面', () => {
  const { state, report } = mergeReceipt(receipt({
    extraAsks: [{ id: 'b1', what: '责编要求的页数上限能否书面确认', accept: '给出一句书面确认或明确拒绝' }],
  }), asker())
  assert.deepEqual(report.inbound_asks, ['b1'])
  const b1 = state.asks.find((ask) => ask.id === 'b1')
  assert.equal(b1.status, 'open')
  assert.equal(b1.to, 'self')
  assert.match(state.next_steps[0], /回答对方反问 b1/)
})

test('对方新证的事实被收下，已有的不重复', () => {
  const { state, report } = mergeReceipt(receipt({
    facts: [
      { claim: '全稿 530 张插图', scope: 'universal', verified: true },
      { claim: '责编已同意松开 260 页限制', scope: 'universal', verified: true, source: '责编邮件' },
    ],
  }), asker())
  assert.equal(report.facts_adopted, 1)
  const adopted = state.facts.find((fact) => fact.claim.includes('260 页'))
  assert.match(adopted.source, /经 张老师@客户机 回执/)
  assert.equal(state.facts.filter((fact) => fact.claim === '全稿 530 张插图').length, 1)
})

test('回执里的机器级事实照样不能带着 ✓ 过来', () => {
  const { state } = mergeReceipt(receipt({
    facts: [{ claim: '中望 3D 在客户机上跑得起来', scope: 'machine', verified: true }],
  }), asker())
  const landed = state.facts.find((fact) => fact.claim.includes('中望 3D'))
  assert.equal(landed.verified, false)
  assert.equal(landed.needs_reverify, true)
  assert.equal(landed.verified_on, '客户机')
})

test('重复合并同一份回执不会把事实和反问复制两遍', () => {
  const pack = receipt({ extraAsks: [{ id: 'b1', what: '再问一句', accept: '给一句明确答复即可' }] })
  const once = mergeReceipt(pack, asker()).state
  const twice = mergeReceipt(pack, once)
  assert.equal(twice.state.asks.filter((ask) => ask.id === 'b1').length, 1)
  assert.equal(twice.report.facts_adopted, 0)
})

test('改主意会被记下来，不是静默覆盖', () => {
  const first = mergeReceipt(receipt({ answers: { a1: 'C（组图方案）' } }), asker()).state
  const { state, report } = mergeReceipt(receipt({ answers: { a1: 'B（保留表格）' } }), first)
  assert.deepEqual(report.overwritten, [{ id: 'a1', was: 'C（组图方案）', now: 'B（保留表格）' }])
  assert.equal(state.asks.find((ask) => ask.id === 'a1').answer, 'B（保留表格）')
})

test('先答的那条，署名不会被后一次合并抹掉', () => {
  // 每次合并都要把已有的 asks 过一遍 normalizeAsks，所以「谁答的」必须活过归一化，
  // 否则收第二份回执时，第一份的署名就没了——而这正是分批回执的常态。
  const first = mergeReceipt(receipt({ answers: { a1: 'C（组图方案）' } }), asker()).state
  const { state } = mergeReceipt(receipt({ answers: { a2: '按组编号' } }), first)
  const a1 = state.asks.find((ask) => ask.id === 'a1')
  assert.equal(a1.answered_by, '张老师@客户机', '第一次的署名被第二次合并抹掉了')
  assert.ok(a1.answered_at)
  assert.equal(state.asks.find((ask) => ask.id === 'a2').status, 'answered')
})

test('没答过的 ask 不凭空长出署名字段——包的字节不能因此变动', () => {
  const { state } = mergeReceipt(receipt(), asker())
  const untouched = state.asks.find((ask) => ask.id === 'a2')
  assert.equal('answered_by' in untouched, false)
  assert.equal('answered_at' in untouched, false)
})

// ---- 反向用例：能变红的判据才算判据 ----

test('handoff 拒绝合并——它必须自己开一本护照', () => {
  assert.throws(
    () => mergeReceipt(receipt({ kind: 'handoff' }), asker()),
    /not a receipt/,
  )
})

test('答复另一件任务的回执拒绝合并', () => {
  assert.throws(
    () => mergeReceipt(receipt({ rootId: 'TP-OTHR-9999' }), asker()),
    /refusing to merge: this receipt answers TP-OTHR-9999/,
  )
})

test('没有 id 的目标护照拒绝合并', () => {
  assert.throws(() => mergeReceipt(receipt(), { title: '无号' }), /target passport state with an id/)
})

test('status 是 answered 但 answer 是空的，不算答完', () => {
  const { report, state } = mergeReceipt(receipt({ answers: { a1: '   ' } }), asker())
  assert.deepEqual(report.answered, [])
  assert.equal(state.asks.find((ask) => ask.id === 'a1').status, 'open')
})

test('对方的落地自检只报告、不采纳——那是他机器的事', () => {
  const state = asker()
  const bag = buildBag({
    state,
    actor: '张老师',
    machine: '客户机',
    kind: 'receipt',
    asks: state.asks,
    landingChecks: [{ check: '客户机能开 CAD', how: '双击 dxf' }],
  })
  const { state: merged, report } = mergeReceipt(verifyBag(bag).passport, asker())
  assert.equal(report.ignored_landing_checks, 1)
  assert.equal(merged.landing_checks, undefined)
})

// ---- pack 必须把提出的 ask 记进护照，否则回执无处可归 ----

test('新提的 ask 被记进护照', () => {
  const recorded = recordSentAsks(undefined, [{ id: 'a1', what: '版式选哪条', accept: '回复 A、B、C 之一' }])
  assert.equal(recorded.length, 1)
  assert.equal(recorded[0].status, 'open')
  assert.equal(recorded[0].answer, null)
})

test('重复打同一批 ask 不改护照——不能为了没变化去撞版本', () => {
  const asks = [{ id: 'a1', what: '版式选哪条', accept: '回复 A、B、C 之一' }]
  const once = recordSentAsks(undefined, asks)
  assert.equal(recordSentAsks(once, asks), null, '内容没变还返回新数组，就会每次打包都撞一次版本')
})

test('重发已答过的问题，不会把答案洗掉', () => {
  const answered = mergeReceipt(receipt(), asker()).state.asks
  const again = recordSentAsks(answered, [
    { id: 'a1', what: '版式走 A/B/C 哪条（重发）', accept: '回复中出现且仅出现 A、B、C 之一' },
  ])
  const a1 = again.find((ask) => ask.id === 'a1')
  assert.equal(a1.answer, 'C（组图方案）', '重发问题把已有答案洗掉了')
  assert.equal(a1.status, 'answered')
  assert.equal(a1.answered_by, '张老师@客户机')
  assert.match(a1.what, /重发/, '措辞更新没生效')
})

test('记进护照的 ask 一条不少——回执才有归处', () => {
  const sent = asker().asks
  const recorded = recordSentAsks([], sent)
  assert.deepEqual(recorded.map((ask) => ask.id), ['a1', 'a2'])
  // 这才是这一组测试的理由：护照记住了问题，答案就能自己回家。
  const { report } = mergeReceipt(receipt(), { ...asker(), asks: recorded })
  assert.deepEqual(report.answered, ['a1'])
})
