/* 背单词 · 艾宾浩斯 —— 纯前端，进度存在 localStorage */
(() => {
  'use strict';

  const LS_KEY = 'vocab-trainer-v1';
  const BANKS = window.VOCAB_BANKS || { primary: { words: [] }, junior: { words: [] }, senior: { words: [] } };
  const EXAMPLES = window.VOCAB_EXAMPLES || {};
  const GROUPS = window.VOCAB_GROUPS || { pos: {}, prefix: {}, suffix: {}, root: {} };
  const GROUP_DIMS = [
    ['pos', '词性', '名词 / 动词 / 形容词…按词性归堆'],
    ['prefix', '前缀', 'un- / re- / dis- 这类造词零件'],
    ['suffix', '后缀', '名词、形容词、动词的常见收尾'],
    ['root', '词根', 'spect / port / dict…同根词放一起'],
  ];
  // 单词 → 所属词性组 / 词根组（学习卡上的小标签、单词表分组都用它）
  const POS_OF = new Map();
  const ROOT_OF = new Map();
  for (const [dim, map] of [['pos', POS_OF], ['root', ROOT_OF]]) {
    for (const level of Object.keys(GROUPS[dim] || {})) {
      for (const g of GROUPS[dim][level]) for (const w of g.words) if (!map.has(w)) map.set(w, g);
    }
  }
  const LEVEL_NAMES = { primary: '小学', junior: '初中', senior: '高中' };
  const LEVEL_EMOJI = { primary: '🧸', junior: '📗', senior: '🎓' };

  // 艾宾浩斯间隔（分钟）：10m → 12h → 1d → 2d → 4d → 7d → 15d → 30d → 60d
  const STEPS = [10, 720, 1440, 2880, 5760, 10080, 21600, 43200, 86400];
  const MASTER_STAGE = STEPS.length;
  const CHUNK = 80; // 单轮最多做多少张
  const DICTATE_SIZE = 20; // 听写一轮多少词
  const MISTAKE_CLEAR_STREAK = 2; // 错词连续答对几次自动移出错词本

  const $ = (s, r = document) => r.querySelector(s);

  // ---------- 词条索引 ----------
  const WORD_INDEX = new Map();
  for (const k of Object.keys(LEVEL_NAMES)) {
    for (const e of BANKS[k]?.words || []) if (!WORD_INDEX.has(e.w)) WORD_INDEX.set(e.w, { ...e, level: k });
  }

  // ---------- 状态 ----------
  const blank = () => ({
    version: 1,
    profile: null,
    words: {},
    mistakes: {},
    day: { key: '', newDone: 0, reviewDone: 0 },
    days: {},
  });
  let state = (() => {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (!raw) return blank();
      const s = Object.assign(blank(), JSON.parse(raw));
      if (!s.mistakes || typeof s.mistakes !== 'object') s.mistakes = {};
      return s;
    } catch { return blank(); }
  })();
  const save = () => { try { localStorage.setItem(LS_KEY, JSON.stringify(state)); } catch (e) { /* 隐私模式忽略 */ } };

  const todayKey = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };

  function ensureDay() {
    const k = todayKey();
    if (state.day.key === k) return;
    if (state.day.key) state.days[state.day.key] = { n: state.day.newDone, r: state.day.reviewDone };
    state.day = { key: k, newDone: 0, reviewDone: 0 };
    save();
  }

  const rec = (w) => state.words[w];
  const learnedCount = () => Object.keys(state.words).length;
  const masteredCount = () => Object.values(state.words).filter((r) => r.s >= MASTER_STAGE).length;
  const mistakeCount = () => Object.keys(state.mistakes).length;

  function dueWords() {
    const now = Date.now();
    return Object.entries(state.words)
      .filter(([, r]) => r.s >= 1 && r.due <= now)
      .sort((a, b) => a[1].due - b[1].due)
      .map(([w]) => w);
  }

  function newWords(n) {
    const list = BANKS[state.profile.level]?.words || [];
    const out = [];
    for (const e of list) {
      if (out.length >= n) break;
      if (!state.words[e.w]) out.push(e.w);
    }
    return out;
  }

  function streak() {
    const keys = new Set(Object.keys(state.days));
    keys.add(state.day.key);
    let n = 0;
    const d = new Date();
    for (;;) {
      const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      if (keys.has(k)) { n++; d.setDate(d.getDate() - 1); } else break;
    }
    return n;
  }

  // ---------- 例句 / 错词本 ----------
  const exampleFor = (w) => {
    const ex = EXAMPLES[w];
    if (!ex) return null;
    return { en: ex[0] || '', cn: ex[1] || '' };
  };

  function bumpMistake(w) {
    const m = state.mistakes[w] || { n: 0, streak: 0 };
    m.n = (m.n || 0) + 1;
    m.streak = 0;
    m.last = Date.now();
    state.mistakes[w] = m;
  }

  function easeMistake(w) {
    const m = state.mistakes[w];
    if (!m) return;
    m.streak = (m.streak || 0) + 1;
    m.last = Date.now();
    if (m.streak >= MISTAKE_CLEAR_STREAK) delete state.mistakes[w];
  }

  function mistakeWords() {
    return Object.keys(state.mistakes)
      .filter((w) => state.words[w] || WORD_INDEX.has(w))
      .sort((a, b) => (state.mistakes[b].n || 0) - (state.mistakes[a].n || 0));
  }

  // ---------- 会话 ----------
  let session = null; // { queue:[{w,isNew}], idx, good, hard, again, total, mode, typed, verdict }
  let revealed = false;
  let view = session ? 'study' : (state.profile ? 'home' : 'onboarding');
  let draft = { level: 'junior', dailyNew: 15 };
  let listFilter = 'learned';
  let groupDim = 'root';
  let groupOpen = '';

  function startSession(mode, extra) {
    ensureDay();
    let queue = [];
    if (mode === 'today') {
      for (const w of dueWords()) queue.push({ w, isNew: false });
      const remaining = Math.max(0, state.profile.dailyNew - state.day.newDone);
      for (const w of newWords(remaining)) queue.push({ w, isNew: true });
    } else if (mode === 'review') {
      for (const w of dueWords()) queue.push({ w, isNew: false });
    } else if (mode === 'dictate') {
      const now = Date.now();
      const known = Object.entries(state.words)
        .filter(([, r]) => r.s >= 1)
        .map(([w, r]) => ({ w, due: r.due, last: r.last || 0 }));
      known.sort((a, b) => (a.due <= now ? 0 : 1) - (b.due <= now ? 0 : 1) || b.last - a.last);
      queue = known.slice(0, DICTATE_SIZE).map((x) => ({ w: x.w, isNew: false }));
    } else if (mode === 'mistake') {
      queue = mistakeWords().slice(0, DICTATE_SIZE).map((w) => ({ w, isNew: false }));
    } else if (mode === 'group') {
      queue = (extra || []).map((w) => ({ w, isNew: !state.words[w] }));
    }
    if (!queue.length) {
      toast(mode === 'mistake' ? '错词本是空的 🎉'
        : mode === 'dictate' ? '先去背几个词再来听写'
        : mode === 'group' ? '这一组还没有可以练的词'
        : '今天没有要背的了 🌿');
      return;
    }
    const trimmed = queue.slice(0, CHUNK);
    session = {
      queue: trimmed, idx: 0, good: 0, hard: 0, again: 0,
      total: queue.length, mode,
      typed: '', verdict: null,
    };
    revealed = false;
    view = 'study';
    render();
    if (mode === 'dictate') speakCurrent();
  }

  function speakCurrent() {
    if (!session) return;
    const item = session.queue[session.idx];
    if (item) speak(WORD_INDEX.get(item.w)?.w || item.w);
  }

  function grade(q) {
    const { w } = session.queue[session.idx];
    const now = Date.now();
    const isNew = !state.words[w];
    const r = state.words[w] || { s: 0, seen: 0, right: 0, wrong: 0 };

    if (q === 2) {
      r.s = Math.min(r.s + 1, MASTER_STAGE);
      r.due = now + STEPS[Math.min(r.s, MASTER_STAGE) - 1] * 60000;
      r.right = (r.right || 0) + 1;
      session.good++;
      easeMistake(w);
    } else if (q === 1) {
      r.s = Math.max(1, Math.min(r.s, MASTER_STAGE));
      r.due = now + 10 * 60000;
      r.wrong = (r.wrong || 0) + 1;
      session.hard++;
    } else {
      r.s = 1;
      r.due = now + 5 * 60000;
      r.wrong = (r.wrong || 0) + 1;
      session.again++;
      bumpMistake(w);
    }
    r.seen = (r.seen || 0) + 1;
    r.last = now;
    r.lvl = r.lvl || state.profile.level;
    state.words[w] = r;

    if (isNew && session.mode === 'group') {
      // 分组练习不占「每日新词」额度，随时想练哪组就练哪组
    } else if (isNew) state.day.newDone++;
    else state.day.reviewDone++;
    save();

    session.idx++;
    revealed = false;
    session.typed = '';
    session.verdict = null;
    if (session.idx >= session.queue.length) { view = 'done'; }
    render();
    if (view === 'study' && session.mode === 'dictate') speakCurrent();
  }

  const normalize = (s) => String(s).toLowerCase().replace(/[^a-z'\- ]+/g, '').replace(/\s+/g, ' ').trim();

  function checkDictation() {
    if (!session || session.mode !== 'dictate') return;
    const item = session.queue[session.idx];
    const answer = normalize(item.w);
    const typed = normalize(session.typed);
    if (!typed) return;
    session.verdict = typed === answer ? 'ok' : 'no';
    render();
    if (session.verdict === 'ok') {
      setTimeout(() => { if (session && session.verdict === 'ok') grade(2); }, 620);
    }
  }

  // ---------- 发音 ----------
  function speak(text) {
    try {
      if (!('speechSynthesis' in window)) return;
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'en-US';
      u.rate = 0.92;
      speechSynthesis.speak(u);
    } catch { /* 忽略 */ }
  }

  let toastTimer = null;
  function toast(msg) {
    let el = $('#toast');
    if (!el) { el = document.createElement('div'); el.id = 'toast'; el.className = 'toast'; document.body.appendChild(el); }
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 1800);
  }

  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function ago(ts) {
    if (!ts) return '';
    const d = Math.floor((Date.now() - ts) / 60000);
    if (d < 1) return '刚刚';
    if (d < 60) return d + ' 分钟前';
    if (d < 1440) return Math.floor(d / 60) + ' 小时前';
    return Math.floor(d / 1440) + ' 天前';
  }

  function tagLine(w) {
    const pos = POS_OF.get(w);
    const root = ROOT_OF.get(w);
    if (!pos && !root) return '';
    return `<div class="tags">
      ${pos ? `<span class="tag">${esc(pos.label)}</span>` : ''}
      ${root ? `<span class="tag root">${esc(root.label)}${root.meaning ? ` · ${esc(root.meaning)}` : ''}</span>` : ''}
    </div>`;
  }

  function exampleBlock(w) {    const ex = exampleFor(w);
    if (!ex) return '';
    return `<div class="example">
      <div class="ex-en">${esc(ex.en)}</div>
      ${ex.cn ? `<div class="ex-cn">${esc(ex.cn)}</div>` : ''}
    </div>`;
  }

  // ---------- 视图 ----------
  function topbar(right = '') {
    return `<div class="topbar">
      <div class="brand"><span class="dot"></span><h1>背单词</h1></div>
      ${right}
    </div>`;
  }

  function renderOnboarding() {
    const counts = Object.fromEntries(Object.keys(LEVEL_NAMES).map((k) => [k, (BANKS[k]?.words || []).length]));
    return `${topbar()}
    <div class="card hero">
      <div class="big" style="font-size:28px">从今天开始，<br>把单词一个一个拿下。</div>
      <p class="muted" style="margin:10px 0 0">选一个词库，定一个每日计划；背过的词会按艾宾浩斯曲线自动安排复习。</p>
    </div>
    <div class="card">
      <h3>1 · 选择词库</h3>
      <div class="levels" style="margin-top:12px">
        ${Object.keys(LEVEL_NAMES).map((k) => `
          <button class="level" data-act="pick-level" data-level="${k}" aria-pressed="${draft.level === k}">
            <span class="emoji">${LEVEL_EMOJI[k]}</span>
            <span class="grow" style="text-align:left">
              <span class="name" style="display:block">${LEVEL_NAMES[k]}</span>
              <span class="count">${counts[k].toLocaleString()} 词</span>
            </span>
          </button>`).join('')}
      </div>
      <h3 style="margin-top:22px">2 · 每日新词</h3>
      <div class="row wrap" style="margin-top:12px">
        <div class="seg">
          ${[5, 10, 15, 20, 30].map((n) => `<button data-act="pick-daily" data-n="${n}" aria-pressed="${draft.dailyNew === n}">${n}</button>`).join('')}
        </div>
        <span class="small muted">词 / 天</span>
      </div>
      <button class="btn primary wide" style="margin-top:22px" data-act="create-plan">开始计划</button>
    </div>`;
  }

  function renderHome() {
    ensureDay();
    const due = dueWords().length;
    const remaining = Math.max(0, state.profile.dailyNew - state.day.newDone);
    const est = Math.min(due + remaining, CHUNK);
    const pct = state.profile.dailyNew ? Math.min(100, Math.round((state.day.newDone / state.profile.dailyNew) * 100)) : 0;
    const levelName = LEVEL_NAMES[state.profile.level];
    const mis = mistakeCount();
    const learned = learnedCount();

    return `${topbar(`<button class="chip" data-act="settings">${levelName} · 每日 ${state.profile.dailyNew} 词</button>`)}
    <div class="card hero">
      <div class="big">${remaining}<small>个新词待学</small></div>
      <div class="plan-row"><span>今日新词 ${state.day.newDone} / ${state.profile.dailyNew}</span><span>今日复习 ${state.day.reviewDone}</span></div>
      <div class="bar" style="margin-top:8px"><i style="width:${pct}%"></i></div>
      <div style="display:grid;gap:10px;margin-top:18px">
        <button class="btn primary wide" data-act="start" ${est ? '' : 'disabled'}>
          开始今日学习${est ? ` · ${est} 张` : ' · 已完成'}
        </button>
        ${due ? `<button class="btn wide" data-act="review">只复习到期的 ${due} 张</button>` : ''}
      </div>
      ${due ? `<p class="small muted" style="margin:12px 0 0">有 ${due} 个词到了复习时间，先复习再学新词效果最好。</p>` : ''}
    </div>

    <div class="stats-grid">
      <div class="stat"><div class="n">${learned}</div><div class="l">已学单词</div></div>
      <div class="stat"><div class="n">${masteredCount()}</div><div class="l">已掌握</div></div>
      <div class="stat"><div class="n">${streak()}</div><div class="l">连续天数</div></div>
    </div>

    <div class="row" style="gap:10px">
      <button class="btn grow" data-act="dictate" ${learned ? '' : 'disabled'}>✍️ 听写</button>
      <button class="btn grow" data-act="mistakes">📕 错词本${mis ? ` ${mis}` : ''}</button>
    </div>

    <div class="row" style="gap:10px;margin-top:10px">
      <button class="btn grow" data-act="groups">🧩 按词根 / 词性分组</button>
    </div>

    <div class="row" style="gap:10px;margin-top:10px">
      <button class="btn grow" data-act="wordlist">单词表</button>
      <button class="btn grow" data-act="stats">统计</button>
      <button class="btn grow" data-act="settings">设置</button>
    </div>

    ${learned ? `<p class="small muted center" style="margin-top:14px">听写：听发音 / 看中文，敲出英文拼写，一轮 ${DICTATE_SIZE} 词。</p>` : ''}`;
  }

  function renderStudy() {
    const item = session.queue[session.idx];
    const e = WORD_INDEX.get(item.w) || { w: item.w, p: '', t: '' };
    const pct = Math.round((session.idx / session.queue.length) * 100);
    const isDictate = session.mode === 'dictate';
    const head = `<div class="topbar">
        <button class="btn ghost" data-act="quit">← 退出</button>
        <span class="small muted">${isDictate ? '✍️ 听写 · ' : ''}${session.idx + 1} / ${session.queue.length}${session.total > session.queue.length ? ` · 共 ${session.total}` : ''}</span>
      </div>
      <div class="progress-line"><div class="bar"><i style="width:${pct}%"></i></div></div>`;

    if (isDictate) {
      const v = session.verdict;
      if (v === 'ok') {
        return `${head}
        <div class="card card-word dictate-ok">
          <div class="word">${esc(e.w)}</div>
          <div class="dict-mark ok-mark">✓ 拼对了</div>
          ${exampleBlock(e.w)}
        </div>`;
      }
      if (v === 'no') {
        return `${head}
        <div class="card card-word dictate-no">
          <div class="dict-mark no-mark">✗ 正确答案</div>
          <div class="word">${esc(e.w)}</div>
          ${e.p ? `<div class="phonetic">/${esc(e.p)}/</div>` : '<div class="phonetic">&nbsp;</div>'}
          <button class="speak" data-act="speak" title="发音">🔊</button>
          <div class="meaning">${esc(e.t)}</div>
          ${exampleBlock(e.w)}
          <button class="btn primary wide" style="margin-top:18px" data-act="grade" data-q="0">继续（空格）</button>
        </div>`;
      }
      return `${head}
      <div class="card card-word">
        <div class="dict-label">听发音，写出这个词</div>
        <button class="speak big-speak" data-act="speak" title="再听一次">🔊</button>
        <div class="dict-meaning">${esc(e.t)}</div>
        <div class="dict-hint">${e.w.length} 个字母</div>
        <input id="dict-input" class="dict-input" autocomplete="off" autocapitalize="off" autocorrect="off"
               spellcheck="false" placeholder="输入英文，回车确认" value="${esc(session.typed)}">
      </div>
      <button class="btn primary wide" data-act="dict-check">确认（回车）</button>
      <p class="small muted center" style="margin-top:12px">点 🔊 可以重听；答错会打回第 1 档并进错词本。</p>`;
    }

    return `${head}
      <div class="card card-word">
        <div class="word">${esc(e.w)}</div>
        ${e.p ? `<div class="phonetic">/${esc(e.p)}/</div>` : '<div class="phonetic">&nbsp;</div>'}
        ${tagLine(e.w)}
        <button class="speak" data-act="speak" title="发音">🔊</button>
        ${revealed
          ? `<div class="meaning">${esc(e.t)}</div>${exampleBlock(e.w)}`
          : '<div class="reveal-hint">按 <span class="kbd">空格</span> 或点下面的按钮看释义</div>'}
      </div>

      ${revealed
        ? `<div class="grade-row">
             <button class="btn again" data-act="grade" data-q="0">不认识<span class="sub">1 · 重学</span></button>
             <button class="btn hard" data-act="grade" data-q="1">模糊<span class="sub">2 · 10 分钟</span></button>
             <button class="btn good" data-act="grade" data-q="2">认识<span class="sub">3 · 拉长间隔</span></button>
           </div>`
        : `<button class="btn primary wide" data-act="reveal">显示释义（空格）</button>`}`;
  }

  function renderDone() {
    const total = session.good + session.hard + session.again;
    const acc = total ? Math.round((session.good / total) * 100) : 0;
    const due = dueWords().length;
    const remaining = Math.max(0, state.profile.dailyNew - state.day.newDone);
    const mis = mistakeCount();
    return `${topbar()}
    <div class="card">
      <h2>这一轮完成了 ✅</h2>
      <div class="done-stats">
        <div class="stat"><div class="n">${total}</div><div class="l">本轮张数</div></div>
        <div class="stat"><div class="n">${acc}%</div><div class="l">认识率</div></div>
        <div class="stat"><div class="n">${due}</div><div class="l">待复习</div></div>
      </div>
      <div class="row between small muted">
        <span>认识 ${session.good}</span><span>模糊 ${session.hard}</span><span>不认识 ${session.again}</span>
      </div>
      <div style="display:grid;gap:10px;margin-top:20px">
        ${mis ? `<button class="btn wide" data-act="mistakes">📕 去错词本看 ${mis} 个词</button>` : ''}
        ${due ? `<button class="btn wide" data-act="review">继续复习 ${due} 张</button>` : ''}
        ${remaining ? `<button class="btn primary wide" data-act="start">再学 ${Math.min(remaining, CHUNK)} 个新词</button>` : ''}
        <button class="btn wide ghost" data-act="home">回到首页</button>
      </div>
      ${session.total > session.queue.length
        ? `<p class="small muted center" style="margin-top:14px">还有 ${session.total - session.queue.length} 张排在本轮之后，点「继续复习」接着做。</p>` : ''}
    </div>`;
  }

  function renderMistakes() {
    const list = mistakeWords();
    return `${topbar(`<button class="btn ghost" data-act="home">← 返回</button>`)}
    <div class="row between">
      <h2>错词本</h2>
      <span class="small muted">${list.length} 个词</span>
    </div>
    <div class="card">
      <p class="small muted" style="margin:0">答错（不认识 / 听写拼错）的词会自动收进来；之后连续答对 ${MISTAKE_CLEAR_STREAK} 次就自动移出。</p>
      <div style="display:grid;gap:10px;margin-top:14px">
        ${list.length ? `<button class="btn primary wide" data-act="practice-mistakes">练习这 ${Math.min(list.length, DICTATE_SIZE)} 个词</button>` : ''}
        ${list.length ? `<button class="btn ghost wide" data-act="clear-mistakes">清空错词本</button>` : ''}
      </div>
    </div>
    <div class="card">
      <div class="mistake-list">
        ${list.map((w) => {
          const e = WORD_INDEX.get(w) || { w, t: '', p: '' };
          const m = state.mistakes[w] || {};
          return `<div class="mis-item">
            <div class="mis-head">
              <span class="w">${esc(w)}</span>
              ${e.p ? `<span class="p">/${esc(e.p)}/</span>` : ''}
              <span class="badge">错 ${m.n || 1} 次</span>
              <button class="btn ghost tiny" data-act="drop-mistake" data-w="${esc(w)}" title="移出错词本">移除</button>
            </div>
            <div class="t">${esc(e.t)}</div>
            ${exampleBlock(w)}
            <div class="when">最近 ${ago(m.last)}${m.streak ? ` · 已连对 ${m.streak}` : ''}</div>
          </div>`;
        }).join('') || '<p class="small muted">还没有错词，继续保持 🌿</p>'}
      </div>
    </div>`;
  }

  function renderSettings() {
    const counts = Object.fromEntries(Object.keys(LEVEL_NAMES).map((k) => [k, (BANKS[k]?.words || []).length]));
    return `${topbar(`<button class="btn ghost" data-act="home">← 返回</button>`)}
    <div class="card">
      <div class="field">
        <div class="label">词库</div>
        <div class="desc">换级别不会清掉已背过的词，新词从新词库里取。</div>
        <div class="levels" style="margin-top:6px">
          ${Object.keys(LEVEL_NAMES).map((k) => `
            <button class="level" data-act="switch-level" data-level="${k}" aria-pressed="${state.profile.level === k}">
              <span class="emoji">${LEVEL_EMOJI[k]}</span>
              <span class="grow" style="text-align:left">
                <span class="name" style="display:block">${LEVEL_NAMES[k]}</span>
                <span class="count">${counts[k].toLocaleString()} 词</span>
              </span>
            </button>`).join('')}
        </div>
      </div>
      <div class="field">
        <div class="label">每日新词</div>
        <div class="desc">今天已经学了 ${state.day.newDone} 个。</div>
        <div class="row wrap" style="margin-top:6px">
          <div class="seg">
            ${[5, 10, 15, 20, 30].map((n) => `<button data-act="switch-daily" data-n="${n}" aria-pressed="${state.profile.dailyNew === n}">${n}</button>`).join('')}
          </div>
          <span class="small muted">词 / 天</span>
        </div>
      </div>
      <div class="field">
        <div class="label">数据</div>
        <div class="desc">进度保存在这台设备的浏览器里，换浏览器或清缓存会丢。</div>
        <button class="btn danger" style="margin-top:8px" data-act="reset">清空全部进度</button>
      </div>
    </div>`;
  }

  function renderStats() {
    const learned = Object.entries(state.words);
    const byStage = Array.from({ length: MASTER_STAGE }, (_, i) => learned.filter(([, r]) => r.s === i + 1).length);
    const right = learned.reduce((a, [, r]) => a + (r.right || 0), 0);
    const wrong = learned.reduce((a, [, r]) => a + (r.wrong || 0), 0);
    const acc = right + wrong ? Math.round((right / (right + wrong)) * 100) : 0;
    const rows = learned
      .map(([w, r]) => ({ w, r, e: WORD_INDEX.get(w) }))
      .sort((a, b) => b.r.last - a.r.last)
      .slice(0, 300);

    return `${topbar(`<button class="btn ghost" data-act="home">← 返回</button>`)}
    <div class="stats-grid">
      <div class="stat"><div class="n">${learned.length}</div><div class="l">已学</div></div>
      <div class="stat"><div class="n">${masteredCount()}</div><div class="l">已掌握</div></div>
      <div class="stat"><div class="n">${acc}%</div><div class="l">总正确率</div></div>
    </div>
    <div class="card">
      <h3>复习曲线分布</h3>
      <div style="display:grid;gap:6px;margin-top:12px">
        ${byStage.map((n, i) => `
          <div class="row" style="gap:10px">
            <span class="tiny muted" style="width:56px;text-align:right">第 ${i + 1} 档</span>
            <div class="bar grow"><i style="width:${learned.length ? Math.round((n / learned.length) * 100) : 0}%"></i></div>
            <span class="tiny muted" style="width:44px">${n}</span>
          </div>`).join('')}
      </div>
    </div>
    <div class="card">
      <h3>最近背过的词</h3>
      <div class="wordlist" style="margin-top:10px">
        ${rows.map(({ w, r, e }) => `
          <div class="wl-item">
            <span class="w">${esc(w)}</span>
            <span class="t">${esc(e ? e.t : '')}</span>
            <span class="s">${r.s >= MASTER_STAGE ? '✓' : 'S' + r.s}</span>
          </div>`).join('') || '<p class="small muted">还没有记录。</p>'}
      </div>
    </div>`;
  }

  function renderWordlist() {
    const level = state.profile.level;
    const list = BANKS[level]?.words || [];
    const learned = list.filter((e) => state.words[e.w]);
    const fresh = list.filter((e) => !state.words[e.w]);
    const items = (listFilter === 'learned' ? learned : fresh).slice(0, 400);
    return `${topbar(`<button class="btn ghost" data-act="home">← 返回</button>`)}
    <div class="row between">
      <h2>${LEVEL_NAMES[level]}词库</h2>
      <div class="seg">
        <button data-act="list-filter" data-f="learned" aria-pressed="${listFilter === 'learned'}">已学 ${learned.length}</button>
        <button data-act="list-filter" data-f="new" aria-pressed="${listFilter === 'new'}">未学 ${fresh.length}</button>
      </div>
    </div>
    <div class="card">
      <div class="wordlist">
        ${items.map((e) => {
          const r = state.words[e.w];
          return `<div class="wl-item">
            <span class="w">${esc(e.w)}</span>
            <span class="t">${esc(e.t)}</span>
            <span class="s">${r ? (r.s >= MASTER_STAGE ? '✓' : 'S' + r.s) : ''}</span>
          </div>`;
        }).join('') || '<p class="small muted">这里是空的。</p>'}
      </div>
      ${items.length >= 400 ? '<p class="small muted center" style="margin-top:12px">只显示前 400 个。</p>' : ''}
    </div>`;
  }

  function renderGroups() {
    const level = state.profile.level;
    const dim = GROUP_DIMS.find((d) => d[0] === groupDim) || GROUP_DIMS[0];
    const groups = (GROUPS[dim[0]] || {})[level] || [];
    const words = groups.reduce((n, g) => n + g.words.length, 0);
    return `${topbar(`<button class="btn ghost" data-act="home">← 返回</button>`)}
    <div class="row between">
      <h2>${LEVEL_NAMES[level]} · 分组</h2>
      <span class="small muted">${groups.length} 组 · ${words.toLocaleString()} 词次</span>
    </div>
    <div class="seg" style="margin-bottom:12px">
      ${GROUP_DIMS.map(([k, name]) => `<button data-act="group-dim" data-dim="${k}" aria-pressed="${groupDim === k}">${name}</button>`).join('')}
    </div>
    <p class="small muted" style="margin:0 0 14px">${dim[2]}</p>
    ${groups.length ? '' : '<div class="card"><p class="small muted" style="margin:0">这一级词表里没有可用的分组。</p></div>'}
    <div class="group-list">
      ${groups.map((g) => {
        const open = groupOpen === `${dim[0]}:${g.k}`;
        const learned = g.words.filter((w) => state.words[w]).length;
        return `<div class="grp${open ? ' open' : ''}">
          <button class="grp-head" data-act="toggle-group" data-dim="${dim[0]}" data-k="${esc(g.k)}">
            <span class="grp-name">${esc(g.label)}</span>
            ${g.meaning ? `<span class="grp-mean">${esc(g.meaning)}</span>` : ''}
            <span class="badge">${g.words.length}</span>
            ${learned ? `<span class="badge dim">已学 ${learned}</span>` : ''}
            <span class="grp-caret">${open ? '▾' : '▸'}</span>
          </button>
          ${open ? `<div class="grp-body">
            <div class="grp-words">
              ${g.words.slice(0, 120).map((w) => `<span class="gw${state.words[w] ? ' done' : ''}">${esc(w)}</span>`).join('')}
              ${g.words.length > 120 ? `<span class="gw more">…还有 ${g.words.length - 120} 个</span>` : ''}
            </div>
            <button class="btn primary wide" data-act="practice-group" data-dim="${dim[0]}" data-k="${esc(g.k)}">练这组（${Math.min(g.words.length, CHUNK)} 张）</button>
          </div>` : ''}
        </div>`;
      }).join('')}
    </div>`;
  }

  function render() {
    const app = $('#app');
    let html = '';
    if (view === 'onboarding') html = renderOnboarding();
    else if (view === 'home') html = renderHome();
    else if (view === 'study' && session) html = renderStudy();
    else if (view === 'done' && session) html = renderDone();
    else if (view === 'settings') html = renderSettings();
    else if (view === 'stats') html = renderStats();
    else if (view === 'wordlist') html = renderWordlist();
    else if (view === 'mistakes') html = renderMistakes();
    else if (view === 'groups') html = renderGroups();
    else html = state.profile ? renderHome() : renderOnboarding();
    app.innerHTML = html;
    window.scrollTo({ top: 0 });
    const input = $('#dict-input');
    if (input) {
      input.value = session.typed || '';
      input.focus();
      input.setSelectionRange(input.value.length, input.value.length);
      input.addEventListener('input', () => { session.typed = input.value; });
    }
  }

  // ---------- 交互 ----------
  const app = $('#app');
  app.addEventListener('click', (ev) => {
    const btn = ev.target.closest('[data-act]');
    if (!btn) return;
    const act = btn.dataset.act;

    if (act === 'pick-level') { draft.level = btn.dataset.level; render(); return; }
    if (act === 'pick-daily') { draft.dailyNew = Number(btn.dataset.n); render(); return; }
    if (act === 'create-plan') {
      state.profile = { level: draft.level, dailyNew: draft.dailyNew, createdAt: Date.now() };
      ensureDay(); save(); view = 'home'; render(); return;
    }
    if (act === 'start') { startSession('today'); return; }
    if (act === 'review') { startSession('review'); return; }
    if (act === 'dictate') { startSession('dictate'); return; }
    if (act === 'reveal') { revealed = true; render(); return; }
    if (act === 'grade') { grade(Number(btn.dataset.q)); return; }
    if (act === 'dict-check') { checkDictation(); return; }
    if (act === 'speak') { speakCurrent(); return; }
    if (act === 'quit') { session = null; view = 'home'; render(); return; }
    if (act === 'home') { session = null; view = 'home'; render(); return; }
    if (act === 'settings') { view = 'settings'; render(); return; }
    if (act === 'stats') { view = 'stats'; render(); return; }
    if (act === 'wordlist') { view = 'wordlist'; render(); return; }
    if (act === 'mistakes') { view = 'mistakes'; render(); return; }
    if (act === 'groups') { view = 'groups'; groupOpen = ''; render(); return; }
    if (act === 'group-dim') { groupDim = btn.dataset.dim; groupOpen = ''; render(); return; }
    if (act === 'toggle-group') {
      const key = `${btn.dataset.dim}:${btn.dataset.k}`;
      groupOpen = groupOpen === key ? '' : key;
      render(); return;
    }
    if (act === 'practice-group') {
      const list = (GROUPS[btn.dataset.dim] || {})[state.profile.level] || [];
      const g = list.find((x) => x.k === btn.dataset.k);
      if (!g) { toast('没找到这一组'); return; }
      startSession('group', g.words);
      return;
    }
    if (act === 'practice-mistakes') { startSession('mistake'); return; }
    if (act === 'drop-mistake') {
      const w = btn.dataset.w;
      delete state.mistakes[w]; save(); render(); return;
    }
    if (act === 'clear-mistakes') {
      if (confirm('清空错词本？已背过的词和复习计划不受影响。')) { state.mistakes = {}; save(); render(); }
      return;
    }
    if (act === 'list-filter') { listFilter = btn.dataset.f; render(); return; }
    if (act === 'switch-level') {
      state.profile.level = btn.dataset.level; save(); toast('已换成' + LEVEL_NAMES[btn.dataset.level] + '词库'); render(); return;
    }
    if (act === 'switch-daily') {
      state.profile.dailyNew = Number(btn.dataset.n); save(); render(); return;
    }
    if (act === 'reset') {
      if (confirm('清空全部进度？已背过的词、复习计划都会消失，无法恢复。')) {
        localStorage.removeItem(LS_KEY);
        state = blank();
        session = null; view = 'onboarding';
        render();
      }
      return;
    }
  });

  app.addEventListener('input', (ev) => {
    if (ev.target && ev.target.id === 'dict-input') session.typed = ev.target.value;
  });

  document.addEventListener('keydown', (ev) => {
    if (view !== 'study' || !session) return;
    const inDictation = session.mode === 'dictate';
    const inputFocused = ev.target && ev.target.id === 'dict-input';

    if (inDictation) {
      if (ev.key === 'Enter') {
        ev.preventDefault();
        if (session.verdict === 'no') grade(0);
        else if (!session.verdict) checkDictation();
        return;
      }
      if (ev.key === 'Escape') { ev.preventDefault(); revealDictationAnswer(); return; }
      return;
    }

    if (ev.code === 'Space' || ev.key === 'Enter') {
      ev.preventDefault();
      if (!revealed) { revealed = true; render(); }
      return;
    }
    if (revealed && ['1', '2', '3'].includes(ev.key)) {
      ev.preventDefault();
      grade(Number(ev.key) - 1);
    }
    if (inputFocused) ev.stopPropagation();
  });

  function revealDictationAnswer() {
    if (!session || session.mode !== 'dictate' || session.verdict) return;
    session.verdict = 'no';
    render();
  }

  // ---------- 启动 ----------
  ensureDay();
  render();
})();
