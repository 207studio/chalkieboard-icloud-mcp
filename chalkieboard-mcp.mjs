#!/usr/bin/env node
// 초키보드 iCloud MCP 서버 — 맥에서 AI로 수업을 준비한다 (73차 6단계-10 → 74차(150-9) 재정비)
//
// 앱의 iCloud 계약을 그대로 도구로 편 것이다. 통로는 셋뿐이고 셋 다 앱이 이미 여는 통로다:
//   · 읽기 — 폴더 루트의 `structure.json`(앱이 덮어쓰는 파생물). 과목·단원·차시·붙은 자료·학급·규칙.
//   · 파일 쓰기 — **과목 폴더**에 파일을 놓는다(74차(69) 과목 1단). 앱이 다음에 훑을 때 그 과목 자료가 된다.
//       파일 이름이 `학년_학기_단원_차시[_차시끝]`로 시작하면 그 차시(들)에 자동 배치된다(74차(135)).
//       이름 끝 괄호는 학급이다(`학습지(1반).pdf`).
//   · 배정표 쓰기 — 과목 폴더의 `lessons.chalkie.json`(공유 인덱스). 앱이 **읽는** 유일한 계획 파일이다(74차(98)):
//       단원·차시·자료 연결을 덧붙이기만 한다. 있는 것은 그대로, 없는 것만 더한다. 지우는 도구는 없다.
//
// 그래서 이 서버는 앱의 저장소(`library.json`)를 **건드리지 않는다.** 파일 하나 잘못 놓아도 앱 데이터가 깨질 길이 없다 —
// 그 안전성이 폴더 → 앱 단방향(덧붙이기) 계약에서 온다. 이 서버가 얇은 이유다.
//
// 의존성 0개. Node 18+ 이면 그대로 돈다. 설치는 같은 폴더의 README.md.

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs'
import { join, resolve, extname, basename, sep } from 'node:path'
import { homedir } from 'node:os'
import { createInterface } from 'node:readline'

const SCHEMA = 1
const MANIFEST = 'structure.json'
const LEGACY_MANIFEST = '수업구조.json'
const README = 'README.md'
const SHEET = 'lessons.chalkie.json'
const LEGACY_SHEET = '배정.chalkie.json'
const APP_FILES = new Set([MANIFEST, LEGACY_MANIFEST, README, SHEET, LEGACY_SHEET])
/** 폴더에서 앱이 들이는 확장자 — `MaterialStore.importFresh`와 같다. 이미지는 폴더로는 안 들어온다. */
const KIND_BY_EXT = { pdf: 'pdf', pptx: 'pptx', ppt: 'pptx', html: 'html', htm: 'html' }
const TEXT_EXT = new Set(['html', 'htm', 'md', 'txt', 'json', 'csv'])

// ── 위치 ──

/** iCloud 폴더. 환경변수로 덮어쓸 수 있다 — 컨테이너 이름이 바뀌어도, 시뮬레이터 `-cloudroot`를 볼 때도 서버를 안 고치게.
 *  컨테이너 `iCloud.only1mui.ChalkieBoard`(CLAUDE.md — 글자 하나까지 같아야 한다) → 폴더 이름은 점이 물결이다.
 *  맥은 `~/Library/Mobile Documents/<컨테이너>/Documents`, 윈도우(iCloud for Windows)는 `%USERPROFILE%\\iCloudDrive\\<컨테이너>`
 *  (Documents 단이 있는 판과 없는 판이 있어 둘 다 본다). structure.json이 있는 첫 후보가 이긴다. */
function root() {
  if (process.env.CHALKIEBOARD_DIR) return process.env.CHALKIEBOARD_DIR
  const c = 'iCloud~only1mui~ChalkieBoard'
  const home = homedir(), win = process.env.USERPROFILE || home
  const candidates = [
    join(home, 'Library', 'Mobile Documents', c, 'Documents'),
    join(win, 'iCloudDrive', c, 'Documents'),
    join(win, 'iCloudDrive', c),
  ]
  const found = candidates.find(p => existsSync(join(p, MANIFEST))) ?? candidates.find(existsSync)
  if (found) return found
  throw new Error(
    'iCloud 폴더를 찾지 못했습니다. 아이패드 앱에서 iCloud 폴더(구독)를 켜고 이 컴퓨터가 같은 iCloud에 로그인돼 있는지 확인하세요.\n' +
    '경로를 아신다면 CHALKIEBOARD_DIR 환경변수(또는 확장 설정의 "수업 폴더")로 알려주세요.')
}

/** 폴더 밖으로 나가는 경로를 막는다 — AI가 준 문자열을 그대로 이어 붙이지 않는다. */
function insideRoot(rel) {
  const base = resolve(root())
  const full = resolve(join(base, rel ?? ''))
  if (full !== base && !full.startsWith(base + sep)) throw new Error('폴더 밖 경로는 쓸 수 없습니다.')
  return full
}

/** 어떤 폴더 **아래**의 경로만 — 과목 폴더에서 `../structure.json`으로 위로 올라가지 못하게. */
function within(dir, rel) {
  const base = resolve(dir)
  const full = resolve(join(base, rel ?? ''))
  if (full !== base && !full.startsWith(base + sep)) throw new Error('그 폴더 밖 경로는 쓸 수 없습니다.')
  return full
}

function readJSON(p) { return JSON.parse(readFileSync(p, 'utf8')) }
function writeJSON(p, obj) { writeFileSync(p, JSON.stringify(obj, null, 2) + '\n') }

// ── 읽기: 매니페스트 ──

function manifest() {
  const r = root()
  const p = [MANIFEST, LEGACY_MANIFEST].map(n => join(r, n)).find(existsSync)
  if (!p) throw new Error(`${MANIFEST}이 없습니다. 아이패드에서 앱을 한 번 열면 만들어집니다(구독·iCloud 로그인 필요).`)
  const m = readJSON(p)
  // 모르는 판을 **조용히 틀리게 읽는 것**보다 멈추는 편이 낫다.
  if (m.schema !== SCHEMA) throw new Error(`이 서버는 schema ${SCHEMA}만 압니다(파일은 ${m.schema}). 서버를 최신으로 받아 주세요.`)
  return m
}

/** 단원 번호 정규화 — 저장값은 "6"이 정본이지만(74차(42)) 옛 데이터에 "6단원"이 남아 있다. 비교는 숫자로, 쓸 때는 있는 그대로. */
function unitNo(name) { return String(name ?? '').replace(/단원\s*$/, '').trim() }

/** 과목 하나 찾기 — 폴더 이름이 정본(유일), 과목 이름은 학기가 여럿이면 모호하다. */
function findSubject(m, { folder, subject, year, semester } = {}) {
  const subs = m.subjects ?? []
  if (folder) {
    const s = subs.find(x => x.folder === folder)
    if (!s) throw new Error(`그런 과목 폴더가 없습니다: ${folder} — list_subjects로 폴더 이름을 확인하세요.`)
    return s
  }
  if (!subject) throw new Error('folder(과목 폴더 이름) 또는 subject(과목 이름)를 주세요.')
  let c = subs.filter(x => x.name === subject)
  if (year != null) c = c.filter(x => x.year === year)
  if (semester != null) c = c.filter(x => x.semester === semester)
  if (c.length === 0) throw new Error(`그런 과목이 없습니다: ${subject} — list_subjects로 확인하세요.`)
  if (c.length > 1) throw new Error(`"${subject}"가 여러 학기에 있습니다: ${c.map(x => x.folder).join(', ')} — folder로 하나를 고르세요.`)
  return c[0]
}

/** 과목의 배정표(있으면). 없는 과목 폴더면 null. */
function sheetOf(folder) {
  const dir = insideRoot(folder)
  const p = [SHEET, LEGACY_SHEET].map(n => join(dir, n)).find(existsSync)
  return p ? readJSON(p) : null
}

/** 매니페스트 + 배정표(빠진 파일)를 합쳐 평평한 차시 목록으로. */
function lessonsOf(s) {
  const sheet = (() => { try { return sheetOf(s.folder) } catch { return null } })()
  const missingOf = (unit, session, title) => {
    if (!sheet) return []
    const pool = unit == null
      ? (sheet.lessonsWithoutUnit ?? []).filter(l => l.title === title)
      : ((sheet.units ?? []).find(u => unitNo(u.number) === unitNo(unit))?.lessons ?? []).filter(l => l.session === session)
    return pool.flatMap(l => l.missing ?? [])
  }
  const sheetUnitTitle = unit => (sheet?.units ?? []).find(u => unitNo(u.number) === unitNo(unit))?.title || ''
  const out = []
  for (const u of s.units ?? []) {
    for (const l of u.lessons ?? []) {
      out.push({ subject: s.name, folder: s.folder, unit: unitNo(u.name), unitTitle: sheetUnitTitle(u.name),
                 session: l.session ?? null, title: l.title || '',
                 materials: (l.materials ?? []).map(x => x.url ? { name: x.name, kind: x.kind, url: x.url } : { name: x.name, kind: x.kind }),
                 missing: missingOf(u.name, l.session, l.title) })
    }
  }
  for (const l of s.lessonsWithoutUnit ?? []) {
    out.push({ subject: s.name, folder: s.folder, unit: null, unitTitle: '', session: l.session ?? null, title: l.title || '',
               materials: (l.materials ?? []).map(x => x.url ? { name: x.name, kind: x.kind, url: x.url } : { name: x.name, kind: x.kind }),
               missing: missingOf(null, null, l.title) })
  }
  return out
}

// ── 파일 ──

/** 과목 폴더 아래 파일 전부(교사가 만든 하위 폴더 포함). 앱이 쓴 파일·숨김·자리표시자는 뺀다. */
function filesUnder(folder) {
  const base = insideRoot(folder)
  if (!existsSync(base)) throw new Error(`폴더가 없습니다: ${folder}`)
  const out = []
  const walk = (dir, rel) => {
    for (const name of readdirSync(dir)) {
      if (name.startsWith('.')) continue
      const p = join(dir, name), r = rel ? `${rel}/${name}` : name
      const st = statSync(p)
      if (st.isDirectory()) { walk(p, r); continue }
      if (APP_FILES.has(name)) continue
      const ext = extname(name).slice(1).toLowerCase()
      const entry = { path: r, bytes: st.size, kind: KIND_BY_EXT[ext] ?? null }
      if (ext === 'icloud') entry.note = '아직 이 맥에 내려오지 않은 파일'
      const slot = parseSlot(name); if (slot) entry.slot = slot
      const klass = parseClass(name); if (klass) entry.class = klass
      out.push(entry)
    }
  }
  walk(base, '')
  return out
}

/** `학년_학기_단원_차시[_차시끝]` — `LessonSlotName.parse`와 같은 정규식. */
function parseSlot(fileName) {
  const base = fileName.replace(/\.[^.]*$/, '')
  const m = /^(\d{1,2})_(\d)_(\d{1,2})_(\d{1,2})(?:_(\d{1,2}))?(?!\d)/.exec(base)
  if (!m) return null
  const unit = +m[3], first = +m[4]
  if (unit < 1 || first < 1) return null
  return { grade: +m[1], semester: +m[2], unit, first, last: Math.max(first, m[5] ? +m[5] : first) }
}
/** 파일 이름 끝 괄호 = 학급. */
function parseClass(fileName) {
  const base = fileName.replace(/\.[^.]*$/, '')
  const m = /\(([^()]+)\)\s*$/.exec(base)
  return m ? m[1] : null
}
const pad2 = n => String(n).padStart(2, '0')

function checkFileName(filename) {
  if (typeof filename !== 'string' || !filename.trim()) throw new Error('파일 이름을 주세요.')
  if (filename.includes('/') || filename.includes('\\') || filename.startsWith('.')) throw new Error('파일 이름에 경로를 넣을 수 없습니다.')
  if (/[:?%*|"<>]/.test(filename)) throw new Error('파일 이름에 : ? % * | " < > 는 쓸 수 없습니다.')
  const ext = extname(filename).slice(1).toLowerCase()
  if (!KIND_BY_EXT[ext]) throw new Error(`앱이 폴더에서 들이는 형식은 pdf · pptx · html 입니다(받은 확장자: ${ext || '없음'}).`)
  return ext
}

// ── 배정표 쓰기(덧붙이기만) ──

/** 자료 표기 하나를 {name, kind[, url]}로. 파일 이름("학습지.pdf")·과목의 자료 이름·웹 주소·{name,kind}를 받는다. */
function materialRef(x, s) {
  if (x && typeof x === 'object') {
    if (!x.name || !x.kind) throw new Error('자료 객체는 name과 kind가 있어야 합니다.')
    return x.url ? { name: x.name, kind: x.kind, url: x.url } : { name: x.name, kind: x.kind }
  }
  if (typeof x !== 'string' || !x.trim()) throw new Error('자료는 파일 이름·자료 이름·주소 문자열이거나 {name, kind}여야 합니다.')
  if (/^https?:\/\//i.test(x)) return { name: x.replace(/^https?:\/\//i, '').slice(0, 60), kind: 'url', url: x }
  const ext = extname(x).slice(1).toLowerCase()
  if (KIND_BY_EXT[ext]) return { name: basename(x, extname(x)), kind: KIND_BY_EXT[ext] }
  const known = lessonsOf(s).flatMap(l => l.materials).find(m => m.name === x)
  if (known) return known
  throw new Error(`"${x}"의 종류를 모르겠습니다 — 확장자를 붙이거나("${x}.pdf") {name, kind}로 주세요.`)
}
const sameRef = (a, b) => a.name === b.name && a.kind === b.kind

/** 배정표를 읽어(없으면 뼈대) 단원·차시·자료를 덧붙이고 쓴다. 지우거나 바꾸는 일은 없다 — 제목은 비어 있을 때만 채운다. */
function mergeSheet(s, { units = [], lessonsWithoutUnit = [], pinned = [] }) {
  const dir = insideRoot(s.folder)
  if (!existsSync(dir)) throw new Error(`과목 폴더가 없습니다: ${s.folder}`)
  const sheet = sheetOf(s.folder) ?? {
    schema: SCHEMA, kind: 'sharedIndex', subject: s.name, year: s.year, semester: s.semester, pinned: [], units: [], lessonsWithoutUnit: [],
  }
  if (sheet.kind !== 'sharedIndex') throw new Error('이 배정표는 공유 인덱스가 아닙니다 — 손대지 않습니다.')
  sheet.units ??= []; sheet.lessonsWithoutUnit ??= []; sheet.pinned ??= []
  // 매니페스트에 있는 단원 번호 표기("1단원")를 그대로 써야 앱이 같은 단원으로 본다(`ensureUnit`은 글자 비교).
  const existingNo = new Map()
  for (const u of sheet.units) existingNo.set(unitNo(u.number), u.number)
  for (const u of s.units ?? []) if (!existingNo.has(unitNo(u.name))) existingNo.set(unitNo(u.name), u.name)
  let added = { units: 0, lessons: 0, materials: 0, titles: 0, pinned: 0 }
  const linkInto = (lesson, mats) => {
    lesson.materials ??= []
    for (const ref of mats.map(x => materialRef(x, s))) {
      if (!lesson.materials.some(m => sameRef(m, ref))) { lesson.materials.push(ref); added.materials++ }
    }
  }
  for (const u of units) {
    const no = unitNo(u.number ?? u.name ?? u.unit)
    if (!no) throw new Error('단원에는 number가 있어야 합니다(예 "1").')
    let target = sheet.units.find(x => unitNo(x.number) === no)
    if (!target) {
      target = { order: sheet.units.length + 1, number: existingNo.get(no) ?? no, title: u.title ?? '', lessons: [] }
      sheet.units.push(target); added.units++
    } else if (u.title && !target.title) { target.title = u.title; added.titles++ }
    target.lessons ??= []
    for (const l of u.lessons ?? []) {
      const session = Number(l.session)
      if (!Number.isInteger(session) || session < 1) throw new Error(`차시 번호(session)가 있어야 합니다: ${JSON.stringify(l)}`)
      let t = target.lessons.find(x => x.session === session)
      if (!t) { t = { session, title: l.title ?? '', materials: [] }; target.lessons.push(t); added.lessons++ }
      else if (l.title && !t.title) { t.title = l.title; added.titles++ }
      linkInto(t, l.materials ?? [])
    }
    target.lessons.sort((a, b) => a.session - b.session)
  }
  for (const l of lessonsWithoutUnit) {
    if (!l.title) throw new Error('단원 없는 차시는 title로 구분합니다 — title을 주세요.')
    let t = sheet.lessonsWithoutUnit.find(x => x.title === l.title)
    if (!t) { t = { title: l.title, materials: [] }; sheet.lessonsWithoutUnit.push(t); added.lessons++ }
    linkInto(t, l.materials ?? [])
  }
  for (const ref of pinned.map(x => materialRef(x, s))) {
    if (!sheet.pinned.some(m => sameRef(m, ref))) { sheet.pinned.push(ref); added.pinned++ }
  }
  sheet.generatedBy = 'chalkieboard-mcp'
  sheet.note ??= '공유 인덱스 배정표 — 초키보드가 이 과목 폴더를 훑을 때 단원·차시와 자료 연결을 덧붙입니다. 학급·시간표는 담지 않습니다.'
  writeJSON(join(dir, SHEET), sheet)
  return added
}

// ── 도구 ──

const TOOLS = {
  list_subjects: {
    description: '과목(바인더) 목록 — 폴더 이름·학년도·학기·단원/차시 수·폴더의 파일 수, 그리고 학급 목록과 폴더 규칙. 무엇이든 시작은 여기서.',
    inputSchema: { type: 'object', properties: {} },
    run: () => {
      const m = manifest()
      return {
        root: root(), classes: m.classes ?? [], rules: m.rules ?? {},
        subjects: (m.subjects ?? []).map(s => {
          let files = null; try { files = filesUnder(s.folder).length } catch {}
          return { name: s.name, folder: s.folder, year: s.year, semester: s.semester,
                   units: (s.units ?? []).map(u => unitNo(u.name)),
                   lessons: (s.units ?? []).reduce((n, u) => n + (u.lessons?.length ?? 0), 0) + (s.lessonsWithoutUnit?.length ?? 0),
                   files }
        }),
      }
    },
  },

  list_lessons: {
    description: '한 과목(또는 전부)의 단원·차시와 각 차시에 붙은 자료, 기다리는 빠진 파일. folder는 list_subjects가 준 과목 폴더 이름.',
    inputSchema: { type: 'object', properties: {
      folder: { type: 'string', description: '과목 폴더 이름(예 "국어 (2026-2)"). 생략하면 전 과목' },
      subject: { type: 'string', description: '과목 이름 — 한 학기에만 있을 때' },
    } },
    run: ({ folder, subject }) => {
      const m = manifest()
      const subs = (folder || subject) ? [findSubject(m, { folder, subject })] : (m.subjects ?? [])
      return { lessons: subs.flatMap(lessonsOf) }
    },
  },

  get_lesson: {
    description: '차시 하나 — 단원 번호와 차시 번호(또는 제목)로. 붙은 자료와 그 파일이 폴더에 있는지까지.',
    inputSchema: { type: 'object', required: ['folder'], properties: {
      folder: { type: 'string' }, unit: { type: 'string', description: '단원 번호("1")' },
      session: { type: 'number' }, title: { type: 'string', description: '제목 일부' },
    } },
    run: ({ folder, unit, session, title }) => {
      const s = findSubject(manifest(), { folder })
      const ls = lessonsOf(s).filter(l =>
        (unit == null || l.unit === unitNo(unit)) &&
        (session == null || l.session === session) &&
        (!title || l.title.includes(title)))
      if (ls.length === 0) throw new Error('그런 차시를 찾지 못했습니다. list_lessons로 먼저 확인해 보세요.')
      if (ls.length > 1) return { candidates: ls.map(l => ({ unit: l.unit, session: l.session, title: l.title })) }
      const files = filesUnder(folder)
      const l = ls[0]
      return { ...l, materials: l.materials.map(x => ({ ...x, file: files.find(f => basename(f.path, extname(f.path)) === x.name)?.path ?? null })) }
    },
  },

  list_files: {
    description: '과목 폴더의 파일(하위 폴더 포함) — 크기·종류·파일명 배치 정보(학년_학기_단원_차시)·학급 표시. 앱이 아직 안 들인 파일도 보인다.',
    inputSchema: { type: 'object', required: ['folder'], properties: { folder: { type: 'string' } } },
    run: ({ folder }) => {
      const s = findSubject(manifest(), { folder })
      const known = new Set(lessonsOf(s).flatMap(l => l.materials).map(x => x.name))
      return { folder, files: filesUnder(folder).map(f => ({ ...f, inLessons: known.has(basename(f.path, extname(f.path))) })) }
    },
  },

  add_material: {
    description:
      '과목 폴더에 자료 파일을 놓는다(pdf·pptx·html). 앱이 다음에 훑을 때 그 과목 자료가 된다. ' +
      'unit·first(·last)·grade를 주면 파일 이름 앞에 `학년_학기_단원_차시[_차시끝]_`를 붙여 그 차시(들)에 자동 배치되게 한다. ' +
      'class를 주면 이름 끝에 (학급)을 붙여 그 학급에만 간다. 있는 파일은 덮어쓰지 않는다.',
    inputSchema: { type: 'object', required: ['folder', 'filename', 'content'], properties: {
      folder: { type: 'string', description: '과목 폴더 이름. 하위 폴더에 두려면 "국어 (2026-2)/학습지"처럼' },
      filename: { type: 'string', description: '확장자 포함(pdf·pptx·html)' },
      content: { type: 'string', description: '파일 내용' },
      encoding: { type: 'string', enum: ['utf8', 'base64'], description: '기본 utf8. pdf·pptx는 base64' },
      unit: { type: 'number', description: '단원 번호 — 주면 차시 자동 배치' },
      first: { type: 'number', description: '첫 차시' }, last: { type: 'number', description: '끝 차시(생략하면 first)' },
      grade: { type: 'number', description: '학년 — 파일 이름에만 쓰인다(배치 판정에는 안 쓴다). unit을 주면 필요' },
      semester: { type: 'number', description: '학기 — 과목이 연간(semester 0)일 때만 필요' },
      class: { type: 'string', description: '학급(예 "1반") — 그 학급에만' },
    } },
    run: ({ folder, filename, content, encoding = 'utf8', unit, first, last, grade, semester, class: klass }) => {
      const m = manifest()
      const top = folder.split(/[\\/]/)[0]
      const s = findSubject(m, { folder: top })
      checkFileName(filename)
      let name = filename
      if (unit != null) {
        if (grade == null || first == null) throw new Error('차시에 배치하려면 grade·unit·first가 모두 필요합니다.')
        const sem = s.semester > 0 ? s.semester : semester
        if (sem == null) throw new Error('연간 과목입니다 — semester(학기)를 주세요.')
        if (![grade, unit, first, sem].every(Number.isInteger) || unit < 1 || first < 1 || sem < 1 || sem > 9) throw new Error('grade·unit·first·semester는 1 이상 정수여야 합니다.')
        const end = last == null ? first : Number(last)
        if (!Number.isInteger(end) || end < first) throw new Error('last는 first 이상이어야 합니다.')
        if (parseSlot(name)) throw new Error('파일 이름에 이미 배치 접두가 있습니다 — unit을 빼거나 이름을 바꾸세요.')
        name = `${grade}_${sem}_${unit}_${pad2(first)}${end > first ? `_${pad2(end)}` : ''}_${name}`
      }
      if (klass) {
        if (/[()\/]/.test(klass)) throw new Error('학급 이름에 괄호·슬래시는 쓸 수 없습니다.')
        const ext = extname(name)
        name = `${basename(name, ext)}(${klass})${ext}`
      }
      const dir = insideRoot(folder)
      if (!existsSync(dir)) {
        if (folder === top) throw new Error(`과목 폴더가 없습니다: ${folder} — 아이패드에서 앱을 한 번 열면 만들어집니다.`)
        mkdirSync(dir, { recursive: true })          // 과목 폴더 안의 하위 폴더는 교사도 만든다 — 그 아래는 전부 그 과목 자료
      }
      const dest = join(dir, name)
      if (existsSync(dest)) throw new Error(`이미 있는 파일입니다: ${name} — 덮어쓰지 않습니다. 고친 판은 이름을 바꿔 두세요.`)
      writeFileSync(dest, Buffer.from(content, encoding))
      const slot = parseSlot(name)
      return {
        placed: `${folder}/${name}`, subject: s.name, materialName: basename(name, extname(name)),
        lessons: slot ? `${slot.unit}단원 ${slot.first}${slot.last > slot.first ? `~${slot.last}` : ''}차시` : null,
        class: parseClass(name), note: '아이패드에서 앱을 열면(또는 iCloud가 닿으면) 자료로 들어옵니다.',
      }
    },
  },

  read_file: {
    description: '과목 폴더의 텍스트 파일(html·md·txt·json·csv, 2MB 이하)을 읽는다. pdf·pptx는 여기서 못 읽는다 — 파일 경로를 받아 다른 도구로.',
    inputSchema: { type: 'object', required: ['folder', 'path'], properties: {
      folder: { type: 'string' }, path: { type: 'string', description: 'list_files가 준 path' },
    } },
    run: ({ folder, path }) => {
      findSubject(manifest(), { folder: folder.split(/[\\/]/)[0] })
      const p = within(insideRoot(folder), path)
      if (!existsSync(p)) throw new Error(`파일이 없습니다: ${folder}/${path}`)
      const ext = extname(p).slice(1).toLowerCase()
      if (!TEXT_EXT.has(ext)) return { path: p, note: '텍스트가 아닌 파일입니다 — 이 절대 경로를 다른 도구(파일 읽기)에 넘기세요.' }
      const size = statSync(p).size
      if (size > 2_000_000) throw new Error('2MB가 넘는 파일은 여기서 읽지 않습니다.')
      return { path, text: readFileSync(p, 'utf8') }
    },
  },

  plan_lessons: {
    description:
      '과목의 배정표(lessons.chalkie.json)에 단원·차시·자료 연결을 **덧붙인다**. 앱이 다음에 훑을 때 없는 단원·차시를 만들고 빈 제목을 채우고 ' +
      '자료를 이름으로 잇는다(폴더에 아직 없는 파일은 "빠진 파일"로 기다리다 같은 이름이 오면 자동 연결). 있는 것은 절대 지우거나 바꾸지 않는다. ' +
      '자료는 파일 이름("학습지.pdf")·과목의 자료 이름·웹 주소·{name, kind}로 적는다.',
    inputSchema: { type: 'object', required: ['folder'], properties: {
      folder: { type: 'string' },
      units: { type: 'array', items: { type: 'object', required: ['number'], properties: {
        number: { type: 'string', description: '단원 번호("1")' }, title: { type: 'string' },
        lessons: { type: 'array', items: { type: 'object', required: ['session'], properties: {
          session: { type: 'number' }, title: { type: 'string' },
          materials: { type: 'array', items: {} },
        } } },
      } } },
      lessonsWithoutUnit: { type: 'array', items: { type: 'object', required: ['title'], properties: {
        title: { type: 'string' }, materials: { type: 'array', items: {} } } } },
      pinned: { type: 'array', items: {}, description: '과목 고정 자료(모든 차시에 붙는 것)' },
    } },
    run: ({ folder, units, lessonsWithoutUnit, pinned }) => {
      const s = findSubject(manifest(), { folder })
      const added = mergeSheet(s, { units, lessonsWithoutUnit, pinned })
      return { sheet: `${folder}/${SHEET}`, added, note: '아이패드에서 앱을 열면 반영됩니다. 반영 뒤 앱이 이 파일을 제 내용으로 다시 씁니다.' }
    },
  },

  create_subject: {
    description:
      '새 과목 폴더를 만든다 — 이름은 `과목 (학년도-학기)`, 안에 빈 배정표를 둔다. 앱이 다음에 훑을 때 그 학기에 바인더가 생긴다 ' +
      '(같은 이름을 앱에서 지운 적이 있으면 되살리지 않는다 — 그때는 앱에서 만든다). 그 다음 add_material·plan_lessons를 쓴다.',
    inputSchema: { type: 'object', required: ['name', 'year', 'semester'], properties: {
      name: { type: 'string' }, year: { type: 'number', description: '학년도(2026)' },
      semester: { type: 'number', description: '학기(1·2, 4학기제면 1~4). 연간이면 0' },
    } },
    run: ({ name, year, semester }) => {
      const m = manifest()
      if (typeof name !== 'string' || !name.trim()) throw new Error('과목 이름을 주세요.')
      if (!Number.isInteger(year) || !Number.isInteger(semester) || semester < 0) throw new Error('year·semester는 정수여야 합니다.')
      const safe = name.replace(/[\/\\:?%*|"<>]/g, '-').trim().slice(0, 60)
      if (!safe || /^\.+$/.test(safe)) throw new Error('과목 이름으로 쓸 수 없습니다.')
      const folder = `${safe} (${year}${semester > 0 ? `-${semester}` : ''})`
      if ((m.subjects ?? []).some(s => s.folder === folder)) throw new Error(`이미 있는 과목입니다: ${folder}`)
      const dir = insideRoot(folder)
      if (existsSync(dir)) throw new Error(`폴더가 이미 있습니다: ${folder} — 앱이 아직 안 들였거나 지운 과목의 폴더입니다.`)
      mkdirSync(dir)
      writeJSON(join(dir, SHEET), { schema: SCHEMA, kind: 'sharedIndex', generatedBy: 'chalkieboard-mcp',
        subject: safe, year, semester, pinned: [], units: [], lessonsWithoutUnit: [] })
      return { folder, note: '아이패드에서 앱을 열면 이 학기에 바인더가 생깁니다.' }
    },
  },
}

// ── 리소스: 앱이 쓴 파일을 그대로 ──

function resources() {
  const r = root()
  const out = [{ uri: `chalkieboard://${README}`, name: README, mimeType: 'text/markdown', description: '폴더 규칙(사람·AI 공용)' },
               { uri: `chalkieboard://${MANIFEST}`, name: MANIFEST, mimeType: 'application/json', description: '과목·단원·차시·자료(앱이 쓰는 파생물)' }]
  try {
    for (const s of manifest().subjects ?? []) {
      if (existsSync(join(r, s.folder, SHEET))) out.push({ uri: `chalkieboard://${s.folder}/${SHEET}`, name: `${s.folder}/${SHEET}`, mimeType: 'application/json', description: '배정표(공유 인덱스)' })
    }
  } catch {}
  return out.filter(x => existsSync(join(r, x.uri.slice('chalkieboard://'.length))))
}
function readResource(uri) {
  if (!uri?.startsWith('chalkieboard://')) throw new Error(`모르는 리소스입니다: ${uri}`)
  const rel = uri.slice('chalkieboard://'.length)
  if (!APP_FILES.has(basename(rel))) throw new Error('앱이 쓴 파일(structure.json · README.md · lessons.chalkie.json)만 리소스입니다.')
  const p = insideRoot(rel)
  if (!existsSync(p)) throw new Error(`없습니다: ${rel}`)
  return { contents: [{ uri, mimeType: rel.endsWith('.md') ? 'text/markdown' : 'application/json', text: readFileSync(p, 'utf8') }] }
}

// ── MCP (stdio, JSON-RPC 2.0) ──

const SUPPORTED = ['2025-06-18', '2025-03-26', '2024-11-05']
function send(o) { process.stdout.write(JSON.stringify(o) + '\n') }
function reply(id, result) { send({ jsonrpc: '2.0', id, result }) }
function fail(id, code, message) { send({ jsonrpc: '2.0', id, error: { code, message } }) }

function handle(req) {
  const { id, method, params } = req
  switch (method) {
    case 'initialize':
      return reply(id, {
        protocolVersion: SUPPORTED.includes(params?.protocolVersion) ? params.protocolVersion : SUPPORTED[SUPPORTED.length - 1],
        capabilities: { tools: {}, resources: {} },
        serverInfo: { name: 'chalkieboard', version: '2.0.0' },
        instructions: '초키보드(교사 iPad 판서 앱)의 iCloud 수업 폴더입니다. 먼저 list_subjects로 과목 폴더 이름을 얻고, ' +
          '자료는 add_material로 과목 폴더에 놓고, 단원·차시 계획은 plan_lessons로 배정표에 덧붙입니다. 지우는 도구는 없습니다 — 삭제는 앱에서만.',
      })
    case 'ping': return reply(id, {})
    case 'tools/list':
      return reply(id, { tools: Object.entries(TOOLS).map(([name, t]) => ({ name, description: t.description, inputSchema: t.inputSchema })) })
    case 'tools/call': {
      const t = TOOLS[params?.name]
      if (!t) return fail(id, -32602, `모르는 도구입니다: ${params?.name}`)
      try {
        const out = t.run(params.arguments ?? {})
        return reply(id, { content: [{ type: 'text', text: JSON.stringify(out, null, 2) }] })
      } catch (e) {
        // 도구 실행 오류는 결과로 돌려준다(isError) — 모델이 읽고 고쳐 다시 부를 수 있게. 프로토콜 오류만 JSON-RPC error.
        return reply(id, { isError: true, content: [{ type: 'text', text: e.message }] })
      }
    }
    case 'resources/list': return reply(id, { resources: resources() })
    case 'resources/read':
      try { return reply(id, readResource(params?.uri)) } catch (e) { return fail(id, -32002, e.message) }
    default:
      if (id != null) fail(id, -32601, `지원하지 않는 메서드입니다: ${method}`)   // 알림(notification)은 응답하지 않는다
  }
}

createInterface({ input: process.stdin }).on('line', line => {
  if (!line.trim()) return
  let req
  try { req = JSON.parse(line) } catch { return fail(null, -32700, 'JSON을 읽지 못했습니다.') }
  try { handle(req) } catch (e) { if (req.id != null) fail(req.id, -32000, e.message) }
})
