// dashboard.js — Home page for Vocab-Galaxy

const VGDashboard = {
  async init() {
    this.renderStats();
    this.renderBands();
    this.renderSettings();
    this.bindEvents();
  },

  renderStats() {
    const cards = VGStore.getCards();
    const now = new Date();
    const daily = VGStore.getDaily();
    const streak = VGStore.getStreak();
    const progress = VGStore.getProgress();

    // Count due reviews
    let dueCount = 0;
    for (const [w, card] of Object.entries(cards)) {
      if (new Date(card.due) <= now) dueCount++;
    }

    // Most recently studied words
    const log = VGStore.getLog();
    const recentlyStudied = new Set(log.slice(-50).map(l => l.w));

    document.getElementById('stats-area').innerHTML = `
      <div class="stat-grid">
        <div class="stat-card">
          <div class="stat-num" style="color:${dueCount > 0 ? '#f59e0b' : '#4caf50'}">${dueCount}</div>
          <div class="stat-label">待复习</div>
        </div>
        <div class="stat-card">
          <div class="stat-num">${Object.keys(cards).length}</div>
          <div class="stat-label">已学词汇</div>
        </div>
        <div class="stat-card">
          <div class="stat-num">${streak.days || 0}</div>
          <div class="stat-label">连续打卡</div>
        </div>
        <div class="stat-card">
          <div class="stat-num">${daily.total}</div>
          <div class="stat-label">今日复习</div>
        </div>
      </div>
    `;
  },

  renderBands() {
    const meta = VG.getMeta();
    const cards = VGStore.getCards();
    const progress = VGStore.getProgress();
    const currentBand = progress.currentBand || 5;

    let html = '';
    for (const band of (meta.bands || [])) {
      // Count learned in this band
      let learned = 0;
      for (const [w] of Object.entries(cards)) {
        const info = VG.getWord(w);
        if (info && info.band === band.id) learned++;
      }
      const pct = band.count > 0 ? Math.round(learned / band.count * 100) : 0;
      const isCur = band.id === currentBand;
      const isLocked = band.id > currentBand;

      html += `
        <div class="band-row ${isLocked ? 'locked' : ''} ${isCur ? 'current' : ''}">
          <div class="label">${band.title}</div>
          <div class="progress-bar">
            <div class="progress-fill" style="width:${pct}%"></div>
          </div>
          <div class="count">${learned}/${band.count}</div>
        </div>
      `;
    }
    document.getElementById('bands-area').innerHTML = html;
  },

  renderSettings() {
    const ai = VGStore.getAI();
    const settings = VGStore.getSettings();
    document.getElementById('settings-area').innerHTML = `
      <h3 style="margin-bottom:12px">⚙️ 设置</h3>

      <div class="setting-row">
        <label>起始 Band</label>
        <select id="start-band-select" style="width:100px">
          ${[5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20].map(b =>
            `<option value="${b}" ${b === (settings.startBand||6) ? 'selected' : ''}>Band ${b}</option>`
          ).join('')}
        </select>
        <span style="font-size:12px;color:#888">跳过更低 band 的词汇</span>
      </div>

      <div class="setting-row">
        <label>每日新词上限</label>
        <input type="number" id="new-per-day-input" min="0" max="500" step="5"
               value="${settings.newPerDay != null ? settings.newPerDay : 0}" style="width:100px">
        <span style="font-size:12px;color:#888"><strong>0 = 不限（无限学习）</strong>；填数字则限制每日新词</span>
      </div>

      <div class="setting-row">
        <label>目标保留率</label>
        <select id="retention-select" style="width:100px">
          ${[0.85,0.87,0.9,0.92,0.95].map(r =>
            `<option value="${r}" ${r === (settings.retention||0.9) ? 'selected' : ''}>${Math.round(r*100)}%</option>`
          ).join('')}
        </select>
        <span style="font-size:12px;color:#888">越高记得越牢但复习越多（FSRS）</span>
      </div>

      <div class="setting-row">
        <label>复习模态</label>
        <span>
          ${[['recog','识别',true],['listen','听音',true],['cloze','例句挖空',true],['build','词缀拼装',true]].map(([k,name,ready]) =>
            `<label style="margin-right:14px;font-weight:normal;cursor:${ready?'pointer':'not-allowed'};opacity:${ready?1:0.45}">
              <input type="checkbox" class="modality-cb" value="${k}" ${ready?'':'disabled'}
                ${(settings.modalities||['recog','listen']).includes(k) ? 'checked' : ''}> ${name}</label>`
          ).join('')}
        </span>
      </div>

      <div class="setting-row">
        <label>DeepSeek API Key</label>
        <input type="password" id="api-key-input" value="${ai.apiKey || ''}" placeholder="sk-..."
               style="width:280px">
      </div>
      <div style="margin-top:12px">
        <button class="btn btn-primary" onclick="VGDashboard.saveSettings()">保存设置</button>
        <span style="margin-left:12px;font-size:13px;color:${ai.enabled && ai.apiKey ? '#4caf50' : '#888'}">
          ${ai.enabled && ai.apiKey ? '● AI 已就绪' : '○ AI 未配置'}
        </span>
      </div>

      <h3 style="margin-top:24px;margin-bottom:12px">💾 数据备份</h3>
      <p style="font-size:12px;color:#666;margin-bottom:8px">浏览器 localStorage 会自动保存。只在换设备或清浏览器时手动导出。</p>
      <div class="flex">
        <button class="btn" style="background:#2a2a3a;color:#4da6ff" onclick="VGDashboard.exportData()">导出 JSON</button>
        <button class="btn" style="background:#2a2a3a;color:#ff8c00" onclick="document.getElementById('import-file').click()">导入 JSON</button>
        <input type="file" id="import-file" accept=".json" style="display:none" onchange="VGDashboard.importData(this)">
      </div>
    `;
  },

  toggleFeat(feat) {
    const ai = VGStore.getAI();
    ai[feat] = !ai[feat];
    VGStore.setAI(ai);
    this.renderSettings();
  },

  saveSettings() {
    const keyInput = document.getElementById('api-key-input');
    const ai = VGStore.getAI();
    ai.apiKey = keyInput.value.trim();
    ai.enabled = !!ai.apiKey;
    VGStore.setAI(ai);

    const settings = VGStore.getSettings();
    const bandSelect = document.getElementById('start-band-select');
    if (bandSelect) settings.startBand = parseInt(bandSelect.value);

    const npd = document.getElementById('new-per-day-input');
    if (npd) {
      const v = parseInt(npd.value);
      settings.newPerDay = isNaN(v) ? 20 : Math.max(0, Math.min(200, v));
    }

    const ret = document.getElementById('retention-select');
    if (ret) settings.retention = parseFloat(ret.value);

    const mods = Array.from(document.querySelectorAll('.modality-cb'))
      .filter(cb => cb.checked).map(cb => cb.value);
    if (mods.length) settings.modalities = mods;  // never let it be empty

    VGStore.setSettings(settings);

    this.renderSettings();
    alert(ai.enabled ? '设置已保存 ✓ AI 功能已启用' : '设置已保存 ✓');
  },

  exportData() {
    const data = VGStore.exportAll();
    const blob = new Blob([JSON.stringify(data, null, 2)], {type:'application/json'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `vocab-galaxy-backup-${new Date().toISOString().slice(0,10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  },

  importData(input) {
    const file = input.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = JSON.parse(e.target.result);
        if (VGStore.importAll(data)) {
          alert('数据已导入！刷新页面查看。');
          location.reload();
        } else {
          alert('导入失败：数据格式不正确');
        }
      } catch(err) {
        alert('导入失败：' + err.message);
      }
    };
    reader.readAsText(file);
  },

  bindEvents() {
    // Start review button
    const btn = document.getElementById('start-review-btn');
    if (btn) {
      btn.addEventListener('click', () => {
        window.location.href = 'review.html';
      });
    }
  }
};
