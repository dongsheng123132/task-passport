import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { BAG_SPEC, buildBag, readZip, unpackState, verifyBag, writeZip } from '../bag.js'

const state = (overrides = {}) => ({
  spec: '2origin/0.1',
  kind: 'task.origin',
  id: 'TP-7K4M-9D2Q',
  title: '搬家冒烟',
  goal: '把任务搬到另一台电脑',
  version: 3,
  current_state: '做了一半',
  harness: 'task-passport-cli',
  facts: [
    { claim: '客户名必须脱敏', verified: true, scope: 'org' },
    { claim: 'image2 在本机可出图', verified: true, scope: 'machine' },
    { claim: '体验课定在 8-22', verified: true, scope: 'universal' },
  ],
  decisions: [],
  artifacts: [],
  next_steps: ['做封面图'],
  ...overrides,
})

test('a bag is a valid BagIt structure and survives a zip round trip', () => {
  const bag = buildBag({ state: state(), files: [{ name: 'brief.txt', data: '750x400' }], actor: '贺方升', machine: 'home-pc' })
  for (const required of ['bagit.txt', 'bag-info.txt', 'manifest-sha256.txt', 'tagmanifest-sha256.txt', 'data/passport.json']) {
    assert.ok(bag.has(required), `${required} must be in the bag`)
  }
  assert.match(bag.get('bagit.txt').toString(), /BagIt-Version: 1\.0/)
  assert.match(bag.get('bag-info.txt').toString(), /Payload-Oxum: \d+\.2/)

  const reopened = readZip(writeZip(bag))
  assert.deepEqual([...reopened.keys()].sort(), [...bag.keys()].sort())
  for (const [name, data] of bag) assert.deepEqual(reopened.get(name), data, `${name} must survive the zip`)

  const { ok, errors, passport } = verifyBag(reopened)
  assert.deepEqual(errors, [])
  assert.equal(ok, true)
  assert.equal(passport.spec, BAG_SPEC)
  assert.equal(passport.lineage.root_id, 'TP-7K4M-9D2Q')
  assert.equal(passport.lineage.from_version, 3)
})

test('a tampered payload fails verification instead of importing quietly', () => {
  const bag = buildBag({ state: state(), files: [{ name: 'brief.txt', data: '750x400' }], actor: 'a', machine: 'm' })
  bag.set('data/files/brief.txt', Buffer.from('750x400 但被人改过'))
  const { ok, errors } = verifyBag(bag)
  assert.equal(ok, false)
  assert.match(errors.join('\n'), /does not match its manifest-sha256\.txt digest/)
})

test('a payload file nobody vouched for fails verification', () => {
  const bag = buildBag({ state: state(), actor: 'a', machine: 'm' })
  bag.set('data/files/smuggled.txt', Buffer.from('hi'))
  const { ok, errors } = verifyBag(bag)
  assert.equal(ok, false)
  assert.match(errors.join('\n'), /not in manifest-sha256\.txt/)
})

test('packing refuses a credential rather than shipping it to someone else', () => {
  assert.throws(
    () => buildBag({ state: state({ current_state: '用 sk-abcdefghij0123456789 这个 key' }), actor: 'a', machine: 'm' }),
    /refusing to pack.*credential/s,
  )
  assert.throws(
    () => buildBag({ state: state(), files: [{ name: 'env.txt', data: 'AKIAIOSFODNN7EXAMPLE' }], actor: 'a', machine: 'm' }),
    /refusing to pack.*credential/s,
  )
})

test('packing refuses a chat transcript — the whole point is not to move one', () => {
  assert.throws(
    () => buildBag({ state: state({ current_state: 'User: 帮我写\nAssistant: 好的' }), actor: 'a', machine: 'm' }),
    /refusing to pack.*transcript/s,
  )
})

test('unpacking downgrades machine-scoped facts and keeps the rest proven', () => {
  const bag = verifyBag(buildBag({ state: state(), actor: '贺方升', machine: 'home-pc' })).passport
  const unpacked = unpackState(bag, { machine: 'office-pc', localId: 'TP-NEWL-0CAL' })

  assert.equal(unpacked.id, 'TP-NEWL-0CAL', 'the sender id must not be reused')
  assert.equal(unpacked.version, 0)
  const byClaim = Object.fromEntries(unpacked.facts.map((fact) => [fact.claim, fact]))
  assert.equal(byClaim['image2 在本机可出图'].verified, false)
  assert.equal(byClaim['image2 在本机可出图'].needs_reverify, true)
  assert.equal(byClaim['客户名必须脱敏'].verified, true)
  assert.equal(byClaim['体验课定在 8-22'].verified, true)
  assert.match(unpacked.next_steps[0], /先重验标了 ⚠️ 的 1 条事实/)
  assert.match(unpacked.current_state, /搬家自 贺方升@home-pc（血缘 TP-7K4M-9D2Q@3）/)
})

test('a familiar hostname does not buy back trust — only an explicit flag does', () => {
  const bag = verifyBag(buildBag({ state: state(), actor: '贺方升', machine: 'same-name' })).passport
  // Hostnames collide, and a false ✓ is far more expensive than re-checking a path.
  const guarded = unpackState(bag, { machine: 'same-name', localId: 'TP-AAAA-0001' })
  assert.equal(guarded.facts.find((f) => f.scope === 'machine').needs_reverify, true)

  const trusted = unpackState(bag, { machine: 'same-name', localId: 'TP-AAAA-0002', trustMachineFacts: true })
  assert.equal(trusted.facts.find((f) => f.scope === 'machine').verified, true)
})

test('a fact with no scope is treated as machine-local, not as universal truth', () => {
  const bag = verifyBag(buildBag({
    state: state({ facts: [{ claim: '路径 D:\\x 存在', verified: true }] }),
    actor: 'a',
    machine: 'm',
  })).passport
  const unpacked = unpackState(bag, { machine: 'other', localId: 'TP-BBBB-0001' })
  assert.equal(unpacked.facts[0].needs_reverify, true, 'unlabelled facts must not cross machines wearing a ✓')
})

test('the zip is a real zip: local headers, central directory and CRCs line up', () => {
  const bag = buildBag({ state: state(), files: [{ name: 'brief.txt', data: 'x'.repeat(5000) }], actor: 'a', machine: 'm' })
  const zip = writeZip(bag)
  assert.equal(zip.readUInt32LE(0), 0x04034b50, 'starts with a local file header')
  const eocdOffset = zip.length - 22
  assert.equal(zip.readUInt32LE(eocdOffset), 0x06054b50, 'ends with an end-of-central-directory record')
  assert.equal(zip.readUInt16LE(eocdOffset + 10), bag.size, 'central directory counts every entry')

  const reopened = readZip(zip)
  const original = bag.get('data/files/brief.txt')
  assert.equal(createHash('sha256').update(reopened.get('data/files/brief.txt')).digest('hex'),
    createHash('sha256').update(original).digest('hex'))
})

test('a downgraded fact records where it was proven, so a receiver can tell why it is unproven', () => {
  const bag = verifyBag(buildBag({
    state: state({ facts: [{ claim: '仓库在 D 盘可读', verified: true, scope: 'machine' }] }),
    actor: '贺方升',
    machine: 'home-pc',
  })).passport
  const unpacked = unpackState(bag, { machine: 'office-pc', localId: 'TP-CCCC-0001' })
  // "different machine" and "same machine, cannot reach that path" are different
  // problems; only the second one goes away by opening a directory.
  assert.equal(unpacked.facts[0].verified_on, 'home-pc')
  assert.match(unpacked.next_steps[0], /只在 home-pc 上验证过/)
  assert.match(unpacked.next_steps[0], /够不着而非失效/)
})

test('a folder keeps its shape through pack and land, and cannot escape data/files/', () => {
  const bag = buildBag({
    state: state(),
    files: [
      { name: '资料/封面.png', data: Buffer.from([0x89, 0x50, 0x4e, 0x47]) },
      { name: '资料/子目录/说明.txt', data: '子目录' },
      // Two files sharing a basename must both survive; flattening loses one silently.
      { name: '资料/另一层/说明.txt', data: '另一层' },
      { name: '../../etc/passwd', data: 'nope' },
      { name: String.raw`C:\Windows\evil.dll`, data: 'nope' },
    ],
    actor: 'a',
    machine: 'm',
  })
  const paths = [...bag.keys()].filter((path) => path.startsWith('data/files/'))
  assert.ok(paths.includes('data/files/资料/子目录/说明.txt'))
  assert.ok(paths.includes('data/files/资料/另一层/说明.txt'))
  assert.equal(paths.filter((path) => path.endsWith('说明.txt')).length, 2, 'same basename must not collide')
  for (const path of paths) {
    assert.ok(path.startsWith('data/files/'), `${path} escaped the payload directory`)
    assert.ok(!path.includes('..'), `${path} still contains a traversal segment`)
    assert.ok(!/[A-Za-z]:/.test(path), `${path} still carries a drive letter`)
  }
  assert.deepEqual(verifyBag(bag).errors, [])
})
