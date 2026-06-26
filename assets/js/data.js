// data.js — data access layer for Vocab-Galaxy
// Loads the full word list (words.json, ~11.7k words), provides lookup API.

const VG = {
  _words: null,
  _bands: {},
  _meta: null,
  _ready: false,
  _initPromise: null,

  async init() {
    if (this._ready) return true;
    // Data is inlined via <script src="assets/data/bundle.js"> (window.VG_DATA),
    // so the site runs from file:// with no fetch and no local server.
    const D = (typeof window !== 'undefined') ? window.VG_DATA : null;
    if (!D || !D.words) {
      console.error('VG.init: window.VG_DATA missing — 请确认 index.html 在 data.js 之前引入了 assets/data/bundle.js');
      return false;
    }
    this._meta = D.meta;
    this._words = D.words;
    this._affixes = D.affixes || {};
    this._lookup = {};
    for (const w of this._words) this._lookup[w.w] = w;
    this._ready = true;
    console.log(`VG data loaded: ${this._words.length} words, ${this._meta.bands.length} bands (inline)`);
    return true;
  },

  getAffixes() { return this._affixes || {}; },

  getWords() { return this._words; },
  getWord(w) { return this._lookup ? this._lookup[w] : null; },
  getMeta() { return this._meta; },
  getBandCount() { return this._meta ? this._meta.bands.length : 0; },

  // Get band info for a specific band id
  getBandInfo(id) {
    if (!this._meta) return null;
    return this._meta.bands.find(b => b.id === id);
  },

  // Words of a band — derived from the inline word list (cached), no fetch.
  loadBand(id) {
    if (this._bands[id]) return this._bands[id];
    const data = (this._words || []).filter(w => w.band === id);
    this._bands[id] = data;
    return data;
  },

  // Kept async for call-site compatibility; resolves immediately.
  async getBandWords(id) {
    return this.loadBand(id);
  },

  // Find which band a word belongs to (from data)
  getWordBand(w) {
    const word = this.getWord(w);
    return word ? word.band : null;
  },

  // Get all band ids in order
  getBandIds() {
    if (!this._meta) return [];
    return this._meta.bands.map(b => b.id);
  }
};
