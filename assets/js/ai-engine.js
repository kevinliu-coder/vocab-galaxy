/* ai-engine.js — Adapted from knowledge-universe for Vocab-Galaxy */
const VGAI = {
  endpoint: 'https://api.deepseek.com/v1/chat/completions',
  model: 'deepseek-chat',

  get apiKey() {
    const s = VGStore.getAI();
    return s.apiKey || '';
  },
  get enabled() {
    const s = VGStore.getAI();
    return s.enabled && !!s.apiKey;
  },
  isOn(feature) {
    const s = VGStore.getAI();
    return s[feature] !== false;
  },

  async call(prompt, maxTokens=800, temperature=0.7) {
    if (!this.enabled) throw new Error('AI未启用：请先在首页设置中配置 DeepSeek API Key');
    const resp = await fetch(this.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type':'application/json',
        'Authorization': 'Bearer ' + this.apiKey
      },
      body: JSON.stringify({
        model: this.model,
        messages: [{role:'user', content: prompt}],
        temperature,
        max_tokens: maxTokens
      })
    });
    const data = await resp.json();
    if (data.error) throw new Error(data.error.message || 'API错误');
    this.trackTokens(data.usage?.total_tokens || maxTokens);
    return data.choices?.[0]?.message?.content || '';
  },

  trackTokens(t) {
    const s = VGStore.getAI();
    s._tokens = (s._tokens || 0) + t;
    VGStore.setAI(s);
  },

  getTokenCount() {
    return VGStore.getAI()._tokens || 0;
  }
};
