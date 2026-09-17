<template>
  <div v-loading="loading">
    <div class="content-card">
      <div class="card-title" style="display: flex; flex-wrap: wrap; gap: 8px; align-items: center">
        <span style="flex: 0 0 auto">📊 多目标对比</span>
        <div style="flex: 1; display: flex; flex-wrap: wrap; gap: 8px; align-items: center; justify-content: flex-end">
          <el-select v-model="metricKey" size="small" style="width: 110px" title="对比语义指标">
            <el-option v-for="m in METRIC_OPTIONS" :key="m.value" :label="m.label" :value="m.value" />
          </el-select>
          <el-radio-group v-model="histMode" size="small">
            <el-radio-button value="raw">原始值</el-radio-button>
            <el-radio-button value="delta">增量</el-radio-button>
          </el-radio-group>
          <el-radio-group v-model="scaleMode" size="small">
            <el-radio-button value="abs">绝对值</el-radio-button>
            <el-radio-button value="growth">增长率</el-radio-button>
            <el-radio-button value="index">指数100</el-radio-button>
          </el-radio-group>
          <el-radio-group v-model="timeAxis" size="small">
            <el-radio-button value="calendar">日历</el-radio-button>
            <el-radio-button value="relative">T+0</el-radio-button>
          </el-radio-group>
          <el-select v-model="chartGapMinutes" size="small" style="width: 72px" title="重采样间隔">
            <el-option v-for="opt in GAP_MINUTE_OPTIONS" :key="opt.value" :label="opt.label" :value="opt.value" />
          </el-select>
          <el-switch v-model="logMode" size="small" active-text="对数" />
          <el-switch v-model="showAvgLine" size="small" active-text="均值" />
          <el-switch v-model="showTrend" size="small" active-text="趋势" />
          <el-switch
            v-if="metricKey !== 'page'"
            v-model="overlayPage"
            size="small"
            active-text="叠加分P"
            title="在当前指标上叠加各视频分P曲线（第三轴）"
          />
          <el-button size="small" @click="reload">刷新</el-button>
          <el-button size="small" @click="exportCsv">CSV</el-button>
          <el-button size="small" @click="savePng">PNG</el-button>
        </div>
      </div>

      <div class="compare-toolbar2">
        <div class="date-range">
          <el-date-picker
            v-model="dateRange"
            type="datetimerange"
            size="small"
            range-separator="~"
            start-placeholder="开始"
            end-placeholder="结束"
            value-format="YYYY-MM-DD HH:mm:ss"
            format="MM/DD HH:mm"
            style="width: 312px"
          />
          <el-button
            size="small"
            style="background-color: #e6f4ff; border-color: #91caff; color: #1677ff"
            @click="showAll = !showAll; if (showAll) dateRange = null"
          >
            {{ showAll ? '收起' : '全部' }}
          </el-button>
        </div>
        <div class="target-chips">
          <el-tag
            v-for="t in targets"
            :key="t.type + ':' + t.target"
            closable
            @close="onRemove(t)"
          >
            {{ typeLabel(t.type) }}·{{ shortName(t.name || t.target) }}
          </el-tag>
          <el-button size="small" @click="$router.push('/')">+ 列表</el-button>
          <el-button v-if="targets.length" size="small" type="danger" plain @click="clearAll">清空</el-button>
        </div>
      </div>

      <div v-if="cards.length" class="compare-cards">
        <div v-for="c in cards" :key="c.key" class="compare-card">
          <div style="display: flex; justify-content: space-between; gap: 6px; align-items: flex-start">
            <div style="min-width: 0">
              <el-tag size="small" :type="tagType(c.type)">{{ typeLabel(c.type) }}</el-tag>
              <div class="name" :title="c.name">{{ c.name }}</div>
            </div>
            <el-button size="small" text @click="openDetail(c)">详情</el-button>
          </div>
          <div class="metrics" v-if="c.summary">
            <span v-for="(v, k) in c.summary" :key="k">{{ k }} {{ v }}</span>
          </div>
          <div class="delta" v-if="c.delta24h">{{ c.delta24h }}</div>
        </div>
      </div>

      <div style="position: relative">
        <LineChart
          ref="chartRef"
          :categories="chartCategories"
          :values="chartSeries"
          :log-mode="logMode"
          :left-axis-log="logMode"
          :right-axis-log="logMode"
          :unequal-log="true"
          :show-avg-line="showAvgLine"
          :show-trend-line="showTrend"
          :trend-line-series="trendSeriesIdx"
        />
      </div>
      <div style="color: var(--text-secondary); font-size: 12px; margin-top: 4px">
        时间对齐容差 20s · 近重复合并 4s · 重采样 {{ chartGapMinutes }} 分钟
        <template v-if="histMode === 'delta'"> · 增量：相邻有效点差值，跨度过大断线</template>
        <template v-if="metricKey === 'page'"> · 分P仅视频目标参与对比</template>
        <template v-else-if="overlayPage"> · 分P已叠加（图例「分P·…」，第三轴）</template>
      </div>
      <div v-if="formulas.length" style="margin-top: 8px; padding: 10px 14px; background: var(--bg); border-radius: 6px">
        <el-collapse>
          <el-collapse-item title="趋势线公式" name="1">
            <div v-for="f in formulas" :key="f.name" style="margin-bottom: 6px; font-size: 13px">
              <b>{{ f.name }}</b>
              <span v-html="renderLatex(f.formula)"></span>
            </div>
          </el-collapse-item>
        </el-collapse>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import LineChart from '../components/charts/LineChart.vue'
import type { TrendFormula } from '../components/charts/LineChart.vue'
import { monitorApi, type CompareTarget, type HistoryKind } from '../api/monitor'
import { formatNum, formatTimestamp, formatSmartTimestamps } from '../utils/format'
import {
  loadCompareTargets, saveCompareTargets, removeCompareTarget, clearCompareTargets,
  parseCompareQuery, encodeCompareQuery, COMPARE_MAX,
} from '../utils/compareStore'
import {
  dedupeNearDuplicates, resampleByInterval, alignByTimeSlots,
  DUPLICATE_MERGE_MS, ALIGN_TOLERANCE_MS, type CleanPoint,
} from '../utils/historyClean'
import katex from 'katex'

function renderLatex(latex: string): string {
  try { return katex.renderToString(latex, { throwOnError: false, displayMode: true }) } catch { return latex }
}

function typeLabel(t: HistoryKind) {
  return ({ up: 'UP', video: '视频', dynamic: '动态', column: '专栏' } as const)[t] || t
}
/** 图例/标签用短名，避免过长 */
function shortName(name: string, max = 10): string {
  const n = name || ''
  return n.length > max ? n.slice(0, max - 1) + '…' : n
}
/** 短名撞车时附加目标尾缀，保证图例/系列名唯一（避免 Vue key 冲突） */
function uniqueSeriesName(base: string, used: Set<string>, target: string): string {
  let n = base
  if (used.has(n)) n = `${base}·${String(target).slice(-4)}`
  let k = 2
  while (used.has(n)) {
    n = `${base}(${k})`
    k++
  }
  used.add(n)
  return n
}
function filterByRange(pts: CleanPoint[]): CleanPoint[] {
  if (showAll.value || !dateRange.value) return pts
  const start = new Date(dateRange.value[0]).getTime()
  const end = new Date(dateRange.value[1]).getTime()
  return pts.filter(p => p.created_at >= start && p.created_at <= end)
}
function tagType(t: HistoryKind) {
  return ({ up: 'primary', video: 'success', dynamic: 'warning', column: 'info' } as const)[t] || 'info'
}

const METRIC_OPTIONS = [
  { value: 'traffic', label: '播放/流量' },
  { value: 'comment', label: '评论/回复' },
  { value: 'danmaku', label: '弹幕' },
  { value: 'page', label: '分P数' },
  { value: 'like', label: '点赞' },
  { value: 'forward', label: '转发' },
  { value: 'favorite', label: '收藏' },
]
const GAP_MINUTE_OPTIONS = [
  { label: '5分钟', value: 5 },
  { label: '1小时', value: 60 },
  { label: '6小时', value: 360 },
  { label: '24小时', value: 1440 },
]

/** 语义指标 → 各类型字段名；null 表示该类型无此指标 */
const METRIC_FIELD: Record<string, Partial<Record<HistoryKind, string>>> = {
  comment: { up: 'total_comments', video: 'comment', dynamic: 'reply_count', column: 'reply_count' },
  traffic: { up: 'total_views', video: 'play' },
  danmaku: { up: 'total_danmaku', video: 'video_review' },
  page: { video: 'page_count' },
  like: { dynamic: 'like_count', column: 'like_count' },
  forward: { dynamic: 'forward_count' },
  favorite: { dynamic: 'favorite_count', column: 'favorite_count' },
}
const DEDUPE_KEYS: Record<HistoryKind, string[]> = {
  up: ['total_views', 'total_danmaku', 'total_comments', 'total_videos'],
  video: ['play', 'video_review', 'comment'],
  dynamic: ['like_count', 'reply_count', 'forward_count'],
  column: ['like_count', 'reply_count', 'favorite_count'],
}

const route = useRoute()
const router = useRouter()
const loading = ref(false)
const targets = ref<CompareTarget[]>([])
const seriesRaw = ref<Record<string, CleanPoint[]>>({})
const cards = ref<{ key: string; type: HistoryKind; target: string; name: string; summary?: Record<string, string>; delta24h?: string }[]>([])

const metricKey = ref('traffic')
const histMode = ref<'raw' | 'delta'>('raw')
const scaleMode = ref<'abs' | 'growth' | 'index'>('abs')
const timeAxis = ref<'calendar' | 'relative'>('calendar')
const chartGapMinutes = ref(60)
const dateRange = ref<[string, string] | null>(null)
const showAll = ref(true)
const logMode = ref(false)
const showAvgLine = ref(false)
const showTrend = ref(false)
/** 在非「分P数」指标上叠加视频分P曲线（第三轴） */
const overlayPage = ref(false)
const formulas = ref<TrendFormula[]>([])
const chartRef = ref<InstanceType<typeof LineChart> | null>(null)

const COLORS = ['#409EFF', '#67C23A', '#E6A23C', '#F56C6C', '#909399', '#9B59B6', '#1ABC9C', '#E74C3C']

function seriesKey(t: CompareTarget) { return `${t.type}:${t.target}` }

async function fetchOne(t: CompareTarget): Promise<{ points: CleanPoint[]; name: string; meta: any }> {
  if (t.type === 'up') {
    const [status, analysis] = await Promise.all([
      monitorApi.upStatus(t.target).catch(() => null),
      monitorApi.upAnalysis(t.target).catch(() => null),
    ])
    const hist = (analysis?.history || []) as CleanPoint[]
    return {
      points: dedupeNearDuplicates(hist, DUPLICATE_MERGE_MS, DEDUPE_KEYS.up),
      name: t.name || t.target,
      meta: status,
    }
  }
  if (t.type === 'video') {
    const [detail, history] = await Promise.all([
      monitorApi.videoDetail(t.target).catch(() => null),
      monitorApi.videoHistory(t.target).catch(() => [] as any[]),
    ])
    return {
      points: dedupeNearDuplicates(history as CleanPoint[], DUPLICATE_MERGE_MS, DEDUPE_KEYS.video),
      name: detail?.metrics?.title || t.name || t.target,
      meta: detail?.metrics,
    }
  }
  if (t.type === 'dynamic') {
    const [detail, history] = await Promise.all([
      monitorApi.dynamicDetail(t.target).catch(() => null),
      monitorApi.dynamicHistory(t.target).catch(() => [] as any[]),
    ])
    return {
      points: dedupeNearDuplicates(history as CleanPoint[], DUPLICATE_MERGE_MS, DEDUPE_KEYS.dynamic),
      name: detail?.metrics?.title || t.name || `动态 ${t.target}`,
      meta: detail?.metrics,
    }
  }
  const [detail, history] = await Promise.all([
    monitorApi.columnDetail(t.target).catch(() => null),
    monitorApi.columnHistory(t.target).catch(() => [] as any[]),
  ])
  return {
    points: dedupeNearDuplicates(history as CleanPoint[], DUPLICATE_MERGE_MS, DEDUPE_KEYS.column),
    name: detail?.metrics?.title || t.name || `专栏 ${t.target}`,
    meta: detail?.metrics,
  }
}

function summarize(type: HistoryKind, meta: any): Record<string, string> | undefined {
  if (!meta) return undefined
  if (type === 'up') {
    return { 播放: formatNum(meta.total_views), 弹幕: formatNum(meta.total_danmaku), 评论: formatNum(meta.total_comments) }
  }
  if (type === 'video') {
    return { 播放: formatNum(meta.last_play ?? meta.play), 评论: formatNum(meta.sample_count != null ? meta.sample_count : 0) + '次' }
  }
  if (type === 'dynamic') {
    return { 点赞: formatNum(meta.like_count), 评论: formatNum(meta.reply_count), 转发: formatNum(meta.forward_count) }
  }
  return { 点赞: formatNum(meta.like_count), 评论: formatNum(meta.reply_count), 收藏: formatNum(meta.favorite_count) }
}

function calcDelta24(points: CleanPoint[], field: string): string {
  if (!points || points.length < 2) return ''
  const last = points[points.length - 1]
  const targetTs = last.created_at - 24 * 3600 * 1000
  let best = points[0]
  let bestDiff = Math.abs(best.created_at - targetTs)
  for (let i = 1; i < points.length - 1; i++) {
    const d = Math.abs(points[i].created_at - targetTs)
    if (d < bestDiff) { bestDiff = d; best = points[i] }
  }
  const delta = Number(last[field] || 0) - Number(best[field] || 0)
  const span = last.created_at - best.created_at
  const insuff = span < 24 * 3600 * 1000 * 0.95
  const sign = delta > 0 ? '+' : ''
  return `24h ${sign}${formatNum(delta)}${insuff ? '（不足24h）' : ''}`
}

async function reload() {
  loading.value = true
  try {
    const list = targets.value
    const results = await Promise.all(list.map(t => fetchOne(t)))
    const raw: Record<string, CleanPoint[]> = {}
    const nextCards: typeof cards.value = []
    list.forEach((t, i) => {
      const k = seriesKey(t)
      raw[k] = results[i].points
      t.name = results[i].name
      const field = METRIC_FIELD[metricKey.value]?.[t.type]
      nextCards.push({
        key: k,
        type: t.type,
        target: t.target,
        name: results[i].name,
        summary: summarize(t.type, results[i].meta),
        delta24h: field ? calcDelta24(results[i].points, field) : '',
      })
    })
    seriesRaw.value = raw
    cards.value = nextCards
    saveCompareTargets(list)
    syncUrl()
  } finally {
    loading.value = false
  }
}

function applyScale(vals: (number | null)[]): (number | null)[] {
  if (scaleMode.value === 'abs') return vals
  const first = vals.find(v => v !== null && v !== undefined) as number | undefined
  if (first == null || first === 0) return vals
  return vals.map(v => {
    if (v === null || v === undefined) return null
    if (scaleMode.value === 'growth') return (v - first) / first
    return (v / first) * 100
  })
}

function buildDelta(values: (number | null)[], times: number[], intervalMin: number): (number | null)[] {
  if (values.length < 2) return []
  const gapLimit = intervalMin * 60 * 1000 * 2.5
  const out: (number | null)[] = []
  for (let i = 1; i < values.length; i++) {
    const a = values[i - 1]
    const b = values[i]
    if (a === null || b === null) { out.push(null); continue }
    if (times[i] - times[i - 1] > gapLimit) { out.push(null); continue }
    out.push(b - a)
  }
  return out
}

const trendSeriesIdx = computed(() => {
  // 叠加分P后系列数与 targets 不对齐，避免误挂趋势线
  if (!showTrend.value || overlayPage.value) return []
  return targets.value.map((_, i) => i)
})

const chartCategories = computed(() => {
  // filled in chartSeries computation via side cache
  return alignedCache.value.categories
})

const chartSeries = computed(() => {
  const list = targets.value
  const fieldOf = (t: CompareTarget) => METRIC_FIELD[metricKey.value]?.[t.type]
  const timesList: number[][] = []
  const valuesList: number[][] = []
  const metaList: { origIdx: number; axis: number; name: string; fullName: string; color: string }[] = []
  const usedNames = new Set<string>()

  list.forEach((t, i) => {
    const field = fieldOf(t)
    const ranged = filterByRange(seriesRaw.value[seriesKey(t)] || [])
    if (field && ranged.length) {
      const pts = resampleByInterval(ranged, chartGapMinutes.value)
      let ts = pts.map(p => p.created_at)
      let vs = pts.map(p => Number(p[field] ?? 0))
      if (histMode.value === 'delta') {
        vs = buildDelta(vs, ts, chartGapMinutes.value) as number[]
        ts = ts.slice(1)
      }
      vs = applyScale(vs) as number[]
      timesList.push(ts)
      valuesList.push(vs as number[])
      const shortBase = `${typeLabel(t.type)}·${shortName(t.name || t.target)}`
      metaList.push({
        origIdx: i,
        axis: 0,
        name: uniqueSeriesName(shortBase, usedNames, t.target),
        fullName: `${typeLabel(t.type)}·${t.name || t.target}`,
        color: COLORS[i % COLORS.length],
      })
    }
    // 叠加分P：仅视频；与主指标同一时间对齐流程，挂第三轴，不做 scale 变换
    if (overlayPage.value && metricKey.value !== 'page' && t.type === 'video' && ranged.length) {
      const pts = resampleByInterval(ranged, chartGapMinutes.value)
      let ts = pts.map(p => p.created_at)
      let vs = pts.map(p => Number(p.page_count ?? 0))
      if (histMode.value === 'delta') {
        vs = buildDelta(vs, ts, chartGapMinutes.value) as number[]
        ts = ts.slice(1)
      }
      timesList.push(ts)
      valuesList.push(vs as number[])
      const shortBase = `分P·${shortName(t.name || t.target)}`
      metaList.push({
        origIdx: i,
        axis: 2,
        name: uniqueSeriesName(shortBase, usedNames, t.target),
        fullName: `分P·${t.name || t.target}`,
        color: COLORS[i % COLORS.length],
      })
    }
  })

  const { slots, aligned } = alignByTimeSlots(timesList, valuesList, ALIGN_TOLERANCE_MS)
  alignedCache.value = {
    categories: timeAxis.value === 'relative'
      ? formatRelativeSlots(slots, list, list.map((_, i) => i))
      : formatSmartTimestamps(slots),
    slots,
  }
  return metaList.map((m, j) => ({
    name: m.name,
    fullName: m.fullName,
    values: aligned[j] || [],
    color: m.color,
    yAxisIndex: m.axis,
    showLabel: false,
  }))
})

const alignedCache = ref<{ categories: string[]; slots: number[] }>({ categories: [], slots: [] })

function formatRelativeSlots(slots: number[], list: CompareTarget[], validIdx: number[]): string[] {
  // 以最早 first point 为 T0 的近似：取各序列首时间最小值
  let t0 = Infinity
  validIdx.forEach(i => {
    const pts = seriesRaw.value[seriesKey(list[i])] || []
    if (pts.length) t0 = Math.min(t0, pts[0].created_at)
  })
  if (!Number.isFinite(t0)) t0 = slots[0] || 0
  return slots.map(t => {
    const h = (t - t0) / 3600000
    return h < 24 ? `T+${h.toFixed(1)}h` : `T+${(h / 24).toFixed(1)}d`
  })
}

function openDetail(c: { type: HistoryKind; target: string }) {
  router.push(`/detail/${c.type}/${c.target}`)
}
function onRemove(t: CompareTarget) {
  targets.value = removeCompareTarget(t.type, t.target)
  reload()
}
function clearAll() {
  clearCompareTargets()
  targets.value = []
  seriesRaw.value = {}
  cards.value = []
  syncUrl()
}
function syncUrl() {
  const q = encodeCompareQuery(targets.value, {
    metric: metricKey.value,
    mode: histMode.value,
    scale: scaleMode.value,
    axis: timeAxis.value,
    interval: String(chartGapMinutes.value),
    log: logMode.value ? '1' : '0',
  })
  const next = `#/compare?${q}`
  if (window.location.hash === next) return
  router.replace({ path: '/compare', query: Object.fromEntries(new URLSearchParams(q)) })
}

function exportCsv() {
  const cats = alignedCache.value.categories
  const series = chartSeries.value
  const headers = ['时间', ...series.map(s => s.name)]
  const rows = cats.map((c, i) => [c, ...series.map(s => {
    const v = s.values[i]
    return v === null || v === undefined ? '' : String(v)
  })])
  const csv = '﻿' + [headers.join(','), ...rows.map(r => r.join(','))].join('\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `compare_${Date.now()}.csv`
  a.click()
  URL.revokeObjectURL(a.href)
}
function savePng() {
  chartRef.value?.saveChart()
}

watch([metricKey, histMode, scaleMode, timeAxis, chartGapMinutes], () => {
  syncUrl()
})

onMounted(async () => {
  const fromUrl = parseCompareQuery(route.query.ids as string)
  if (fromUrl.length) {
    targets.value = fromUrl.slice(0, COMPARE_MAX)
    saveCompareTargets(targets.value)
  } else {
    targets.value = loadCompareTargets()
  }
  if (route.query.metric) metricKey.value = String(route.query.metric)
  if (route.query.mode === 'delta' || route.query.mode === 'raw') histMode.value = route.query.mode
  if (route.query.scale) scaleMode.value = route.query.scale as any
  if (route.query.axis === 'relative' || route.query.axis === 'calendar') timeAxis.value = route.query.axis
  if (route.query.interval) chartGapMinutes.value = Number(route.query.interval) || 60
  if (route.query.log === '1') logMode.value = true
  if (!targets.value.length) {
    ElMessage.info('请先在列表或详情页添加对比目标')
  } else {
    await reload()
  }
})
</script>

<style scoped>
.compare-toolbar2 {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 10px;
}
.date-range {
  display: flex;
  gap: 6px;
  align-items: center;
  flex-wrap: wrap;
}
.target-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
}
.compare-cards {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: 10px;
  margin-bottom: 12px;
}
.compare-card {
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 10px 12px;
  background: var(--bg);
}
.compare-card .name {
  font-weight: 600;
  font-size: 13px;
  margin-top: 4px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.compare-card .metrics {
  margin-top: 6px;
  font-size: 12px;
  color: var(--text-secondary);
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.compare-card .delta {
  margin-top: 4px;
  font-size: 12px;
  color: #67c23a;
}
</style>
