<template>
  <div ref="chartRef" style="width: 100%; height: 350px"></div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch, nextTick } from 'vue'
import * as echarts from 'echarts'

const props = withDefaults(defineProps<{
  categories: string[]
  values: number[]
  percentages?: string[]
  title?: string
  color?: string
  colors?: string[]
  horizontal?: boolean
  maxDisplay?: number
  showLabel?: boolean
}>(), {
  showLabel: false,
})

const chartRef = ref<HTMLDivElement>()
let chart: echarts.ECharts | null = null

function initChart() {
  if (!chartRef.value) return
  chart = echarts.init(chartRef.value)
  nextTick(() => updateChart())
  window.addEventListener('resize', () => chart?.resize())
}

function updateChart() {
  if (!chart) return
  const maxDisplay = props.maxDisplay === 0 ? props.categories.length : (props.maxDisplay || 15)
  const needsHorizontal = props.categories.length > maxDisplay || props.horizontal || props.maxDisplay === 0
  const displayCats = props.categories.slice(0, maxDisplay)
  const displayVals = props.values.slice(0, maxDisplay)
  const displayPcts = props.percentages?.slice(0, maxDisplay) || []
  const hCats = [...displayCats].reverse()
  const hVals = [...displayVals].reverse()
  const hPcts = [...displayPcts].reverse()

  // 动态计算标签位置
  const labelPosition = needsHorizontal ? 'right' : 'top'

  chart.setOption({
    tooltip: {
      trigger: 'axis',
      formatter: (params: any) => {
        const data = params[0]
        const pct = displayPcts[data.dataIndex] || ''
        return `${data.name}: ${data.value} (${pct})`
      }
    },
    grid: {
      left: needsHorizontal ? 120 : 10,
      right: 50,
      top: 20,
      bottom: needsHorizontal ? 10 : 60,
      containLabel: true,
    },
    xAxis: needsHorizontal
      ? { type: 'value', position: 'bottom' }
      : {
          type: 'category',
          data: displayCats,
          axisLabel: { rotate: displayCats.length > 6 ? 45 : 0, fontSize: 11, interval: 0 },
        },
    yAxis: needsHorizontal
      ? { type: 'category', data: hCats, axisLabel: { fontSize: 12, width: 100, overflow: 'truncate' } }
      : { type: 'value' },
    series: [
      {
        type: 'bar',
        data: needsHorizontal ? hVals : displayVals,
        itemStyle: {
          color: (params: any) => {
            const idx = needsHorizontal ? (displayVals.length - 1 - params.dataIndex) : params.dataIndex
            return props.colors?.[idx] || props.color || '#409eff'
          },
          borderRadius: needsHorizontal ? [0, 4, 4, 0] : [4, 4, 0, 0],
        },
        barMaxWidth: needsHorizontal ? 24 : 50,
        label: {
          show: props.showLabel,
          position: labelPosition,
          fontSize: 11,
          color: '#606266',
          formatter: (params: any) => {
            const idx = needsHorizontal ? (displayVals.length - 1 - params.dataIndex) : params.dataIndex
            return displayPcts[idx] || params.value
          }
        },
        emphasis: { label: { show: true, fontSize: 12, fontWeight: 'bold' } },
      },
    ],
  }, true)
  setTimeout(() => chart?.resize(), 50)
}

function resize() {
  chart?.resize()
}

watch(() => [props.categories, props.values, props.percentages, props.showLabel], () => nextTick(updateChart), { deep: true })

onMounted(initChart)
onUnmounted(() => {
  chart?.dispose()
  chart = null
})

defineExpose({ resize })
</script>