import assert from 'node:assert/strict'
import { test } from 'node:test'
import { MAX_INLINE_ATTACHMENT_BYTES, buildBag, unpackState, verifyBag } from '../bag.js'
import { conformance, fromFlat, lintForExport, toFlat } from '../taskpack.js'

const state = () => ({
  id: 'TP-TEST-0001',
  version: 3,
  title: '交接测试',
  goal: '验证 TaskPack 两种编码等价',
  harness: 'node-test',
  current_state: '打包中',
  facts: [
    { claim: '客户确认了封面尺寸 750×400', scope: 'universal', verified: true, source: '会议纪要' },
    { claim: 'D:\\tools\\image2.exe 可运行', scope: 'machine', verified: true, source: '本机跑过' },
  ],
  artifacts: ['D:\\uking编程\\FDE培训班\\01-文案.txt'],
  next_steps: ['出封面图'],
})

const pack = (overrides = {}) => buildBag({
  state: state(),
  actor: '贺方升',
  machine: 'zhuanz-win11',
  asks: [{ what: '给封面图的提示词', accept: '一段中文提示词，覆盖 750×400 与配色要求' }],
  landingChecks: [{ check: '本机能出图', how: 'bl image generate 跑一张测试图' }],
  ...overrides,
})

test('两种编码逐字节往返等价', () => {
  const entries = pack()
  const rebuilt = fromFlat(toFlat(entries))
  assert.deepEqual([...rebuilt.keys()].sort(), [...entries.keys()].sort())
  for (const [key, value] of entries) {
    assert.equal(Buffer.compare(value, rebuilt.get(key)), 0, `${key} 往返后字节不同`)
  }
})

test('合规的包能过 conformance 全部检查', () => {
  const report = conformance(pack())
  assert.equal(report.ok, true, report.checks.filter((c) => !c.ok).map((c) => `${c.id}:${c.detail}`).join(' | '))
  assert.ok(report.total >= 10)
})

// ---- 反向用例：能变红的判据才算判据 ----

test('没有 accept 的 ask 拒绝打包', () => {
  assert.throws(
    () => pack({ asks: [{ what: '看着办' }] }),
    /has no accept rule/,
  )
})

test('没有正文的 ask 拒绝打包', () => {
  assert.throws(
    () => pack({ asks: [{ accept: '一段中文提示词' }] }),
    /has no request text/,
  )
})

test('机器级事实不得带着 ✓ 出境——打包时就降级，不指望接收方', () => {
  const entries = pack()
  const { passport } = verifyBag(entries)
  const machineFact = passport.passport.facts.find((fact) => fact.scope === 'machine')
  assert.equal(machineFact.verified, false)
  assert.equal(machineFact.needs_reverify, true)
  assert.equal(machineFact.verified_on, 'zhuanz-win11', '必须记下它曾在哪台机器上被证明')

  const universal = passport.passport.facts.find((fact) => fact.scope === 'universal')
  assert.equal(universal.verified, true, '与环境无关的事实不该被牵连')
})

test('篡改了附件的扁平包会被自己的 sha256 挡下', () => {
  const entries = buildBag({
    state: state(),
    files: [{ name: 'note.txt', data: Buffer.from('原文', 'utf8') }],
    asks: [],
  })
  const flat = JSON.parse(toFlat(entries))
  flat.attachments[0].data = '被改过的内容'
  assert.throws(() => fromFlat(JSON.stringify(flat)), /does not match its declared sha256/)
})

test('conformance 会因为伪造的护照变红，而不是一路绿灯', () => {
  const entries = pack()
  // 手工把一条机器级事实改回 verified，模拟一个绕过咽喉自己拼包的实现
  const raw = JSON.parse(entries.get('data/passport.json').toString('utf8'))
  raw.passport.facts[1].verified = true
  raw.passport.facts[1].needs_reverify = false
  entries.set('data/passport.json', Buffer.from(`${JSON.stringify(raw, null, 2)}\n`, 'utf8'))

  const report = conformance(entries)
  assert.equal(report.ok, false)
  const c6 = report.checks.find((check) => check.id === 'C6')
  assert.equal(c6.ok, false, '机器级事实带 ✓ 必须让 C6 变红')
})

test('落地把必做自检和未答 ask 排在发送方自己的下一步之前', () => {
  const entries = pack()
  const { passport } = verifyBag(entries)
  const landed = unpackState(passport, { machine: 'colleague-pc', localId: 'TP-NEW-0002' })

  assert.match(landed.next_steps[0], /落地自检【必做】本机能出图/)
  assert.ok(landed.next_steps.some((step) => /回答 ask a1/.test(step)))
  assert.ok(landed.next_steps.some((step) => /什么算答完/.test(step)), 'ask 落地时必须带上判据')
  assert.equal(landed.next_steps.at(-1), '出封面图', '发送方原有的下一步排在最后')
  assert.equal(landed.id, 'TP-NEW-0002', '接收方用自己的新号，不复用发送方的')
  assert.equal(landed.landing_checks.length, 1)
})

test('--trust-machine-facts 只能恢复本机证明过的事实，不能给别人的洗白', () => {
  const { passport } = verifyBag(pack())

  const sameMachine = unpackState(passport, { machine: 'zhuanz-win11', localId: 'TP-A', trustMachineFacts: true })
  assert.equal(sameMachine.facts[1].verified, true, '同一台机器上应当可以恢复')

  const otherMachine = unpackState(passport, { machine: 'colleague-pc', localId: 'TP-B', trustMachineFacts: true })
  assert.equal(otherMachine.facts[1].verified, false, '换了机器，这个开关必须无效')
  assert.equal(otherMachine.facts[1].needs_reverify, true)
})

test('导出体检会点名对方打不开的本机路径', () => {
  const warnings = lintForExport({ state: state(), files: [], asks: [] })
  assert.ok(warnings.some((warning) => /本机绝对路径/.test(warning)))

  const attached = lintForExport({
    state: state(),
    files: [{ name: '01-文案.txt' }],
    asks: [],
  })
  assert.ok(!attached.some((warning) => /本机绝对路径/.test(warning)), '装进包里的行李不该再被警告')
})

test('未标 scope 的事实会被点名——缺省按 machine 处理是有代价的', () => {
  const warnings = lintForExport({
    state: { facts: [{ claim: '这条没标 scope', verified: true }] },
  })
  assert.ok(warnings.some((warning) => /未标 scope/.test(warning)))
})

test('读得懂已经发出去的 .tpx 文件，不把首批用户扔掉', () => {
  const legacy = {
    tpx: '0.1',
    kind: 'handoff',
    issued_at: '2026-08-15T11:47:56Z',
    origin: { actor: '贺方升', machine: 'zhuanz-win11', harness: 'claude-code' },
    lineage: { root_id: 'TP-G6RZ-DS3B', from_version: 2, chain: ['TP-G6RZ-DS3B@2'] },
    passport: { id: 'TP-G6RZ-DS3B', title: 'FDE 培训班交付', goal: '交付体验课' },
    facts: [{ claim: '体验课时间定为 2026-08-22', scope: 'universal', verified: true, source: 'r1' }],
    asks: [{ id: 'a1', what: '提供封面提示词', accept: '一段可直接投喂的中文提示词' }],
    landing_checks: [{ id: 'c1', check: '附件 sha256 一致', how: 'import 自动校验', required: true }],
  }

  const entries = fromFlat(JSON.stringify(legacy))
  const { ok, passport } = verifyBag(entries)
  assert.equal(ok, true)
  assert.equal(passport.lineage.root_id, 'TP-G6RZ-DS3B')
  assert.equal(passport.asks[0].accept, '一段可直接投喂的中文提示词')
  assert.equal(passport.passport.facts[0].verified, true)
})

test('the flat form refuses an attachment too big to inline, and names it', () => {
  const bag = buildBag({
    state: { id: 'TP-7K4M-9D2Q', title: 't', goal: 'g', version: 1 },
    files: [{ name: '大图.png', data: Buffer.alloc(MAX_INLINE_ATTACHMENT_BYTES + 1) }],
    actor: 'a',
    machine: 'm',
  })
  assert.throws(() => toFlat(bag), /大图\.png.*inline limit.*without --flat/s)
})

test('判定一个包时，不能享受读取方自己做的修复', () => {
  // 干净机实测（2026-08-16）挖出来的：手改一个扁平包，塞进一条 machine 级但仍带 ✓ 的事实，
  // C6 却是绿的——因为读取路径经过咽喉，事实被静默修复了，C6 看的是修复结果不是文件本身。
  const entries = pack()
  const flat = JSON.parse(toFlat(entries))
  flat.passport.passport.facts = [
    { claim: 'D:/tools/x.exe 可运行', scope: 'machine', verified: true, source: '本机跑过' },
  ]
  const text = JSON.stringify(flat, null, 2)

  // 宽松读取（落地场景）：修好它，因为接收方本来就该安全
  const repaired = fromFlat(text)
  const { passport } = verifyBag(repaired)
  assert.equal(passport.passport.facts[0].verified, false, '落地时应当修复')

  // 严格读取（判定场景）：必须出声，不能替文件把分数挣了
  assert.throws(() => fromFlat(text, { strict: true }), /not conformant as written/)
})

test('合规的包在严格模式下照样读得进去', () => {
  const text = toFlat(pack())
  assert.doesNotThrow(() => fromFlat(text, { strict: true }))
})
