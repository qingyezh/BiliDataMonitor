# 非自然流量指数算法说明

> **模块**：`src/server/analytics/boostIndex.ts`  
> **接口**：`computeBoostIndex(points) → BoostIndexResult`  
> **API**：`GET /api/video/:bvid/detail` → `data.boostIndex`  
> **UI**：视频详情页「数据变化趋势」曲线图下方；UP 视频排行「异常流量指数」列  
> **版本**：算法 **v5.1 / algo_version=6**（文档随 46h 形态窗 + 残差闸门更新）

---

## 0. 版本摘要（v5.1）

| 项 | 说明 |
|----|------|
| 分析窗 | 仍取监测序列 **前 48h**（超额积分用全程） |
| 形态检测窗 | **0–46h**（尾部 **2h 保护带**，消窗口末端伪影） |
| 主跃升/断崖 | 滤波速率 \(x\) 上（与 v4 一致），绝对量门槛 |
| 残差闸门 | 去小时效应后倍率作 **门控**，不替代主检测 |
| 冷启动 | 峰值后降至 \(\max(25\%\cdot peak,\ 1.2\cdot med)\)，且至少约 1h |
| 负增量 | \(Δplay<0\) 整点剔除；3 点中值滤波 |
| 存储 | `video_boost_index`，**6h 时间分桶**重算，48h 后冻结；`?boost_recalc=1` / UP「刷新指数」强制重算 |

### 为何需要残差闸门

强日周期下，「凌晨低谷 → 午间高峰」在原始增速上可算出 10×+ 倍率（如 `BV1sjen6QEQ7` 曾报 15.2×）。  
倍率必须在 **去小时效应的残差** 上复核；若残差失真（小时基线被事件污染）而 **raw 跃升明确且节律低**，则不得重罚。

---

## 1. 问题定义

### 1.1 目标

在只有 **播放量、弹幕数、评论数**（约每 5 分钟一组监测快照）的条件下，估计某视频是否存在 **人工强推 / 买量 / 投流**，并输出一个可解释的连续指标：

\[
\boxed{\text{非自然流量指数 } S \in [0,100]}
\]

- **数值越大** → 人工强推/买量可能性越高  
- **数值越小** → 更接近自然传播形态  

### 1.2 与「自然流量」的形态差异（经验前提）

| 维度 | 自然传播 | 人工强推/投流 |
|------|----------|----------------|
| 冷启动 | 粉丝脉冲后 **单调衰减** | 衰减被打断 |
| 峰形 | **缓升缓降**（小时级） | **阶跃跃升**（亚小时级） |
| 高位 | 无持续平台 | **数小时不衰减的供给平台** |
| 结束 | 渐降 / 随活跃时段回落 | **断崖式下跌**（投放停止） |
| 日节律 | 与 12–14 / 18–23 吻合 | 起止时刻任意，常抹平节律 |
| 三线 | 播/弹/评 **按稳定比例共动** | 真实买量时常 **同步跳变** |

### 1.3 明确不做的事

- **不是执法结论**，只是统计形态研判  
- 不爬取 B 站投放后台、不依赖「是否买量」标签  
- 不写库、不在调度时预计算（打开详情时现算）  
- 不区分「官方资源位 / 算法推荐二波 / 商业起飞」——统称 **非自然/非常规供给**

---

## 2. 输入数据

### 2.1 字段

来自 `video_history`（`listVideoHistoryLeading(bvid, 48)`）：

| 字段 | 含义 | 单位 |
|------|------|------|
| `play` | 累计播放 | 次 |
| `video_review` | 累计弹幕 | 条 |
| `comment` | 累计评论 | 条 |
| `created_at` | 采集时刻 | 毫秒时间戳 |

### 2.2 采样间隔（实测）

| 统计 | 间隔 |
|------|------|
| 标称 | 5 分钟 = 300s |
| p50 | ≈ 304.7s（5min+4.7s） |
| 5min±10s 覆盖率 | ≈ 96.5% |
| 其余 | 漏采（>5.5min）或近重复脏点 |

**因此：不做死板 5 分钟分桶，一律用实际 \(\Delta t\) 归一速率。**

### 2.3 样本量门槛

| 条件 | 要求 | 不满足时 |
|------|------|----------|
| 原始点数 | ≥ 24 | `insufficient = 样本不足`，`score = 0` |
| 增量点数 | ≥ 22 | `insufficient = 增量点不足` |
| 前 48h 窗口内点数 | ≥ 24 | `insufficient = 前48h样本不足` |

---

## 3. 预处理

### 3.1 近重复清洗

相邻两快照若

\[
t_i - t_{i-1} < 2\,\mathrm{s}
\]

视为脏点（同一时刻双写），**丢弃后点**。

### 3.2 时间窗口

以清洗后 **首点** 为锚：

\[
W = \{\, p \mid t(p) \le t_0 + 48\,\mathrm{h} \,\}
\]

即「监测序列的前 48 小时」。  
> 若监测晚于发布很久，这里仍是「监测前 48h」，不是严格「发布后 48h」；对老视频中后期曲线同样适用。

### 3.3 速率序列（核心变换）

对相邻快照 \(a,b\)：

\[
\Delta t = t_b - t_a \quad (\mathrm{s})
\]

\[
v^{(P)} = \frac{P_b - P_a}{\Delta t} \times 300, \quad
v^{(D)} = \frac{D_b - D_a}{\Delta t} \times 300, \quad
v^{(C)} = \frac{C_b - C_a}{\Delta t} \times 300
\]

含义：**归一到「标称 5 分钟」口径下的播放/弹幕/评论增量速率**。  
后续所有形态检测均在 \(v^{(P)}\)（记作序列 \(x\)）上进行；\(v^{(D)}, v^{(C)}\) 用于共动分析。

记增量序列长度为 \(n\)，时间戳序列为 \(t_i\)。

### 3.4 冷启动跳过（v5.1）

为避免发布脉冲与后续日周期混淆：

\[
\text{dropTo}=\max(0.25\cdot earlyMax,\ 1.2\cdot \mathrm{median}(x))
\]

自峰值后至少约 1h（≥12 点）起，首次满足 \(x_i<\text{dropTo}\) 的下标作为形态搜索起点 `start`。

### 3.5 形态窗与保护带（v5.1）

- 超额积分 \(E\)：**0–48h 全程**  
- 跃升 / 断崖 / 平台 / 三线共跳：仅在 **`[start, shapeEnd)`**，其中 `shapeEnd` 为 **首点+46h**  
- 尾部 2h **不参与形态判定**，避免把窗口截断伪影当成「持续供给」

---

## 4. 形态特征与公式

### 4.1 滑动窗均值

对序列 \(x\)、位置 \(i\)、半窗 \(k=3\)：

\[
\mathrm{mean}_{\mathrm{before}}(i)=\frac{1}{|B|}\sum_{j\in B}x_j,\quad
B=[\max(0,i-k),\ \max(1,i))
\]

\[
\mathrm{mean}_{\mathrm{after}}(i)=\frac{1}{|A|}\sum_{j\in A}x_j,\quad
A=[i,\ \min(n,i+k))
\]

### 4.2 跃升倍率 \(J\) 与断崖倍率 \(C\)（主检测，在滤波速率 \(x\) 上）

对 \(i\) 在 \([start,\ shapeEnd)\) 上（半窗 \(k=3\)）：

\[
J(i)=\frac{\mathrm{mean}_{\mathrm{after}}(i)}{\max(\mathrm{mean}_{\mathrm{before}}(i),\ 0.08\cdot\mathrm{median}(x))}
\]

\[
C(i)=\frac{\mathrm{mean}_{\mathrm{before}}(i)}{\max(\mathrm{mean}_{\mathrm{after}}(i),\ 0.08\cdot\mathrm{median}(x))}
\]

**绝对量门槛：** 仅当 \(\mathrm{mean}_{\mathrm{after}}\ge 2\cdot\mathrm{median}(x)\) 才接受为跃升；断崖要求前窗对称达标。

取全局最大得 \(\mathrm{jumpR},\mathrm{cliffR}\) 及对应下标。

### 4.2b 残差闸门（v5.1，防日周期假跃升）

小时效应（**P30**，避免事件抬高基线；\(s_h\) 封顶 3）：

\[
s_h=\frac{Q_{0.3}\{x_t\mid \mathrm{hour}=h\}}{\mathrm{median}_h\{Q_{0.3}\}}
\]

残差：

\[
r_t=\frac{x_t}{s_{\mathrm{hour}(t)}}
\]

残差跃升倍率（在同一 jumpI 上算）：

\[
J_{\mathrm{resid}}=\frac{\mathrm{mean}(r)_{\mathrm{after}}}{\max(\mathrm{mean}(r)_{\mathrm{before}},\ 0.12\cdot\mathrm{median}(r))}
\]

**门控 \(\mathrm{residGate}\in\{1,0.85,0.75,0.55,0.25\}\)：**

| 条件 | gate |
|------|------|
| \(J_{\mathrm{resid}}\ge 1.8\) 且 \(W_{\mathrm{up}}\le 5\) | 1 |
| \(J_{\mathrm{resid}}\ge 1.2\) | 0.75 |
| 节律低且 raw \(J\ge 2\)（残差可能失真） | 0.85 |
| 节律低 | 0.55 |
| 节律高且残差无跃升 | 0.25 |

\[
j_S = \mathrm{clip}\Big(\frac{J-1.2}{3.5}\Big)\cdot \mathrm{residGate}
\]

**解读：**  
- `BV1sjen6QEQ7` 类「早→午」在残差上倍率塌缩 → 重罚  
- `BV1Vj8K6DEFM` 类 raw 有跃升但小时基线被污染 → **不重罚**  

### 4.3 上升沿宽度 \(W_{\mathrm{up}}\)

从 \(\mathrm{jumpI}\) 向左回溯，只要 \(x_{j-1}\le x_j\) 就继续：

\[
W_{\mathrm{up}} = \mathrm{jumpI} - j^*,\quad
j^*=\min\{\, j \mid x_{j-1}>x_j \,\}
\]

| \(W_{\mathrm{up}}\) | 形态 |
|---------------------|------|
| 0–2（≈10 分钟） | **阶跃** → 更像人为 |
| ≥ 8（≈40 分钟） | **缓升** → 更像节律/自然波 |

### 4.4 高位平台 \(P_{\mathrm{plat}}\)

从 \(\max(0,\mathrm{jumpI})\) 起向右贪心扩展窗口 \([i,j)\)，满足：

\[
\mu_L=\mathrm{mean}(x_{[i,i+h)}),\quad
\mu_R=\mathrm{mean}(x_{[i+h,j)}),\quad
h=\lfloor (j-i)/2\rfloor
\]

**平台成立条件：**

\[
\mu_L > 0.5 \quad\land\quad \frac{\mu_R}{\mu_L}\ge 0.55
\]

（后半段均值不低于前半的 55%，即 **没有明显衰减**）

**平台强度：**

\[
P_{\mathrm{plat}} = \frac{\mu_L}{\mathrm{median}(x)}\cdot\frac{L}{n},\quad L=j-i
\]

同时记录：

- \(\mathrm{platLen}=L\)（平台长度，点数）  
- \(\mathrm{platDecay}=\mu_R/\mu_L\)（衰减比，越接近 1 越「平」）  
- 实现里 `plat.score` 即上式 \(P_{\mathrm{plat}}\)

### 4.5 节律校正超额积分 \(E\)（程度主指标）

#### 4.5.1 局部有机包络

对每个 \(i\)，取窗 \(w=7\)，窗口内 \(x\) 的 **20% 分位** 作为「本应有的有机水平」：

\[
\hat{x}^{\mathrm{raw}}_i = Q_{0.2}\!\left(\{x_j \mid |j-i|\le 7\}\right)
\]

用低分位而非均值，是为了 **不被局部买量高峰抬高基线**。

#### 4.5.2 小时节律倍率

按本地小时 \(h(t_i)\) 分组：

\[
r_i = \frac{x_i}{\max(\hat{x}^{\mathrm{raw}}_i, 10^{-6})}
\]

\[
s_h = \mathrm{median}\{\, r_i \mid h(t_i)=h \,\}
\]

归一（使整体中位数为 1）：

\[
\tilde{s}_h = \frac{s_h}{\mathrm{median}\{\, s_{h'} \,\}}
\]

#### 4.5.3 超额比

\[
\hat{x}_i = \hat{x}^{\mathrm{raw}}_i \cdot \tilde{s}_{h(t_i)}
\]

\[
E = \frac{\sum_i \max(x_i - \hat{x}_i,\ 0)}{\sum_i x_i}
\in [0,1]
\]

**解读：** 播放增量中，有多少比例 **超出「有机 + 日节律」预期**。  
- \(E\) 高 → 有大量「多出来的」供给（投流程度的代理变量）  
- 图3 类自然曲线 \(E\) 较低；图2 类平台会抬高 \(E\)

> 对应 UI 中的「超额 {{ parts.excess }}」及证据「超额播放偏高」。

### 4.6 加速度尖峰 \(A\)

二阶差分（离散加速度）：

\[
d^{(2)}_i = x_{i+1} - 2x_i + x_{i-1},\quad i=1,\ldots,n-2
\]

稳健尺度（MAD）：

\[
\mathrm{med} = \mathrm{median}(d^{(2)}),\quad
\mathrm{MAD} = \mathrm{median}(|d^{(2)}-\mathrm{med}|)
\]

\[
A = \frac{\max_i |d^{(2)}_i - \mathrm{med}|}{1.4826\cdot \mathrm{MAD} + 10^{-6}}
\]

\(A\) 大 → 存在尖锐拐点（跃升/断崖瞬间）。

### 4.7 三线共动

#### 4.7.1 共跳标记 \(\mathrm{coJump}\)

分别对 \(v^{(D)}, v^{(C)}\) 用与 4.2 相同的 `detectStep`，得到弹幕/评论的跃升下标 \(i_D, i_C\)。

\[
\mathrm{coJump}=
\begin{cases}
1, & \exists\, i\in\{i_D,i_C\},\ i\ge 0 \land |i-\mathrm{jumpI}|\le 6 \\
0, & \text{otherwise}
\end{cases}
\]

（6 个采样点 ≈ 30 分钟内同步跳变）

#### 4.7.2 滑动相关 \(\rho_D,\rho_C\)

对 \(v^{(P)}\) 与 \(v^{(D)}\)（及 \(v^{(C)}\)）标准化后，在窗长 \(9\)、步长 \(3\) 上算皮尔逊相关并平均：

\[
\rho = \frac{1}{|T|}\sum_{t\in T}\mathrm{corr}\big(z(P)_t,\ z(M)_t\big)
\]

\[
\mathrm{syncAvg}=\frac{\rho_D+\rho_C}{2}
\]

共动子分（0–1）：

\[
S_{\mathrm{co}} = \mathrm{clip}_{[0,1]}\!\left(
0.6\cdot \mathrm{coJump} + 0.4\cdot \frac{\mathrm{syncAvg}+1}{2}
\right)
\]

---

## 5. 子分归一（全部压到 \([0,1]\)）

\[
\mathrm{clip}_{[0,1]}(v)=\max(0,\min(1,v))
\]

| 符号 | 公式 | 含义 |
|------|------|------|
| \(j_S\) | \(\mathrm{clip}\big((\mathrm{jumpR}-1.2)/3.5\big)\) | 跃升 |
| \(c_S\) | \(\mathrm{clip}\big((\mathrm{cliffR}-1.2)/3.5\big)\) | 断崖 |
| \(p_S\) | \(\mathrm{clip}\big(P_{\mathrm{plat}}/1.5\big)\) | 平台 |
| \(e_S\) | \(\mathrm{clip}\big(E/0.2\big)\) | 超额积分 |
| \(a_S\) | \(\mathrm{clip}\big(A/12\big)\) | 加速度 |
| \(\mathrm{step}_S\) | \(\mathrm{clip}\big((1-\min(W_{\mathrm{up}},16)/16)\cdot j_S\big)\) | 阶跃（短上升沿 × 大跃升） |

### 5.1 四个聚合子分

**形态分**

\[
S_{\mathrm{shape}} = \mathrm{clip}_{[0,1]}\big(
0.38\, j_S + 0.22\, p_S + 0.22\, c_S + 0.18\, \mathrm{step}_S
\big)
\]

**超额分**

\[
S_{\mathrm{excess}} = e_S
\]

**辅助分**

\[
S_{\mathrm{aux}} = \mathrm{clip}_{[0,1]}\big(
0.55\, a_S + 0.25\, j_S + 0.20\, \mathrm{coJump}
\big)
\]

**共动分** \(S_{\mathrm{co}}\)（见 4.7）

---

## 6. 节律惩罚

### 6.1 节律得分 \(R\)

\[
\mathrm{activeHour}=
\begin{cases}
1, & h(\mathrm{jumpI})\in[12,14]\cup[18,23] \\
0, & \text{otherwise}
\end{cases}
\]

\[
\mathrm{slowRise}=
\begin{cases}
1, & W_{\mathrm{up}}\ge 8 \\
0, & \text{otherwise}
\end{cases}
\]

\[
R = 0.5\cdot \mathrm{activeHour} + 0.5\cdot \mathrm{slowRise} \in [0,1]
\]

### 6.2 惩罚项

\[
\mathrm{rhythmPenalty} = 0.3\, R
\]

\[
S' = \big(0.4\,S_{\mathrm{shape}} + 0.35\,S_{\mathrm{excess}} + 0.15\,S_{\mathrm{aux}} + 0.10\,S_{\mathrm{co}}\big)
\cdot (1 - \mathrm{rhythmPenalty})
\]

**设计意图：** 同样大小的「抬升」，若 **落在晚高峰且是缓升**，更可能是人体节律/自然推荐，故降权；若 **任意时刻阶跃**，不惩罚。

---

## 7. 综合指数

### 7.1 连续分

\[
S_{\mathrm{raw}} = 100 \cdot S'
\]

### 7.2 强规则修正（v5.1：须过残差闸门）

| 规则 | 条件 | 操作 |
|------|------|------|
| **强投流** | \(J\ge 2.5 \land W\le 4 \land C\ge 2.5 \land \mathrm{diurnal}<0.55 \land J_{\mathrm{resid}}\ge 1.8\) | \(S{+}{=}15\) |
| **干净阶跃断崖** | 上式且 \(J\ge 3 \land C\ge 2.5 \land W\le 3 \land J_{\mathrm{resid}}\ge 2.2\) | 再 \(+8\) |
| **阶跃+长台** | \(J\ge 2.2 \land\) 平台 ≥48 点 \(\land J_{\mathrm{resid}}\ge 1.6\) | \(+6\) |
| **强自然** | 无跃升无断崖且节律高，或 \(\mathrm{diurnal}\ge 0.75\) | \(S{-}{=}18\) |
| **假跃升抑制** | \(J\ge 2 \land J_{\mathrm{resid}}<1.5\) | 额外 \(-10\) |

对应直观图像：

- **图2 型**（阶跃 + 平台 + 断崖）→ 强投流抬分  
- **图3 型**（平滑衰减 + 节律缓峰）→ 强自然压分  

### 7.3 最终裁剪

\[
\boxed{\ S = \mathrm{round}\big(\max(0,\min(100, S))\big)\ }
\]

### 7.4 等级映射

| \(S\) | `level` | UI 文案 | 颜色 |
|-------|---------|---------|------|
| 0–39 | `low` | 较低 | 绿 |
| 40–69 | `medium` | 中等 | 橙 |
| 70–100 | `high` | 较高 | 红 |

---

## 8. 完整计算流水线

```text
video_history 前48h 快照
        │
        ▼
近重复清洗 (Δt<2s) ──► 点数 <24? ──► insufficient
        │
        ▼
按实际 Δt 归一 5min 速率 x, vD, vC
        │
        ├─► detectStep(x) ──► jumpR, cliffR, jumpI
        ├─► riseWidth ──► W_up
        ├─► plateauScore ──► P_plat, platLen, platDecay
        ├─► excessRatio(节律校正) ──► E
        ├─► accelSpike(二阶差分MAD) ──► A
        └─► detectStep(vD,vC) + corr ──► coJump, syncAvg
        │
        ▼
子分 jS,cS,pS,eS,aS,stepS
        │
        ▼
S_shape, S_excess, S_aux, S_co
        │
        ▼
节律 R → 惩罚 0.3R
        │
        ▼
S' = 0.4·shape + 0.35·excess + 0.15·aux + 0.10·co
        │
        ▼
×100 → 强规则 ±12/±15 → clip[0,100] → score
        │
        ▼
证据列表 evidence[]（跃升/平台/断崖/超额/共跳/节律）
```

---

## 9. 输出结构

```ts
interface BoostIndexResult {
  score: number              // 0-100
  level: 'low' | 'medium' | 'high'
  levelText: string          // 较低 / 中等 / 较高
  sampleCount: number        // 增量点数
  windowHours: 48
  parts: {
    shape: number            // 形态 0-100
    excess: number           // 超额 0-100
    aux: number              // 加速度/辅助 0-100
    co: number               // 三线共动 0-100
    rhythmPenalty: number    // 节律降权百分比 0-30
  }
  evidence: { key, label, detail }[]
  insufficient?: string      // 数据不足时的说明
}
```

### 9.1 证据触发阈值

| key | 条件 | 展示 |
|-----|------|------|
| `jump` | \(\mathrm{jumpR}\ge 2\) | 播放增速跃升 |
| `plateau` | \(P_{\mathrm{plat}}\ge 0.3 \land \mathrm{platLen}\ge 12\) | 高位平台 |
| `cliff` | \(\mathrm{cliffR}\ge 2.5\) | 断崖式回落 |
| `excess` | \(E\ge 0.15\) | 超额播放偏高 |
| `co` | \(\mathrm{coJump}=1\) | 三线同步跳变 |
| `rhythm` | \(R\ge 0.7 \land \mathrm{jumpR}<2.5\) | 符合日节律（偏自然） |
| `flat` | 以上皆无 | 形态平稳 |

---

## 10. 参数总表

| 参数 | 取值 | 作用 |
|------|------|------|
| `WINDOW_MS` | 48h | 分析窗口 |
| `NOMINAL_DT_S` | 300 | 速率归一口径 |
| `MIN_POINTS` | 24 | 最少快照 |
| 近重复阈值 | 2s | 脏点丢弃 |
| 滑动窗 \(k\) | 3 | 跃升/断崖 |
| 平台 `minLen` | 6 | 最短平台 |
| 平台衰减阈 | 0.55 | \(\mu_R/\mu_L\) |
| 包络窗 \(w\) | 7 | 20% 分位 |
| 加速度 MAD 系数 | 1.4826 | 正态等价 |
| 共跳容差 | 6 点 | ≈30min |
| 相关窗/步 | 9 / 3 | 共动 |
| 形态权重 | 0.35/0.25/0.20/0.20 | j/p/c/step |
| 综合权重 | 0.40/0.35/0.15/0.10 | shape/excess/aux/co |
| 节律惩罚 | 0.3 | \(R\) |
| 强投流加成 | +12 | 见 7.2 |
| 强自然扣分 | −15 | 见 7.2 |
| 等级边界 | 40 / 70 | low/medium/high |

---

## 11. 本地验证（8.20 后 31 条，v5.1）

| 视频 | v4 | v5.1 | 说明 |
|------|-----|------|------|
| BV1sjen6QEQ7 | 53 | **25** | 假 15× 跃升消除（jumpR 2.07） |
| BV1SZhk6HEXw | 42 | **22** | 午间节律压低（已确认合理） |
| BV1Vj8K6DEFM | 60 | **60** | 残差失真修复后不再误压 |
| BV1e58P65EmC | 39 | **26** | 下降正常 |
| BV1sdYZ6dEmq | 33 | **21** | 下降正常 |
| BV1yjYx6AEp7 | 75 | **76** | 真投流保持 |
| BV1sAbL6tEEC | 87 | **89** | 强投流保持 |
| BV13Xew6LE7T | 38 | **36** | 自然衰减保持低分 |

全样本：|Δ|≥5 仅上述 5 条已确认项，其余 26 条均在误差内；≥70 约 2 条；均分 ≈39。

---

## 12. 算法族对比（为何这样融合）

在 28 条前 48h 上 Spearman 相关：

| 方案 | 与「跃升/断崖」相关 | 特点 |
|------|---------------------|------|
| S1 跃升/断崖 | — | 对应图2 最强 |
| S2 线性拟合+二阶差分 | 0.35 | 不稳定，只作辅助 |
| S3 超额积分 | **0.21** | 与形状 **正交**，抓「持续偏高」 |
| S4 形状三件套 | 0.98 | 与 S1 同源 |
| S5 综合 | 0.91 | 本实现 |

**结论：** 形状分负责「是不是阶跃开关」，超额分负责「是不是多出来很多流量」，节律惩罚负责「是不是只是晚高峰」。三者缺一都会误判。

---

## 13. 局限与使用建议

### 13.1 已知局限

1. **无法区分** 商业买量 / 官方资源位 / 算法强推——都算「非自然/非常规」  
2. **监测起始** 若不在发布后数小时内，窗口是「监测前 48h」  
3. **高体量自然爆款**（版本 PV、直播）也可能中等分——需结合内容类型  
4. **仅播放/弹幕/评论**，若以后并入点赞率/投币率/完播率，区分度会再升一档  
5. 阈值为启发式，**不是**在大规模标注集上校准的分类器  

### 13.2 使用建议

| score | 建议表述 |
|-------|----------|
| ≥70 | 强烈建议对照曲线看证据列表；「阶跃+平台+断崖」三件套很典型 |
| 40–69 | 结合 `evidence`：若有 `excess` 无 `jump`，可能是持续供给而非单次投放 |
| <40 | 形态接近自然；仍可能有轻度推流被噪声淹没 |
| `insufficient` | 先保证至少约 2h（≥24 点）有效监测再解读 |

### 13.3 后续可迭代方向

- 用标注样本校准：`jumpR` 阈、平台长度、40/70 分界  
- 贝叶斯在线变点，支持准实时告警  
- 同 UP 历史基线对比（个体化期望）  
- 引入互动率残差，抑制「只刷播放」误判  

---

## 14. 相关文件

| 路径 | 说明 |
|------|------|
| `src/server/analytics/boostIndex.ts` | 算法实现 |
| `src/server/database.ts` | `listVideoHistoryLeading` |
| `src/server/routes/video.ts` | detail API 注入 `boostIndex` |
| `src/frontend/src/views/Detail.vue` | 曲线图下方卡片 |
| `scripts/smoke_boost_server.mjs` | 服务器冒烟脚本 |
| `scripts/DEPLOY_BOOST_INDEX.md` | 部署与防双开 |
| `scripts/validate_boost_index.mjs` | 本地批量验证 |

---

## 15. 一页速查

\[
S = 100\cdot(0.4\,S_{\mathrm{shape}}+0.35\,E_S+0.15\,S_{\mathrm{aux}}+0.1\,S_{\mathrm{co}})\cdot(1-0.3R)
\]

再对「阶跃+断崖」+12，对「缓升+节律」−15，裁剪到 \([0,100]\)。

- **形状** 看开关：跃升 \(J\)、平台 \(P\)、断崖 \(C\)、上升沿 \(W\)  
- **超额** 看程度：节律校正残差正积分占比 \(E\)  
- **节律** 做减法：晚高峰缓升 → 不是买量  
- **三线** 做印证：播/弹/评同跳 → 真实流量灌入  
