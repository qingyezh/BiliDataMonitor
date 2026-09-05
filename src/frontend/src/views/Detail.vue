<template>
  <div v-loading="loading">
    <!-- 返回 -->
    <el-button size="small" @click="$router.push('/')" style="margin-bottom: 12px">
      <el-icon><ArrowLeft /></el-icon> 返回列表
    </el-button>

    <!-- UP主详情 -->
    <template v-if="type === 'up'">
      <!-- 概览卡片 -->
      <div class="content-card">
        <div class="card-title" style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px">
          <span>🏆 {{ name }}</span>
          <el-button size="small" type="success" :loading="refreshing" @click="refreshNow">立即刷新</el-button>
        </div>
        <div v-if="upMetrics" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: 12px; margin-top: 8px">
          <div class="stat-card"><div class="label">总视频</div><div class="value">{{ upMetrics.total_videos }}</div></div>
          <div class="stat-card"><div class="label">总播放</div><div class="value" style="color: #409eff">{{ formatNum(upMetrics.total_views) }}</div></div>
          <div class="stat-card"><div class="label">总弹幕</div><div class="value" style="color: #e6a23c">{{ formatNum(upMetrics.total_danmaku) }}</div></div>
          <div class="stat-card"><div class="label">总评论</div><div class="value" style="color: #67c23a">{{ formatNum(upMetrics.total_comments) }}</div></div>
          <div class="stat-card"><div class="label">播放:弹幕:评论</div><div class="value">{{ upMetrics.play_danmaku_comment }}</div></div>
          <div class="stat-card"><div class="label">平均播放</div><div class="value">{{ formatNum(upMetrics.avg_play) }}</div></div>
        </div>
        <el-empty v-else description="暂无数据，请先刷新" :image-size="60" />
      </div>

      <!-- 数据更新序列（每次轮询一条，原始/增量切换） -->
      <div class="content-card" v-if="upHistory.length > 0">
        <div class="card-title" style="display: flex; align-items: center; flex-wrap: wrap; gap: 8px">
          <span style="flex: 0 0 auto">📈 数据更新序列</span>
          <div style="flex: 1; display: flex; justify-content: center">
            <div style="display: flex; align-items: center; gap: 4px; width: 312px">
              <el-date-picker
                v-model="upDateRange"
                type="datetimerange"
                size="small"
                range-separator="~"
                start-placeholder="开始"
                end-placeholder="结束"
                value-format="YYYY-MM-DD HH:mm:ss"
                format="MM/DD HH:mm"
                style="flex: 1"
              />
              <el-button size="small" style="background-color: #e6f4ff; border-color: #91caff; color: #1677ff" @click="upShowAll = !upShowAll; if(upShowAll) upDateRange = null">
                {{ upShowAll ? '收起' : '全部' }}
              </el-button>
            </div>
          </div>
          <div style="flex: 0 0 auto; display: flex; align-items: center; gap: 8px">
            <el-radio-group v-model="upHistMode" size="small">
              <el-radio-button value="raw">原始值</el-radio-button>
              <el-radio-button value="delta">增量</el-radio-button>
            </el-radio-group>
            <el-popover placement="bottom" :width="200" trigger="click">
              <template #reference>
                <el-switch size="small" active-text="标签" :model-value="upShowPlayLabel || upShowDanmakuLabel || upShowCommentLabel" />
              </template>
              <div style="display: flex; flex-direction: column; gap: 8px">
                <el-switch v-model="upShowPlayLabel" size="small" active-text="总播放" />
                <el-switch v-model="upShowDanmakuLabel" size="small" active-text="总弹幕" />
                <el-switch v-model="upShowCommentLabel" size="small" active-text="总评论" />
              </div>
            </el-popover>
          </div>
        </div>
        <div style="position: relative">
          <LineChart
            ref="upChartRef"
            :categories="upHistDates"
            :values="upHistSeries"
            :log-mode="upLogMode"
            :left-axis-log="upLeftAxisLog"
            :right-axis-log="upRightAxisLog"
            :unequal-log="true"
            :show-trend-line="true"
            :trend-line-series="[0, 1, 2]"
            @trend-formulas="upFormulas = $event"
          />
          <div class="chart-controls">
            <div class="chart-controls-left">
              <el-switch v-model="upLogMode" size="small" active-text="对数" />
              <template v-if="upLogMode">
                <el-switch v-model="upLeftAxisLog" size="small" active-text="左轴" />
                <el-switch v-model="upRightAxisLog" size="small" active-text="右轴" />
              </template>
            </div>
            <div class="chart-controls-right">
              <el-button size="small" @click="upChartRef?.exportCsv()">
                <el-icon><Download /></el-icon> 导出CSV
              </el-button>
              <el-button size="small" @click="upChartRef?.saveChart()">
                <el-icon><Picture /></el-icon> 保存PNG
              </el-button>
            </div>
          </div>
        </div>
        <div v-if="upFormulas.length > 0" style="margin-top: 8px; padding: 12px 16px; background: var(--bg); border-radius: 6px; text-align: center">
          <div v-for="f in upFormulas" :key="f.name" style="margin-bottom: 8px; font-size: 14px; display: flex; align-items: center; justify-content: center; gap: 8px">
            <span style="font-weight: 600; color: var(--text-secondary); white-space: nowrap">{{ f.name }}：</span>
            <span v-html="renderLatex(f.formula)"></span>
          </div>
        </div>
        <div style="color: var(--text-secondary); font-size: 12px; margin-top: 4px">
          <template v-if="upHistMode === 'raw'">左轴：总播放 | 右轴：总弹幕/总评论（每次更新记录一条）</template>
          <template v-else>增量模式：相邻更新差值（不含首条），负值红点标记</template>
        </div>
      </div>

      <!-- 时长分布 -->
      <div class="content-card" v-if="durationDist.length > 0">
        <div class="card-title">⏱️ 视频时长分布</div>
        <BarChart :categories="durationLabels" :values="durationValues" :colors="durationColors" />
      </div>

      <!-- 视频排行 -->
      <div class="content-card">
        <div class="card-title" style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px">
          <span>🎬 视频排行</span>
          <el-radio-group v-model="videoSortBy" size="small" @change="videoPage = 1">
            <el-radio-button value="play">按播放量</el-radio-button>
            <el-radio-button value="created">按发布时间</el-radio-button>
            <el-radio-button value="comment">按评论数</el-radio-button>
            <el-radio-button value="video_review">按弹幕数</el-radio-button>
          </el-radio-group>
        </div>
        <el-table :data="paginatedVideos" stripe size="small">
          <el-table-column type="index" label="#" width="50" align="center" :index="(i: number) => (videoPage - 1) * videoPageSize + i + 1" />
          <el-table-column prop="title" label="标题" min-width="220" show-overflow-tooltip>
            <template #default="{ row }">
              <el-link type="primary" @click.prevent="goVideo(row.bvid)">{{ row.title }}</el-link>
            </template>
          </el-table-column>
          <el-table-column label="时长" width="80" align="center">
            <template #default="{ row }">{{ formatDuration(row.duration) }}</template>
          </el-table-column>
          <el-table-column label="播放" width="100" align="center">
            <template #default="{ row }"><span style="font-weight: 600; color: #409eff">{{ formatNum(row.play) }}</span></template>
          </el-table-column>
          <el-table-column label="弹幕" width="90" align="center">
            <template #default="{ row }">{{ formatNum(row.video_review) }}</template>
          </el-table-column>
          <el-table-column label="评论" width="90" align="center">
            <template #default="{ row }">{{ formatNum(row.comment) }}</template>
          </el-table-column>
          <el-table-column label="发布时间" width="150" align="center"><template #default="{ row }">{{ formatTimestamp(row.created * 1000) }}</template></el-table-column>
        </el-table>
        <div style="display: flex; justify-content: flex-end; margin-top: 12px" v-if="videoTotal > videoPageSize">
          <el-pagination
            v-model:current-page="videoPage"
            v-model:page-size="videoPageSize"
            :page-sizes="[10, 20, 30]"
            :total="videoTotal"
            layout="sizes, prev, pager, next"
          />
        </div>
      </div>
    </template>

    <!-- 视频详情 -->
    <template v-else-if="type === 'video'">
      <div class="content-card">
        <div class="card-title" style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px">
          <span>🎬 {{ videoMetrics?.title || target }}</span>
          <el-button size="small" type="success" :loading="refreshing" @click="refreshNow">立即刷新</el-button>
        </div>
        <div v-if="videoMetrics" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: 12px; margin-top: 8px">
          <div class="stat-card"><div class="label">首播→末播</div><div class="value">{{ formatNum(videoMetrics.first_play) }} → {{ formatNum(videoMetrics.last_play) }}</div></div>
          <div class="stat-card"><div class="label">播放:弹幕:评论</div><div class="value">{{ videoRatio }}</div></div>
          <div class="stat-card"><div class="label">首次记录</div><div class="value">{{ formatTimestamp(videoMetrics.first_seen_at) }}</div></div>
          <div class="stat-card"><div class="label">记录时长</div><div class="value">{{ formatRecordDuration(videoMetrics.first_seen_at) }}</div></div>
          <div class="stat-card"><div class="label">快照次数</div><div class="value">{{ videoMetrics.sample_count }}</div></div>
          <div class="stat-card">
            <div class="label">播放时间分布</div>
            <div style="display: flex; justify-content: center; gap: 16px">
              <div style="display: flex; align-items: baseline; gap: 4px">
                <span style="font-size: 12px; color: var(--text-secondary)">50%:</span>
                <span style="font-size: 18px; font-weight: 700">{{ playTimePercents.p50 != null ? playTimePercents.p50 + '%' : '--' }}</span>
              </div>
              <div style="display: flex; align-items: baseline; gap: 4px">
                <span style="font-size: 12px; color: var(--text-secondary)">90%:</span>
                <span style="font-size: 18px; font-weight: 700">{{ playTimePercents.p90 != null ? playTimePercents.p90 + '%' : '--' }}</span>
              </div>
            </div>
          </div>
        </div>
        <el-empty v-else description="暂无数据，请先刷新" :image-size="60" />
      </div>

      <div class="content-card" v-if="videoHistory.length > 0">
        <div class="card-title" style="display: flex; align-items: center; flex-wrap: wrap; gap: 8px">
          <span style="flex: 0 0 auto">📈 数据变化趋势</span>
          <div style="flex: 1; display: flex; justify-content: center">
            <div style="display: flex; align-items: center; gap: 4px; width: 312px">
              <el-date-picker
                v-model="videoDateRange"
                type="datetimerange"
                size="small"
                range-separator="~"
                start-placeholder="开始"
                end-placeholder="结束"
                value-format="YYYY-MM-DD HH:mm:ss"
                format="MM/DD HH:mm"
                style="flex: 1"
              />
              <el-button size="small" style="background-color: #e6f4ff; border-color: #91caff; color: #1677ff" @click="videoShowAll = !videoShowAll; if(videoShowAll) videoDateRange = null">
                {{ videoShowAll ? '收起' : '全部' }}
              </el-button>
            </div>
          </div>
          <div style="flex: 0 0 auto; display: flex; align-items: center; gap: 8px">
            <el-radio-group v-model="videoHistMode" size="small">
              <el-radio-button value="raw">原始值</el-radio-button>
              <el-radio-button value="delta">增量</el-radio-button>
            </el-radio-group>
            <el-popover placement="bottom" :width="200" trigger="click">
              <template #reference>
                <el-switch size="small" active-text="标签" :model-value="videoShowPlayLabel || videoShowDanmakuLabel || videoShowCommentLabel" />
              </template>
              <div style="display: flex; flex-direction: column; gap: 8px">
                <el-switch v-model="videoShowPlayLabel" size="small" active-text="播放" />
                <el-switch v-model="videoShowDanmakuLabel" size="small" active-text="弹幕" />
                <el-switch v-model="videoShowCommentLabel" size="small" active-text="评论" />
              </div>
            </el-popover>
          </div>
        </div>
        <div style="position: relative">
          <LineChart
            ref="videoChartRef"
            :categories="videoHistDates"
            :values="videoHistSeries"
            :log-mode="videoLogMode"
            :left-axis-log="videoLeftAxisLog"
            :right-axis-log="videoRightAxisLog"
            :unequal-log="true"
            :show-trend-line="true"
            :trend-line-series="[0, 1, 2]"
            @trend-formulas="videoFormulas = $event"
          />
          <div class="chart-controls">
            <div class="chart-controls-left">
              <el-switch v-model="videoLogMode" size="small" active-text="对数" />
              <template v-if="videoLogMode">
                <el-switch v-model="videoLeftAxisLog" size="small" active-text="左轴" />
                <el-switch v-model="videoRightAxisLog" size="small" active-text="右轴" />
              </template>
            </div>
            <div class="chart-controls-right">
              <el-button size="small" @click="videoChartRef?.exportCsv()">
                <el-icon><Download /></el-icon> 导出CSV
              </el-button>
              <el-button size="small" @click="videoChartRef?.saveChart()">
                <el-icon><Picture /></el-icon> 保存PNG
              </el-button>
            </div>
          </div>
        </div>
        <div v-if="videoFormulas.length > 0" style="margin-top: 8px; padding: 12px 16px; background: var(--bg); border-radius: 6px; text-align: center">
          <div v-for="f in videoFormulas" :key="f.name" style="margin-bottom: 8px; font-size: 14px; display: flex; align-items: center; justify-content: center; gap: 8px">
            <span style="font-weight: 600; color: var(--text-secondary); white-space: nowrap">{{ f.name }}：</span>
            <span v-html="renderLatex(f.formula)"></span>
          </div>
        </div>
        <div style="color: var(--text-secondary); font-size: 12px; margin-top: 4px">
          <template v-if="videoHistMode === 'raw'">播放（左轴）| 弹幕/评论（右轴）</template>
          <template v-else>增量模式：相邻快照差值（不含首日），负值红点标记</template>
        </div>
      </div>
    </template>

    <!-- 动态详情 -->
    <template v-else-if="type === 'dynamic'">
      <div class="content-card">
        <div class="card-title" style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px">
          <span>📢 {{ dynamicMetrics?.title || `动态 ${target}` }}</span>
          <el-button size="small" type="success" :loading="refreshing" @click="refreshNow">立即刷新</el-button>
        </div>
        <div v-if="dynamicMetrics" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: 12px; margin-top: 8px">
          <div class="stat-card"><div class="label">作者</div><div class="value">{{ dynamicMetrics.author_name || '--' }}</div></div>
          <div class="stat-card"><div class="label">点赞</div><div class="value" style="color: #409eff">{{ formatNum(dynamicMetrics.like_count) }}</div></div>
          <div class="stat-card"><div class="label">评论</div><div class="value" style="color: #e6a23c">{{ formatNum(dynamicMetrics.reply_count) }}</div></div>
          <div class="stat-card"><div class="label">转发</div><div class="value" style="color: #67c23a">{{ formatNum(dynamicMetrics.forward_count) }}</div></div>
          <div class="stat-card"><div class="label">类型</div><div class="value">{{ dynamicTypeName(dynamicMetrics.type) }}</div></div>
          <div class="stat-card"><div class="label">发布时间</div><div class="value">{{ formatTimestamp(dynamicMetrics.created_time * 1000) }}</div></div>
        </div>
        <el-empty v-else description="暂无数据，请先刷新" :image-size="60" />
      </div>

      <div class="content-card" v-if="dynamicHistory.length > 0">
        <div class="card-title" style="display: flex; align-items: center; flex-wrap: wrap; gap: 8px">
          <span style="flex: 0 0 auto">📈 数据变化趋势</span>
          <div style="flex: 1; display: flex; justify-content: center">
            <div style="display: flex; align-items: center; gap: 4px; width: 312px">
              <el-date-picker
                v-model="dynamicDateRange"
                type="datetimerange"
                size="small"
                range-separator="~"
                start-placeholder="开始"
                end-placeholder="结束"
                value-format="YYYY-MM-DD HH:mm:ss"
                format="MM/DD HH:mm"
                style="flex: 1"
              />
              <el-button size="small" style="background-color: #e6f4ff; border-color: #91caff; color: #1677ff" @click="dynamicShowAll = !dynamicShowAll; if(dynamicShowAll) dynamicDateRange = null">
                {{ dynamicShowAll ? '收起' : '全部' }}
              </el-button>
            </div>
          </div>
          <div style="flex: 0 0 auto; display: flex; align-items: center; gap: 8px">
            <el-radio-group v-model="dynamicHistMode" size="small">
              <el-radio-button value="raw">原始值</el-radio-button>
              <el-radio-button value="delta">增量</el-radio-button>
            </el-radio-group>
            <el-popover placement="bottom" :width="200" trigger="click">
              <template #reference>
                <el-switch size="small" active-text="标签" :model-value="dynamicShowLikeLabel || dynamicShowReplyLabel || dynamicShowForwardLabel" />
              </template>
              <div style="display: flex; flex-direction: column; gap: 8px">
                <el-switch v-model="dynamicShowLikeLabel" size="small" active-text="点赞" />
                <el-switch v-model="dynamicShowReplyLabel" size="small" active-text="评论" />
                <el-switch v-model="dynamicShowForwardLabel" size="small" active-text="转发" />
              </div>
            </el-popover>
          </div>
        </div>
        <div style="position: relative">
          <LineChart
            ref="dynamicChartRef"
            :categories="dynamicHistDates"
            :values="dynamicHistSeries"
            :log-mode="dynamicLogMode"
            :left-axis-log="dynamicLeftAxisLog"
            :right-axis-log="dynamicRightAxisLog"
            :unequal-log="true"
            :show-trend-line="true"
            :trend-line-series="[0, 1, 2]"
            @trend-formulas="dynamicFormulas = $event"
          />
          <div class="chart-controls">
            <div class="chart-controls-left">
              <el-switch v-model="dynamicLogMode" size="small" active-text="对数" />
              <template v-if="dynamicLogMode">
                <el-switch v-model="dynamicLeftAxisLog" size="small" active-text="左轴" />
                <el-switch v-model="dynamicRightAxisLog" size="small" active-text="右轴" />
              </template>
            </div>
            <div class="chart-controls-right">
              <el-button size="small" @click="dynamicChartRef?.exportCsv()">
                <el-icon><Download /></el-icon> 导出CSV
              </el-button>
              <el-button size="small" @click="dynamicChartRef?.saveChart()">
                <el-icon><Picture /></el-icon> 保存PNG
              </el-button>
            </div>
          </div>
        </div>
        <div v-if="dynamicFormulas.length > 0" style="margin-top: 8px; padding: 12px 16px; background: var(--bg); border-radius: 6px; text-align: center">
          <div v-for="f in dynamicFormulas" :key="f.name" style="margin-bottom: 8px; font-size: 14px; display: flex; align-items: center; justify-content: center; gap: 8px">
            <span style="font-weight: 600; color: var(--text-secondary); white-space: nowrap">{{ f.name }}：</span>
            <span v-html="renderLatex(f.formula)"></span>
          </div>
        </div>
        <div style="color: var(--text-secondary); font-size: 12px; margin-top: 4px">
          <template v-if="dynamicHistMode === 'raw'">点赞（左轴）| 评论/转发（右轴）</template>
          <template v-else>增量模式：相邻快照差值（不含首日），负值红点标记</template>
        </div>
      </div>
    </template>

    <!-- 专栏详情 -->
    <template v-else-if="type === 'column'">
      <div class="content-card">
        <div class="card-title" style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px">
          <span>📝 {{ columnMetrics?.title || `专栏 ${target}` }}</span>
          <el-button size="small" type="success" :loading="refreshing" @click="refreshNow">立即刷新</el-button>
        </div>
        <div v-if="columnMetrics" style="display: grid; grid-template-columns: repeat(auto-fit, minmax(130px, 1fr)); gap: 12px; margin-top: 8px">
          <div class="stat-card"><div class="label">作者</div><div class="value">{{ columnMetrics.author_name || '--' }}</div></div>
          <div class="stat-card"><div class="label">点赞</div><div class="value" style="color: #409eff">{{ formatNum(columnMetrics.like_count) }}</div></div>
          <div class="stat-card"><div class="label">评论</div><div class="value" style="color: #e6a23c">{{ formatNum(columnMetrics.reply_count) }}</div></div>
          <div class="stat-card"><div class="label">收藏</div><div class="value" style="color: #67c23a">{{ formatNum(columnMetrics.favorite_count) }}</div></div>
          <div class="stat-card"><div class="label">发布时间</div><div class="value">{{ formatTimestamp(columnMetrics.created_time * 1000) }}</div></div>
        </div>
        <el-empty v-else description="暂无数据，请先刷新" :image-size="60" />
      </div>

      <div class="content-card" v-if="columnHistory.length > 0">
        <div class="card-title" style="display: flex; align-items: center; flex-wrap: wrap; gap: 8px">
          <span style="flex: 0 0 auto">📈 数据变化趋势</span>
          <div style="flex: 1; display: flex; justify-content: center">
            <div style="display: flex; align-items: center; gap: 4px; width: 312px">
              <el-date-picker
                v-model="columnDateRange"
                type="datetimerange"
                size="small"
                range-separator="~"
                start-placeholder="开始"
                end-placeholder="结束"
                value-format="YYYY-MM-DD HH:mm:ss"
                format="MM/DD HH:mm"
                style="flex: 1"
              />
              <el-button size="small" style="background-color: #e6f4ff; border-color: #91caff; color: #1677ff" @click="columnShowAll = !columnShowAll; if(columnShowAll) columnDateRange = null">
                {{ columnShowAll ? '收起' : '全部' }}
              </el-button>
            </div>
          </div>
          <div style="flex: 0 0 auto; display: flex; align-items: center; gap: 8px">
            <el-radio-group v-model="columnHistMode" size="small">
              <el-radio-button value="raw">原始值</el-radio-button>
              <el-radio-button value="delta">增量</el-radio-button>
            </el-radio-group>
            <el-popover placement="bottom" :width="200" trigger="click">
              <template #reference>
                <el-switch size="small" active-text="标签" :model-value="columnShowLikeLabel || columnShowReplyLabel || columnShowFavoriteLabel" />
              </template>
              <div style="display: flex; flex-direction: column; gap: 8px">
                <el-switch v-model="columnShowLikeLabel" size="small" active-text="点赞" />
                <el-switch v-model="columnShowReplyLabel" size="small" active-text="评论" />
                <el-switch v-model="columnShowFavoriteLabel" size="small" active-text="收藏" />
              </div>
            </el-popover>
          </div>
        </div>
        <div style="position: relative">
          <LineChart
            ref="columnChartRef"
            :categories="columnHistDates"
            :values="columnHistSeries"
            :log-mode="columnLogMode"
            :left-axis-log="columnLeftAxisLog"
            :right-axis-log="columnRightAxisLog"
            :unequal-log="true"
            :show-trend-line="true"
            :trend-line-series="[0, 1, 2]"
            @trend-formulas="columnFormulas = $event"
          />
          <div class="chart-controls">
            <div class="chart-controls-left">
              <el-switch v-model="columnLogMode" size="small" active-text="对数" />
              <template v-if="columnLogMode">
                <el-switch v-model="columnLeftAxisLog" size="small" active-text="左轴" />
                <el-switch v-model="columnRightAxisLog" size="small" active-text="右轴" />
              </template>
            </div>
            <div class="chart-controls-right">
              <el-button size="small" @click="columnChartRef?.exportCsv()">
                <el-icon><Download /></el-icon> 导出CSV
              </el-button>
              <el-button size="small" @click="columnChartRef?.saveChart()">
                <el-icon><Picture /></el-icon> 保存PNG
              </el-button>
            </div>
          </div>
        </div>
        <div v-if="columnFormulas.length > 0" style="margin-top: 8px; padding: 12px 16px; background: var(--bg); border-radius: 6px; text-align: center">
          <div v-for="f in columnFormulas" :key="f.name" style="margin-bottom: 8px; font-size: 14px; display: flex; align-items: center; justify-content: center; gap: 8px">
            <span style="font-weight: 600; color: var(--text-secondary); white-space: nowrap">{{ f.name }}：</span>
            <span v-html="renderLatex(f.formula)"></span>
          </div>
        </div>
        <div style="color: var(--text-secondary); font-size: 12px; margin-top: 4px">
          <template v-if="columnHistMode === 'raw'">点赞（左轴）| 评论/收藏（右轴）</template>
          <template v-else>增量模式：相邻快照差值（不含首日），负值红点标记</template>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { ArrowLeft, Download, Picture } from '@element-plus/icons-vue'
import LineChart from '../components/charts/LineChart.vue'
import type { TrendFormula } from '../components/charts/LineChart.vue'
import BarChart from '../components/charts/BarChart.vue'
import { monitorApi, type UpMetrics, type UpDurationDist, type VideoMetrics, type VideoHistoryPoint } from '../api/monitor'
import { formatNum, formatTimestamp, formatDuration, formatSmartTimestamps, formatRecordDuration } from '../utils/format'
import katex from 'katex'

function renderLatex(latex: string): string {
  try {
    return katex.renderToString(latex, { throwOnError: false, displayMode: true })
  } catch {
    return latex
  }
}

function dynamicTypeName(type: string): string {
  const map: Record<string, string> = {
    DYNAMIC_TYPE_DRAW: '图文',
    DYNAMIC_TYPE_FORWARD: '转发',
    DYNAMIC_TYPE_AV: '视频',
    DYNAMIC_TYPE_ARTICLE: '专栏',
    DYNAMIC_TYPE_LIVE: '直播',
    DYNAMIC_TYPE_PGC: '番剧',
    DYNAMIC_TYPE_UGC_SEASON: '合集',
    DYNAMIC_TYPE_WORD: '文字',
    DYNAMIC_TYPE_NONE: '无内容',
  }
  return map[type] || type || '--'
}

const route = useRoute()
const router = useRouter()
const type = route.params.type as string
const target = route.params.target as string
const loading = ref(false)
const refreshing = ref(false)
const intervalMinutes = ref(30)

// 图表 ref
const upChartRef = ref<InstanceType<typeof LineChart> | null>(null)
const videoChartRef = ref<InstanceType<typeof LineChart> | null>(null)
const dynamicChartRef = ref<InstanceType<typeof LineChart> | null>(null)
const columnChartRef = ref<InstanceType<typeof LineChart> | null>(null)

// 趋势线公式
const upFormulas = ref<TrendFormula[]>([])
const videoFormulas = ref<TrendFormula[]>([])
const dynamicFormulas = ref<TrendFormula[]>([])
const columnFormulas = ref<TrendFormula[]>([])

// 日期范围筛选
const upDateRange = ref<[string, string] | null>(null)
const videoDateRange = ref<[string, string] | null>(null)
const dynamicDateRange = ref<[string, string] | null>(null)
const columnDateRange = ref<[string, string] | null>(null)
const upShowAll = ref(false)
const videoShowAll = ref(false)
const dynamicShowAll = ref(false)
const columnShowAll = ref(false)

// 对数模式
const upLogMode = ref(false)
const upLeftAxisLog = ref(true)
const upRightAxisLog = ref(true)
const videoLogMode = ref(false)
const videoLeftAxisLog = ref(true)
const videoRightAxisLog = ref(true)
const dynamicLogMode = ref(false)
const dynamicLeftAxisLog = ref(true)
const dynamicRightAxisLog = ref(true)
const columnLogMode = ref(false)
const columnLeftAxisLog = ref(true)
const columnRightAxisLog = ref(true)

// UP 曲线标签独立控制
const upShowPlayLabel = ref(false)
const upShowDanmakuLabel = ref(false)
const upShowCommentLabel = ref(false)

// 视频曲线标签独立控制
const videoShowPlayLabel = ref(false)
const videoShowDanmakuLabel = ref(false)
const videoShowCommentLabel = ref(false)

// 动态曲线标签独立控制
const dynamicShowLikeLabel = ref(false)
const dynamicShowReplyLabel = ref(false)
const dynamicShowForwardLabel = ref(false)

// 专栏曲线标签独立控制
const columnShowLikeLabel = ref(false)
const columnShowReplyLabel = ref(false)
const columnShowFavoriteLabel = ref(false)

// UP 数据
const upMetrics = ref<UpMetrics | null>(null)
const upHistory = ref<any[]>([])
const durationDist = ref<UpDurationDist[]>([])
const videoTotal = ref(0)
const videos = ref<any[]>([])
const videoPage = ref(1)
const videoPageSize = ref(10)
const videoSortBy = ref('created')

// 视频数据
const videoMetrics = ref<VideoMetrics | null>(null)
const videoRealtime = ref<{ play: number; danmaku: number; reply: number } | null>(null)
const videoHistory = ref<VideoHistoryPoint[]>([])

// 动态数据
const dynamicMetrics = ref<any>(null)
const dynamicHistory = ref<any[]>([])

// 专栏数据
const columnMetrics = ref<any>(null)
const columnHistory = ref<any[]>([])

const videoRatio = computed(() => {
  const play = videoRealtime.value?.play ?? videoHistory.value[videoHistory.value.length - 1]?.play ?? 0
  const danmaku = videoRealtime.value?.danmaku ?? videoHistory.value[videoHistory.value.length - 1]?.video_review ?? 0
  const comment = videoRealtime.value?.reply ?? videoHistory.value[videoHistory.value.length - 1]?.comment ?? 0
  return comment > 0 
    ? `${(play / comment).toFixed(1)} : ${(danmaku / comment).toFixed(1)} : 1`
    : '--'
})

function findTimeAtPlay(targetPlay: number, history: VideoHistoryPoint[]): number | null {
  if (history.length < 2) return null
  for (let i = 1; i < history.length; i++) {
    const prev = history[i - 1]
    const curr = history[i]
    if (prev.play <= targetPlay && curr.play >= targetPlay) {
      const ratio = (targetPlay - prev.play) / (curr.play - prev.play)
      return prev.created_at + ratio * (curr.created_at - prev.created_at)
    }
  }
  return null
}

const playTimePercents = computed(() => {
  if (!videoMetrics.value || videoHistory.value.length < 2) return { p50: null, p90: null }
  const first = videoMetrics.value.first_play
  const last = videoMetrics.value.last_play
  const totalPlay = last - first
  if (totalPlay <= 0) return { p50: null, p90: null }
  
  const target50 = first + totalPlay * 0.5
  const target90 = first + totalPlay * 0.9
  const time50 = findTimeAtPlay(target50, videoHistory.value)
  const time90 = findTimeAtPlay(target90, videoHistory.value)
  
  const totalTime = videoMetrics.value.last_seen_at - videoMetrics.value.first_seen_at
  if (totalTime <= 0) return { p50: null, p90: null }
  
  return {
    p50: time50 != null ? Math.round((time50 - videoMetrics.value.first_seen_at) / totalTime * 100) : null,
    p90: time90 != null ? Math.round((time90 - videoMetrics.value.first_seen_at) / totalTime * 100) : null,
  }
})

const name = computed(() => upMetrics.value ? `${target}` : target)

function goVideo(bvid: string) {
  router.push(`/detail/video/${bvid}`)
}

// ── UP 图表：数据更新序列（含 原始值/增量 切换） ──
const upHistMode = ref<'raw' | 'delta'>('raw')

const MAX_CHART_POINTS = 300

function filterByDateRange<T extends { created_at: number }>(data: T[], dateRange: [string, string] | null, showAll: boolean): T[] {
  if (showAll) return data
  if (!dateRange) return data.slice(-MAX_CHART_POINTS)
  const start = new Date(dateRange[0]).getTime()
  const end = new Date(dateRange[1]).getTime()
  return data.filter(h => h.created_at >= start && h.created_at <= end)
}

const filteredUpHistory = computed(() => filterByDateRange(upHistory.value, upDateRange.value, upShowAll.value))

const upHistDates = computed(() => {
  const timestamps = filteredUpHistory.value.map(h => h.created_at)
  const sliced = upHistMode.value === 'delta' ? timestamps.slice(1) : timestamps
  return formatSmartTimestamps(sliced)
})

/**
 * 构造增量系列（含异常间隔断线）：
 * - 增量 = 第 i+1 点值 - 第 i 点值
 * - 若相邻两点时间差 > 设定间隔×1.5 → 该增量点用 null 断线（不展示，跨度过大不可靠）
 * - null 占位保持 x 轴对齐；realMap/markPoints 只收录正常点
 */
function buildDeltaSeries(
  name: string,
  timestamps: number[],
  rawValues: number[],
  color: string,
  yAxisIndex: number,
  intervalMinutes: number,
  showLabel: boolean = false
) {
  const gapLimitMs = intervalMinutes * 60 * 1000 * 1.5
  const slicedTs = timestamps.slice(1)
  const dates = formatSmartTimestamps(slicedTs)
  const delta = rawValues.slice(1).map((v, i) => v - rawValues[i])

  const displayValues: (number | null)[] = []
  const realMap: Record<string, number> = {}
  const markPoints: { coord: [number, number]; value: number }[] = []
  delta.forEach((v, i) => {
    const gap = timestamps[i + 1] - timestamps[i]
    if (gap > gapLimitMs) {
      displayValues.push(null)
      return
    }
    const shown = v < 0 ? 0 : v
    displayValues.push(shown)
    realMap[dates[i]] = v
    if (v < 0) markPoints.push({ coord: [i, 0], value: v })
  })
  return {
    name,
    values: displayValues,
    color,
    yAxisIndex,
    realMap,
    markPoints,
    dates,
    showLabel,
  }
}
const upHistSeries = computed(() => {
  const colors = ['#409eff', '#67c23a', '#e6a23c']
  const labelSwitches = [upShowPlayLabel, upShowDanmakuLabel, upShowCommentLabel]
  const metrics = [
    { name: '总播放', key: 'total_views' as const, idx: 0 },
    { name: '总弹幕', key: 'total_danmaku' as const, idx: 1 },
    { name: '总评论', key: 'total_comments' as const, idx: 2 },
  ]
  return metrics.map(m => {
    const raw = filteredUpHistory.value.map(h => h[m.key] || 0)
    if (upHistMode.value === 'raw') {
      return { name: m.name, values: raw, color: colors[m.idx], yAxisIndex: m.idx === 0 ? 0 : 1, showLabel: labelSwitches[m.idx].value }
    }
    return buildDeltaSeries(
      `${m.name}增量`,
      filteredUpHistory.value.map(h => h.created_at),
      raw,
      colors[m.idx],
      m.idx === 0 ? 0 : 1,
      intervalMinutes.value,
      labelSwitches[m.idx].value
    )
  })
})

const DURATION_COLORS = ['#67c23a', '#67c23a', '#e6a23c', '#e6a23c', '#e6a23c', '#f0a020', '#f56c6c', '#f56c6c', '#d03050', '#a02040']
const durationLabels = computed(() => durationDist.value.map(d => d.label))
const durationValues = computed(() => durationDist.value.map(d => d.value))
const durationColors = computed(() => durationDist.value.map((_, i) => DURATION_COLORS[i % DURATION_COLORS.length]))

const paginatedVideos = computed(() => {
  const start = (videoPage.value - 1) * videoPageSize.value
  return videos.value.slice(start, start + videoPageSize.value)
})

// ── 视频图表（含 原始值/增量 切换） ──
const videoHistMode = ref<'raw' | 'delta'>('raw')

const filteredVideoHistory = computed(() => filterByDateRange(videoHistory.value, videoDateRange.value, videoShowAll.value))

// 增量模式去掉首日（首日无前值）；智能时间标签（同年月日只显示一次日期）
const videoHistDates = computed(() => {
  const timestamps = filteredVideoHistory.value.map(h => h.created_at)
  const sliced = videoHistMode.value === 'delta' ? timestamps.slice(1) : timestamps
  return formatSmartTimestamps(sliced)
})
const videoHistSeries = computed(() => {
  const colors = ['#409eff', '#e6a23c', '#67c23a']
  const labelSwitches = [videoShowPlayLabel, videoShowDanmakuLabel, videoShowCommentLabel]
  const metrics = [
    { name: '播放', key: 'play' as const, idx: 0 },
    { name: '弹幕', key: 'video_review' as const, idx: 1 },
    { name: '评论', key: 'comment' as const, idx: 2 },
  ]
  return metrics.map(m => {
    const raw = filteredVideoHistory.value.map(h => h[m.key])
    if (videoHistMode.value === 'raw') {
      return { name: m.name, values: raw, color: colors[m.idx], yAxisIndex: m.idx === 0 ? 0 : 1, showLabel: labelSwitches[m.idx].value }
    }
    return buildDeltaSeries(
      `${m.name}增量`,
      filteredVideoHistory.value.map(h => h.created_at),
      raw,
      colors[m.idx],
      m.idx === 0 ? 0 : 1,
      intervalMinutes.value,
      labelSwitches[m.idx].value
    )
  })
})

// ── 动态图表（含 原始值/增量 切换） ──
const dynamicHistMode = ref<'raw' | 'delta'>('raw')

const filteredDynamicHistory = computed(() => filterByDateRange(dynamicHistory.value, dynamicDateRange.value, dynamicShowAll.value))

const dynamicHistDates = computed(() => {
  const timestamps = filteredDynamicHistory.value.map(h => h.created_at)
  const sliced = dynamicHistMode.value === 'delta' ? timestamps.slice(1) : timestamps
  return formatSmartTimestamps(sliced)
})
const dynamicHistSeries = computed(() => {
  const colors = ['#409eff', '#e6a23c', '#67c23a']
  const labelSwitches = [dynamicShowLikeLabel, dynamicShowReplyLabel, dynamicShowForwardLabel]
  const metrics = [
    { name: '点赞', key: 'like_count' as const, idx: 0 },
    { name: '评论', key: 'reply_count' as const, idx: 1 },
    { name: '转发', key: 'forward_count' as const, idx: 2 },
  ]
  return metrics.map(m => {
    const raw = filteredDynamicHistory.value.map(h => h[m.key])
    if (dynamicHistMode.value === 'raw') {
      return { name: m.name, values: raw, color: colors[m.idx], yAxisIndex: m.idx === 0 ? 0 : 1, showLabel: labelSwitches[m.idx].value }
    }
    return buildDeltaSeries(
      `${m.name}增量`,
      filteredDynamicHistory.value.map(h => h.created_at),
      raw,
      colors[m.idx],
      m.idx === 0 ? 0 : 1,
      intervalMinutes.value,
      labelSwitches[m.idx].value
    )
  })
})

// ── 专栏图表（含 原始值/增量 切换） ──
const columnHistMode = ref<'raw' | 'delta'>('raw')

const filteredColumnHistory = computed(() => filterByDateRange(columnHistory.value, columnDateRange.value, columnShowAll.value))

const columnHistDates = computed(() => {
  const timestamps = filteredColumnHistory.value.map(h => h.created_at)
  const sliced = columnHistMode.value === 'delta' ? timestamps.slice(1) : timestamps
  return formatSmartTimestamps(sliced)
})
const columnHistSeries = computed(() => {
  const colors = ['#409eff', '#e6a23c', '#67c23a']
  const labelSwitches = [columnShowLikeLabel, columnShowReplyLabel, columnShowFavoriteLabel]
  const metrics = [
    { name: '点赞', key: 'like_count' as const, idx: 0 },
    { name: '评论', key: 'reply_count' as const, idx: 1 },
    { name: '收藏', key: 'favorite_count' as const, idx: 2 },
  ]
  return metrics.map(m => {
    const raw = filteredColumnHistory.value.map(h => h[m.key])
    if (columnHistMode.value === 'raw') {
      return { name: m.name, values: raw, color: colors[m.idx], yAxisIndex: m.idx === 0 ? 0 : 1, showLabel: labelSwitches[m.idx].value }
    }
    return buildDeltaSeries(
      `${m.name}增量`,
      filteredColumnHistory.value.map(h => h.created_at),
      raw,
      colors[m.idx],
      m.idx === 0 ? 0 : 1,
      intervalMinutes.value,
      labelSwitches[m.idx].value
    )
  })
})

async function loadData() {
  loading.value = true
  try {
    // 加载间隔设置（用于增量断线判断）
    try {
      const s = await monitorApi.settings()
      intervalMinutes.value = s.interval_minutes || 30
    } catch { /* 保持默认 */ }
    if (type === 'up') {
      const [status, analysis] = await Promise.all([
        monitorApi.upStatus(target).catch(() => null),
        monitorApi.upAnalysis(target).catch(() => null),
      ])
      upMetrics.value = status
      if (analysis) {
        upHistory.value = analysis.history || []
        durationDist.value = analysis.duration_dist || []
      }
      await loadVideos()
    } else if (type === 'video') {
      const [detail, history] = await Promise.all([
        monitorApi.videoDetail(target).catch(() => null),
        monitorApi.videoHistory(target).catch(() => [] as VideoHistoryPoint[]),
      ])
      videoMetrics.value = detail?.metrics || null
      videoRealtime.value = detail?.realtime || null
      videoHistory.value = history
    } else if (type === 'dynamic') {
      const [detail, history] = await Promise.all([
        monitorApi.dynamicDetail(target).catch(() => null),
        monitorApi.dynamicHistory(target).catch(() => [] as any[]),
      ])
      dynamicMetrics.value = detail?.metrics || null
      if (detail?.realtime) {
        dynamicMetrics.value = { ...dynamicMetrics.value, ...detail.realtime }
      }
      dynamicHistory.value = history
    } else if (type === 'column') {
      const [detail, history] = await Promise.all([
        monitorApi.columnDetail(target).catch(() => null),
        monitorApi.columnHistory(target).catch(() => [] as any[]),
      ])
      columnMetrics.value = detail?.metrics || null
      if (detail?.realtime) {
        columnMetrics.value = { ...columnMetrics.value, ...detail.realtime }
      }
      columnHistory.value = history
    }
  } finally {
    loading.value = false
  }
}

async function loadVideos() {
  const r = await monitorApi.upVideos(target, { page: 1, page_size: 200, sort: videoSortBy.value })
  videos.value = r.items || []
  videoTotal.value = r.total || 0
}

async function refreshNow() {
  const task = await monitorApi.listTasks().then(ts => ts.find(t => t.target === target && t.task_type === type))
  if (!task) {
    ElMessage.warning('未找到对应任务')
    return
  }
  refreshing.value = true
  try {
    await monitorApi.refreshTask(task.id)
    ElMessage.success('刷新完成')
    await loadData()
  } catch (e: any) {
    ElMessage.error(e?.response?.data?.message || '刷新失败')
  } finally {
    refreshing.value = false
  }
}

watch(videoSortBy, () => loadVideos())

// 路由参数变化（如从 UP 详情跳到视频详情）时重新加载，避免组件复用不刷新
watch(
  () => [route.params.type, route.params.target],
  () => {
    window.location.reload()
  }
)

onMounted(loadData)
</script>

<style scoped>
.stat-card {
  background: var(--bg);
  border: 1px solid var(--border);
  border-radius: 6px;
  padding: 10px 14px;
  text-align: center;
}
.stat-card .label { font-size: 12px; color: var(--text-secondary); margin-bottom: 4px; }
.stat-card .value { font-size: 18px; font-weight: 700; }
.chart-controls {
  position: absolute;
  bottom: 30px;
  left: 8px;
  right: 8px;
  display: flex;
  justify-content: space-between;
  align-items: center;
  z-index: 10;
}
.chart-controls-left {
  display: flex;
  gap: 8px;
  align-items: center;
}
.chart-controls-right {
  display: flex;
  gap: 8px;
  align-items: center;
}
</style>
