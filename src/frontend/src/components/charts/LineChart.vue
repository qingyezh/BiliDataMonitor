<template>
  <div>
    <div ref="chartRef" style="width: 100%; height: 300px"></div>
    <div v-if="isMultiSeries" class="custom-legend">
      <div class="legend-row" @click="onSeriesLegendClick">
        <div v-for="(s, i) in (values as SeriesItem[])" :key="s.name" class="legend-item" :data-index="i" :class="{ inactive: !seriesVisible[i] }">
          <span class="legend-icon" :style="{ background: seriesVisible[i] ? (s.color || COLORS[i % COLORS.length]) : '#ddd' }"></span>
          <span class="legend-text">{{ s.name }}</span>
        </div>
      </div>
      <div v-if="showTrendLine && trendLineSeries.length > 0" class="legend-row" @click="onTrendLegendClick">
        <div v-for="(item, i) in trendLegendItems" :key="item.name" class="legend-item" :data-name="item.name" :class="{ inactive: !trendVisible[item.name] }">
          <span class="legend-icon" :style="{ background: trendVisible[item.name] ? item.color : '#ddd' }"></span>
          <span class="legend-text">{{ item.name }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.custom-legend {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 8px 0;
}
.legend-row {
  display: flex;
  justify-content: center;
  gap: 16px;
  cursor: pointer;
}
.legend-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  border-radius: 4px;
  transition: opacity 0.2s;
}
.legend-item:hover {
  background: rgba(0, 0, 0, 0.05);
}
.legend-icon {
  width: 14px;
  height: 14px;
  border-radius: 3px;
  flex-shrink: 0;
}
.legend-text {
  font-size: 12px;
  color: #666;
  white-space: nowrap;
}
.legend-item.inactive {
  opacity: 0.4;
}
.legend-item.inactive .legend-icon {
  background: #ddd !important;
}
</style>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import * as echarts from 'echarts'

interface SeriesItem {
  name: string
  values: (number | null)[]
  color?: string
  markPoints?: { coord: [number, number]; value: number }[]
  realValues?: (number | null)[]
  dates?: string[]
  realMap?: Record<string, number>
  yAxisIndex?: number
  hideInLegend?: boolean
  showLabel?: boolean
  formatter?: (v: number) => string
}

export interface TrendFormula {
  name: string
  formula: string
  r2: number
}

const emit = defineEmits<{
  (e: 'trend-formulas', formulas: TrendFormula[]): void
}>()

const props = withDefaults(defineProps<{
  categories: string[]
  values: number[] | SeriesItem[]
  title?: string
  color?: string
  label?: string
  itemLabels?: string[]
  formatter?: (v: number) => string
  logMode?: boolean
  leftAxisLog?: boolean
  rightAxisLog?: boolean
  unequalLog?: boolean
  showTrendLine?: boolean
  trendLineSeries?: number[]
}>(), {
  logMode: false,
  leftAxisLog: false,
  rightAxisLog: false,
  unequalLog: true,
  showTrendLine: false,
  trendLineSeries: () => [],
})

const chartRef = ref<HTMLDivElement>()
let chart: echarts.ECharts | null = null

const COLORS = ['#409EFF', '#67C23A', '#E6A23C', '#F56C6C', '#909399', '#9B59B6', '#1ABC9C', '#E74C3C']

const isMultiSeries = computed(() => Array.isArray(props.values) && props.values.length > 0 && typeof props.values[0] === 'object')

const seriesVisible = ref<boolean[]>([])
const trendVisible = ref<Record<string, boolean>>({})

const trendLegendItems = computed(() => {
  const items: { name: string; color: string }[] = []
  if (!props.showTrendLine || !isMultiSeries.value) return items
  for (const seriesIdx of props.trendLineSeries) {
    if (seriesIdx >= (props.values as SeriesItem[]).length) continue
    const targetSeries = (props.values as SeriesItem[])[seriesIdx]
    const color = targetSeries.color || COLORS[seriesIdx % COLORS.length]
    const originalValues = targetSeries.values
    const result = computeTrendLine(originalValues, props.categories)
    if (!result) continue
    const name = `${targetSeries.name}趋势 (R²=${result.r2.toFixed(3)})`
    items.push({ name, color })
  }
  return items
})

function onSeriesLegendClick(e: Event) {
  const target = (e.target as HTMLElement).closest('.legend-item') as HTMLElement
  if (!target) return
  const idx = parseInt(target.dataset.index || '0')
  seriesVisible.value[idx] = !seriesVisible.value[idx]
  updateChart()
}

function onTrendLegendClick(e: Event) {
  const target = (e.target as HTMLElement).closest('.legend-item') as HTMLElement
  if (!target) return
  const name = target.dataset.name
  if (!name) return
  trendVisible.value[name] = !trendVisible.value[name]
  updateFormulasByTrend()
  updateChart()
}

function updateFormulasByTrend() {
  const visible = allFormulas.filter(f => trendVisible.value[f.name] !== false)
  emit('trend-formulas', visible)
}

function decimalPlaces(v: number, figs: number = 2): number {
  if (v === 0) return 0
  const s = parseFloat(v.toPrecision(figs)).toString()
  const dot = s.indexOf('.')
  return dot === -1 ? 0 : s.length - dot - 1
}

function logTransform(v: number): number {
  if (v < 0) return 0
  const log = Math.log10(v + 1)
  return log * log * log
}

function logInverse(t: number): number {
  if (t <= 0) return 0
  return Math.pow(10, Math.cbrt(t)) - 1
}

function formatLogValue(v: number): string {
  if (v >= 100000000) return (v / 100000000).toFixed(1) + '亿'
  if (v >= 10000) return (v / 10000).toFixed(1) + '万'
  if (v >= 1000) return (v / 1000).toFixed(1) + 'k'
  if (v >= 1) return String(Math.round(v))
  return v.toFixed(2)
}

function polyFit(xs: number[], ys: number[], degree: number): number[] {
  const n = xs.length
  const m = degree + 1
  const matrix: number[][] = Array.from({ length: m }, () => Array(m + 1).fill(0))
  for (let i = 0; i < m; i++) {
    for (let j = 0; j < m; j++) {
      for (let k = 0; k < n; k++) {
        matrix[i][j] += Math.pow(xs[k], i + j)
      }
    }
    for (let k = 0; k < n; k++) {
      matrix[i][m] += ys[k] * Math.pow(xs[k], i)
    }
  }
  for (let i = 0; i < m; i++) {
    let maxRow = i
    for (let k = i + 1; k < m; k++) {
      if (Math.abs(matrix[k][i]) > Math.abs(matrix[maxRow][i])) maxRow = k
    }
    ;[matrix[i], matrix[maxRow]] = [matrix[maxRow], matrix[i]]
    if (Math.abs(matrix[i][i]) < 1e-10) continue
    for (let j = i + 1; j < m; j++) {
      const factor = matrix[j][i] / matrix[i][i]
      for (let k = i; k <= m; k++) {
        matrix[j][k] -= factor * matrix[i][k]
      }
    }
  }
  const coeffs = Array(m).fill(0)
  for (let i = m - 1; i >= 0; i--) {
    coeffs[i] = matrix[i][m]
    for (let j = i + 1; j < m; j++) {
      coeffs[i] -= matrix[i][j] * coeffs[j]
    }
    coeffs[i] /= matrix[i][i]
  }
  return coeffs
}

function polyEval(coeffs: number[], x: number): number {
  let result = 0
  for (let i = 0; i < coeffs.length; i++) {
    result += coeffs[i] * Math.pow(x, i)
  }
  return result
}

function computeTrendLine(values: (number | null)[], categories: string[]): { trendValues: (number | null)[], r2: number, coeffs: number[], degree: number } | null {
  const validIndices: number[] = []
  const validValues: number[] = []
  for (let i = 0; i < values.length; i++) {
    if (values[i] !== null && values[i] !== undefined && values[i]! > 0) {
      validIndices.push(i)
      validValues.push(values[i]!)
    }
  }
  if (validIndices.length < 4) {
    return null
  }
  let degree = 7
  if (validIndices.length < 8) degree = 5
  if (validIndices.length < 6) degree = 3
  const xs = validIndices.map(i => i)
  const logYs = validValues.map(v => Math.log(v + 1))
  const coeffs = polyFit(xs, logYs, degree)
  const trendValues: (number | null)[] = []
  for (let i = 0; i < values.length; i++) {
    const predicted = Math.exp(polyEval(coeffs, i)) - 1
    trendValues.push(predicted)
  }
  const meanY = validValues.reduce((a, b) => a + b, 0) / validValues.length
  let ssRes = 0
  let ssTot = 0
  for (let i = 0; i < validIndices.length; i++) {
    const actual = validValues[i]
    const predicted = Math.exp(polyEval(coeffs, validIndices[i])) - 1
    ssRes += (actual - predicted) ** 2
    ssTot += (actual - meanY) ** 2
  }
  const r2 = ssTot === 0 ? 0 : 1 - ssRes / ssTot
  return { trendValues, r2, coeffs, degree }
}

function formatFormula(coeffs: number[], degree: number): string {
  const terms: string[] = []
  for (let i = degree; i >= 0; i--) {
    const c = coeffs[i]
    if (Math.abs(c) < 1e-10) continue
    const cStr = c.toExponential(3)
    let term = ''
    if (i === 0) {
      term = cStr
    } else if (i === 1) {
      term = `${cStr}x`
    } else {
      term = `${cStr}x^{${i}}`
    }
    if (terms.length > 0 && c > 0) term = '+' + term
    terms.push(term)
  }
  return `y = e^{\\left(${terms.join('')}\\right)} - 1`
}

function initChart() {
  if (!chartRef.value) return
  chart = echarts.init(chartRef.value)
  if (isMultiSeries.value) {
    seriesVisible.value = (props.values as SeriesItem[]).map(() => true)
    const trendInit: Record<string, boolean> = {}
    for (const item of trendLegendItems.value) {
      trendInit[item.name] = false
    }
    trendVisible.value = trendInit
  }
  updateChart()
  window.addEventListener('resize', () => chart?.resize())
}

let allFormulas: TrendFormula[] = []

function updateChart() {
  if (!chart) return
  try {
    renderChart()
  } catch (e) {
    console.error('[LineChart] 渲染失败:', e)
  }
}

function renderChart() {
  if (!chart) return

  // 判断是多系列还是单系列
  const isMultiSeries = Array.isArray(props.values) && props.values.length > 0 && typeof props.values[0] === 'object'

  // 计算 y 轴统一小数位数（2 位有效数字）
  const allNums = isMultiSeries
    ? (props.values as SeriesItem[]).flatMap(s => s.values.filter((v): v is number => v !== null))
    : (props.values as number[])
  const yMaxDecimals = Math.max(0, ...allNums.map(v => decimalPlaces(v)))

  const getAxisLog = (axisIdx: number) => {
    if (axisIdx === 0) return props.logMode && props.leftAxisLog
    return props.logMode && props.rightAxisLog
  }

  const useUnequalLog = (axisIdx: number) => {
    return getAxisLog(axisIdx) && props.unequalLog
  }

  function toLogValue(v: number | null, axisIdx: number): number | null {
    if (v === null || v === undefined) return null
    if (v <= 0) return 0
    if (useUnequalLog(axisIdx)) {
      return logTransform(v)
    }
    if (v <= 1) return 1
    return v
  }

  function buildLogMarkPoints(originalValues: (number | null)[], yAxisIdx: number, existingMarkPoints?: { coord: [number, number]; value: number }[]): { coord: [number, number]; value: number }[] {
    const points: { coord: [number, number]; value: number }[] = []
    if (existingMarkPoints) points.push(...existingMarkPoints)
    const axisLog = getAxisLog(yAxisIdx)
    if (!axisLog) return points
    for (let i = 0; i < originalValues.length; i++) {
      const v = originalValues[i]
      if (v !== null && v < 0) {
        const displayY = useUnequalLog(yAxisIdx) ? 0 : 1
        points.push({ coord: [i, displayY], value: v })
      }
    }
    return points
  }

  let series: any[]
  if (isMultiSeries) {
    series = (props.values as SeriesItem[])
      .map((s, i) => ({ s, i }))
      .filter(({ i }) => seriesVisible.value[i] !== false)
      .map(({ s, i }) => {
      const axisIdx = s.yAxisIndex ?? 0
      const logValues = s.values.map(v => toLogValue(v, axisIdx))
      const mergedMarkPoints = buildLogMarkPoints(s.values, axisIdx, s.markPoints)

      const base: any = {
        name: s.name,
        type: 'line',
        data: logValues,
        smooth: true,
        symbol: 'circle',
        symbolSize: 6,
        lineStyle: { width: 2 },
        itemStyle: { color: s.color || COLORS[i % COLORS.length] },
        yAxisIndex: axisIdx,
        label: {
          show: s.showLabel ?? false,
          position: 'top',
          color: '#666',
          fontSize: 10,
          formatter: (params: any) => {
            let v = params.value
            if (useUnequalLog(axisIdx) && typeof v === 'number') {
              v = logInverse(v)
            }
            if (s.formatter) return s.formatter(v)
            return props.formatter ? props.formatter(v) : undefined
          },
        },
        emphasis: {
          label: {
            show: true,
            fontSize: 12,
            fontWeight: 'bold',
            formatter: (params: any) => {
              let v = params.value
              if (useUnequalLog(axisIdx) && typeof v === 'number') {
                v = logInverse(v)
              }
              if (s.formatter) return s.formatter(v)
              return props.formatter ? props.formatter(v) : (typeof v === 'number' ? v.toLocaleString() : String(v))
            },
          },
        },
        areaStyle: {
          color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
            { offset: 0, color: (s.color || COLORS[i % COLORS.length]) + '30' },
            { offset: 1, color: (s.color || COLORS[i % COLORS.length]) + '03' },
          ]),
        },
      }
      if (mergedMarkPoints.length > 0) {
        base.markPoint = {
          symbol: 'circle',
          symbolSize: 10,
          itemStyle: { color: '#f56c6c' },
          label: { show: false },
          tooltip: { show: false },
          emphasis: { disabled: true },
          data: mergedMarkPoints.map(mp => ({
            coord: mp.coord,
            value: mp.value,
          })),
        }
      } else {
        base.markPoint = { data: [], tooltip: { show: false } }
      }
      return base
    })
  } else {
    const logValues = (props.values as number[]).map(v => toLogValue(v, 0))
    series = [
      {
        name: props.label || '数值',
        type: 'line',
        data: logValues,
        smooth: true,
        symbol: 'circle',
        symbolSize: 6,
        lineStyle: { width: 2 },
        itemStyle: { color: props.color || '#409eff' },
        label: {
          show: false,
          position: 'top',
          color: '#666',
          fontSize: 10,
          formatter: (params: any) => {
            let v = params.value
            if (useUnequalLog(0) && typeof v === 'number') {
              v = logInverse(v)
            }
            return props.formatter ? props.formatter(v) : undefined
          },
        },
        emphasis: {
          label: {
            show: true,
            fontSize: 12,
            fontWeight: 'bold',
            formatter: (params: any) => {
              let v = params.value
              if (useUnequalLog(0) && typeof v === 'number') {
                v = logInverse(v)
              }
              return props.formatter ? props.formatter(v) : (typeof v === 'number' ? v.toLocaleString() : String(v))
            },
          },
        },
        areaStyle: {
          color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
            { offset: 0, color: (props.color || '#409eff') + '30' },
            { offset: 1, color: (props.color || '#409eff') + '03' },
          ]),
        },
      },
    ]
  }

  if (props.showTrendLine && isMultiSeries && (props.values as SeriesItem[]).length > 0) {
    const formulas: TrendFormula[] = []
    for (const seriesIdx of props.trendLineSeries) {
      if (seriesIdx >= (props.values as SeriesItem[]).length) continue
      const targetSeries = (props.values as SeriesItem[])[seriesIdx]
      const axisIdx = targetSeries.yAxisIndex ?? 0
      const originalValues = targetSeries.values
      const result = computeTrendLine(originalValues, props.categories)
      if (!result) continue
      const { trendValues, r2, coeffs, degree } = result
      const trendData = trendValues.map(v => toLogValue(v, axisIdx))
      const name = `${targetSeries.name}趋势 (R²=${r2.toFixed(3)})`
      if (trendVisible.value[name] === true) {
        series.push({
          name,
          type: 'line',
          data: trendData,
          smooth: true,
          symbol: 'none',
          lineStyle: { width: 2, type: 'dashed', color: targetSeries.color || COLORS[seriesIdx % COLORS.length] },
          itemStyle: { color: targetSeries.color || COLORS[seriesIdx % COLORS.length] },
          yAxisIndex: axisIdx,
          z: 10,
        })
        formulas.push({
          name,
          formula: formatFormula(coeffs, degree),
          r2,
        })
      }
    }
    allFormulas = formulas
    updateFormulasByTrend()
  } else {
    allFormulas = []
  }

  const hasDualAxis = isMultiSeries && (props.values as SeriesItem[]).some(s => s.yAxisIndex === 1)

  function makeYAxis(axisIdx: number) {
    const isLog = getAxisLog(axisIdx)
    const isUnequal = useUnequalLog(axisIdx)

    if (isUnequal) {
      return {
        type: 'value',
        min: 0,
        splitLine: { lineStyle: { color: '#f0f0f0', type: 'dashed' } },
        axisLabel: {
          color: '#999',
          fontSize: 11,
          formatter: (v: number) => formatLogValue(logInverse(v)),
        },
      }
    }

    if (isLog) {
      return {
        type: 'log',
        min: 1,
        splitLine: { lineStyle: { color: '#f0f0f0', type: 'dashed' } },
        axisLabel: { color: '#999', fontSize: 11, formatter: (v: number) => v.toFixed(yMaxDecimals) },
      }
    }

    return {
      type: 'value',
      splitLine: { lineStyle: { color: '#f0f0f0', type: 'dashed' } },
      axisLabel: { color: '#999', fontSize: 11, formatter: (v: number) => v.toFixed(yMaxDecimals) },
    }
  }

  chart.setOption({
    title: props.title ? { text: props.title, left: 'center', textStyle: { fontSize: 14 } } : undefined,
    tooltip: {
      trigger: 'axis',
      confine: true,
      backgroundColor: 'rgba(255,255,255,0.95)',
      borderWidth: 0,
      boxShadow: '0 2px 12px rgba(0,0,0,0.1)',
      borderRadius: 8,
      padding: [10, 14],
      valueFormatter: (value: any) => {
        if (typeof value === 'number') return value.toLocaleString()
        return value
      },
      formatter: (params: any) => {
        if (!Array.isArray(params) || params.length === 0) return ''
        const sorted = [...params].sort((a: any, b: any) => (b.value || 0) - (a.value || 0))
        const header = sorted[0]?.axisValue || ''
        const items = sorted.map((p: any) => {
          const color = p.color || '#ccc'
          const name = p.seriesName || ''
          const seriesData = (props.values as SeriesItem[]).find(s => s.name === name)
          let val = p.value
          let useRealMap = false
          if (seriesData?.realMap && seriesData.realMap[p.axisValue] !== undefined) {
            val = seriesData.realMap[p.axisValue]
            useRealMap = true
          }
          const axisIdx = seriesData?.yAxisIndex ?? 0
          // realMap already contains original values, only convert p.value when not from realMap
          if (!useRealMap && useUnequalLog(axisIdx) && typeof val === 'number') {
            val = logInverse(val)
          }
          let valStr: string
          if (typeof val === 'number') {
            valStr = seriesData?.formatter ? seriesData.formatter(val) : val.toLocaleString()
          } else {
            valStr = val === null ? '--' : String(val)
          }
          return `<div style="display:flex;align-items:center;gap:6px;margin:2px 0"><span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${color}"></span><span style="flex:1">${name}</span><span style="font-weight:600">${valStr}</span></div>`
        })
        return `<div style="font-weight:600;margin-bottom:4px">${header}</div>${items.join('')}`
      },
    },

    grid: {
      left: '8%',
      right: '8%',
      top: props.title ? 50 : 20,
      bottom: isMultiSeries ? 30 : 20,
      containLabel: true,
    },
    xAxis: {
      type: 'category',
      data: props.categories,
      boundaryGap: true,
      axisLine: { lineStyle: { color: '#e0e0e0' } },
      axisTick: { show: false },
      axisLabel: { 
        color: '#666', 
        fontSize: 11, 
        rotate: props.categories.length > 12 ? 45 : 0,
      },
    },
    yAxis: hasDualAxis
      ? [makeYAxis(0), makeYAxis(1)]
      : makeYAxis(0),
    series,
  }, true)

  if (props.showTrendLine && isMultiSeries) {
    const selected: Record<string, boolean> = {}
    for (const seriesIdx of props.trendLineSeries) {
      if (seriesIdx >= (props.values as SeriesItem[]).length) continue
      const targetSeries = (props.values as SeriesItem[])[seriesIdx]
      const originalValues = targetSeries.values
      const result = computeTrendLine(originalValues, props.categories)
      if (!result) continue
      const name = `${targetSeries.name}趋势 (R²=${result.r2.toFixed(3)})`
      selected[name] = false
    }
    updateFormulasByTrend()
  }
}

function saveChart() {
  if (!chart) return
  const url = chart.getDataURL({
    type: 'png',
    pixelRatio: 3,
    backgroundColor: '#fff',
  })
  const a = document.createElement('a')
  a.href = url
  a.download = `${props.title || 'chart'}.png`
  a.click()
}

function exportCsv() {
  const isMultiSeries = Array.isArray(props.values) && props.values.length > 0 && typeof props.values[0] === 'object'
  const seriesList = isMultiSeries ? (props.values as SeriesItem[]) : []

  const headers = ['日期', ...seriesList.map(s => s.name)]
  const rows: string[][] = []

  for (let i = 0; i < props.categories.length; i++) {
    const row: string[] = [props.categories[i]]
    for (const s of seriesList) {
      let val = s.values[i]
      if (s.realMap && s.realMap[props.categories[i]] !== undefined) {
        val = s.realMap[props.categories[i]]
      }
      row.push(val !== null && val !== undefined ? String(val) : '')
    }
    rows.push(row)
  }

  const csvContent = '\uFEFF' + [headers.join(','), ...rows.map(r => r.join(','))].join('\n')
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  const now = new Date()
  const dateStr = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`
  a.download = `${props.title || 'chart'}_${dateStr}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

watch(() => [props.categories, props.values], () => {
  if (!chart && chartRef.value) {
    chart = echarts.init(chartRef.value)
  }
  updateChart()
}, { deep: true })

watch([() => props.logMode, () => props.leftAxisLog, () => props.rightAxisLog, () => props.unequalLog, () => props.showTrendLine, () => props.trendLineSeries], () => {
  if (!chart && chartRef.value) {
    chart = echarts.init(chartRef.value)
  }
  if (chart) {
    chart.dispose()
    chart = echarts.init(chartRef.value!)
  }
  updateChart()
})

onMounted(initChart)
onUnmounted(() => {
  chart?.dispose()
  chart = null
})

defineExpose({ exportCsv, saveChart })
</script>
