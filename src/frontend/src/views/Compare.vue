<template>
  <div v-loading="loading">
    <div class="content-card">
      <!-- 行1：仅标题 -->
      <div class="card-title">📊 多目标对比</div>

      <!-- 行2：模式 + 时间选择器 + 刷新（右对齐） -->
      <div class="compare-toolbar-row toolbar-main">
        <el-select v-model="metricKey" size="small" style="width: 110px" title="对比语义指标">
          <el-option v-for="m in METRIC_OPTIONS" :key="m.value" :label="m.label" :value="m.value" />
        </el-select>

        <span class="toolbar-sep" aria-hidden="true" />

        <!-- 标度在前，原始/增量在后 -->
        <el-select v-model="scaleMode" size="small" style="width: 100px" title="数值标度">
          <el-option label="绝对值" value="abs" />
          <el-option label="增长率" value="growth" />
          <el-option label="指数100" value="index" />
        </el-select>

        <span class="toolbar-sep" aria-hidden="true" />

        <el-radio-group v-model="histMode" size="small">
          <el-radio-button value="raw">原始值</el-radio-button>
          <el-radio-button value="delta">增量</el-radio-button>
        </el-radio-group>

        <span class="toolbar-sep" aria-hidden="true" />

        <el-radio-group v-model="timeAxis" size="small">
          <el-radio-button value="calendar">日历</el-radio-button>
          <el-radio-button value="relative">T+0</el-radio-button>
        </el-radio-group>

        <span class="toolbar-sep" aria-hidden="true" />

        <el-select v-model="chartGapMinutes" size="small" style="width: 72px" title="重采样间隔">
          <el-option v-for="opt in GAP_MINUTE_OPTIONS" :key="opt.value" :label="opt.label" :value="opt.value" />
        </el-select>

        <span class="toolbar-sep" aria-hidden="true" />

        <template v-if="timeAxis === 'calendar'">
          <div class="date-range-wrap">
            <el-date-picker
              v-model="dateRange"
              type="datetimerange"
              size="small"
              range-separator="~"
              start-placeholder="开始"
              end-placeholder="结束"
              value-format="YYYY-MM-DD HH:mm:ss"
              format="MM/DD HH:mm"
              class="date-range-compact"
              style="width: 100%"
            />
          </div>
          <el-button
            size="small"
            style="background-color: #e6f4ff; border-color: #91caff; color: #1677ff"
            @click="showAll = !showAll; if (showAll) dateRange = null"
          >
            {{ showAll ? '收起' : '全部' }}
          </el-button>
        </template>
        <template v-else>
          <span style="font-size: 12px; color: var(--text-secondary)">相对</span>
          <el-input-number v-model="t0Start" size="small" :min="0" :max="100000" :step="1" controls-position="right" style="width: 72px" />
          <span style="font-size: 12px; color: var(--text-secondary)">~</span>
          <el-input-number v-model="t0End" size="small" :min="0" :max="100000" :step="1" controls-position="right" style="width: 72px" />
          <el-select v-model="t0Unit" size="small" style="width: 64px">
            <el-option label="小时" value="hour" />
            <el-option label="天" value="day" />
          </el-select>
          <el-button size="small" style="background-color: #e6f4ff; border-color: #91caff; color: #1677ff" @click="setT0Preset(0, 24)">前24h</el-button>
          <el-button size="small" style="background-color: #e6f4ff; border-color: #91caff; color: #1677ff" @click="setT0Preset(0, 48)">前48h</el-button>
          <el-button size="small" style="background-color: #e6f4ff; border-color: #91caff; color: #1677ff" @click="setT0Preset(0, 168)">前7天</el-button>
          <el-button size="small" style="background-color: #e6f4ff; border-color: #91caff; color: #1677ff" @click="t0ShowAll = !t0ShowAll">{{ t0ShowAll ? '限窗' : '全部' }}</el-button>
        </template>

        <div class="toolbar-spacer" />
        <el-button size="small" type="primary" plain @click="reload">刷新</el-button>
      </div>

      <!-- 目标列表：工具 + 表格合成一块 -->
      <div class="compare-list">
        <div class="compare-list-bar">
          <span class="compare-list-title">对比目标</span>
          <div class="compare-list-actions">
            <el-button size="small" @click="$router.push('/')">+ 列表</el-button>
            <el-button v-if="targets.length" size="small" type="danger" plain @click="clearAll">清空</el-button>
          </div>
        </div>
        <el-table :data="cards" size="small" stripe>
          <el-table-column label="类型" width="72" align="center">
            <template #default="{ row }">
              <el-tag size="small" :type="tagType(row.type)">{{ typeLabel(row.type) }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column prop="name" label="名称" min-width="180" show-overflow-tooltip />
          <el-table-column label="别名" min-width="160">
            <template #default="{ row }">
              <div class="alias-cell">
                <template v-if="editingAliasKey === row.key">
                  <el-input
                    v-model="editingAliasValue"
                    size="small"
                    :maxlength="20"
                    placeholder="图例名，空=清除"
                    style="width: 140px"
                    @keyup.enter="confirmAlias(row)"
                    @keyup.esc="cancelAlias"
                  />
                  <el-button size="small" type="primary" text @click="confirmAlias(row)">存</el-button>
                  <el-button size="small" text @click="cancelAlias">取消</el-button>
                </template>
                <template v-else>
                  <span class="alias-value" :title="aliasMap[row.key] || ''">{{ aliasMap[row.key] || '未设置' }}</span>
                  <el-button size="small" text type="primary" @click="startEditAlias(row)">{{ aliasMap[row.key] ? '修改' : '设置' }}</el-button>
                  <el-button v-if="aliasMap[row.key]" size="small" text type="danger" @click="clearAlias(row)">清除</el-button>
                </template>
              </div>
            </template>
          </el-table-column>
          <!-- 多级表头：指标 / 24h增量 各三列子列名 -->
          <el-table-column label="指标" align="center">
            <el-table-column
              v-for="(h, hi) in tableSubHeaders"
              :key="'sum-' + hi"
              :label="h"
              align="right"
              min-width="80"
            >
              <template #default="{ row }">
                <span class="num-cell">{{ summaryAt(row, hi) }}</span>
              </template>
            </el-table-column>
          </el-table-column>
          <el-table-column label="24h增量" align="center">
            <el-table-column
              v-for="(h, hi) in tableSubHeaders"
              :key="'d24-' + hi"
              :label="h"
              align="right"
              min-width="88"
            >
              <template #default="{ row }">
                <span
                  class="num-cell"
                  :style="{ color: deltaAt(row, hi)?.color || 'var(--text-secondary)' }"
                  :title="deltaAt(row, hi)?.insuff ? '不足24h' : ''"
                >{{ deltaAt(row, hi)?.text ?? '—' }}</span>
              </template>
            </el-table-column>
          </el-table-column>
          <el-table-column label="操作" width="120" align="center">
            <template #default="{ row }">
              <el-button size="small" text type="primary" @click="openDetail(row)">详情</el-button>
              <el-button size="small" text type="danger" @click="onRemove({ type: row.type, target: row.target })">移除</el-button>
            </template>
          </el-table-column>
        </el-table>
      </div>

      <!-- 图表 + 左下开关 / 右下导出 -->
      <div class="chart-wrap">
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
        <div class="chart-footer">
          <div class="chart-footer-left">
            <div class="chart-switches">
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
            </div>
            <div class="chart-note">
              <template v-if="timeAxis === 'calendar'">时间对齐容差 20s · 近重复合并 4s · 重采样 {{ chartGapMinutes }} 分钟</template>
              <template v-else>
                T+0：各序列自起点对齐 ·
                <template v-if="!t0ShowAll">窗 T+{{ t0StartLabel }}~T+{{ t0EndLabel }} · 约 {{ t0PointCountLabel }} 点 ·</template>
                <template v-else>窗 全部 ·</template>
                相对网格重采样 {{ chartGapMinutes }} 分钟
              </template>
              <template v-if="histMode === 'delta'"> · 增量：相对网格相邻差值，真断档才断线</template>
              <template v-if="metricKey === 'page'"> · 分P仅视频目标参与对比</template>
              <template v-else-if="overlayPage"> · 分P已叠加（图例「分P·…」，第三轴）</template>
            </div>
          </div>
          <div class="chart-footer-right">
            <el-button size="small" @click="exportCsv">CSV</el-button>
            <el-button size="small" @click="savePng">PNG</el-button>
          </div>
        </div>
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
  loadAliasMap, setCompareAlias, clearCompareAlias,
  loadCompareUiSettings, saveCompareUiSettings,
} from '../utils/compareStore'
import {
  dedupeNearDuplicates, resampleByInterval, alignByTimeSlots, alignByRelativeBuckets,
  resampleRelativeSeries, buildDeltaOnRelative,
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

/** T+0 相对窗（小时） */
function t0WindowHours(): { startH: number; endH: number; showAll: boolean } {
  const mul = t0Unit.value === 'day' ? 24 : 1
  return {
    startH: Math.max(0, t0Start.value * mul),
    endH: Math.max(0, t0End.value * mul),
    showAll: t0ShowAll.value,
  }
}

function setT0Preset(startH: number, endH: number) {
  t0Unit.value = 'hour'
  t0Start.value = startH
  t0End.value = endH
  t0ShowAll.value = false
}

const t0StartLabel = computed(() => {
  const { startH } = t0WindowHours()
  return t0Unit.value === 'day' ? `${t0Start.value}d` : `${startH}h`
})
const t0EndLabel = computed(() => {
  const { endH } = t0WindowHours()
  return t0Unit.value === 'day' ? `${t0End.value}d` : `${endH}h`
})
/** 默认窗下点数 = 窗长 / 间隔（桶个数） */
const t0PointCountLabel = computed(() => {
  const { startH, endH, showAll: all } = t0WindowHours()
  if (all) return '全部'
  const intervalH = chartGapMinutes.value / 60
  const n = Math.max(0, Math.round((endH - startH) / intervalH))
  return String(n)
})

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
/** 日历范围选择器总宽 */
const DATE_RANGE_WIDTH = 220

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
const cards = ref<{
  key: string
  type: HistoryKind
  target: string
  name: string
  summary?: { label: string; value: string }[]
  delta24?: { label: string; text: string; color: string; insuff?: boolean }[]
}[]>([])

/** 当前登录用户名（别名按账号分桶） */
const currentUsername = ref('')
/** aliasMap: "type:target" -> alias */
const aliasMap = ref<Record<string, string>>({})
const editingAliasKey = ref<string | null>(null)
const editingAliasValue = ref('')

function aliasId(type: HistoryKind | string, target: string) {
  return `${type}:${target}`
}

function displayAliasOrName(t: { type: HistoryKind; target: string; name?: string }) {
  const alias = aliasMap.value[aliasId(t.type, t.target)]
  return alias || shortName(t.name || t.target)
}

function startEditAlias(c: { key: string }) {
  editingAliasKey.value = c.key
  editingAliasValue.value = aliasMap.value[c.key] || ''
}

function cancelAlias() {
  editingAliasKey.value = null
  editingAliasValue.value = ''
}

function confirmAlias(c: { key: string; type: HistoryKind; target: string }) {
  aliasMap.value = setCompareAlias(currentUsername.value, c.type, c.target, editingAliasValue.value)
  cancelAlias()
}

function clearAlias(c: { key: string; type: HistoryKind; target: string }) {
  aliasMap.value = clearCompareAlias(currentUsername.value, c.type, c.target)
  cancelAlias()
}

function seriesDisplayBase(t: CompareTarget, prefix = '') {
  const alias = aliasMap.value[aliasId(t.type, t.target)]
  const base = alias || shortName(t.name || t.target)
  return prefix ? `${prefix}·${base}` : `${typeLabel(t.type)}·${base}`
}

function seriesFullName(t: CompareTarget, prefix = '') {
  const alias = aliasMap.value[aliasId(t.type, t.target)]
  const origin = t.name || t.target
  const label = alias ? `${alias}（${origin}）` : origin
  return prefix ? `${prefix}·${label}` : `${typeLabel(t.type)}·${label}`
}

const metricKey = ref('traffic')
const histMode = ref<'raw' | 'delta'>('raw')
const scaleMode = ref<'abs' | 'growth' | 'index'>('abs')
const timeAxis = ref<'calendar' | 'relative'>('calendar')
const chartGapMinutes = ref(60)
const dateRange = ref<[string, string] | null>(null)
const showAll = ref(true)
/** T+0 相对时间窗：零点=各序列开始记录；单位可切换 */
const t0Start = ref(0)
const t0End = ref(48)
const t0Unit = ref<'hour' | 'day'>('hour')
const t0ShowAll = ref(false)
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

/** 多级表头子列名：按对比集中第一个目标类型的语义指标 */
const tableSubHeaders = computed(() => {
  const t = cards.value[0]?.type || 'video'
  return metricFieldsOf(t).map(f => f.label)
})

function summaryAt(row: { summary?: { label: string; value: string }[] }, idx: number): string {
  return row.summary?.[idx]?.value ?? '—'
}

function deltaAt(
  row: { delta24?: { label: string; text: string; color: string; insuff?: boolean }[] },
  idx: number
) {
  return row.delta24?.[idx]
}

/** 各类型的三项展示：播放/弹幕/评论 或 点赞/评论/转发|收藏 */
function metricFieldsOf(type: HistoryKind): { label: string; key: string }[] {
  if (type === 'up' || type === 'video') {
    return [
      { label: '播放', key: type === 'up' ? 'total_views' : 'play' },
      { label: '弹幕', key: type === 'up' ? 'total_danmaku' : 'video_review' },
      { label: '评论', key: type === 'up' ? 'total_comments' : 'comment' },
    ]
  }
  if (type === 'dynamic') {
    return [
      { label: '点赞', key: 'like_count' },
      { label: '评论', key: 'reply_count' },
      { label: '转发', key: 'forward_count' },
    ]
  }
  return [
    { label: '点赞', key: 'like_count' },
    { label: '评论', key: 'reply_count' },
    { label: '收藏', key: 'favorite_count' },
  ]
}

/** 指标：优先用历史末点（三项齐全）；无历史时退回 meta */
function summarize(type: HistoryKind, meta: any, points: CleanPoint[]): { label: string; value: string }[] {
  const fields = metricFieldsOf(type)
  const last = points?.length ? points[points.length - 1] : null
  return fields.map(f => {
    let n: number | null | undefined
    if (last && last[f.key] !== undefined) n = Number(last[f.key])
    else if (meta) {
      if (type === 'up') {
        n = f.key === 'total_views' ? meta.total_views : f.key === 'total_danmaku' ? meta.total_danmaku : meta.total_comments
      } else if (type === 'video') {
        n = f.key === 'play' ? (meta.last_play ?? meta.play) : undefined
      } else {
        n = meta[f.key]
      }
    }
    return { label: f.label, value: n === null || n === undefined || Number.isNaN(n) ? '—' : formatNum(n) }
  })
}

function calcDelta24Multi(points: CleanPoint[], type: HistoryKind): { label: string; text: string; color: string; insuff?: boolean }[] {
  const fields = metricFieldsOf(type)
  if (!points || points.length < 2) {
    return fields.map(f => ({ label: f.label, text: '—', color: 'var(--text-secondary)' }))
  }
  const last = points[points.length - 1]
  const targetTs = last.created_at - 24 * 3600 * 1000
  let best = points[0]
  let bestDiff = Math.abs(best.created_at - targetTs)
  for (let i = 1; i < points.length - 1; i++) {
    const d = Math.abs(points[i].created_at - targetTs)
    if (d < bestDiff) { bestDiff = d; best = points[i] }
  }
  const span = last.created_at - best.created_at
  const insuff = span < 24 * 3600 * 1000 * 0.95
  return fields.map(f => {
    const a = Number(best[f.key] ?? 0)
    const b = Number(last[f.key] ?? 0)
    if (best[f.key] === undefined || last[f.key] === undefined) {
      return { label: f.label, text: '—', color: 'var(--text-secondary)', insuff }
    }
    const delta = b - a
    const color = delta > 0 ? '#67c23a' : delta < 0 ? '#f56c6c' : 'var(--text-secondary)'
    const sign = delta > 0 ? '+' : ''
    return { label: f.label, text: `${sign}${formatNum(delta)}`, color, insuff }
  })
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
      nextCards.push({
        key: k,
        type: t.type,
        target: t.target,
        name: results[i].name,
        summary: summarize(t.type, results[i].meta, results[i].points),
        delta24: calcDelta24Multi(results[i].points, t.type),
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
  const isRel = timeAxis.value === 'relative'
  const intervalMin = chartGapMinutes.value
  const bucketMs = Math.max(1, intervalMin) * 60 * 1000
  const win = t0WindowHours()

  const timesList: number[][] = []
  const valuesList: number[][] = []
  const metaList: { origIdx: number; axis: number; name: string; fullName: string; color: string }[] = []
  const usedNames = new Set<string>()

  /** T+0：相对网格 → 可选增量 → 相对窗截断 → scale（first=窗内首有效点） */
  function buildRelativeSeries(pts: CleanPoint[], field: string): { ts: number[]; vs: (number | null)[] } | null {
    const rel = resampleRelativeSeries(pts, field, intervalMin)
    if (!rel) return null
    let ts = rel.times
    let vs: (number | null)[] = rel.values
    if (histMode.value === 'delta') {
      vs = buildDeltaOnRelative(vs)
    }
    if (!win.showAll) {
      const startMs = win.startH * 3600000
      const endMs = win.endH * 3600000
      const keepIdx: number[] = []
      ts.forEach((t, i) => {
        if (t >= startMs && t <= endMs) keepIdx.push(i)
      })
      ts = keepIdx.map(i => ts[i])
      vs = keepIdx.map(i => vs[i]!)
    }
    const scaled = applyScale(vs as (number | null)[])
    return { ts, vs: scaled }
  }

  /** 日历：绝对重采样 + 既有管线 */
  function buildCalendarSeries(pts: CleanPoint[], field: string): { ts: number[]; vs: (number | null)[] } {
    const rs = resampleByInterval(pts, intervalMin)
    let ts = rs.map(p => p.created_at)
    let vs: (number | null)[] = rs.map(p => Number(p[field] ?? 0))
    if (histMode.value === 'delta') {
      vs = buildDelta(vs as number[], ts, intervalMin)
      ts = ts.slice(1)
    }
    return { ts, vs: applyScale(vs) }
  }

  list.forEach((t, i) => {
    const field = fieldOf(t)
    // T+0 不做日历过滤；日历模式用 dateRange
    const ranged = isRel
      ? (seriesRaw.value[seriesKey(t)] || [])
      : filterByRange(seriesRaw.value[seriesKey(t)] || [])
    if (field && ranged.length) {
      const built = isRel ? buildRelativeSeries(ranged, field) : buildCalendarSeries(ranged, field)
      if (built && built.ts.length) {
        timesList.push(built.ts)
        valuesList.push(built.vs as number[])
        metaList.push({
          origIdx: i,
          axis: 0,
          name: uniqueSeriesName(seriesDisplayBase(t), usedNames, t.target),
          fullName: seriesFullName(t),
          color: COLORS[i % COLORS.length],
        })
      }
    }
    // 叠加分P：仅视频；与主指标同一时间对齐流程，挂第三轴，不做 scale 变换
    if (overlayPage.value && metricKey.value !== 'page' && t.type === 'video' && ranged.length) {
      let ts: number[] = []
      let vs: (number | null)[] = []
      if (isRel) {
        const rel = resampleRelativeSeries(ranged, 'page_count', intervalMin)
        if (rel) {
          ts = rel.times
          vs = histMode.value === 'delta' ? buildDeltaOnRelative(rel.values) : rel.values
          if (!win.showAll) {
            const startMs = win.startH * 3600000
            const endMs = win.endH * 3600000
            const keepIdx: number[] = []
            ts.forEach((tt, ii) => { if (tt >= startMs && tt <= endMs) keepIdx.push(ii) })
            ts = keepIdx.map(ii => ts[ii])
            vs = keepIdx.map(ii => vs[ii]!)
          }
        }
      } else {
        const rs = resampleByInterval(ranged, intervalMin)
        ts = rs.map(p => p.created_at)
        vs = rs.map(p => Number(p.page_count ?? 0))
        if (histMode.value === 'delta') {
          vs = buildDelta(vs as number[], ts, intervalMin)
          ts = ts.slice(1)
        }
      }
      if (ts.length) {
        timesList.push(ts)
        valuesList.push(vs as number[])
        metaList.push({
          origIdx: i,
          axis: 2,
          name: uniqueSeriesName(seriesDisplayBase(t, '分P'), usedNames, t.target),
          fullName: seriesFullName(t, '分P'),
          color: COLORS[i % COLORS.length],
        })
      }
    }
  })

  // 对齐：T+0 各序列已是相对网格，再按 interval 分桶对齐；日历用绝对时间槽
  const { slots: slotsFinal, aligned: alignedFinal } = isRel
    ? alignByRelativeBuckets(timesList, valuesList, bucketMs)
    : alignByTimeSlots(timesList, valuesList, ALIGN_TOLERANCE_MS)

  alignedCache.value = {
    categories: isRel ? formatRelativeSlots(slotsFinal) : formatSmartTimestamps(slotsFinal),
    slots: slotsFinal,
  }
  return metaList.map((m, j) => ({
    name: m.name,
    fullName: m.fullName,
    values: alignedFinal[j] || [],
    color: m.color,
    yAxisIndex: m.axis,
    showLabel: false,
  }))
})

const alignedCache = ref<{ categories: string[]; slots: number[] }>({ categories: [], slots: [] })

/** slots 已是相对时间（ms），直接格式化为 T+ */
function formatRelativeSlots(slots: number[]): string[] {
  return slots.map(t => {
    const h = Math.max(0, t) / 3600000
    return h < 24 ? `T+${h.toFixed(1)}h` : `T+${(h / 24).toFixed(1)}d`
  })
}

function openDetail(c: { type: HistoryKind; target: string }) {
  router.push(`/detail/${c.type}/${c.target}`)
}
function onRemove(t: Pick<CompareTarget, 'type' | 'target'>) {
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

function collectUiSettings() {
  return {
    metricKey: metricKey.value,
    histMode: histMode.value,
    scaleMode: scaleMode.value,
    timeAxis: timeAxis.value,
    chartGapMinutes: chartGapMinutes.value,
    logMode: logMode.value,
    showAvgLine: showAvgLine.value,
    showTrend: showTrend.value,
    overlayPage: overlayPage.value,
    showAll: showAll.value,
    dateRange: dateRange.value,
    t0Start: t0Start.value,
    t0End: t0End.value,
    t0Unit: t0Unit.value,
    t0ShowAll: t0ShowAll.value,
  }
}

function applyUiSettings(s: NonNullable<ReturnType<typeof loadCompareUiSettings>>) {
  if (s.metricKey) metricKey.value = s.metricKey
  if (s.histMode === 'raw' || s.histMode === 'delta') histMode.value = s.histMode
  if (s.scaleMode === 'abs' || s.scaleMode === 'growth' || s.scaleMode === 'index') scaleMode.value = s.scaleMode
  if (s.timeAxis === 'calendar' || s.timeAxis === 'relative') timeAxis.value = s.timeAxis
  if (typeof s.chartGapMinutes === 'number' && s.chartGapMinutes > 0) chartGapMinutes.value = s.chartGapMinutes
  if (typeof s.logMode === 'boolean') logMode.value = s.logMode
  if (typeof s.showAvgLine === 'boolean') showAvgLine.value = s.showAvgLine
  if (typeof s.showTrend === 'boolean') showTrend.value = s.showTrend
  if (typeof s.overlayPage === 'boolean') overlayPage.value = s.overlayPage
  if (typeof s.showAll === 'boolean') showAll.value = s.showAll
  if (Array.isArray(s.dateRange) && s.dateRange.length === 2) dateRange.value = s.dateRange as [string, string]
  else if (s.dateRange === null) dateRange.value = null
  if (typeof s.t0Start === 'number') t0Start.value = s.t0Start
  if (typeof s.t0End === 'number') t0End.value = s.t0End
  if (s.t0Unit === 'hour' || s.t0Unit === 'day') t0Unit.value = s.t0Unit
  if (typeof s.t0ShowAll === 'boolean') t0ShowAll.value = s.t0ShowAll
}

watch(
  [
    metricKey, histMode, scaleMode, timeAxis, chartGapMinutes,
    logMode, showAvgLine, showTrend, overlayPage,
    showAll, dateRange, t0Start, t0End, t0Unit, t0ShowAll,
  ],
  () => {
    syncUrl()
    saveCompareUiSettings(currentUsername.value, collectUiSettings())
  },
  { deep: true }
)

onMounted(async () => {
  // 别名/设置按账号分桶：优先 auth/check，失败则用缓存用户名
  try {
    const auth = await monitorApi.checkAuth()
    currentUsername.value = auth?.username || localStorage.getItem('bili_username') || '__anon__'
    if (auth?.username) localStorage.setItem('bili_username', auth.username)
  } catch {
    currentUsername.value = localStorage.getItem('bili_username') || '__anon__'
  }
  aliasMap.value = loadAliasMap(currentUsername.value)

  // 1) 先恢复本地缓存的工具栏设置（不清缓存则刷新不丢）
  const savedUi = loadCompareUiSettings(currentUsername.value)
  if (savedUi) applyUiSettings(savedUi)

  const fromUrl = parseCompareQuery(route.query.ids as string)
  if (fromUrl.length) {
    targets.value = fromUrl.slice(0, COMPARE_MAX)
    saveCompareTargets(targets.value)
  } else {
    targets.value = loadCompareTargets()
  }
  // 2) URL 参数优先覆盖本地缓存（分享链接仍生效）
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
.toolbar-main {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  align-items: center;
  margin-bottom: 10px;
}
.toolbar-spacer {
  flex: 1 1 auto;
  min-width: 8px;
}
.toolbar-sep {
  width: 1px;
  height: 16px;
  background: var(--border, #dcdfe6);
  opacity: 0.9;
  flex-shrink: 0;
  margin: 0 2px;
}
.date-range-wrap {
  width: 220px;
  flex-shrink: 0;
  display: flex;
}
.toolbar-main :deep(.date-range-compact.el-date-editor--datetimerange),
.toolbar-main :deep(.date-range-compact.el-date-editor) {
  width: 220px !important;
  max-width: 220px;
  flex: none;
}
.toolbar-main :deep(.date-range-compact .el-range-input) {
  width: 68px !important;
  flex: none;
  min-width: 0;
}
.toolbar-main :deep(.date-range-compact .el-range-separator) {
  padding: 0 4px !important;
  width: auto !important;
  flex: none;
}
.compare-list {
  margin-bottom: 12px;
  border: 1px solid var(--border);
  border-radius: 8px;
  overflow: hidden;
  background: var(--bg);
}
.compare-list-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 10px;
  border-bottom: 1px solid var(--border);
}
.compare-list-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--text);
}
.compare-list-actions {
  display: flex;
  gap: 8px;
  align-items: center;
}
.chart-wrap {
  position: relative;
}
.chart-footer {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin-top: 6px;
  flex-wrap: wrap;
}
.chart-footer-left {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
  flex: 1;
}
.chart-switches {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
  align-items: center;
}
.chart-note {
  color: var(--text-secondary);
  font-size: 12px;
  line-height: 1.5;
}
.chart-footer-right {
  display: flex;
  gap: 8px;
  align-items: center;
  flex-shrink: 0;
  margin-left: auto;
}
.alias-cell {
  display: flex;
  align-items: center;
  gap: 4px;
  flex-wrap: wrap;
  min-height: 24px;
}
.alias-value {
  font-size: 12px;
  color: var(--text);
  max-width: 120px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.num-cell {
  font-variant-numeric: tabular-nums;
  font-feature-settings: "tnum";
  font-weight: 600;
  white-space: nowrap;
}
</style>
