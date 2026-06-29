// ai-vocab.js — Vocab-Galaxy AI 写作关卡
// AI 用最近学的 N 个词出一道造句/写作题 → 学生造句 → AI 评估造句能力。

function _vgExtractJSON(text) {
  const s = text.indexOf('{'), e = text.lastIndexOf('}') + 1;
  if (s < 0 || e <= s) throw new Error('no JSON in response');
  return JSON.parse(text.slice(s, e));
}

const VGAIVocab = {

  // 出题：用这些词出一道造句题（给场景，要求尽量用上目标词）
  async generateWritingTask(words, wordInfos) {
    if (!VGAI.enabled) return null;
    const wordList = words.map(w => `${w}(${(wordInfos[w] || {}).tr || ''})`).join('、');
    const prompt = `你是英语写作老师。学生刚学了这 ${words.length} 个单词：${wordList}

请出一道造句/写作小题，要求学生用上其中尽量多的词。题目要给一个具体的场景或主题，让学生有话可写，难度适合中级学习者（不要太长）。

用 JSON 返回（只返回 JSON）：
{"task":"题目说明，中文，含场景/要求","mustUse":[${words.map(w=>`"${w}"`).join(',')}],"minWords":2}
其中 minWords 是建议至少写的句子数(2-4)。`;
    try {
      const text = await VGAI.call(prompt, 600, 0.8);
      const data = _vgExtractJSON(text);
      data.generatedAt = new Date().toISOString();
      data.words = words;
      if (!data.mustUse || !data.mustUse.length) data.mustUse = words;
      return data;
    } catch (e) {
      console.warn('AI 出题失败:', e.message);
      return null;
    }
  },

  // 评估：对学生的造句打分 + 逐词点评 + 改写
  async evaluateWriting(task, words, userText) {
    if (!VGAI.enabled) return null;
    const prompt = `你是严格但鼓励的英语写作老师。请评估学生对目标词的运用和造句能力。

目标词：${words.join(', ')}
题目：${task}
学生的造句：
"""
${userText}
"""

用 JSON 返回（只返回 JSON，中文点评，corrected 用英文）：
{
 "score": 0到100的整数总分,
 "summary": "一句话总评",
 "perWord": [{"word":"目标词","used":true或false,"correct":true或false,"comment":"该词用得对不对、地道不地道，简短"}],
 "grammar": "语法/搭配/用词的主要问题，简短",
 "corrected": "把学生的句子改写成更地道的英文版本"
}
perWord 必须覆盖每一个目标词。`;
    try {
      const text = await VGAI.call(prompt, 1200, 0.4);
      return _vgExtractJSON(text);
    } catch (e) {
      console.warn('AI 评估失败:', e.message);
      return null;
    }
  },

  // 完形填空：用刚学的词生成一篇短文，挖掉其中 6 个词
  async generateCloze(words, wordInfos) {
    if (!VGAI.enabled) return null;
    const wordList = words.map(w => `${w}(${(wordInfos[w] || {}).tr || ''})`).join('、');
    const prompt = `你是英语教学专家。学生刚学了这 ${words.length} 个单词：${wordList}

请创作一篇连贯、有趣、场景自然的英语短文（80-120词），自然地用上其中恰好 6 个单词。然后把这 6 个被用到的单词替换成 ______（6 个下划线），短文其余部分完整保留。

用 JSON 返回（只返回 JSON）：
{"passage":"短文，其中恰好 6 处是 ______","blanks":[{"answer":"被挖掉的原词","hint":"简短中文提示"}]}
blanks 数组按 ______ 在短文中出现的先后顺序排列，长度必须正好是 6。`;
    try {
      const text = await VGAI.call(prompt, 1000, 0.8);
      const data = _vgExtractJSON(text);
      if (!data.passage || !Array.isArray(data.blanks) || !data.blanks.length) return null;
      data.generatedAt = new Date().toISOString();
      return data;
    } catch (e) {
      console.warn('AI 完形填空生成失败:', e.message);
      return null;
    }
  },

  // 例句挖空：给单个词造一个地道例句，并把该词挖成 ______
  async generateExample(word, info) {
    if (!VGAI.enabled) return null;
    const prompt = `给英语单词 "${word}"（中文：${(info && info.tr) || ''}）造一个地道、生活化的英文例句（10-18 词），难度适合中级学习者。
然后把句子中的 "${word}"（或它的相应变形）替换成 ______（6 个下划线）。

用 JSON 返回（只返回 JSON）：
{"blanked":"含且仅含一个 ______ 的句子","answer":"被替换掉的实际词形","cn":"整句中文翻译"}`;
    try {
      const text = await VGAI.call(prompt, 400, 0.7);
      const d = _vgExtractJSON(text);
      if (!d.blanked || d.blanked.indexOf('___') < 0) return null;
      if (!d.answer) d.answer = word;
      d.generatedAt = new Date().toISOString();
      return d;
    } catch (e) {
      console.warn('AI 例句生成失败:', e.message);
      return null;
    }
  },

  // 翻译题：AI 生成中文段落，让学生翻译成英文
  async generateTranslationTask(words, wordInfos) {
    if (!VGAI.enabled) return null;
    const wordList = words.map(w => `${w}（${(wordInfos[w] || {}).tr || ''}）`).join('、');
    const prompt = `你是英语教学专家。请用中文写一段自然的短文（60-100字），内容要能让学生在翻译时用上这 ${words.length} 个英语单词：${wordList}

段落中要自然包含这些单词的中文含义。让学生翻译时能用上这些英文词。

用 JSON 返回（只返回 JSON）：
{"cn":"中文原文（60-100字）","en":"对应的地道英文翻译（参考答案，自然地使用目标词汇）","mustUse":${JSON.stringify(words)}}`;
    try {
      const text = await VGAI.call(prompt, 800, 0.7);
      const data = _vgExtractJSON(text);
      data.generatedAt = new Date().toISOString();
      data.words = words;
      if (!data.mustUse) data.mustUse = words;
      return data;
    } catch(e) {
      console.warn('AI 翻译题生成失败:', e.message);
      return null;
    }
  },

  // 评估翻译：对学生翻译打分 + 逐词点评
  async evaluateTranslation(cnText, enRef, words, userTranslation) {
    if (!VGAI.enabled) return null;
    const prompt = `你是英语翻译老师。请评估学生的翻译质量和目标词汇使用情况。

原文（中文）：${cnText}
参考译文：${enRef}
目标词汇：${words.join(', ')}
学生的翻译：
"""
${userTranslation}
"""

用 JSON 返回（只返回 JSON，中文点评，corrected 用英文）：
{
 "score": 0到100的整数总分,
 "summary": "一句话总评",
 "perWord": [{"word":"目标词","used":true或false,"correct":true或false,"comment":"该词用得对不对，简短"}],
 "grammar": "翻译/语法/用词的主要问题，简短",
 "corrected": "更地道的英文翻译版本"
}
perWord 必须覆盖每一个目标词。`;
    try {
      const text = await VGAI.call(prompt, 1200, 0.4);
      return _vgExtractJSON(text);
    } catch(e) {
      console.warn('AI 翻译评估失败:', e.message);
      return null;
    }
  },

  // 当前题目缓存（刷新/重入不重复出题）
  getCachedTask() {
    try { const d = VGStore._get('ai_task', null); return (d && d.task) ? d : null; }
    catch (e) { return null; }
  },
  saveTask(d) { VGStore._set('ai_task', d); },
  clearTask() { VGStore._set('ai_task', null); },

  getCachedCloze() {
    try { const d = VGStore._get('ai_cloze', null); return (d && d.passage) ? d : null; }
    catch (e) { return null; }
  },
  saveCloze(d) { VGStore._set('ai_cloze', d); },
  clearCloze() { VGStore._set('ai_cloze', null); }
};
