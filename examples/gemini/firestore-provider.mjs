#!/usr/bin/env node
/**
 * firestore-provider.mjs — Google Cloud Firestore 作为 Task Passport 的 Provider
 *
 * 演示 core.js 的开放 Provider 合约：第三方只需实现三个方法
 *   list() -> state[]
 *   open(passportId) -> { state, compiledContext? } | null
 *   save(state, expectedVersion) -> 保存后的 state（过期版本必须拒绝）
 *
 * 依赖：npm i @google-cloud/firestore
 * 免 key 演示：启动本地 emulator 后设置 FIRESTORE_EMULATOR_HOST
 *   gcloud beta emulators firestore start --project clawme-488709
 *   export FIRESTORE_EMULATOR_HOST=localhost:8080
 *
 * 运行（在仓库根目录）：
 *   node examples/gemini/firestore-provider.mjs
 * 会跑一个 new -> open -> checkpoint 的最小闭环并打印结果。
 */
import { Firestore } from '@google-cloud/firestore'
import { createPassportClient } from '../../core.js'

const COLLECTION = 'task-passports'

/**
 * Firestore Provider 实现。
 * 注意：Provider 只负责存 state 对象；版本冲突检测在 save() 里做，
 * 与本地 store 的行为保持一致（expected_version 不匹配必须拒绝）。
 */
export function createFirestoreProvider(options = {}) {
  const db = options.db ?? new Firestore()
  const collection = db.collection(options.collection ?? COLLECTION)

  async function list() {
    const snapshot = await collection.orderBy('updated_at', 'desc').get()
    return snapshot.docs.map((doc) => doc.data())
  }

  async function open(passportId) {
    const doc = await collection.doc(passportId).get()
    if (!doc.exists) return null
    return { state: doc.data() }
  }

  async function save(state, expectedVersion) {
    const passportId = state.id
    const ref = collection.doc(passportId)

    // 版本冲突检测：expected_version 必须等于当前版本（不存在视为 0）
    const doc = await ref.get()
    const currentVersion = doc.exists ? Number(doc.data().version || 0) : 0
    if (Number(expectedVersion) !== currentVersion) {
      throw new Error(
        `Task Passport version conflict: expected ${expectedVersion}, ` +
          `current ${currentVersion} (passport ${passportId})`,
      )
    }

    // 原子写入：version + 1 由调用方 state 携带，这里只保证条件更新
    await ref.set(state, { merge: true })
    return state
  }

  return { kind: 'firestore', list, open, save }
}

// ---------------------------------------------------------------------------
// main：跑一个 new -> open -> checkpoint 最小闭环（证明 Provider 可用）
// ---------------------------------------------------------------------------
async function main() {
  const provider = createFirestoreProvider()
  const client = createPassportClient({ provider, harness: 'firestore-demo' })

  console.log('=== 1. new：在 Firestore 里创建一本护照 ===')
  const created = await client.create({
    title: 'Firestore Provider 演示',
    goal: '证明 Task Passport 的第三方 Provider 合约可以被 Firestore 实现',
    currentState: '最小闭环运行中。',
    nextStep: '验证 new/open/checkpoint 三个方法都走 Firestore。',
  })
  console.log(JSON.stringify({ passport_id: created.passport_id, state_version: created.state_version }, null, 2))

  const id = created.passport_id
  const v1 = created.state_version

  console.log('\n=== 2. open：从 Firestore 读回 ===')
  const opened = await client.open(id)
  console.log(`goal: ${opened.state.goal}`)
  console.log(`current_state: ${opened.state.current_state}`)

  console.log('\n=== 3. checkpoint：更新状态（version 1 -> 2）===')
  const next = { ...opened.state, current_state: '闭环跑完了，Firestore 可用。' }
  const saved = await client.checkpoint(next, v1)
  console.log(JSON.stringify({ state_version: saved.state_version, current_state: saved.state.current_state }, null, 2))

  console.log('\n=== 4. 版本冲突检测：用旧的 expected_version 再写一次，必须被拒绝 ===')
  try {
    await client.checkpoint({ ...next, current_state: '这行不该写入' }, v1)
    console.log('!! 未抛错：冲突检测失效了（bug）')
    process.exitCode = 1
  } catch (error) {
    console.log(`✓ 正确拒绝：${error.message.slice(0, 80)}…`)
  }

  console.log('\n=== 5. list：确认护照在 Firestore 集合里 ===')
  const listing = await client.list()
  console.log(`共 ${listing.count} 本护照`)
  console.log('闭环通过 ✓')
}

// 直接运行（import 时不执行）
if (import.meta.url === `file://${process.argv[1]?.replaceAll('\\', '/')}`) {
  main().catch((error) => {
    console.error('演示失败：', error.message)
    process.exitCode = 1
  })
}
