// srs.js — SRS scheduler for Vocab-Galaxy
// Primary: ts-fsrs (CDN). Fallback: SM-2.

const VGSRS = {
  _fsrs: null,
  _ready: false,
  _mode: 'fsrs', // 'fsrs' or 'sm2'

  async init() {
    const settings = VGStore.getSettings();
    this._mode = settings.scheduler || 'fsrs';
    if (this._mode === 'sm2') { this._ready = true; return true; }

    try {
      const mod = await import('https://cdn.jsdelivr.net/npm/ts-fsrs@4.6.1/+esm');
      this._fsrs = mod.fsrs(mod.generatorParameters({
        request_retention: settings.retention || 0.9,
        enable_fuzz: true
      }));
      this._Rating = mod.Rating;
      this._createEmptyCard = mod.createEmptyCard;
      this._ready = true;
      console.log('VGSRS: FSRS loaded');
      return true;
    } catch(e) {
      console.warn('FSRS CDN failed, falling back to SM-2:', e.message);
      this._mode = 'sm2';
      this._ready = true;
      return true;
    }
  },

  // Create initial card for a new word
  newCard(now) {
    now = now || new Date();
    if (this._mode === 'fsrs' && this._fsrs) {
      const card = this._createEmptyCard(now);
      return this._serializeCard(card);
    }
    // SM-2 new card
    return { ef: 2.5, reps: 0, interval: 0, due: now.toISOString() };
  },

  // Schedule next review. rating: 1=Again, 2=Hard, 3=Good, 4=Easy
  schedule(card, ratingNum, now) {
    now = now || new Date();
    if (this._mode === 'fsrs' && this._fsrs) {
      return this._scheduleFSRS(card, ratingNum, now);
    }
    return this._scheduleSM2(card, ratingNum, now);
  },

  _scheduleFSRS(card, ratingNum, now) {
    const ratingMap = {1: this._Rating.Again, 2: this._Rating.Hard, 3: this._Rating.Good, 4: this._Rating.Easy};
    const rating = ratingMap[ratingNum] || this._Rating.Good;
    // Deserialize dates
    const c = {
      ...card,
      due: new Date(card.due),
      last_review: card.last_review ? new Date(card.last_review) : undefined
    };
    const rec = this._fsrs.repeat(c, now);
    const newCard = rec[rating].card;
    return this._serializeCard(newCard);
  },

  _scheduleSM2(card, ratingNum, now) {
    const qMap = {1:2, 2:3, 3:4, 4:5};
    const q = qMap[ratingNum] || 4;
    let { ef=2.5, reps=0, interval=0 } = card;

    if (q <= 2) { // Again: full reset
      reps = 0;
      interval = 0;
    } else if (q === 3) { // Hard: partial reset, don't lose all progress
      reps = Math.max(0, reps - 2);
      interval = Math.max(1, Math.round(interval * 0.4));
    } else {
      reps += 1;
      if (reps === 1) interval = 1;
      else if (reps === 2) interval = 6;
      else interval = Math.round(interval * ef);
    }
    ef = Math.max(1.3, ef + (0.1 - (5-q)*(0.08 + (5-q)*0.02)));

    const due = new Date(now.getTime() + interval * 86400000);
    return {
      ef: parseFloat(ef.toFixed(2)),
      reps,
      interval,
      due: due.toISOString()
    };
  },

  _serializeCard(c) {
    return {
      due: c.due instanceof Date ? c.due.toISOString() : String(c.due),
      stability: c.stability,
      difficulty: c.difficulty,
      elapsed_days: c.elapsed_days,
      scheduled_days: c.scheduled_days,
      reps: c.reps,
      lapses: c.lapses,
      state: c.state,
      last_review: c.last_review instanceof Date ? c.last_review.toISOString() : (c.last_review || null)
    };
  },

  getMode() { return this._mode; }
};

window.VGSRS = VGSRS;
