// store.js — localStorage wrapper for Vocab-Galaxy
// All keys prefixed "vg_". All reads/writes go through here.

const VGStore = {
  _get(k, fallback) {
    try {
      const v = localStorage.getItem('vg_' + k);
      return v ? JSON.parse(v) : fallback;
    } catch(e) { return fallback; }
  },

  _set(k, v) {
    try {
      localStorage.setItem('vg_' + k, JSON.stringify(v));
    } catch(e) {
      console.warn('localStorage full?', e);
    }
  },

  // ---- Cards ----
  getCards() { return this._get('cards', {}); },
  setCards(c) { this._set('cards', c); },
  getCard(w) { return this._get('cards', {})[w]; },

  // ---- Settings ----
  getSettings() {
    // Merge stored settings over defaults so newly-added keys (e.g. newPerDay)
    // always have a value even for users with an older saved settings object.
    const defaults = {
      retention: 0.9,
      newPerDay: 0,        // daily new-word cap; 0 = 不限（无限学习模式）
      modalities: ['recog', 'listen'],
      scheduler: 'fsrs',   // 'fsrs' or 'sm2'
      startBand: 6         // default skip band 5 (user knows ~5000)
    };
    return Object.assign(defaults, this._get('settings', {}));
  },
  setSettings(s) { this._set('settings', s); },

  // ---- AI Settings ----
  getAI() {
    return this._get('ai', {
      apiKey: '',
      enabled: false,
      explain: true,      // F1
      sentence_eval: true, // F2
      weakspot: true       // F3
    });
  },
  setAI(a) { this._set('ai', a); },

  // 本地日期 YYYY-MM-DD（按用户时区，而非 UTC，避免凌晨跨天判断错误）
  _ymd(d) {
    d = d || new Date();
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  },

  // ---- Daily stats ----
  getDaily() {
    const today = this._ymd();
    const d = this._get('daily', {date:'', newDone:0, reviewDone:0, correct:0, total:0});
    if (d.date !== today) {
      return {date: today, newDone:0, reviewDone:0, correct:0, total:0};
    }
    return d;
  },
  setDaily(d) { this._set('daily', d); },

  // ---- Review log ----
  getLog() { return this._get('log', []); },
  addLog(entry) {
    const log = this.getLog();
    log.push(entry);
    if (log.length > 5000) log.splice(0, log.length - 5000);
    this._set('log', log);
  },

  // ---- Streak ----
  getStreak() {
    return this._get('streak', {last:'', days:0});
  },
  updateStreak() {
    const today = this._ymd();
    let s = this.getStreak();
    if (s.last === today) return s;
    const yesterday = this._ymd(new Date(Date.now() - 86400000));
    if (s.last === yesterday) {
      s = {last: today, days: s.days + 1};
    } else {
      s = {last: today, days: 1};
    }
    this._set('streak', s);
    return s;
  },

  // ---- Band progress ----
  getProgress() {
    return this._get('progress', {currentBand:5, bandDone:{}});
  },
  setProgress(p) { this._set('progress', p); },

  // ---- AI word notes cache ----
  getWordNotes() { return this._get('word_notes', {}); },
  getWordNote(w) { return this._get('word_notes', {})[w]; },
  setWordNote(w, note) {
    const notes = this.getWordNotes();
    notes[w] = note;
    this._set('word_notes', notes);
  },

  // ---- 例句缓存（AI 实时生成的例句挖空，按词缓存，避免重复调用）----
  getExample(w) { return this._get('examples', {})[w]; },
  setExample(w, obj) {
    const e = this._get('examples', {});
    e[w] = obj;
    this._set('examples', e);
  },

  // ---- AI weak words ----
  getWeakWords() { return this._get('weak_words', {}); },
  recordWeakScore(w, rating) {
    // rating: 1=Again, 2=Hard
    const ws = this.getWeakWords();
    if (!ws[w]) ws[w] = {againCount:0, hardCount:0, drills:[]};
    if (rating === 1) ws[w].againCount++;
    if (rating === 2) ws[w].hardCount++;
    this._set('weak_words', ws);
    return ws[w];
  },

  // ---- Export / Import ----
  exportAll() {
    const keys = ['cards','settings','ai','log','streak','progress','word_notes','weak_words'];
    const data = {};
    for (const k of keys) data[k] = this._get(k, null);
    data.exportedAt = new Date().toISOString();
    return data;
  },
  importAll(data) {
    if (!data || typeof data !== 'object') return false;
    const keys = ['cards','settings','ai','log','streak','progress','word_notes','weak_words'];
    for (const k of keys) {
      if (data[k] !== undefined) this._set(k, data[k]);
    }
    return true;
  }
};
