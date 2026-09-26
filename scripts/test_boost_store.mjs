/**
 * 验证 video_boost_index 建表、6h 分桶门控、对服务器库副本写入缓存
 * 用法: node --experimental-sqlite scripts/test_boost_store.mjs [dbPath]
 * 注意: dbPath 必须是副本，绝不能指向线上库
 */
import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'

const ROOT = 'D:/Desktop/program/preoject/BiliDataMonitor-linux'
const DB = process.argv[2] || path.join(ROOT, 'app/data/analysis/server_monitor_copy.db')

if (!fs.existsSync(DB)) {
  console.error('DB not found', DB)
  process.exit(1)
}
// 安全护栏：拒绝明显是线上路径的库
const norm = DB.replace(/\\/g, '/')
if (/\/home\/admin\/project\/BiliDataMonitor-linux\/app\/data\/monitor\.db$/.test(norm)) {
  console.error('REFUSE: do not run against live server db')
  process.exit(1)
}

console.log('DB', DB)

// ── 直接 SQL 验证建表幂等（与 database.ts 同结构精简） ──
const db = new DatabaseSync(DB)
db.exec(`
CREATE TABLE IF NOT EXISTS video_boost_index (
  bvid            TEXT PRIMARY KEY,
  score           INTEGER NOT NULL DEFAULT 0,
  level           TEXT NOT NULL DEFAULT 'low',
  level_text      TEXT NOT NULL DEFAULT '',
  sample_count    INTEGER NOT NULL DEFAULT 0,
  window_hours    INTEGER NOT NULL DEFAULT 48,
  shape_score     INTEGER NOT NULL DEFAULT 0,
  excess_score    INTEGER NOT NULL DEFAULT 0,
  aux_score       INTEGER NOT NULL DEFAULT 0,
  co_score        INTEGER NOT NULL DEFAULT 0,
  rhythm_penalty  INTEGER NOT NULL DEFAULT 0,
  jump_r          REAL NOT NULL DEFAULT 0,
  cliff_r         REAL NOT NULL DEFAULT 0,
  rise_width      INTEGER NOT NULL DEFAULT 0,
  plateau_score   REAL NOT NULL DEFAULT 0,
  plateau_len     INTEGER NOT NULL DEFAULT 0,
  excess_ratio    REAL NOT NULL DEFAULT 0,
  evidence_json   TEXT NOT NULL DEFAULT '[]',
  insufficient    TEXT NOT NULL DEFAULT '',
  computed_at     INTEGER NOT NULL DEFAULT 0,
  history_end_at  INTEGER NOT NULL DEFAULT 0,
  history_count   INTEGER NOT NULL DEFAULT 0,
  algo_version    INTEGER NOT NULL DEFAULT 1,
  compute_bucket  INTEGER NOT NULL DEFAULT 0,
  created_at      INTEGER NOT NULL DEFAULT 0,
  updated_at      INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_boost_score ON video_boost_index(score DESC);
CREATE INDEX IF NOT EXISTS idx_boost_updated ON video_boost_index(updated_at);
`)
const cols = db.prepare('PRAGMA table_info(video_boost_index)').all()
console.log('COLUMNS', cols.map((c) => c.name).join(','))

// ── 分桶门控（与 database.ts 同逻辑） ──
const BOOST_BUCKET_MS = 6 * 3600 * 1000
const BOOST_WINDOW_MS = 48 * 3600 * 1000
const BOOST_FIRST_SPAN_MS = Math.floor(BOOST_BUCKET_MS * 0.9)
const BOOST_ALGO_VERSION = 1

function shouldRecomputeBoost(existing, firstTs, lastTs, force = false) {
  const span = Math.max(0, lastTs - firstTs)
  const bucket = Math.floor(span / BOOST_BUCKET_MS)
  if (force) return { ok: true, bucket, reason: 'force' }
  if (!existing || existing.algo_version !== BOOST_ALGO_VERSION) {
    if (span < BOOST_FIRST_SPAN_MS) return { ok: false, bucket, reason: 'wait_first_bucket' }
    return { ok: true, bucket: Math.max(bucket, 1), reason: existing ? 'algo_version' : 'first' }
  }
  if (span >= BOOST_WINDOW_MS) return { ok: false, bucket, reason: 'window_frozen' }
  if (bucket <= existing.compute_bucket) return { ok: false, bucket, reason: 'same_bucket' }
  return { ok: true, bucket, reason: 'next_bucket' }
}

const t0 = 1_700_000_000_000
const cases = [
  { name: 'span=3h 无缓存', first: t0, last: t0 + 3 * 3600e3, existing: undefined, force: false, expect: false },
  { name: 'span=5.6h 无缓存(接近6h)', first: t0, last: t0 + 5.6 * 3600e3, existing: undefined, force: false, expect: true },
  { name: 'span=6h 无缓存', first: t0, last: t0 + 6 * 3600e3, existing: undefined, force: false, expect: true },
  { name: 'span=7h 已算 bucket=1', first: t0, last: t0 + 7 * 3600e3, existing: { algo_version: 1, compute_bucket: 1 }, force: false, expect: false },
  { name: 'span=12.1h 已算 bucket=1', first: t0, last: t0 + 12.1 * 3600e3, existing: { algo_version: 1, compute_bucket: 1 }, force: false, expect: true },
  { name: 'span=50h 已算 bucket=8 窗口满', first: t0, last: t0 + 50 * 3600e3, existing: { algo_version: 1, compute_bucket: 8 }, force: false, expect: false },
  { name: 'span=50h force', first: t0, last: t0 + 50 * 3600e3, existing: { algo_version: 1, compute_bucket: 8 }, force: true, expect: true },
  { name: 'span=50h algo过期', first: t0, last: t0 + 50 * 3600e3, existing: { algo_version: 0, compute_bucket: 8 }, force: false, expect: true },
]
console.log('\n=== BUCKET GATE ===')
let fail = 0
for (const c of cases) {
  const r = shouldRecomputeBoost(c.existing, c.first, c.last, c.force)
  const ok = r.ok === c.expect
  if (!ok) fail++
  console.log(`${ok ? 'OK ' : 'FAIL'} ${c.name} -> ok=${r.ok} bucket=${r.bucket} reason=${r.reason}`)
}

// ── 对真实数据（副本）选样例写入缓存 ──
console.log('\n=== UPSERT ON COPY ===')
const bvids = ['BV13Xew6LE7T', 'BV1znY96NEvn', 'BV1vRtA6gE5m']
const selectHist = db.prepare(
  'SELECT play, video_review AS video_review, comment, created_at FROM video_history WHERE bvid = ? ORDER BY created_at ASC LIMIT 600'
)
// 精简复用 validate 的 compute（与 boostIndex 对齐的主路径）
function median(xs) {
  if (!xs.length) return 0
  const s = [...xs].sort((a, b) => a - b)
  const m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}
const clip01 = (v, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, v))

function computeScore(points) {
  const clean = []
  for (const p of points) {
    if (!clean.length) { clean.push(p); continue }
    if (p.created_at - clean[clean.length - 1].created_at < 2000) continue
    clean.push(p)
  }
  const t0h = clean[0].created_at
  const win = clean.filter((p) => p.created_at <= t0h + 48 * 3600 * 1000)
  const tMs = [], dPlay = []
  for (let i = 1; i < win.length; i++) {
    const a = win[i - 1], b = win[i]
    const dtS = (b.created_at - a.created_at) / 1000
    if (dtS <= 0) continue
    tMs.push(b.created_at)
    dPlay.push(((b.play - a.play) * 300) / dtS)
  }
  if (dPlay.length < 22) return { score: 0, insufficient: 'delta', n: dPlay.length }
  // 只验证门控 + 存储链路，分数用与线上一致的调用（动态 import dist）
  return { score: null, n: dPlay.length, first: t0h, last: win[win.length - 1].created_at }
}

const ins = db.prepare(`
  INSERT INTO video_boost_index (
    bvid, score, level, level_text, sample_count, window_hours,
    shape_score, excess_score, aux_score, co_score, rhythm_penalty,
    jump_r, cliff_r, rise_width, plateau_score, plateau_len, excess_ratio,
    evidence_json, insufficient, computed_at, history_end_at, history_count,
    algo_version, compute_bucket, created_at, updated_at
  ) VALUES (@bvid, @score, @level, @level_text, @sample_count, @window_hours,
    @shape_score, @excess_score, @aux_score, @co_score, @rhythm_penalty,
    @jump_r, @cliff_r, @rise_width, @plateau_score, @plateau_len, @excess_ratio,
    @evidence_json, @insufficient, @computed_at, @history_end_at, @history_count,
    @algo_version, @compute_bucket, @created_at, @updated_at)
  ON CONFLICT(bvid) DO UPDATE SET
    score=excluded.score, level=excluded.level, level_text=excluded.level_text,
    compute_bucket=excluded.compute_bucket, updated_at=excluded.updated_at, algo_version=excluded.algo_version
`)

for (const bvid of bvids) {
  const rows = selectHist.all(bvid)
  if (rows.length < 2) {
    console.log('skip', bvid, 'rows', rows.length)
    continue
  }
  const firstTs = rows[0].created_at
  const lastTs = rows[rows.length - 1].created_at
  const spanH = ((lastTs - firstTs) / 3600000).toFixed(1)
  const gate = shouldRecomputeBoost(undefined, firstTs, lastTs, false)
  console.log(bvid, 'n=', rows.length, 'span_h=', spanH, 'gate=', JSON.stringify(gate))
  if (!gate.ok) continue
  // 用 dist 算法（若已编译）
  let result = { score: -1 }
  try {
    const href = path.join(ROOT, 'src/server/dist/analytics/boostIndex.js').replace(/\\/g, '/')
    const url = href.startsWith('file:') ? href : `file:///${href}`
    const boost = await import(url)
    result = boost.computeBoostIndex(rows.map((x) => ({
      play: x.play,
      video_review: x.video_review,
      comment: x.comment,
      created_at: x.created_at,
    })))
  } catch (e) {
    console.log('  dist import fail', e.message)
    continue
  }
  ins.run({
    bvid,
    score: result.score,
    level: result.level || 'low',
    level_text: result.levelText || '',
    sample_count: result.sampleCount || rows.length,
    window_hours: 48,
    shape_score: result.parts?.shape ?? 0,
    excess_score: result.parts?.excess ?? 0,
    aux_score: result.parts?.aux ?? 0,
    co_score: result.parts?.co ?? 0,
    rhythm_penalty: result.parts?.rhythmPenalty ?? 0,
    jump_r: result.features?.jumpR ?? 0,
    cliff_r: result.features?.cliffR ?? 0,
    rise_width: result.features?.riseWidth ?? 0,
    plateau_score: result.features?.plateauScore ?? 0,
    plateau_len: result.features?.plateauLen ?? 0,
    excess_ratio: result.features?.excessRatio ?? 0,
    evidence_json: JSON.stringify(result.evidence || []),
    insufficient: result.insufficient || '',
    computed_at: Date.now(),
    history_end_at: lastTs,
    history_count: rows.length,
    algo_version: BOOST_ALGO_VERSION,
    compute_bucket: gate.bucket,
    created_at: Date.now(),
    updated_at: Date.now(),
  })
  console.log('  WROTE score=', result.score, 'level=', result.level, 'bucket=', gate.bucket)
}

const list = db.prepare('SELECT bvid, score, level, compute_bucket, sample_count, updated_at FROM video_boost_index ORDER BY score DESC').all()
console.log('\n=== TABLE ROWS ===')
for (const r of list) console.log(JSON.stringify(r))

console.log(fail === 0 ? '\nALL_GATE_OK' : `\nGATE_FAIL count=${fail}`)
db.close()
process.exit(fail === 0 ? 0 : 1)
