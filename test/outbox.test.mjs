import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildBag, verifyBag } from '../bag.js'
import { LEDGER_FILE, listArchives, outboxDirectory, readArchived, readOutbox, recordOutbound } from '../outbox.js'

/**
 * The ledger answers one question: 「那个包里到底有什么」. These tests are written so
 * that a ledger which LOOKS fine but cannot answer it goes red — a count that survives
 * while the copy is lost is the failure mode worth guarding, because you only discover
 * it months later when someone asks.
 */

const scratch = () => mkdtemp(join(tmpdir(), 'tp-outbox-'))

const state = (overrides = {}) => ({
  spec: '2origin/0.1',
  kind: 'task.origin',
  id: 'TP-LEDG-0001',
  title: '发件台账',
  goal: '记住发出去了什么',
  version: 5,
  current_state: '第一轮已交付',
  facts: [
    { claim: '全稿 530 张插图', scope: 'universal', verified: true },
    { claim: '工具链在本机可运行', scope: 'machine', verified: true },
  ],
  decisions: [{ what: '只做无歧义的意见', why: '避免返工', when: '2026-08-15' }],
  learnings: [{ lesson: '分类只能给建议', confidence: 'high' }],
  next_steps: ['等回执'],
  ...overrides
})

const packed = (overrides = {}) => verifyBag(buildBag({
  state: state(),
  actor: '贺方升',
  machine: 'zjzhfs',
  note: '第一轮交付',
  asks: [{ id: 'a1', what: '版式走哪条', accept: '回复中出现且仅出现 A、B、C 之一' }],
  landingChecks: [{ check: '本机能开 dxf', how: '双击 svg' }],
  ...overrides,
})).passport

const entry = (overrides = {}) => ({
  passport_id: 'TP-LEDG-0001',
  state_version: 5,
  encoding: 'bagit-zip',
  out: '交接.taskpack',
  to: '教材编写组',
  actor: '贺方升',
  luggage: ['开工确认单.md'],
  ...overrides,
})

test('发出去就记一笔：谁、什么时候、哪一版、多少内容', async () => {
  const dir = await scratch()
  try {
    const result = await recordOutbound(dir, { entry: entry(), passport: packed(), packBytes: Buffer.from('PK-fake-zip') })
    assert.equal(result.ok, true)
    const { count, entries, damaged } = await readOutbox(dir)
    assert.equal(count, 1)
    assert.equal(damaged, 0)
    const line = entries[0]
    assert.equal(line.passport_id, 'TP-LEDG-0001')
    assert.equal(line.to, '教材编写组')
    assert.equal(line.state_version, 5)
    assert.equal(line.kind, 'handoff')
    assert.match(line.at, /^\d{4}-\d{2}-\d{2}T/)
    assert.equal(line.contents.facts, 2)
    assert.equal(line.contents.decisions, 1)
    assert.equal(line.contents.learnings, 1)
    assert.equal(line.contents.asks, 1)
    assert.deepEqual(line.luggage, ['开工确认单.md'])
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test('记下发出去那些字节的指纹——事后能对上是不是同一个包', async () => {
  const dir = await scratch()
  try {
    const bytes = Buffer.from('PK-fake-zip')
    await recordOutbound(dir, { entry: entry(), passport: packed(), packBytes: bytes })
    const { entries } = await readOutbox(dir)
    const expected = (await import('node:crypto')).createHash('sha256').update(bytes).digest('hex')
    assert.equal(entries[0].pack_sha256, expected)
    assert.equal(entries[0].bytes, bytes.length)
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test('存根留的是当时那份护照，不是现在这份——版本走了也还答得出来', async () => {
  const dir = await scratch()
  try {
    await recordOutbound(dir, { entry: entry(), passport: packed(), packBytes: Buffer.from('x') })
    const { entries } = await readOutbox(dir)
    const archived = await readArchived(dir, entries[0].archived_passport)
    // 这才是台账的意义：护照后来改到 v9 了，也仍然知道当初发出去的 v5 里写了什么。
    assert.equal(archived.passport.facts.length, 2)
    assert.equal(archived.passport.decisions[0].why, '避免返工')
    assert.equal(archived.asks[0].accept, '回复中出现且仅出现 A、B、C 之一')
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test('存根里的机器级事实是封存后的样子——存的是真出门的那份', async () => {
  const dir = await scratch()
  try {
    await recordOutbound(dir, { entry: entry(), passport: packed(), packBytes: Buffer.from('x') })
    const { entries } = await readOutbox(dir)
    const archived = await readArchived(dir, entries[0].archived_passport)
    const machine = archived.passport.facts.find((f) => f.scope === 'machine')
    assert.equal(machine.verified, false, '存根记的必须是收件方看到的那份，不是我们发之前那份')
    assert.equal(machine.needs_reverify, true)
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test('同一版同一秒发两次，两份存根都在——不许后一个盖掉前一个', async () => {
  const dir = await scratch()
  try {
    const at = '2026-08-17T00:47:05Z'
    await recordOutbound(dir, { entry: { ...entry(), at, encoding: 'bagit-zip' }, passport: packed(), packBytes: Buffer.from('zip-bytes') })
    await recordOutbound(dir, { entry: { ...entry(), at, encoding: 'flat' }, passport: packed(), packBytes: Buffer.from('flat-bytes') })
    const { entries, count } = await readOutbox(dir)
    assert.equal(count, 2)
    assert.notEqual(entries[0].archived_passport, entries[1].archived_passport, '两笔记录指向同一个存根 = 丢了一份')
    assert.equal((await listArchives(dir)).length, 2)
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test('多次写入是追加，不是覆盖', async () => {
  const dir = await scratch()
  try {
    for (const to of ['甲方', '乙方', '丙方']) {
      await recordOutbound(dir, { entry: entry({ to }), passport: packed(), packBytes: Buffer.from(to) })
    }
    const { entries } = await readOutbox(dir)
    assert.deepEqual(entries.map((e) => e.to), ['甲方', '乙方', '丙方'])
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test('按护照筛，按条数截', async () => {
  const dir = await scratch()
  try {
    await recordOutbound(dir, { entry: entry(), passport: packed(), packBytes: Buffer.from('1') })
    await recordOutbound(dir, { entry: entry({ passport_id: 'TP-OTHR-0002' }), passport: packed(), packBytes: Buffer.from('2') })
    assert.equal((await readOutbox(dir, { passportId: 'TP-LEDG-0001' })).count, 1)
    assert.equal((await readOutbox(dir, { limit: 1 })).entries.length, 1)
  } finally { await rm(dir, { recursive: true, force: true }) }
})

// ---- 反向用例：能变红的判据才算判据 ----

test('还没发过东西时，台账是空的而不是报错', async () => {
  const dir = await scratch()
  try {
    const report = await readOutbox(dir)
    assert.equal(report.count, 0)
    assert.deepEqual(report.entries, [])
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test('台账被写坏一行，如实报告损坏数，不假装干净', async () => {
  const dir = await scratch()
  try {
    await recordOutbound(dir, { entry: entry(), passport: packed(), packBytes: Buffer.from('1') })
    const path = join(dir, LEDGER_FILE)
    await writeFile(path, `${await readFile(path, 'utf8')}{这行不是 JSON\n`, 'utf8')
    const report = await readOutbox(dir)
    assert.equal(report.count, 1)
    assert.equal(report.damaged, 1, '坏行被静默吞掉，台账就会看起来比实际干净')
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test('写不进去时返回失败，而不是抛给打包流程', async () => {
  // 包是交付物；写不成日记不能把包也拦下来。
  const result = await recordOutbound('\0非法路径', { entry: entry(), passport: packed(), packBytes: Buffer.from('x') })
  assert.equal(result.ok, false)
  assert.ok(result.error)
})

test('存根路径只认自己目录里的文件名，不接受路径穿越', async () => {
  const dir = await scratch()
  try {
    await assert.rejects(() => readArchived(dir, '../../etc/passwd'), /not an archive name/)
  } finally { await rm(dir, { recursive: true, force: true }) }
})

test('台账跟着 store 走；没有 store 才落到用户目录', () => {
  assert.equal(outboxDirectory({ store: 'D:/TaskPassports' }).endsWith('TaskPassports'), true)
  assert.equal(outboxDirectory({ outbox: 'D:/elsewhere', store: 'D:/TaskPassports' }).endsWith('elsewhere'), true)
  assert.match(outboxDirectory({}), /\.task-passport$/)
})
