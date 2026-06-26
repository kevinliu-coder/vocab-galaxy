// review.js — Core review engine for Vocab-Galaxy
// v3: micro-review every 5 new words, rich card back, root decomposition, AI checkpoint

const VGReview = {
  queue: [],
  index: 0,
  currentCard: null,
  daily: null,
  flipped: false,
  settings: null,
  microPool: [],         // words studied in current batch
  _affixes: null,        // cached affixes.json
  _aiCheckpointCount: 0, // new words since last AI checkpoint
  _aiCheckpointReady: false,
  _aiWords: [],          // collected words for next checkpoint
  _aiWordInfos: {},

  async init() {
    this.settings = VGStore.getSettings();
    this.daily = VGStore.getDaily();
    this._aiCheckpointCount = 0; // reset per session, trigger at 10 new words
    VGStore._set('ai_checkpoint_count', 0);
    await this.loadAffixes(); // pre-load affixes for root decomposition
    // Check for cached AI checkpoint
    if (VGAIVocab.getCachedTask()) {
      this._aiCheckpointReady = true;
    }
    await this.buildQueue();
    this.renderProgress();
    if (this.queue.length > 0) {
      this.showCard(0);
    } else {
      this.showEmpty();
    }
    this.bindKeys();
  },

  async loadAffixes() {
    // Affixes are inlined in window.VG_DATA (via bundle.js) — no fetch.
    this._affixes = (typeof VG !== 'undefined' && VG.getAffixes) ? VG.getAffixes() : {};
  },

  async buildQueue() {
    const now = new Date();
    const cards = VGStore.getCards();
    const progress = VGStore.getProgress();
    const startBand = this.settings.startBand || 6;

    // Determine current band (first band >= startBand with < 90% completion)
    let currentBand = startBand;
    const bandIds = VG.getBandIds().filter(id => id >= startBand);
    for (const bid of bandIds) {
      const words = await VG.getBandWords(bid);
      const learned = words.filter(w => cards[w.w]).length;
      const pct = words.length > 0 ? learned / words.length : 0;
      if (pct < 0.9) { currentBand = bid; break; }
    }
    progress.currentBand = currentBand;
    VGStore.setProgress(progress);

    // 1. Due reviews
    const dueList = [];
    for (const [w, card] of Object.entries(cards)) {
      if (new Date(card.due) <= now) {
        dueList.push({ word: w, type: 'review', card });
      }
    }
    dueList.sort((a,b) => new Date(a.card.due) - new Date(b.card.due));

    // 2. New words from current band, capped by the daily new-word limit.
    //    remaining = newPerDay - (new words already studied today)
    const newPerDay = this.settings.newPerDay || 0; // 0 = 不限（无限学习）
    const remainingNew = newPerDay > 0 ? Math.max(0, newPerDay - (this.daily.newDone || 0)) : Infinity;
    const bandWords = await VG.getBandWords(currentBand);
    const newList = [];
    for (const bw of bandWords) {
      if (newList.length >= remainingNew) break;
      if (!cards[bw.w]) {
        newList.push({ word: bw.w, type: 'new', card: null });
        this._aiWords.push(bw.w);
        this._aiWordInfos[bw.w] = bw;
      }
    }

    // 3. Build queue with micro-reviews every 5 new words
    // Strategy: insert micro-review blocks after every 5 new words
    // AI checkpoint: after 50+ new words, insert AI story card
    const combined = [];
    let dueIdx = 0;
    let newBatch = [];
    let sessionNewCount = 0;
    const triggerAIAt = 10; // insert AI checkpoint every 10 words
    let aiInserted = false;
    console.log(`[AI] checkpoint count at start: ${this._aiCheckpointCount}, need ${triggerAIAt} for trigger`);

    for (let i = 0; i < newList.length; i++) {
      if (dueIdx < dueList.length) {
        combined.push(dueList[dueIdx++]);
      }
      newBatch.push(newList[i]);
      combined.push(newList[i]);
      sessionNewCount++;

      // AI 造句关卡：每 triggerAIAt 个新词插一次，用刚学的 10 个词
      if (sessionNewCount % triggerAIAt === 0) {
        const cpNo = sessionNewCount / triggerAIAt; // 1,2,3...
        combined.push({ type: 'ai-checkpoint', mode: (cpNo % 2 === 1) ? 'writing' : 'cloze', words: newList.slice(0, i+1).map(n=>n.word).slice(-10) });
      }

      // After 5 new words, insert their micro-review
      if (newBatch.length === 5) {
        for (const nw of newBatch) {
          combined.push({ word: nw.word, type: 'micro-review', card: null });
        }
        newBatch = [];
      }
    }

    // Last batch (less than 5)
    if (newBatch.length > 0) {
      for (const nw of newBatch) {
        combined.push({ word: nw.word, type: 'micro-review', card: null });
      }
    }
    // Remaining due reviews
    while (dueIdx < dueList.length) {
      combined.push(dueList[dueIdx++]);
    }

    this.queue = combined;
    this.microPool = [];
    const aiIdx = combined.findIndex(c => c.type === 'ai-checkpoint');
    console.log(`Queue: ${dueList.length} due + ${newList.length} new (band ${currentBand}) = ${combined.length} total | AI checkpoint at idx ${aiIdx}`);
  },

  renderProgress() {
    const el = document.getElementById('review-stats');
    if (!el) return;
    const done = this.index;
    const total = this.queue.length;
    const wordsToAI = 9 - (this.daily.newDone % 10); // 9,8,7...0 = AI triggered
    const aiIcon = wordsToAI <= 0 ? '🤖🎯' : `🤖${wordsToAI+1}`;
    el.innerHTML = `
      复习 <span>${this.daily.reviewDone}</span> ·
      新词 <span>${this.daily.newDone}</span><span style="color:#888">/${(this.settings.newPerDay>0)?this.settings.newPerDay:'∞'}</span> ·
      进度 <span>${done}</span>/<span>${total}</span>
      <span style="margin-left:12px;color:${wordsToAI <= 0 ? '#4caf50' : '#888'}">${aiIcon}</span>
      <span style="margin-left:4px;color:#888;font-size:11px">${VGSRS.getMode().toUpperCase()}</span>
    `;
  },

  showCard(i) {
    if (i >= this.queue.length) {
      this.rebuildDueQueue();
      return;
    }
    this.index = i;
    this.flipped = false;
    const item = this.queue[i];

    // AI checkpoint card
    if (item.type === 'ai-checkpoint') {
      console.log('[AI] Rendering checkpoint card at queue index:', i);
      try {
        this.renderAICheckpoint(item);
      } catch(e) {
        console.error('[AI] Checkpoint render error:', e);
        this.nextCard();
      }
      this.renderProgress();
      return;
    }

    const wordInfo = VG.getWord(item.word);
    if (!wordInfo) { this.nextCard(); return; }

    this.currentCard = { ...item, info: wordInfo };
    this.renderFront();
    this.renderProgress();

    // 自动发音（cloze/build 的答案就是这个词本身，不能念出来）
    setTimeout(() => { if (this._cardModality !== 'cloze' && this._cardModality !== 'build') this.speakWord(); }, 350);
  },

  // 按设置里启用的复习模态选一种（新词永远用识别；按当前词是否可用过滤）
  pickModality(card) {
    if (card.type === 'new') return 'recog';
    const ai = VGStore.getAI();
    const info = card.info || (card.word ? VG.getWord(card.word) : null);
    const enabled = (this.settings.modalities || ['recog','listen']).filter(m => {
      if (m === 'recog' || m === 'listen') return true;
      if (m === 'cloze') return !!(ai.enabled && ai.apiKey);              // 例句挖空需 key
      if (m === 'build') return !!(info && this.decomposeWord(info.w).length > 1); // 需可分解
      return false;
    });
    if (!enabled.length) return 'recog';
    return enabled[Math.floor(Math.random() * enabled.length)];
  },

  renderFront() {
    const c = this.currentCard;
    const el = document.getElementById('review-card');
    const isNew = c.type === 'new';
    const isMicro = c.type === 'micro-review';

    let typeLabel = isNew ? '🆕 新词' : isMicro ? '🔄 快速复习' : '📋 复习';
    let frontHTML = '';
    this._cardModality = 'recog';

    if (isNew) {
      // New word: learning mode — show word + phonetics + hint, NOT a blank test
      frontHTML = `
        <div class="word-front" style="text-align:center">
          <p style="font-size:13px;color:#666;margin-bottom:8px">${typeLabel} · ${c.info.w.length} 字母 · band ${c.info.band}${c.info.pos ? ' · '+c.info.pos+'.' : ''}</p>
          <p style="font-size:42px;font-weight:bold;color:#fff;margin-bottom:6px">${c.info.w}</p>
          <p style="font-size:18px;color:#4da6ff;margin-bottom:16px">${c.info.ph || ''}</p>
          ${c.info.tag ? `<p style="font-size:12px;color:#888;margin-bottom:8px">🏷 ${c.info.tag}</p>` : ''}
          <button class="audio-btn" onclick="VGReview.speakWord()" style="margin-bottom:16px">🔊 听听发音，跟读一遍</button>
          <p style="font-size:15px;color:#888">看看这个词，猜猜它的意思</p>
        </div>
      `;
    } else {
      // 复习/微复习：按启用的模态出题
      const modality = this.pickModality(c);
      this._cardModality = modality;
      if (modality === 'build') return this.renderBuildFront(c);
      if (modality === 'cloze') return this.renderClozeSentenceFront(c);
      const accent = isMicro ? '#ff8c00' : '#666';
      const head = isMicro ? '🔄 快速复习' : typeLabel;
      if (modality === 'listen') {
        // 听音：藏住拼写，只放发音
        frontHTML = `
          <div class="word-front" style="text-align:center">
            <p style="font-size:14px;color:${accent};margin-bottom:16px">${head} · 🎧 听音 · band ${c.info.band}</p>
            <div style="font-size:44px;margin:8px 0">🔊</div>
            <button class="audio-btn" onclick="VGReview.speakWord()" style="margin:8px 0 12px">▶ 再播一次</button>
            <p style="font-size:16px;color:#888">听发音，回忆它的拼写和中文意思</p>
          </div>
        `;
      } else {
        // 识别：显示词面，回忆中文
        frontHTML = `
          <div class="word-front">
            <p style="font-size:14px;color:${accent};margin-bottom:16px">${head} · band ${c.info.band}</p>
            <p style="font-size:32px;color:#e0e0e0;margin-bottom:12px">${c.info.w}</p>
            <p style="font-size:16px;color:#888">${isMicro ? '刚才学过的，还记得中文意思吗？' : '回想它的中文释义'}</p>
            <button class="audio-btn" onclick="VGReview.speakWord()" style="margin-top:12px">🔊 听听发音</button>
          </div>
        `;
      }
    }

    el.innerHTML = `
      <div class="word-card" id="card-inner" style="min-height:280px">
        ${frontHTML}
        <button class="btn btn-primary btn-lg" onclick="VGReview.flip()" style="margin-top:24px;padding:14px 48px;font-size:18px">
          显示答案 (空格键)
        </button>
      </div>
    `;
  },

  renderRecogFront(c) {
    const el = document.getElementById('review-card');
    el.innerHTML = `
      <div class="word-card" id="card-inner" style="min-height:280px">
        <div class="word-front">
          <p style="font-size:14px;color:#666;margin-bottom:16px">📋 复习 · band ${c.info.band}</p>
          <p style="font-size:32px;color:#e0e0e0;margin-bottom:12px">${c.info.w}</p>
          <p style="font-size:16px;color:#888">回想它的中文释义</p>
          <button class="audio-btn" onclick="VGReview.speakWord()" style="margin-top:12px">🔊 听听发音</button>
        </div>
        <button class="btn btn-primary btn-lg" onclick="VGReview.flip()" style="margin-top:24px;padding:14px 48px;font-size:18px">显示答案 (空格键)</button>
      </div>`;
  },

  // 词缀拼装：用词缀积木拼出这个词
  renderBuildFront(c) {
    const el = document.getElementById('review-card');
    const parts = this.decomposeWord(c.info.w).map(p => p.part);
    this._buildTarget = c.info.w.toLowerCase();
    this._buildAnswer = '';
    const tiles = parts.map((p, i) => ({ p, i })).sort(() => Math.random() - 0.5);
    const tileHTML = tiles.map(t => `<span class="bld-tile" data-i="${t.i}" onclick="VGReview._buildPick(${t.i},'${t.p}')" style="display:inline-block;background:#1a1a2e;border:1px solid #2a2a3a;border-radius:8px;padding:10px 16px;margin:5px;cursor:pointer;font-size:18px;color:#4da6ff;user-select:none">${this._esc(t.p)}</span>`).join('');
    el.innerHTML = `
      <div class="word-card" id="card-inner" style="min-height:280px;text-align:center;padding:28px 24px">
        <p style="font-size:13px;color:#666;margin-bottom:8px">🧩 词缀拼装 · ${c.info.ph || ''}</p>
        <p style="font-size:22px;color:#e0e0e0;margin-bottom:6px">${this._esc(c.info.tr)}</p>
        <p style="font-size:13px;color:#888;margin-bottom:16px">用下面的词缀积木拼出这个词</p>
        <div id="bld-answer" style="min-height:38px;font-size:26px;color:#fff;letter-spacing:1px;border-bottom:2px dashed #4da6ff;display:inline-block;min-width:160px;padding:4px 10px;margin-bottom:16px">&nbsp;</div>
        <div style="margin-bottom:10px">${tileHTML}</div>
        <button class="btn" onclick="VGReview._buildClear()" style="background:#1a1a2e;color:#888;margin-bottom:10px">清空重拼</button>
        <button class="btn btn-primary btn-lg" onclick="VGReview.flip()" style="width:100%;margin-top:4px">显示答案 (空格键)</button>
      </div>`;
  },

  _buildPick(i, part) {
    this._buildAnswer = (this._buildAnswer || '') + String(part).replace(/-/g, '');
    const a = document.getElementById('bld-answer');
    if (a) {
      a.textContent = this._buildAnswer;
      a.style.color = this._buildTarget.startsWith(this._buildAnswer.toLowerCase()) ? '#fff' : '#ff6b6b';
    }
    const tile = document.querySelector('.bld-tile[data-i="' + i + '"]');
    if (tile) { tile.style.opacity = '0.35'; tile.style.pointerEvents = 'none'; }
  },

  _buildClear() {
    this._buildAnswer = '';
    const a = document.getElementById('bld-answer');
    if (a) { a.innerHTML = '&nbsp;'; a.style.color = '#fff'; }
    document.querySelectorAll('.bld-tile').forEach(t => { t.style.opacity = '1'; t.style.pointerEvents = 'auto'; });
  },

  // 例句挖空：AI 现场为该词造例句并挖空（按词缓存）
  async renderClozeSentenceFront(c) {
    const el = document.getElementById('review-card');
    el.innerHTML = this._ckLoading('AI 正在为这个词造例句…');
    let ex = VGStore.getExample(c.info.w);
    if (!ex) {
      ex = await VGAIVocab.generateExample(c.info.w, c.info);
      if (ex) VGStore.setExample(c.info.w, ex);
    }
    if (!this.currentCard || this.currentCard.word !== c.word || this.flipped) return;
    if (!ex || !ex.blanked) { this._cardModality = 'recog'; this.renderRecogFront(c); return; }
    el.innerHTML = `
      <div class="word-card" id="card-inner" style="min-height:280px;text-align:left;padding:28px 24px">
        <p style="font-size:13px;color:#666;margin-bottom:10px;text-align:center">📖 例句挖空 · 填入正确的词</p>
        <div style="background:#0a0a12;border:1px solid #2a2a3a;border-radius:8px;padding:16px;font-size:17px;line-height:1.9;color:#e0e0e0;margin-bottom:8px">${this._esc(ex.blanked)}</div>
        ${ex.cn ? `<div style="font-size:13px;color:#888;margin-bottom:12px">${this._esc(ex.cn)}</div>` : ''}
        <input id="cloze-sent-in" autocomplete="off" spellcheck="false" placeholder="这个空填什么词？" style="width:100%;box-sizing:border-box;background:#0a0a12;border:1px solid #2a2a3a;border-radius:8px;padding:10px 12px;color:#fff;font-size:16px;text-align:center;margin-bottom:8px">
        <button class="btn btn-primary btn-lg" onclick="VGReview.flip()" style="width:100%">显示答案 (空格键)</button>
      </div>`;
    setTimeout(() => { const f = document.getElementById('cloze-sent-in'); if (f) f.focus(); }, 50);
  },

  flip() {
    if (this.flipped) return;
    this.flipped = true;
    this.renderBack();
    // Track micro-review pool
    if (this.currentCard.type === 'new') {
      this.microPool.push(this.currentCard);
    }
    setTimeout(() => this.speakWord(), 300);
  },

  renderBack() {
    const c = this.currentCard;
    const info = c.info;
    const el = document.getElementById('card-inner');
    if (!el) return;

    // Root decomposition from affixes.json
    const rootParts = this.decomposeWord(info.w);

    // Derivative words from ECDICT exchange field
    const derivs = this.getDerivatives(info);

    // Full translation (not truncated to 80 chars)
    const fullTr = info.tr;

    // Check cached AI notes
    const notes = VGStore.getWordNote(info.w);
    const aiEnabled = VGStore.getAI().enabled;

    let aiSection = '';
    if (notes) {
      aiSection = `
        <div class="word-detail">
          ${notes.sentences ? `<span class="label">📝 实用例句</span>${notes.sentences.map(s => `<div style="margin:4px 0">· ${s}</div>`).join('')}` : ''}
          ${notes.collocations ? `<span class="label">🔗 常见搭配</span>${notes.collocations.map(c => `<div style="margin:4px 0">· ${c}</div>`).join('')}` : ''}
          ${notes.synonyms ? `<span class="label">🔀 近义词辨析</span><div style="margin:4px 0">${notes.synonyms}</div>` : ''}
          ${notes.mnemonic ? `<span class="label">💡 记忆技巧</span><div style="margin:4px 0">${notes.mnemonic}</div>` : ''}
        </div>
      `;
    }

    let rootHTML = '';
    if (rootParts.length > 1) {
      rootHTML = `
        <div style="margin-top:12px;padding:10px 14px;background:#141428;border-radius:8px;font-size:14px;line-height:1.8">
          <span style="color:#4da6ff;font-weight:bold">📚 词根拆解</span><br>
          ${rootParts.map(p => `<span style="color:#4da6ff">${p.part}</span> <span style="color:#888">(${p.meaning || '未知'})</span>`).join(' + ')}
          ${rootParts.length > 1 ? `<br><span style="color:#888">→ 组合含义：${rootParts.map(p => p.meaning || p.part).join(' + ')}</span>` : ''}
        </div>
      `;
    }

    let derivHTML = '';
    if (derivs.length > 0) {
      derivHTML = `
        <div style="margin-top:8px;font-size:13px;color:#888">
          🔀 派生词：${derivs.join(' · ')}
        </div>
      `;
    }

    let aiNote = '';
    if (aiEnabled) {
      aiNote = `<div style="margin-top:8px;font-size:12px;color:#555">💡 每学满 10 个新词会触发一次 AI 造句关卡</div>`;
    } else {
      aiNote = `<div style="margin-top:8px;font-size:12px;color:#555">💡 配置 API Key 解锁 AI 造句关卡（每 10 个新词一次）</div>`;
    }

    el.innerHTML = `
      <div style="min-height:320px;text-align:left;padding:28px 24px">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px">
          <div class="word-spell" style="font-size:48px;margin:0">${info.w}</div>
          <button class="audio-btn" onclick="VGReview.speakWord()">🔊</button>
        </div>
        <div class="word-phonetic" style="font-size:18px;margin-bottom:8px">${info.ph || ''}</div>
        <div class="word-translation" style="font-size:24px;margin-bottom:8px">${fullTr}</div>
        ${info.tag ? `<div style="color:#888;font-size:12px;margin-bottom:4px">🏷 ${info.tag}</div>` : ''}
        ${c.type === 'new' ? '<div style="color:#4da6ff;font-size:13px;margin-bottom:8px">首次学习 · 仔细看一遍再评分</div>' : ''}
        ${c.type === 'micro-review' ? '<div style="color:#ff8c00;font-size:13px;margin-bottom:8px">🔄 快速复习 · 刚学过的词</div>' : ''}
        ${rootHTML}
        ${derivHTML}
        ${aiSection}
        ${aiNote}

        <div class="rating-row" style="margin-top:24px">
          <button class="btn btn-again" onclick="VGReview.rate(1)" style="font-size:20px;padding:16px 12px;flex:1;max-width:140px">Again<br><small style="font-size:14px">忘了</small></button>
          <button class="btn btn-hard"  onclick="VGReview.rate(2)" style="font-size:20px;padding:16px 12px;flex:1;max-width:140px">Hard<br><small style="font-size:14px">很难</small></button>
          <button class="btn btn-good"  onclick="VGReview.rate(3)" style="font-size:20px;padding:16px 12px;flex:1;max-width:140px">Good<br><small style="font-size:14px">记得</small></button>
          <button class="btn btn-easy"  onclick="VGReview.rate(4)" style="font-size:20px;padding:16px 12px;flex:1;max-width:140px">Easy<br><small style="font-size:14px">简单</small></button>
        </div>
        <div class="kbd-hint" style="font-size:13px">键盘：<kbd>1</kbd> Again <kbd>2</kbd> Hard <kbd>3</kbd> Good <kbd>4</kbd> Easy</div>
      </div>
    `;
  },

  // Root decomposition using affixes.json (greedy match: longest prefix + longest suffix)
  decomposeWord(w) {
    if (!this._affixes || Object.keys(this._affixes).length === 0) return [{part: w, meaning: ''}];

    const parts = [];
    let remaining = w.toLowerCase();
    const matchedPrefixes = [];
    const matchedSuffixes = [];

    // Collect known prefixes/suffixes from affixes
    const knownPrefixes = [];
    const knownSuffixes = [];
    for (const [key, val] of Object.entries(this._affixes)) {
      if (!val || !val.meaning) continue;
      if (key.startsWith('-')) knownSuffixes.push({key, meaning: val.meaning});
      else if (key.endsWith('-')) knownPrefixes.push({key, meaning: val.meaning});
      else {
        // Pure root - try as prefix/suffix match
        knownPrefixes.push({key, meaning: val.meaning});
      }
    }

    // Greedy match prefix (longest first)
    knownPrefixes.sort((a,b) => b.key.length - a.key.length);
    for (const p of knownPrefixes) {
      const k = p.key.replace(/-$/, '');
      if (k.length < 2) continue;
      if (remaining.startsWith(k)) {
        parts.push({part: k + '-', meaning: p.meaning});
        remaining = remaining.slice(k.length);
        break;
      }
    }

    // Middle part (root)
    if (remaining.length > 0) {
      // Greedy match suffix (longest first)
      knownSuffixes.sort((a,b) => b.key.length - a.key.length);
      let suffixFound = false;
      for (const s of knownSuffixes) {
        const k = s.key.replace(/^-/, '');
        if (k.length < 2) continue;
        if (remaining.endsWith(k) && remaining.length > k.length) {
          const rootPart = remaining.slice(0, -k.length);
          if (rootPart.length > 0) parts.push({part: rootPart, meaning: ''});
          parts.push({part: '-' + k, meaning: s.meaning});
          suffixFound = true;
          break;
        }
      }
      if (!suffixFound) {
        parts.push({part: remaining, meaning: ''});
      }
    }

    // If only one part (no decomposition found), return word as-is
    if (parts.length <= 1) {
      // Try simpler: look for any matching root/affix
      for (const [key, val] of Object.entries(this._affixes)) {
        if (!val || !val.meaning) continue;
        const k = key.replace(/^-/, '').replace(/-$/, '');
        if (k.length < 3) continue;
        if (w.toLowerCase().includes(k) && k !== w.toLowerCase()) {
          return [
            {part: w.slice(0, w.toLowerCase().indexOf(k)), meaning: ''},
            {part: k, meaning: val.meaning},
            {part: w.slice(w.toLowerCase().indexOf(k) + k.length), meaning: ''}
          ].filter(p => p.part.length > 0);
        }
      }
      return [{part: w, meaning: ''}];
    }

    return parts;
  },

  // Get derivative words from ECDICT exchange field (now included in data)
  getDerivatives(info) {
    return info.derivs || [];
  },

  rate(rating) {
    if (!this.flipped) return;
    const now = new Date();
    const w = this.currentCard.word;

    // For micro-reviews, always treat as "review" type for scheduling
    const card = VGStore.getCard(w);
    let cardData;
    if (card) {
      cardData = VGSRS.schedule(card, rating, now);
    } else {
      cardData = VGSRS.newCard(now);
      // If new word being rated for first time, schedule it too
      cardData = VGSRS.schedule(cardData, rating, now);
    }

    const cards = VGStore.getCards();
    cards[w] = cardData;
    VGStore.setCards(cards);

    // Log
    VGStore.addLog({ w, r: rating, t: now.toISOString() });

    // Daily stats
    this.daily.total++;
    if (rating >= 3) this.daily.correct++;
    if (this.currentCard.type === 'new') this.daily.newDone++;
    else this.daily.reviewDone++;
    VGStore.setDaily(this.daily);

    // Track weak words
    if (rating <= 2) VGStore.recordWeakScore(w, rating);

    // Streak
    VGStore.updateStreak();

    // Next
    setTimeout(() => this.nextCard(), 250);
  },

  nextCard() {
    this.showCard(this.index + 1);
  },

  showEmpty() {
    const el = document.getElementById('review-card');
    el.innerHTML = `
      <div class="word-card">
        <div class="word-spell" style="font-size:24px">🎉</div>
        <p style="margin:16px 0;font-size:18px">今天没有需要复习的词汇</p>
        <p style="color:#888">当前 band 已学完。去设置里调整起始 Band 试试。</p>
        <button class="btn btn-primary" onclick="location.href='index.html'">返回首页</button>
      </div>
    `;
  },

  showComplete() {
    // Replaced by rebuildDueQueue — never show completion, always loop
    this.rebuildDueQueue();
  },

  async rebuildDueQueue() {
    const now = new Date();
    const cards = VGStore.getCards();
    const dueList = [];
    for (const [w, card] of Object.entries(cards)) {
      if (new Date(card.due) <= now) {
        dueList.push({ word: w, type: 'review', card });
      }
    }
    dueList.sort((a,b) => new Date(a.card.due) - new Date(b.card.due));

    if (dueList.length > 0) {
      this.queue = dueList;
      this.index = 0;
      this.showCard(0);
    } else {
      // No due cards — show idle state, check again in 30s
      const el = document.getElementById('review-card');
      const pct = this.daily.total > 0 ? Math.round(this.daily.correct/this.daily.total*100) : 0;
      el.innerHTML = `
        <div class="word-card">
          <div class="word-spell" style="font-size:24px">🎉 全部完成</div>
          <div style="margin:16px 0;font-size:16px">
            今天学了 <span style="color:#4da6ff;font-size:24px">${this.daily.newDone}</span> 新词，
            复习了 <span style="color:#4caf50;font-size:24px">${this.daily.reviewDone}</span> 次
          </div>
          <div style="font-size:14px;color:#888;margin-bottom:16px">
            没有待复习的卡片。回首页调整起始 Band 学更多，或等明天到期词回来。
          </div>
          <button class="btn btn-primary" onclick="location.href='index.html'">返回首页</button>
          <button class="btn" style="background:#2a2a3a;color:#4da6ff;margin-left:8px" onclick="VGReview.rebuildDueQueue()">检查待复习</button>
        </div>
      `;
    }
  },

  // ---- AI 造句关卡：AI 出题 → 你造句 → AI 评估 ----
  async renderAICheckpoint(item) {
    const words = (item && item.words && item.words.length) ? item.words : this._aiWords.slice(-10);
    const ai = VGStore.getAI();
    if (!ai.enabled || !ai.apiKey) { this.renderSimpleCheckpoint(words); return; }
    this._writingWords = words;
    const mode = (item && item.mode === 'cloze') ? 'cloze' : 'writing';
    if (mode === 'cloze') return this.renderClozeFlow(words);
    return this.renderWritingFlow(words);
  },

  async renderWritingFlow(words) {
    let task = VGAIVocab.getCachedTask();
    if (!task) {
      document.getElementById('review-card').innerHTML = this._ckLoading('AI 正在用你刚学的词出造句题…');
      task = await VGAIVocab.generateWritingTask(words, this._aiWordInfos);
      if (!task) { this.renderSimpleCheckpoint(words); return; }
      VGAIVocab.saveTask(task);
    }
    this._writingTask = task;
    this.renderWritingTask(task, words);
  },

  async renderClozeFlow(words) {
    let ck = VGAIVocab.getCachedCloze();
    if (!ck) {
      document.getElementById('review-card').innerHTML = this._ckLoading('AI 正在用你刚学的词出完形填空…');
      ck = await VGAIVocab.generateCloze(words, this._aiWordInfos);
      if (!ck) { this.renderSimpleCheckpoint(words); return; }
      VGAIVocab.saveCloze(ck);
    }
    this._clozeData = ck;
    this.renderClozeCard(ck);
  },

  renderClozeCard(ck) {
    this._clozeData = ck;
    const el = document.getElementById('review-card');
    const blanks = ck.blanks || [];
    let i = 0;
    const passageHTML = String(ck.passage || '').replace(/_{3,}/g, () => {
      const idx = i++;
      return `<input class="cloze-in" id="cz-${idx}" autocomplete="off" spellcheck="false" style="display:inline-block;width:110px;border:none;border-bottom:2px solid #4da6ff;background:#0a0a12;color:#fff;font-size:15px;text-align:center;margin:0 3px;padding:2px 4px;border-radius:4px 4px 0 0">`;
    });
    const hints = blanks.map((b, n) => `<span style="color:#888;font-size:12px;margin:0 10px 4px 0;display:inline-block">${n+1}. ${this._esc(b.hint||'')}</span>`).join('');
    el.innerHTML = `
      <div class="word-card" style="min-height:280px;text-align:left;padding:28px 24px">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px">
          <span style="font-size:20px">🧩 AI 完形填空</span>
          <span style="font-size:12px;color:#888">把刚学的词填回短文</span>
        </div>
        <div style="background:#0a0a12;border:1px solid #2a2a3a;border-radius:8px;padding:16px 18px;font-size:16px;line-height:2.4;color:#e0e0e0;margin-bottom:12px">${passageHTML}</div>
        <div style="margin-bottom:10px">${hints}</div>
        <button class="btn btn-primary btn-lg" style="width:100%" onclick="VGReview.submitCloze()">提交检查</button>
        <button class="btn" style="margin-top:6px;width:100%;background:#1a1a2e;color:#888" onclick="VGReview.finishCheckpoint()">跳过</button>
      </div>`;
    setTimeout(()=>{ const f=document.getElementById('cz-0'); if(f) f.focus(); }, 50);
  },

  submitCloze() {
    const blanks = (this._clozeData && this._clozeData.blanks) || [];
    let correct = 0;
    const rows = blanks.map((b, i) => {
      const inp = document.getElementById('cz-' + i);
      const got = inp ? inp.value.trim() : '';
      const ok = got.toLowerCase() === String(b.answer||'').toLowerCase();
      if (ok) correct++;
      return `<div style="margin:4px 0;padding:6px 10px;border-radius:4px;background:${ok?'#0a2a0a':'#2a0a0a'};font-size:14px">
        ${ok?'✅':'❌'} <span style="color:#4da6ff">${this._esc(b.answer||'')}</span>
        ${ok?'':`<span style="color:#ff6b6b">（你填: ${this._esc(got||'空')}）</span>`}
        <span style="color:#888;font-size:12px">${this._esc(b.hint||'')}</span>
      </div>`;
    }).join('');
    const pct = blanks.length ? Math.round(correct/blanks.length*100) : 0;
    const el = document.getElementById('review-card');
    el.innerHTML = `
      <div class="word-card" style="min-height:280px;text-align:left;padding:28px 24px">
        <div style="text-align:center;font-size:24px;margin-bottom:12px">
          ${pct>=80?'🎉':pct>=50?'👍':'📚'} <span style="color:#4da6ff">${correct}/${blanks.length}</span> 正确 (${pct}%)
        </div>
        ${rows}
        <button class="btn btn-primary btn-lg" style="margin-top:16px;width:100%" onclick="VGReview.finishCheckpoint()">继续学习</button>
      </div>`;
  },

  _ckLoading(msg) {
    return `<div class="word-card" style="min-height:280px;display:flex;align-items:center;justify-content:center">
      <div style="text-align:center"><div style="font-size:24px;margin-bottom:12px">🤖</div>
      <div style="font-size:17px;color:#4da6ff">${msg}</div></div></div>`;
  },

  _esc(s){ return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); },

  renderWritingTask(task, words) {
    const el = document.getElementById('review-card');
    const must = (task.mustUse && task.mustUse.length ? task.mustUse : words);
    const chips = must.map(w => {
      const info = this._aiWordInfos[w] || VG.getWord(w) || {};
      return `<span style="display:inline-block;background:#1a1a2e;border:1px solid #2a2a3a;border-radius:6px;padding:4px 10px;margin:3px;font-size:14px;color:#e0e0e0">${this._esc(w)} <span style="color:#888;font-size:12px">${this._esc(info.tr||'')}</span></span>`;
    }).join('');
    el.innerHTML = `
      <div id="card-inner" class="word-card" style="min-height:280px;text-align:left;padding:28px 24px">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px">
          <span style="font-size:20px">✍️ AI 造句关卡</span>
          <span style="font-size:12px;color:#888">用学过的词写句子，AI 给你评分</span>
        </div>
        <div style="background:#0d1424;border:1px solid #1a2a4a;border-radius:8px;padding:14px 16px;font-size:15px;line-height:1.7;color:#cfe0ff;margin-bottom:12px">
          📝 ${this._esc(task.task)}${task.minWords?`<div style="color:#7da0d0;font-size:12px;margin-top:6px">建议至少写 ${task.minWords} 句</div>`:''}
        </div>
        <div style="margin-bottom:8px">${chips}</div>
        <textarea id="writing-input" placeholder="在这里写下你的句子（英文）…"
          style="width:100%;box-sizing:border-box;min-height:120px;background:#0a0a12;border:1px solid #2a2a3a;border-radius:8px;padding:12px;color:#e0e0e0;font-size:15px;line-height:1.6;resize:vertical"></textarea>
        <button class="btn btn-primary btn-lg" style="margin-top:12px;width:100%" onclick="VGReview.submitWriting()">提交给 AI 评估</button>
        <button class="btn" style="margin-top:6px;width:100%;background:#1a1a2e;color:#888" onclick="VGReview.finishCheckpoint()">跳过</button>
      </div>`;
    setTimeout(()=>{ const t=document.getElementById('writing-input'); if(t) t.focus(); }, 50);
  },

  async submitWriting() {
    const ta = document.getElementById('writing-input');
    const text = ta ? ta.value.trim() : '';
    if (!text) { if (ta) ta.focus(); return; }
    const el = document.getElementById('review-card');
    el.innerHTML = this._ckLoading('AI 正在评估你的造句…');
    const res = await VGAIVocab.evaluateWriting(this._writingTask.task, this._writingWords, text);
    if (!res) { this.renderWritingError(text); return; }
    this.renderWritingResult(res, text);
  },

  renderWritingError(text) {
    const el = document.getElementById('review-card');
    el.innerHTML = `<div class="word-card" style="min-height:240px;text-align:left;padding:28px 24px">
      <div style="color:#ff8c00;font-size:16px;margin-bottom:8px">⚠️ AI 评估失败（网络或额度问题），你的句子已保留：</div>
      <div style="background:#0a0a12;border:1px solid #2a2a3a;border-radius:8px;padding:12px;color:#e0e0e0;white-space:pre-wrap">${this._esc(text)}</div>
      <button class="btn btn-primary btn-lg" style="margin-top:16px;width:100%" onclick="VGReview.finishCheckpoint()">继续学习</button>
    </div>`;
  },

  renderWritingResult(res, userText) {
    const el = document.getElementById('review-card');
    const score = typeof res.score==='number' ? res.score : 0;
    const color = score>=80?'#4caf50':score>=60?'#eab308':'#ff6b6b';
    const perWord = (res.perWord||[]).map(p => `
      <div style="display:flex;gap:8px;align-items:flex-start;padding:5px 0;border-bottom:1px solid #1a1a2e;font-size:13px">
        <span>${p.used===false?'⬜':(p.correct?'✅':'❌')}</span>
        <span style="color:#4da6ff;min-width:90px">${this._esc(p.word||'')}</span>
        <span style="color:#aaa;flex:1">${this._esc(p.comment||'')}</span>
      </div>`).join('');
    el.innerHTML = `
      <div class="word-card" style="min-height:280px;text-align:left;padding:28px 24px">
        <div style="text-align:center;margin-bottom:14px">
          <div style="font-size:40px;font-weight:bold;color:${color}">${score}<span style="font-size:18px;color:#888">/100</span></div>
          <div style="color:#ccc;font-size:14px;margin-top:4px">${this._esc(res.summary||'')}</div>
        </div>
        <div style="font-size:12px;color:#888;margin:6px 0">你的造句</div>
        <div style="background:#0a0a12;border:1px solid #2a2a3a;border-radius:8px;padding:10px 12px;color:#e0e0e0;white-space:pre-wrap;font-size:14px;margin-bottom:12px">${this._esc(userText)}</div>
        ${perWord?`<div style="font-size:12px;color:#888;margin:6px 0">用词点评</div>${perWord}`:''}
        ${res.grammar?`<div style="background:#1a1206;border:1px solid #3a2a0a;border-radius:8px;padding:10px 12px;margin-top:12px;font-size:13px;color:#e8d8b0">🔍 ${this._esc(res.grammar)}</div>`:''}
        ${res.corrected?`<div style="background:#0a1a0a;border:1px solid #1a3a1a;border-radius:8px;padding:10px 12px;margin-top:10px;font-size:14px;color:#bfe8bf">✨ 更地道的写法：<br>${this._esc(res.corrected)}</div>`:''}
        <button class="btn btn-primary btn-lg" style="margin-top:16px;width:100%" onclick="VGReview.finishCheckpoint()">继续学习</button>
      </div>`;
  },

  // 未配置 API Key：仅列词供自我造句练习（无 AI 评分）
  renderSimpleCheckpoint(words) {
    const el = document.getElementById('review-card');
    const list = words.map((w,i) => {
      const info = this._aiWordInfos[w] || VG.getWord(w) || {};
      return `<div style="display:flex;align-items:center;gap:12px;padding:7px 0;border-bottom:1px solid #1a1a2e">
        <span style="color:#888;font-size:12px;width:20px">${i+1}.</span>
        <span style="color:#fff;font-size:16px;min-width:120px">${this._esc(w)}</span>
        <span style="color:#888;font-size:14px;flex:1">${this._esc(info.tr||'')}</span>
        <button class="audio-btn" onclick="VGReview._checkpointSpeak('${this._esc(w)}')" style="padding:4px 8px;font-size:12px">🔊</button>
      </div>`;
    }).join('');
    el.innerHTML = `
      <div id="card-inner" class="word-card" style="min-height:280px;text-align:left;padding:28px 24px">
        <div style="font-size:20px;margin-bottom:8px">✍️ 造句练习</div>
        <div style="font-size:13px;color:#aaa;margin-bottom:8px">试着用下面这些词各写一个句子（自我练习）</div>
        ${list}
        <div style="font-size:12px;color:#555;margin-top:10px">💡 在首页配置 DeepSeek API Key 后，这里会变成「AI 出题 + 评分」</div>
        <button class="btn btn-primary btn-lg" style="margin-top:14px;width:100%" onclick="VGReview.finishCheckpoint()">完成 · 继续</button>
      </div>`;
  },

  _checkpointSpeak(word) {
    try { const u=new SpeechSynthesisUtterance(word); u.lang='en-US'; u.rate=0.85; speechSynthesis.cancel(); speechSynthesis.speak(u); } catch(e){}
  },

  finishCheckpoint() {
    VGAIVocab.clearTask();
    VGAIVocab.clearCloze();
    this._aiCheckpointCount = 0;
    VGStore._set('ai_checkpoint_count', 0);
    this._aiWords = [];
    this._aiCheckpointReady = false;
    this.daily.total += 1;
    if (this.daily.total > 0) this.daily.correct += 1; // AI checkpoint counts as correct
    VGStore.setDaily(this.daily);
    this.nextCard();
  },

  speakWord() {
    if (!this.currentCard || !this.currentCard.word) return;
    try {
      // Pre-warm voices
      if (!speechSynthesis.getVoices().length) {
        speechSynthesis.getVoices();
        setTimeout(() => this._doSpeak(this.currentCard.word), 100);
      } else {
        this._doSpeak(this.currentCard.word);
      }
    } catch(e) {}
  },

  _doSpeak(word) {
    const u = new SpeechSynthesisUtterance(word);
    u.lang = 'en-US';
    u.rate = 0.85;
    u.volume = 1;
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
  },

  bindKeys() {
    document.addEventListener('keydown', (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
      if (e.key === ' ') {
        e.preventDefault();
        if (!this.flipped) this.flip();
      }
      if (this.flipped && ['1','2','3','4'].includes(e.key)) {
        e.preventDefault();
        this.rate(parseInt(e.key));
      }
    });
  },
};
