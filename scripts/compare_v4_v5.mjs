/** v4 vs v5 对照表 */
import fs from 'node:fs'
import path from 'node:path'
const ROOT = 'D:/Desktop/program/preoject/BiliDataMonitor-linux'
const v4 = JSON.parse(fs.readFileSync(path.join(ROOT, 'app/data/analysis/scores_v4.json'), 'utf8'))
const v5 = JSON.parse(fs.readFileSync(path.join(ROOT, 'app/data/analysis/scores_v5.json'), 'utf8'))
const map5 = new Map(v5.rows.map((r) => [r.bvid, r]))
const rows = v4.rows.map((a) => {
  const b = map5.get(a.bvid) || {}
  return {
    bvid: a.bvid,
    title: (a.title || '').slice(0, 18),
    s4: a.score ?? null,
    s5: b.score ?? null,
    d: (b.score ?? 0) - (a.score ?? 0),
    j4: a.jumpR,
    j5: b.jumpR,
    c4: a.cliffR,
    c5: b.cliffR,
    d4: a.diurnalScore,
    d5: b.diurnalScore,
    ev5: b.ev,
  }
})
rows.sort((x, y) => y.d - x.d)
console.log('bvid        v4->v5  Δ   jump4 jump5  cliff4 cliff5  diur5 ev5 | title')
for (const r of rows) {
  console.log(
    r.bvid,
    String(r.s4).padStart(3),
    '->',
    String(r.s5).padStart(3),
    String(r.d).padStart(4),
    String(r.j4 ?? '-').padStart(5),
    String(r.j5 ?? '-').padStart(5),
    String(r.c4 ?? '-').padStart(5),
    String(r.c5 ?? '-').padStart(5),
    String(r.d5 ?? '-').padStart(4),
    r.ev5,
    '|',
    r.title
  )
}
const s4 = rows.map((r) => r.s4).filter((x) => x != null)
const s5 = rows.map((r) => r.s5).filter((x) => x != null)
const mean = (a) => (a.reduce((x, y) => x + y, 0) / a.length).toFixed(1)
console.log('mean v4', mean(s4), 'mean v5', mean(s5))
console.log('v5>=70', s5.filter((x) => x >= 70).length, 'v4>=70', s4.filter((x) => x >= 70).length)
console.log('v5<=40', s5.filter((x) => x <= 40).length, 'v4<=40', s4.filter((x) => x <= 40).length)
