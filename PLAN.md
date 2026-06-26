# Vocab-Galaxy 实现计划书（交付给执行 AI）

> 这是一份**自包含**的实现规格。执行者只需读这份文档 + `data_src/` 里的数据文件，
> 即可生成整个网站。**凡是文档写死的数值/字段/规则，不要自行更改或"优化"。**
> 遇到本文档没覆盖的细节，按"约束原则"就近决定，不要引入后端、构建工具或框架。

---

## 0. 项目目标与硬约束

**目标**：一个帮助用户把英语词汇量从 ~5000 提升到 ~20000 的背单词工具。用户已掌握最高频 ~5000 词，
本工具覆盖词频排名 **5000–20000** 这一段。不为应试，为全面语言能力，但当前阶段**只做"词汇 + 复习"**，
听说读写的其他模块以后再说。

**效率三支柱（必须落实，不能退化成"看词表"）**：
1. **调度**：只在"快要忘"的时刻复习 → SRS 算法（见 §5）。
2. **主动回忆**：先考自己再看答案 → 卡片必须先隐藏答案（见 §6）。
3. **编码质量**：词根/联想/语境 → 词缀、例句（见 §6 各模态）。

**硬约束**：
- 纯静态网站。**无后端、无数据库、无登录**。状态全部存 `localStorage`。
- **无构建工具**（不用 webpack/vite/npm build）。直接 `<script>` 引入 ES 模块或普通脚本，双击 `index.html` 或本地静态服务器即可运行。
- 第三方库只允许通过 **CDN** 引入（如 ts-fsrs、Chart.js）。
- 风格沿用姊妹项目 knowledge-universe 的 `universe.css`（卡片化、蓝色主色 `#2563eb`、圆角、浅灰背景）。
- 中文界面。代码注释中文即可。

---

## 1. 教学法依据 → 功能映射（保留"为什么"，别把功能做没了）

| 循证方法 | 证据 | 对应功能 |
|---|---|---|
| 间隔重复 Spaced Repetition | Ebbinghaus 遗忘曲线；分散 > 集中 | FSRS 调度器，每词算"记忆稳定度"，到临界才复习 |
| 检索练习 Testing Effect | Roediger & Karpicke 2006 | 卡片正面只给提示，**先回忆再翻面** |
| 合意困难 Desirable Difficulty | Bjork | 用户自评回忆质量（Again/Hard/Good/Easy）驱动调度 |
| 生成效应 Generation Effect | 产出 > 识别 | 词缀拼装、例句挖空（让用户"产出"而非"认") |
| 双重编码 Dual Coding | Atkinson 关键词法、词源 | 卡背显示词根词缀拆解 + 含义 |
| 语境学习 Context / i+1 | 可理解输入 | 例句挖空，在句子里考词 |
| 交错 Interleaving | 混合 > 分块 | 复习队列跨 band 混排，不按字母序 |

> 执行者注意：**不要**做成"翻列表 + 标记已学"。每次出现一个词，必须是一次"主动回忆测试"。

---

## 2. 目录结构（按此创建）

```
vocab-galaxy/
├── PLAN.md                      ← 本文档
├── index.html                   ← 首页/仪表盘
├── review.html                  ← 复习页（核心）
├── browse.html                  ← 词库浏览/搜索
├── stats.html                   ← 统计页
├── build_wordlist.py            ← 数据生成脚本（见 §3，可直接运行）
├── data_src/                    ← 原始数据（已下载，见 §3）
│   ├── ecdict.csv               (66MB，英中词典+词频)
│   ├── wordroot.txt             (词根词缀 JSON)
│   └── lemma.en.txt             (词形还原表)
└── assets/
    ├── css/  universe.css       ← 从 knowledge-universe 复制；如取不到按 §9 自写
    ├── js/
    │   ├── data.js              ← 加载 words/meta，提供查询 API
    │   ├── srs.js               ← 调度器（FSRS，见 §5）
    │   ├── store.js             ← localStorage 读写（见 §8）
    │   ├── review.js            ← 复习引擎 + 四种出题模态（见 §6）
    │   ├── dashboard.js         ← 首页渲染
    │   ├── browse.js            ← 词库浏览/搜索
    │   └── stats.js             ← 统计图表
    └── data/                    ← build_wordlist.py 的产物
        ├── meta.json            ← band 列表、总数、生成时间
        ├── words.json           ← 全部词条（浏览/搜索用）
        ├── bands/band-5.json …  ← 分 band 词条（复习按需加载）
        └── affixes.json         ← 词根前后缀（Phase 3 用）
```

---

## 3. 数据管线（最易出错，已写死规则；脚本可直接运行）

### 3.1 数据来源（已下载到 `data_src/`，若缺失用这些命令重下）
```
curl -sL -o data_src/ecdict.csv   https://raw.githubusercontent.com/skywind3000/ECDICT/master/ecdict.csv
curl -sL -o data_src/wordroot.txt https://raw.githubusercontent.com/skywind3000/ECDICT/master/wordroot.txt
curl -sL -o data_src/lemma.en.txt https://raw.githubusercontent.com/skywind3000/ECDICT/master/lemma.en.txt
```

### 3.2 ECDICT 列含义（`ecdict.csv` 表头）
`word, phonetic, definition, translation, pos, collins, oxford, tag, bnc, frq, exchange, detail, audio`
- `phonetic` 音标（无斜杠）。`translation` 中文释义（多行，含 `\n`，可能有 `[网络]`/`[化]` 等噪声行）。
- `collins` 柯林斯星级 1–5（5 最常用，空=无）。`oxford` 牛津 3000 核心词标记（1/空）。
- `tag` 考试标签：`zk`中考 `gk`高考 `cet4` `cet6` `ky`考研 `toefl` `ielts` `gre`（空格分隔）。
- `frq` **COCA 词频排名**（1=最高频，0=未排名）。**这是分层依据**。
- `exchange` 词形变化，`/` 分隔。其中 `0:LEMMA` 表示该词是 LEMMA 的变形（如 `running` 的 `0:run`）。

### 3.3 过滤规则（**严格按此，勿改**）
一个词条入选，当且仅当全部满足：
1. `word` 匹配正则 `^[a-z]+$`（纯小写字母，排除短语/连字符/专名/缩写）。
2. `len(word) >= 3`。
3. `translation` 非空。
4. `5001 <= frq <= 20000`（用户已会 ~5000，本工具只覆盖这段）。
5. **剔除变形词**：若 `exchange` 含 `0:LEMMA` 且 `LEMMA != word`，丢弃（只保留原形，避免把 running/runs 当独立词教）。

### 3.4 字段清洗
- `tr`（中文）：把 `translation` 按 `\n` 切行，丢弃空行和以 `[` 开头的行，取前 2 行用 ` ` 连接，截断到 80 字符。
- `ph`：取 `phonetic`，原样保留（可能为空）。
- `tag`：原样保留（空格分隔字符串）。
- `band`：`frq // 1000`（如 frq=8148 → band 8）。band 标题形如 `"Rank 8000–8999"`。

### 3.5 产物 schema
**`assets/data/words.json`**（数组，按 frq 升序）：
```json
[{"w":"ubiquitous","ph":"juːˈbɪkwɪtəs","tr":"a. 无所不在的, 普遍存在的","pos":"a","frq":8148,"band":8,"tag":"gre","co":1,"ox":0}, …]
```
字段：`w`单词 `ph`音标 `tr`中文 `pos`词性(从 tr 第一个缩写推断，可空) `frq`频率排名 `band`层 `tag`考试标签 `co`柯林斯星级(int,0空) `ox`牛津标记(0/1)。
单词字符串 `w` 即唯一主键。

**`assets/data/bands/band-N.json`**：同结构，但只含该 band 的词。复习时按需只加载当前 band，避免一次性载入全部一万多词。

**`assets/data/meta.json`**：
```json
{"generated":"<ISO时间>","total":15234,"bands":[{"id":5,"title":"Rank 5000–5999","count":1000},…]}
```

**`assets/data/affixes.json`**（来自 `wordroot.txt`，Phase 3 用）：原 `wordroot.txt` 本身就是 JSON
（`{ "hom": {"meaning":"man, human","class":"root","example":[…],"origin":"Latin"}, "-less": {…} }`），
解析后筛掉 example 过少的项，原样转存即可。

### 3.6 build_wordlist.py（直接可用，按需微调路径）
```python
#!/usr/bin/env python3
# -*- coding: utf-8 -*-
import csv, json, os, re, datetime
csv.field_size_limit(10**7)
SRC='data_src/ecdict.csv'; OUT='assets/data'
LOW, HIGH = 5001, 20000
WORD_RE = re.compile(r'^[a-z]+$')
os.makedirs(os.path.join(OUT,'bands'), exist_ok=True)

def clean_tr(t):
    t=t.replace('\\n','\n')   # ECDICT 用字面 \n（反斜杠+n）作换行，必须先还原
    out=[]
    for line in t.split('\n'):
        line=line.strip()
        if not line or line.startswith('['): continue
        out.append(line)
        if len(out)>=2: break
    return ' '.join(out)[:80]

def lemma_of(exch):
    for p in (exch or '').split('/'):
        if p.startswith('0:'): return p[2:]
    return None

def pos_of(tr):
    m=re.match(r'\s*([a-z]+)\.', tr)
    return m.group(1) if m else ''

rows=[]
with open(SRC, newline='', encoding='utf-8') as f:
    for x in csv.DictReader(f):
        w=x['word']
        if not WORD_RE.match(w) or len(w)<3: continue
        tr=(x['translation'] or '').strip()
        if not tr: continue
        try: frq=int(x['frq'] or 0)
        except: frq=0
        if not (LOW<=frq<=HIGH): continue
        lem=lemma_of(x['exchange'])
        if lem and lem!=w: continue
        ctr=clean_tr(tr)
        rows.append({"w":w,"ph":(x['phonetic'] or '').strip(),"tr":ctr,
                     "pos":pos_of(ctr),"frq":frq,"band":frq//1000,
                     "tag":(x['tag'] or '').strip(),
                     "co":int(x['collins']) if x['collins'] else 0,
                     "ox":1 if x['oxford'] else 0})
rows.sort(key=lambda r:r['frq'])

# 全量
json.dump(rows, open(os.path.join(OUT,'words.json'),'w',encoding='utf-8'),
          ensure_ascii=False, separators=(',',':'))
# 分 band
bands={}
for r in rows: bands.setdefault(r['band'],[]).append(r)
meta_bands=[]
for b in sorted(bands):
    json.dump(bands[b], open(os.path.join(OUT,'bands',f'band-{b}.json'),'w',encoding='utf-8'),
              ensure_ascii=False, separators=(',',':'))
    meta_bands.append({"id":b,"title":f"Rank {b*1000}–{b*1000+999}","count":len(bands[b])})
meta={"generated":datetime.datetime.now().isoformat(timespec='seconds'),
      "total":len(rows),"bands":meta_bands}
json.dump(meta, open(os.path.join(OUT,'meta.json'),'w',encoding='utf-8'), ensure_ascii=False, indent=1)

# 词缀
try:
    aff=json.load(open('data_src/wordroot.txt',encoding='utf-8'))
    aff={k:v for k,v in aff.items() if isinstance(v,dict)}
    json.dump(aff, open(os.path.join(OUT,'affixes.json'),'w',encoding='utf-8'),
              ensure_ascii=False, separators=(',',':'))
except Exception as e:
    print('affix skip:', e)

print('words:', len(rows), '| bands:', len(meta_bands))
```
运行：`cd vocab-galaxy && python3 build_wordlist.py`。**实测产出 11709 词，band 5–20（共 16 层）**。
（注：`clean_tr` 里把字面 `\n` 还原是必须的——ECDICT 的换行是反斜杠+n 两个字符，不是真换行；漏了会把 `[化]` 等噪声行带进中文释义。）

---

## 4. 数据访问层 `data.js`

提供全局 `VG.data`：
- `loadMeta()` → 读 `meta.json`。
- `loadBand(id)` → 读 `bands/band-id.json`，缓存到内存。
- `loadAll()` → 读 `words.json`（仅 browse/search 页用）。
- `getWord(w)` → 返回词条对象。
- 所有读取用 `fetch`（本地需静态服务器；文档 §10 给出启动命令）。

---

## 5. 调度算法 SRS（效率核心）

> 用户明确偏好"参数要推导/实测，不要拍脑袋"。因此**首选 FSRS**（参数由数据拟合，
> 非 SM-2 那种 2.5、1.3 魔法常数）。优先用现成库，失败再用 §5.3 回退。

### 5.1 首选：ts-fsrs（CDN，推荐）
ES 模块引入（在 `srs.js` 顶部）：
```js
import { fsrs, generatorParameters, createEmptyCard, Rating }
  from 'https://cdn.jsdelivr.net/npm/ts-fsrs@4.6.1/+esm';
```
（pin 版本 `@4.6.1`，避免 API 漂移。若该版本拉取失败，换最近的 `@4.x`，并据其 README 校准下列调用。）

封装统一接口，供 `review.js` 调用：
```js
const params = generatorParameters({ request_retention: 0.9, enable_fuzz: true });
const f = fsrs(params);

// 新词第一次进入：createEmptyCard(now) 得到初始 card 状态
// 评分：rating ∈ {1:Again,2:Hard,3:Good,4:Easy}
function schedule(card, ratingNum, now){
  const R = {1:Rating.Again,2:Rating.Hard,3:Rating.Good,4:Rating.Easy}[ratingNum];
  const rec = f.repeat(card, now);     // 返回各 Rating 的结果
  return rec[R].card;                  // 新的 card 状态（含 due / stability / difficulty）
}
```
**持久化的 card 状态字段**（FSRS 需要，存进 §8 的 `vg_cards[word]`）：
`due, stability, difficulty, elapsed_days, scheduled_days, reps, lapses, state, last_review`。
存储时把 `Date` 用 ISO 字符串序列化，读回时 `new Date(...)` 还原。

`request_retention: 0.9`（目标保留率）选 0.9 是 FSRS 推荐的"复习量/记忆牢度"平衡点——
设为设置项 `vg_settings.retention`，允许用户在 0.85–0.95 间调。

### 5.2 间隔直觉（给 UI 文案用，不用自己算）
ts-fsrs 已算好 `card.due`。大致：评 Good 时下次间隔 ≈ 当前 stability（天）；Again 会让间隔回到分钟级重学。

### 5.3 回退方案：SM-2（仅当 CDN 完全不可用）
若无法引入 ts-fsrs，用 SM-2（标准、易实现）。每词存 `{ef, reps, interval, due}`，初始 `ef=2.5, reps=0, interval=0`。
评分映射质量 q：Again→2, Hard→3, Good→4, Easy→5。
```
ef = max(1.3, ef + (0.1 - (5-q)*(0.08 + (5-q)*0.02)))
if q < 3:  reps = 0; interval = 0   // 当天重学
else:      reps += 1
           interval = 1 if reps==1 else 6 if reps==2 else round(interval*ef)
due = now + interval 天
```
> 在 UI 注明当前用的是 FSRS 还是 SM-2 回退。SM-2 的 2.5/1.3 是历史常数，FSRS 没有这些——
> 这正是首选 FSRS 的原因，别把回退当默认。

---

## 6. 复习引擎 `review.js`（核心交互）

### 6.1 每日队列构建
进入 `review.html` 时：
1. `now = new Date()`。
2. **到期复习**：遍历 `vg_cards`，取 `due <= now` 的词，按 `due` 升序 → `dueList`。
3. **新词**：`newQuota = settings.newPerDay - todayDone.new`（见 §8 每日计数，跨天重置）。
   从"当前 band 起、按 frq 升序、且不在 `vg_cards` 中"的词里取前 `newQuota` 个 → `newList`。
   当前 band = 已学完比例 < 90% 的最低 band（顺序解锁）。
4. **交错**：把 `dueList` 和 `newList` 合并打散（不要先全复习再全新词；新词之间插入复习）。得到 `queue`。
5. 顶部进度条显示：剩余张数、今日新词 x/上限、今日已复习数。

`newPerDay` 默认 **20**（设置项）。推导：实测 11709 词 / 20 ≈ 585 天 ≈ 1.6 年学完；调到 40 则 ~10 个月。
稳态日复习量 ≈ newPerDay × (每词生命周期内复习次数 ÷ 间隔铺开)，约 newPerDay 的 3–6 倍，故 20/天的日负担约 60–120 张，合理。让用户自己在设置里权衡。

### 6.2 单卡流程（主动回忆是铁律）
每张卡：
1. 根据词的状态和"启用模态"选一种出题模态（§6.3）。
2. **先只显示"问题面"**（提示），用户在脑中回忆 / 或作答。
3. 用户点"显示答案"（或提交作答）→ 翻面，显示：单词、音标、🔊发音按钮、中文、词性、（有则）例句、（有则）词缀拆解。
4. 用户自评 **Again / Hard / Good / Easy** 四个按钮 → 调 §5 `schedule()` 更新该词 card → 写回 `vg_cards` → 追加一条到 `vg_log`（§8）→ 下一张。
   - 新词第一次：先 `createEmptyCard`，本张作为"学习"展示（可正反面都给），再评分。
5. 键盘快捷键：空格=显示答案；1/2/3/4=四个评分。

### 6.3 四种出题模态（用户选定的；**不做裸拼写**）
设置项 `vg_settings.modalities`（多选）。每张卡从启用集合里挑一个**该词支持**的模态：

| 模态 | 问题面 | 答案面 | 适用 | 阶段 |
|---|---|---|---|---|
| **识别 cn→en / en→cn** | 显示中文(或英文)，回忆另一面 | 全部信息 | 所有词 | P1 |
| **听音 listen** | 只播放 `speechSynthesis` 发音 + 🔊重播，隐藏拼写 | 全部信息 | 所有词 | P1 |
| **例句挖空 cloze** | 例句中目标词挖成 `____`，给中文提示 | 填回原词 + 整句 | 有例句的词 | P2 |
| **词缀拼装 build** | 给乱序的词缀积木（正确块+干扰块），用户排出该词 | 正确拆解 + 各块含义 | 可分解的词 | P3 |

发音实现（所有页面通用工具）：
```js
function speak(w){ const u=new SpeechSynthesisUtterance(w); u.lang='en-US'; u.rate=0.9; speechSynthesis.cancel(); speechSynthesis.speak(u); }
```
**新词的第一面默认用"识别 en→cn"**（先建立形义联结），后续复习再随机其他模态（交错）。

---

## 7. 页面规格

### 7.1 `index.html` 仪表盘（`dashboard.js`）
- 顶部：今日待复习数（大数字）、今日新词 x/上限、连续打卡天数 streak、全局保留率（近 30 天 §11）。
- **「开始复习」**大按钮 → `review.html`。
- Band 阶梯进度：每个 band 一行，显示 `已学/总数` 进度条，当前解锁 band 高亮，未解锁置灰。
- 设置区（写入 `vg_settings`）：目标保留率、每日新词上限、启用模态（多选）、调度器显示（FSRS/SM-2）。
- 数据备份：「导出 JSON」「导入 JSON」按钮（导出/恢复全部 `vg_*` localStorage）。

### 7.2 `review.html`（`review.js`）—— 见 §6
卡片居中、大字。完成队列后显示当日小结（复习 X、新学 Y、正确率 Z）。

### 7.3 `browse.html`（`browse.js`）
- 词库表格/卡片，可按 band 筛选、按 tag 筛选、搜索框（前缀/包含匹配 `w` 或 `tr`）。
  搜索可复用 knowledge-universe 的"输入即过滤下拉"交互。
- 每词显示状态：未学 / 学习中 / 已掌握（由 `vg_cards[w].state` 推断），可点 🔊。
- 允许「加入今日新词」或「标记已掌握(跳过)」。

### 7.4 `stats.html`（`stats.js`，用 Chart.js CDN）
- 保留率曲线（近 30/90 天，按天聚合 `vg_log` 的正确率）。
- 未来 7 天到期量预测（统计 `vg_cards.due` 落在各天的数量）。
- 各 band 掌握度柱状图。
- 累计已学词数曲线。

---

## 8. localStorage 数据契约（`store.js` 统一封装）

所有键前缀 `vg_`。读写都走 `store.js`，并 try/catch JSON。

| 键 | 内容 |
|---|---|
| `vg_cards` | `{ [word]: { due, stability, difficulty, elapsed_days, scheduled_days, reps, lapses, state, last_review } }`（FSRS）；SM-2 回退时为 `{ef,reps,interval,due}`。Date 用 ISO 字符串。 |
| `vg_settings` | `{ retention:0.9, newPerDay:20, modalities:["recog","listen"], scheduler:"fsrs" }` |
| `vg_daily` | `{ date:"YYYY-MM-DD", newDone:0, reviewDone:0, correct:0, total:0 }`，**跨天自动重置**（读到 date≠今天就清零）。 |
| `vg_log` | 复习事件数组 `[{w, r, t}]`：r=评分1-4，t=ISO 时间。用于保留率与统计。可设上限（如保留最近 5000 条）。 |
| `vg_streak` | `{ last:"YYYY-MM-DD", days:N }` |
| `vg_progress` | `{ currentBand:5, bandDone:{5:120,6:0,…} }`（可由 vg_cards 派生，缓存用） |

**「已掌握」判定**：FSRS `state===Review 且 stability>=21`（天）视为基本掌握（仅用于 UI 标识与 band 进度，不影响调度）。

---

## 9. 样式

优先从 knowledge-universe 复制 `assets/css/universe.css` 复用其 CSS 变量
（`--pri:#2563eb; --pri-lt; --bd; --tx/--tx2/--tx3; --bg`）。取不到时自写一份极简：
- 背景浅灰 `#f8fafc`，卡片白底圆角 `12px` 阴影；主色 `#2563eb`。
- 复习卡：最大宽 `640px` 居中，单词 `40px` 粗体，音标灰色，中文 `18px`。
- 四个评分按钮配色：Again 红、Hard 橙、Good 绿、Easy 蓝。
- 响应式：手机单列，按钮够大可点。

---

## 10. 实现顺序（**严格分阶段，每阶段可独立验收**）

> 执行 AI 请**一阶段一阶段做**，每阶段做完自检（§11）通过再进下一阶段。不要一次写完全部。

**Phase 0 — 数据**
- 运行 `build_wordlist.py`，产出 `meta.json / words.json / bands/*.json / affixes.json`。
- 自检：`words.json` 词数 1.3–1.6 万；随机抽 5 词中文/音标正确；无变形词（搜 `running` 应不在）。

**Phase 1 — 核心 SRS 闭环（MVP，最重要）**
- `store.js` + `data.js` + `srs.js`（FSRS）+ `review.js`（仅"识别"+"听音"两模态）+ `index.html` 仪表盘。
- 能：建队列 → 出卡 → 翻面 → 四级评分 → 写回 → 跨天到期重现。
- 自检见 §11。**这一步通过，工具就已可用。**

**Phase 2 — 浏览 + 统计 + 例句挖空**
- `browse.html`/`browse.js`、`stats.html`/`stats.js`。
- 例句来源：从 Tatoeba 英中句对（`https://tatoeba.org`，或 `https://downloads.tatoeba.org/exports/`）
  抽含目标词的句子，写一个 `build_sentences.py` 生成 `assets/data/sentences.json`（`{word:[{en,cn}]}`，每词≤3句）。
  无例句的词，cloze 模态对其禁用。
- 启用"例句挖空"模态。

**Phase 3 — 词缀拼装**
- 用 `affixes.json` 写分解器：对一个词，贪心匹配**已知前缀**(开头最长)、**已知后缀**(结尾最长)，中间记为词根；
  至少命中 1 个已知词缀才认为"可分解"（如 `irreversible` = ir + revers + ible），否则该词不启用 build 模态。
- 拼装 UI：把正确块 + 2–3 个干扰块乱序成可点积木，用户按序拼出；答对显示各块含义（强化词源）。

---

## 11. 验收标准（执行 AI 自检清单）

**Phase 0**（实测基准：词数 **11709**，band **5–20**）
- [ ] `meta.json.total` ≈ 11700（在 11000–12500 之间即可）；`bands` 覆盖 5–20。
- [ ] 抽查 `ubiquitous`(band 8)、`photosynthesis`(band 17) 存在；中文释义**无** `\n`、`[化]` 等噪声。
- [ ] `running`/`runs`/`looked`/`incredible` 等变形词或低频词**不在** words.json。

**Phase 1**
- [ ] 首次进入：仪表盘今日新词上限默认 20，待复习 0。
- [ ] 复习一张新词 → 评 Good → 该词出现在 `vg_cards`，`due` 为未来时间。
- [ ] 评 Again 的词当天会再次出现（短间隔）。
- [ ] 刷新页面后进度不丢（localStorage 持久化）。
- [ ] 把系统时间改到明天（或临时改 due）→ 到期词重新进队列。
- [ ] 🔊 按钮能用 `speechSynthesis` 发音；"听音"模态问题面不暴露拼写。
- [ ] 键盘 空格/1/2/3/4 生效。
- [ ] 导出 JSON → 清 localStorage → 导入 → 状态恢复。

**Phase 2**
- [ ] 浏览页可按 band/tag 筛选、搜索即时过滤。
- [ ] 统计页保留率曲线、未来到期预测正常渲染。
- [ ] 有例句的词能正确挖空并判对/错。

**Phase 3**
- [ ] 可分解词（如 `irreversible`=ir+revers+ible，band 12）能拼装并显示各块含义；不可分解词不出现 build 模态。

---

## 12. 关键决策摘要（已定，勿推翻）

1. **词频排名 5000–20000** 作为范围，按 `frq` 升序学习（频率≈实用度，最高效顺序）。
2. **调度器用 FSRS**（ts-fsrs CDN）；SM-2 仅作回退。原因：用户要"参数实测推导，非魔法常数"。
3. 目标保留率默认 **0.9**，每日新词默认 **20**，均为可调设置项（非写死）。
4. **四模态**：识别、听音、例句挖空、词缀拼装；**不做裸字母拼写**（用户已否决，改为词缀拼装）。
5. 发音用浏览器 **Web Speech API**，零音频文件、零后端。
6. 状态全部 `localStorage`，提供 JSON 导入导出做备份。
7. 分 4 个阶段交付，Phase 1 即为可用 MVP。

> 如需偏离以上任一条，先停下问用户，不要自行决定。
