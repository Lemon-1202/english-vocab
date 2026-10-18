// 无浏览器冒烟测试：用最小 DOM 桩驱动 app.js，验证计划→学习→评分→持久化→续背
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');
const bankSrc = fs.readFileSync(path.join(ROOT, 'data', 'bank.js'), 'utf8');
const examplesSrc = fs.readFileSync(path.join(ROOT, 'data', 'examples.js'), 'utf8');
const appSrc = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');

function makeEnv() {
  const store = new Map();
  const clickHandlers = [];
  const keyHandlers = [];
  const inputHandlers = [];
  const document = {
    _app: null,
    querySelector(sel) {
      if (sel === '#app') return this._app;
      if (sel === '#toast') return null;
      return null;
    },
    addEventListener(type, fn) { if (type === 'keydown') keyHandlers.push(fn); },
    createElement() {
      return { id: '', className: '', textContent: '', classList: { add() {}, remove() {} }, appendChild() {} };
    },
    body: { appendChild() {} },
  };
  const appEl = {
    innerHTML: '',
    addEventListener(type, fn) {
      if (type === 'click') clickHandlers.push(fn);
      if (type === 'input') inputHandlers.push(fn);
    },
  };
  document._app = appEl;

  const localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };

  const window = {
    VOCAB_BANKS: null,
    scrollTo() {},
    localStorage,
  };

  const sandbox = {
    window,
    document,
    localStorage,
    console,
    setTimeout,
    clearTimeout,
    JSON,
    Math,
    Date,
    Object,
    Array,
    String,
    Number,
    Boolean,
    Map,
    Set,
    confirm: () => true,
    globalThis: null,
  };
  sandbox.globalThis = sandbox;
  const ctx = vm.createContext(sandbox);

  function bootstrap() {
    vm.runInContext(bankSrc, ctx);
    vm.runInContext(examplesSrc, ctx);
    // app.js 是 IIFE，每次执行都会重新读 localStorage → 相当于「再打开一次」
    vm.runInContext(appSrc, ctx);
  }

  function click(dataset) {
    const ev = { target: { closest: () => ({ dataset }) } };
    clickHandlers[clickHandlers.length - 1](ev);
    return appEl.innerHTML;
  }
  function key(k) {
    const ev = { key: k, code: k === ' ' ? 'Space' : '', preventDefault() {} };
    keyHandlers.forEach((h) => h(ev));
  }
  function input(value) {
    const ev = { target: { id: 'dict-input', value } };
    inputHandlers.forEach((h) => h(ev));
  }
  return { ctx, window, localStorage, click, key, input, bootstrap, appEl, resetHandlers() { clickHandlers.length = 0; keyHandlers.length = 0; inputHandlers.length = 0; } };
}

function assert(cond, msg) {
  if (!cond) { console.error('❌ ' + msg); process.exitCode = 1; } else { console.log('✅ ' + msg); }
}

// ---------- 第一次打开：建计划 ----------
const env = makeEnv();
env.bootstrap();
let html = env.appEl.innerHTML;
assert(html.includes('选择词库'), '首次打开显示引导页（选择词库）');

env.click({ act: 'pick-level', level: 'primary' });
env.click({ act: 'pick-daily', n: '10' });
html = env.click({ act: 'create-plan' });
assert(html.includes('个新词待学'), '创建计划后进入首页');

// ---------- 开始学习 ----------
html = env.click({ act: 'start' });
assert(html.includes('显示释义'), '进入学习卡，未揭示时提示显示释义');

let graded = 0;
for (let i = 0; i < 10; i++) {
  env.click({ act: 'reveal' });
  html = env.click({ act: 'grade', q: '2' });
  graded++;
}
const raw = env.localStorage.getItem('vocab-trainer-v1');
const st = JSON.parse(raw);
const words = Object.keys(st.words);
assert(words.length === 10, `背了 10 个词（实际 ${words.length}）`);
assert(st.day.newDone === 10, `今日新词计数 = 10（实际 ${st.day.newDone}）`);

const first = st.words[words[0]];
const deltaMin = Math.round((first.due - first.last) / 60000);
assert(deltaMin === 10, `第一次评"认识"后 10 分钟复习（实际 ${deltaMin} 分钟）`);
assert(html.includes('这一轮完成了'), '10 张做完后进入完成页');

// ---------- 再打开一次：续背 ----------
const env2 = makeEnv();
env2.localStorage.setItem('vocab-trainer-v1', raw);
env2.bootstrap();
html = env2.appEl.innerHTML;
assert(html.includes('0个新词待学') || html.includes('个新词待学'), '重开应用直接回到首页（记忆生效）');
assert(/今日新词 10 \/ 10/.test(html), '重开后今日进度仍是 10/10');
assert(/已学单词/.test(html), '首页显示统计');

// ---------- 复习：模拟到期的词 ----------
const st2 = JSON.parse(env2.localStorage.getItem('vocab-trainer-v1'));
for (const k of Object.keys(st2.words)) st2.words[k].due = Date.now() - 1000;
env2.localStorage.setItem('vocab-trainer-v1', JSON.stringify(st2));
const env3 = makeEnv();
env3.localStorage.setItem('vocab-trainer-v1', JSON.stringify(st2));
env3.bootstrap();
html = env3.appEl.innerHTML;
assert(html.includes('只复习到期的 10 张'), '到期的词会出现在复习入口');
env3.click({ act: 'review' });
html = env3.click({ act: 'reveal' });
assert(html.includes('grade'), '复习卡揭示后出现评分按钮');

// ---------- 评分：不认识 → 5 分钟后重学 ----------
const env4 = makeEnv();
env4.localStorage.setItem('vocab-trainer-v1', JSON.stringify(st2));
env4.bootstrap();
env4.click({ act: 'review' });
env4.click({ act: 'reveal' });
env4.click({ act: 'grade', q: '0' });
const st4 = JSON.parse(env4.localStorage.getItem('vocab-trainer-v1'));
const anyWord = Object.values(st4.words).find((r) => r.s === 1);
assert(!!anyWord, '"不认识"后档位重置为 1');
assert(Math.round((anyWord.due - anyWord.last) / 60000) === 5, '"不认识"后 5 分钟再考（实际 ' + Math.round((anyWord.due - anyWord.last) / 60000) + '）');

// ---------- 键盘 ----------
const env5 = makeEnv();
env5.localStorage.setItem('vocab-trainer-v1', JSON.stringify(st2));
env5.bootstrap();
env5.click({ act: 'review' });
env5.key(' ');
assert(env5.appEl.innerHTML.includes('grade-row') || env5.appEl.innerHTML.includes('不认识'), '空格键可以揭示释义');
env5.key('3');
const st5 = JSON.parse(env5.localStorage.getItem('vocab-trainer-v1'));
assert(Object.keys(st5.words).length === 10, '键盘评分不崩');

// ---------- 词库 ----------
const w = env.window.VOCAB_BANKS;
assert(w.primary.words.length > 1000 && w.junior.words.length > 1000 && w.senior.words.length > 4000,
  `词库规模 小学 ${w.primary.words.length} / 初中 ${w.junior.words.length} / 高中 ${w.senior.words.length}`);
const bad = [...w.primary.words, ...w.junior.words, ...w.senior.words].filter((e) => !e.w || !e.t);
assert(bad.length === 0, '所有词条都有拼写与中文释义');

// ---------- 例句 ----------
const envEx = makeEnv();
envEx.bootstrap();
const EX = envEx.window.VOCAB_EXAMPLES || {};
const exCount = Object.keys(EX).length;
assert(exCount > 9000, `例句数据集规模 ${exCount}`);
assert(Array.isArray(EX.apple) && /apple/i.test(EX.apple[0]), '例句库含 apple 的句子');
envEx.click({ act: 'pick-level', level: 'primary' });
envEx.click({ act: 'pick-daily', n: '5' });
envEx.click({ act: 'create-plan' });
envEx.click({ act: 'start' });
html = envEx.click({ act: 'reveal' });
assert(html.includes('ex-en'), '揭示释义后显示例句');

// ---------- 听写 + 错词本 ----------
const todayStr = (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; })();
const seed = () => JSON.stringify({
  version: 1,
  profile: { level: 'primary', dailyNew: 15, createdAt: 1 },
  words: { apple: { s: 2, seen: 2, right: 2, wrong: 0, due: Date.now() - 60000, last: Date.now() - 60000, lvl: 'primary' } },
  mistakes: {},
  day: { key: todayStr, newDone: 0, reviewDone: 0 },
  days: {},
});

const envD = makeEnv();
envD.localStorage.setItem('vocab-trainer-v1', seed());
envD.bootstrap();
html = envD.appEl.innerHTML;
assert(html.includes('听写'), '首页有听写入口');
assert(html.includes('错词本'), '首页有错词本入口');
html = envD.click({ act: 'dictate' });
assert(html.includes('听发音，写出这个词'), '进入听写卡');
assert(!/class="word">apple</.test(html), '听写时不显示英文拼写');
envD.input('aplle');
html = envD.click({ act: 'dict-check' });
assert(html.includes('正确答案'), '拼错时显示正确答案');
envD.click({ act: 'grade', q: '0' });
const stD = JSON.parse(envD.localStorage.getItem('vocab-trainer-v1'));
assert(!!(stD.mistakes && stD.mistakes.apple), '拼错后词进入错词本');
assert(stD.words.apple.s === 1, '拼错后档位打回 1');

// 错词本视图 + 练习 + 移除
html = envD.click({ act: 'mistakes' });
assert(html.includes('错词本') && html.includes('apple'), '错词本列出这个词');
html = envD.click({ act: 'practice-mistakes' });
assert(html.includes('显示释义') || html.includes('grade'), '可以从错词本开始练习');
envD.click({ act: 'quit' });
envD.click({ act: 'mistakes' });
html = envD.click({ act: 'drop-mistake', w: 'apple' });
const stD2 = JSON.parse(envD.localStorage.getItem('vocab-trainer-v1'));
assert(!stD2.mistakes.apple, '可以手动移出错词本');

// ---------- 渲染脏值扫描（undefined / NaN） ----------
const envS = makeEnv();
const seedS = JSON.parse(seed());
seedS.words = {
  apple: { s: 2, seen: 3, right: 2, wrong: 1, due: Date.now() - 1000, last: Date.now() - 1000, lvl: 'primary' },
  the: { s: 9, seen: 9, right: 9, wrong: 0, due: Date.now() + 86400000, last: Date.now() - 1000, lvl: 'primary' },
  be: { s: 4, seen: 5, right: 4, wrong: 1, due: Date.now() + 3600000, last: Date.now() - 7200000, lvl: 'primary' },
};
seedS.mistakes = { apple: { n: 3, streak: 1, last: Date.now() - 60000 } };
envS.localStorage.setItem('vocab-trainer-v1', JSON.stringify(seedS));
envS.bootstrap();
const views = ['home', 'wordlist', 'stats', 'settings', 'mistakes'];
for (const v of views) {
  const out = v === 'home' ? envS.appEl.innerHTML : envS.click({ act: v });
  assert(!/undefined|NaN/.test(out), `${v} 视图没有 undefined / NaN`);
}
envS.click({ act: 'review' });
envS.click({ act: 'reveal' });
assert(!/undefined|NaN/.test(envS.appEl.innerHTML), '学习卡没有 undefined / NaN');
envS.click({ act: 'quit' });
envS.click({ act: 'dictate' });
assert(!/undefined|NaN/.test(envS.appEl.innerHTML), '听写卡没有 undefined / NaN');

// ---------- 听写答对（异步：等自动进入下一张） ----------
(async () => {
  const envOk = makeEnv();
  envOk.localStorage.setItem('vocab-trainer-v1', seed());
  envOk.bootstrap();
  envOk.click({ act: 'dictate' });
  envOk.input('  Apple ');
  const shown = envOk.click({ act: 'dict-check' });
  assert(shown.includes('拼对了'), '拼对时给正反馈（大小写/空格自动忽略）');
  await new Promise((r) => setTimeout(r, 900));
  const stOk = JSON.parse(envOk.localStorage.getItem('vocab-trainer-v1'));
  assert(stOk.words.apple.s === 3, `拼对后档位 +1（实际 S${stOk.words.apple.s}）`);
  assert(!(stOk.mistakes && stOk.mistakes.apple), '拼对的词不进错词本');

  // 连续答对 2 次自动移出错词本
  const envClear = makeEnv();
  const seeded = JSON.parse(seed());
  seeded.mistakes = { apple: { n: 1, streak: 0, last: Date.now() } };
  envClear.localStorage.setItem('vocab-trainer-v1', JSON.stringify(seeded));
  envClear.bootstrap();
  envClear.click({ act: 'dictate' });
  envClear.input('apple');
  envClear.click({ act: 'dict-check' });
  await new Promise((r) => setTimeout(r, 900));
  envClear.click({ act: 'dictate' });
  envClear.input('apple');
  envClear.click({ act: 'dict-check' });
  await new Promise((r) => setTimeout(r, 900));
  const stClear = JSON.parse(envClear.localStorage.getItem('vocab-trainer-v1'));
  assert(!(stClear.mistakes && stClear.mistakes.apple), '连对 2 次自动移出错词本');

  console.log('\n完成。');
})();
