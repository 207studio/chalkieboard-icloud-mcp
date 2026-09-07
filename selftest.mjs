#!/usr/bin/env node
// chalkieboard-mcp 자가 검사 — 임시 폴더에 앱이 쓰는 꼴 그대로 structure.json·배정표를 만들어 서버를 띄우고 도구 전부를 돌린다.
// 사용: node tools/mcp/selftest.mjs        (의존성 0, 실제 iCloud 폴더는 건드리지 않는다)
import { spawn } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { createInterface } from 'node:readline'
import assert from 'node:assert/strict'

const here = dirname(fileURLToPath(import.meta.url))
const rootDir = mkdtempSync(join(tmpdir(), 'chalkie-mcp-'))
const KOR = '국어 (2026-2)', SCI = '과학 (2026)'

// ── 픽스처: 앱(CloudManifest)이 쓰는 모양 그대로 ──
mkdirSync(join(rootDir, KOR)); mkdirSync(join(rootDir, SCI))
writeFileSync(join(rootDir, 'README.md'), '# 수업 자료 폴더\n')
writeFileSync(join(rootDir, 'structure.json'), JSON.stringify({
  schema: 1, generatedBy: 'Chalkieboard', readOnly: true, classes: ['1반', '2반'],
  rules: { addMaterial: '과목 폴더에', classAssignment: '괄호', lessonSlot: '학년_학기_단원_차시' },
  subjects: [
    { id: 'A', name: '국어', year: 2026, semester: 2, folder: KOR,
      units: [{ name: '1단원', lessons: [
        { id: 'L1', session: 1, title: '도입', materials: [{ name: '교과서', kind: 'pdf' }] },
        { id: 'L2', session: 2, title: '', materials: [] }] }],
      lessonsWithoutUnit: [{ id: 'L9', title: '보충', materials: [] }] },
    { id: 'B', name: '과학', year: 2026, semester: 0, folder: SCI, units: [], lessonsWithoutUnit: [] },
  ],
}, null, 2))
writeFileSync(join(rootDir, KOR, 'lessons.chalkie.json'), JSON.stringify({
  schema: 1, kind: 'sharedIndex', generatedBy: 'Chalkieboard', subject: '국어', year: 2026, semester: 2, pinned: [],
  units: [{ order: 1, number: '1단원', title: '이야기', lessons: [
    { session: 1, title: '도입', materials: [{ name: '교과서', kind: 'pdf' }], missing: ['학습지.pdf'] },
    { session: 2, title: '', materials: [] }] }],
  lessonsWithoutUnit: [{ title: '보충', materials: [] }],
}, null, 2))
writeFileSync(join(rootDir, KOR, '교과서.pdf'), '%PDF-1.4 fake')
mkdirSync(join(rootDir, KOR, '메모')); writeFileSync(join(rootDir, KOR, '메모', '수업계획.md'), '# 계획\n')

// ── 서버 ──
const srv = spawn(process.execPath, [join(here, 'chalkieboard-mcp.mjs')], { env: { ...process.env, CHALKIEBOARD_DIR: rootDir }, stdio: ['pipe', 'pipe', 'inherit'] })
const rl = createInterface({ input: srv.stdout })
const pending = new Map(); let seq = 0
rl.on('line', l => { const m = JSON.parse(l); const p = pending.get(m.id); if (p) { pending.delete(m.id); p(m) } })
const rpc = (method, params) => new Promise(res => { const id = ++seq; pending.set(id, res); srv.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n') })
const call = async (name, args) => {
  const r = await rpc('tools/call', { name, arguments: args })
  if (r.error) throw new Error('RPC error: ' + r.error.message)
  const text = r.result.content[0].text
  if (r.result.isError) { const e = new Error(text); e.toolError = true; throw e }
  return JSON.parse(text)
}
const rejects = async (p, re) => { try { await p } catch (e) { assert.ok(e.toolError, '도구 오류여야 한다: ' + e.message); assert.match(e.message, re); return } assert.fail('거부돼야 한다: ' + re) }

let failed = 0
const check = async (name, fn) => { try { await fn(); console.log('PASS', name) } catch (e) { failed++; console.log('FAIL', name, '—', e.message) } }

await check('initialize', async () => {
  const r = await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'selftest', version: '0' } })
  assert.equal(r.result.protocolVersion, '2025-06-18'); assert.ok(r.result.capabilities.tools); assert.ok(r.result.capabilities.resources)
  srv.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n')
  assert.deepEqual((await rpc('ping')).result, {})
})
await check('tools/list 8개', async () => {
  const r = await rpc('tools/list')
  assert.deepEqual(r.result.tools.map(t => t.name), ['list_subjects', 'list_lessons', 'get_lesson', 'list_files', 'add_material', 'read_file', 'plan_lessons', 'create_subject'])
})
await check('list_subjects', async () => {
  const r = await call('list_subjects')
  assert.equal(r.root, rootDir); assert.deepEqual(r.classes, ['1반', '2반']); assert.ok(r.rules.lessonSlot)
  const k = r.subjects.find(s => s.folder === KOR)
  assert.deepEqual(k.units, ['1']); assert.equal(k.lessons, 3); assert.equal(k.files, 2)   // 배정표는 파일 수에서 뺀다
})
await check('list_lessons — 매니페스트 + 배정표(빠진 파일·단원 제목)', async () => {
  const r = await call('list_lessons', { folder: KOR })
  assert.equal(r.lessons.length, 3)
  const l1 = r.lessons.find(l => l.session === 1)
  assert.equal(l1.unit, '1'); assert.equal(l1.unitTitle, '이야기'); assert.deepEqual(l1.missing, ['학습지.pdf'])
  assert.equal(r.lessons.find(l => l.unit === null).title, '보충')
  const all = await call('list_lessons'); assert.equal(all.lessons.length, 3)
  await rejects(call('list_lessons', { folder: '없음 (2026-1)' }), /그런 과목 폴더가 없습니다/)
})
await check('get_lesson — 파일 존재까지', async () => {
  const r = await call('get_lesson', { folder: KOR, unit: '1단원', session: 1 })
  assert.equal(r.materials[0].file, '교과서.pdf')
  const many = await call('get_lesson', { folder: KOR, unit: '1' }); assert.equal(many.candidates.length, 2)
})
await check('list_files — 하위 폴더·종류·연결 여부', async () => {
  const r = await call('list_files', { folder: KOR })
  assert.deepEqual(r.files.map(f => f.path).sort(), ['교과서.pdf', '메모/수업계획.md'])
  assert.equal(r.files.find(f => f.path === '교과서.pdf').inLessons, true)
  assert.equal(r.files.find(f => f.path === '교과서.pdf').kind, 'pdf')
  assert.equal(r.files.find(f => f.path === '메모/수업계획.md').kind, null)
})
await check('add_material — 접두(차시 배치)·학급 꼬리·하위 폴더', async () => {
  const r = await call('add_material', { folder: KOR, filename: '학습지.html', content: '<p>hi</p>', unit: 1, first: 3, last: 4, grade: 4, class: '1반' })
  assert.equal(r.placed, `${KOR}/4_2_1_03_04_학습지(1반).html`); assert.equal(r.lessons, '1단원 3~4차시'); assert.equal(r.class, '1반')
  assert.ok(existsSync(join(rootDir, KOR, '4_2_1_03_04_학습지(1반).html')))
  const f = (await call('list_files', { folder: KOR })).files.find(x => x.path.startsWith('4_2_1'))
  assert.deepEqual(f.slot, { grade: 4, semester: 2, unit: 1, first: 3, last: 4 }); assert.equal(f.class, '1반')
  const sub = await call('add_material', { folder: `${KOR}/학습지`, filename: '보충.html', content: 'x' })
  assert.ok(existsSync(join(rootDir, KOR, '학습지', '보충.html'))); assert.equal(sub.lessons, null)
  const pdf = await call('add_material', { folder: KOR, filename: '요약.pdf', content: Buffer.from('%PDF-1.4').toString('base64'), encoding: 'base64' })
  assert.equal(readFileSync(join(rootDir, KOR, '요약.pdf'), 'utf8'), '%PDF-1.4'); assert.equal(pdf.materialName, '요약')
})
await check('add_material — 거부: 덮어쓰기·확장자·경로 탈출·연간 학기 없음·접두 중복', async () => {
  await rejects(call('add_material', { folder: KOR, filename: '교과서.pdf', content: 'x' }), /이미 있는 파일/)
  await rejects(call('add_material', { folder: KOR, filename: '그림.png', content: 'x' }), /pdf · pptx · html/)
  await rejects(call('add_material', { folder: '../탈출', filename: 'a.pdf', content: 'x' }), /폴더 밖|그런 과목 폴더/)
  await rejects(call('add_material', { folder: KOR, filename: '../a.pdf', content: 'x' }), /경로를 넣을 수 없/)
  await rejects(call('add_material', { folder: KOR, filename: '.숨김.pdf', content: 'x' }), /경로를 넣을 수 없/)
  await rejects(call('add_material', { folder: SCI, filename: 'a.pdf', content: 'x', unit: 1, first: 1, grade: 3 }), /연간 과목/)
  await rejects(call('add_material', { folder: KOR, filename: '4_2_1_01_a.pdf', content: 'x', unit: 1, first: 1, grade: 4 }), /이미 배치 접두/)
  await rejects(call('add_material', { folder: KOR, filename: 'a.pdf', content: 'x', unit: 1, first: 1 }), /grade·unit·first/)
  await rejects(call('add_material', { folder: '없음 (2026-2)', filename: 'a.pdf', content: 'x' }), /그런 과목 폴더/)
  assert.ok(!existsSync(join(rootDir, '..', '탈출')))
})
await check('read_file — 텍스트·비텍스트·탈출', async () => {
  assert.equal((await call('read_file', { folder: KOR, path: '메모/수업계획.md' })).text, '# 계획\n')
  assert.match((await call('read_file', { folder: KOR, path: '교과서.pdf' })).note, /텍스트가 아닌/)
  await rejects(call('read_file', { folder: KOR, path: '../structure.json' }), /폴더 밖/)
  await rejects(call('read_file', { folder: '..', path: 'x' }), /폴더 밖|그런 과목 폴더/)
})
await check('plan_lessons — 덧붙이기만, 단원 표기 보존, 자료 표기 셋', async () => {
  const r = await call('plan_lessons', { folder: KOR, units: [
    { number: '1', title: '바뀌면 안 됨', lessons: [
      { session: 2, title: '이야기 비교', materials: ['교과서.pdf', '학습지.pdf', 'https://example.com/x'] },
      { session: 3, title: '새 차시', materials: [{ name: '교과서', kind: 'pdf' }] }] },
    { number: '2', title: '새 단원', lessons: [{ session: 1, materials: ['교과서'] }] },
  ], lessonsWithoutUnit: [{ title: '보충', materials: ['교과서.pdf'] }, { title: '새 보충' }], pinned: ['교과서.pdf'] })
  assert.deepEqual(r.added, { units: 1, lessons: 3, materials: 6, titles: 1, pinned: 1 })
  const sheet = JSON.parse(readFileSync(join(rootDir, KOR, 'lessons.chalkie.json'), 'utf8'))
  assert.equal(sheet.kind, 'sharedIndex'); assert.equal(sheet.schema, 1); assert.equal(sheet.generatedBy, 'chalkieboard-mcp')
  const u1 = sheet.units.find(u => u.number === '1단원')                      // 있던 표기 그대로 — 앱이 같은 단원으로 본다
  assert.ok(u1); assert.equal(u1.title, '이야기')                               // 있던 제목은 안 바뀐다
  assert.deepEqual(u1.lessons.find(l => l.session === 1).missing, ['학습지.pdf'])   // 있던 것 보존
  const l2 = u1.lessons.find(l => l.session === 2)
  assert.equal(l2.title, '이야기 비교')
  assert.deepEqual(l2.materials, [{ name: '교과서', kind: 'pdf' }, { name: '학습지', kind: 'pdf' }, { name: 'example.com/x', kind: 'url', url: 'https://example.com/x' }])
  assert.equal(u1.lessons.find(l => l.session === 3).title, '새 차시')
  const u2 = sheet.units.find(u => u.number === '2'); assert.equal(u2.order, 2); assert.equal(u2.lessons[0].materials[0].name, '교과서')
  assert.equal(sheet.lessonsWithoutUnit.length, 2); assert.deepEqual(sheet.pinned, [{ name: '교과서', kind: 'pdf' }])
  // 두 번째 같은 호출 — 더해지는 것 0
  const again = await call('plan_lessons', { folder: KOR, units: [{ number: '1단원', lessons: [{ session: 2, materials: ['교과서.pdf'] }] }] })
  assert.deepEqual(again.added, { units: 0, lessons: 0, materials: 0, titles: 0, pinned: 0 })
  await rejects(call('plan_lessons', { folder: KOR, units: [{ number: '1', lessons: [{ title: '번호 없음' }] }] }), /session/)
  await rejects(call('plan_lessons', { folder: KOR, units: [{ number: '1', lessons: [{ session: 5, materials: ['정체불명'] }] }] }), /종류를 모르겠/)
  // 새 과목 배정표(없던 파일)도 뼈대부터 만든다
  await call('plan_lessons', { folder: SCI, units: [{ number: '1', lessons: [{ session: 1, title: '물의 상태' }] }] })
  const sci = JSON.parse(readFileSync(join(rootDir, SCI, 'lessons.chalkie.json'), 'utf8'))
  assert.equal(sci.subject, '과학'); assert.equal(sci.semester, 0); assert.equal(sci.units[0].number, '1')
  // 매니페스트로 이어진 차시(list_lessons)에도 빠진 파일이 보인다
  const ls = await call('list_lessons', { folder: KOR }); assert.equal(ls.lessons.find(l => l.session === 2).missing.length, 0)
})
await check('create_subject', async () => {
  const r = await call('create_subject', { name: '사회/역사', year: 2026, semester: 2 })
  assert.equal(r.folder, '사회-역사 (2026-2)')
  const sh = JSON.parse(readFileSync(join(rootDir, r.folder, 'lessons.chalkie.json'), 'utf8'))
  assert.equal(sh.kind, 'sharedIndex'); assert.equal(sh.subject, '사회-역사'); assert.equal(sh.semester, 2)
  assert.equal((await call('create_subject', { name: '미술', year: 2026, semester: 0 })).folder, '미술 (2026)')
  await rejects(call('create_subject', { name: '국어', year: 2026, semester: 2 }), /이미 있는 과목/)
  await rejects(call('create_subject', { name: '미술', year: 2026, semester: 0 }), /폴더가 이미/)
  await rejects(call('create_subject', { name: '..', year: 2026, semester: 1 }), /과목 이름으로 쓸 수 없/)
  assert.equal((await call('create_subject', { name: '../탈출', year: 2026, semester: 1 })).folder, '..-탈출 (2026-1)')
})
await check('resources', async () => {
  const r = await rpc('resources/list')
  const uris = r.result.resources.map(x => x.uri)
  assert.ok(uris.includes('chalkieboard://structure.json')); assert.ok(uris.includes('chalkieboard://README.md')); assert.ok(uris.includes(`chalkieboard://${KOR}/lessons.chalkie.json`))
  const rd = await rpc('resources/read', { uri: 'chalkieboard://README.md' }); assert.match(rd.result.contents[0].text, /수업 자료 폴더/)
  assert.ok((await rpc('resources/read', { uri: `chalkieboard://${KOR}/교과서.pdf` })).error)
  assert.ok((await rpc('resources/read', { uri: 'chalkieboard://../x/README.md' })).error)
})
await check('schema 불일치는 멈춘다', async () => {
  const p = join(rootDir, 'structure.json'); const orig = readFileSync(p, 'utf8')
  writeFileSync(p, orig.replace('"schema": 1', '"schema": 2'))
  await rejects(call('list_subjects'), /schema 1만/)
  writeFileSync(p, orig)
})
await check('모르는 메서드 → JSON-RPC 오류, 알림은 무응답', async () => {
  assert.equal((await rpc('nope')).error.code, -32601)
})

srv.kill(); rmSync(rootDir, { recursive: true, force: true })
console.log(failed ? `\n${failed}건 실패` : '\n전부 통과')
process.exit(failed ? 1 : 0)
