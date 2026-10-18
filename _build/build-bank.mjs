// 构建分级词库：小学 / 初中 / 高中（含四六级）
// 分级依据 = 教材词书（LinXueyuanStdio/DictionaryData 的小学/初中/高中/四级/六级词书）
// 音标与中文释义 = ECDICT（skywind3000/ECDICT, MIT），缺失时回退到 DictionaryData 的翻译表
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(ROOT, 'data', 'bank.js');

const LEVEL_BOOKS = {
  primary: '45c48cce2e2d7fbdea1afc51', // 小学英语
  junior: 'd3d9446802a44259755d38e6', // 初中英语
  senior: '6512bd43d9caa6e02c990b0a', // 高中英语
  cet4: 'c9f0f895fb98ab9159f51fd0', // 大学英语四级词汇
  cet6: 'c20ad4d76fe97759aa27a0c9', // 大学英语六级词汇
};

const WORD_RE = /^[a-z][a-z''\-]{1,23}$/;

// ---------- 1. 教材词书：书 → 叶子书 → 单词 ----------
const books = fs.readFileSync(path.join(__dirname, 'book.csv'), 'utf8').replace(/^\uFEFF/, '').split('\n').slice(1)
  .filter(Boolean).map((l) => { const p = l.split('>'); return { id: p[0], parent: p[1] }; });
const childrenOf = new Map();
for (const b of books) {
  if (!b.parent || b.parent === '0') continue;
  if (!childrenOf.has(b.parent)) childrenOf.set(b.parent, []);
  childrenOf.get(b.parent).push(b.id);
}
function expand(id, acc = new Set()) {
  acc.add(id);
  for (const c of childrenOf.get(id) || []) expand(c, acc);
  return acc;
}
const idToKey = new Map();
for (const [key, id] of Object.entries(LEVEL_BOOKS)) for (const bid of expand(id)) idToKey.set(bid, key);

const vocabWord = new Map();
for (const l of fs.readFileSync(path.join(__dirname, 'word.csv'), 'utf8').replace(/^\uFEFF/, '').split('\n').slice(1)) {
  if (!l) continue;
  const p = l.split('>');
  if (p.length >= 2) vocabWord.set(p[0], p[1].trim());
}

const sets = {};
for (const k of Object.keys(LEVEL_BOOKS)) sets[k] = new Set();
for (const l of fs.readFileSync(path.join(__dirname, 'relation_book_word.csv'), 'utf8').replace(/^\uFEFF/, '').split('\n').slice(1)) {
  if (!l) continue;
  const p = l.split('>');
  if (p.length < 3) continue;
  const key = idToKey.get(p[1]);
  if (!key) continue;
  const w = (vocabWord.get(p[2]) || '').toLowerCase().trim();
  if (!w || !WORD_RE.test(w)) continue; // 只收单词，丢掉词组/人名/带空格的条目
  sets[key].add(w);
}
const clean = (s) => { const out = new Set(); for (const w of s) if (WORD_RE.test(w)) out.add(w); return out; };
const primarySet = clean(sets.primary);
const juniorSet = clean(sets.junior);
const seniorSet = clean(sets.senior);
const cet4Set = clean(sets.cet4);
console.log('教材词表（单词数）:', { primary: primarySet.size, junior: juniorSet.size, senior: seniorSet.size, cet4: cet4Set.size });

// ---------- 2. ECDICT：音标 + 中文释义 ----------
const csv = fs.readFileSync(path.join(__dirname, 'ecdict.csv'), 'utf8').replace(/^\uFEFF/, '');
const need = new Set([...primarySet, ...juniorSet, ...seniorSet, ...cet4Set]);
const dict = new Map();
{
  const fields = [];
  let field = '';
  let inQ = false;
  let rowNo = 0;
  const flush = () => {
    rowNo++;
    if (fields.length >= 10 && rowNo > 1) {
      const w = (fields[0] || '').trim().toLowerCase();
      if (need.has(w) && !dict.has(w)) {
        dict.set(w, {
          p: (fields[1] || '').trim().replace(/^\/|\/$/g, ''),
          t: fields[3] || '',
          frq: Number(fields[9]) || 0,
        });
      }
    }
    fields.length = 0; field = '';
  };
  for (let i = 0; i < csv.length; i++) {
    const c = csv[i];
    if (inQ) {
      if (c === '"') { if (csv[i + 1] === '"') { field += '"'; i++; } else inQ = false; } else field += c;
      continue;
    }
    if (c === '"') { inQ = true; continue; }
    if (c === ',') { fields.push(field); field = ''; continue; }
    if (c === '\r') continue;
    if (c === '\n') { fields.push(field); flush(); continue; }
    field += c;
  }
  if (field || fields.length) { fields.push(field); flush(); }
}
console.log('ECDICT 命中:', dict.size, '/', need.size);

// ---------- 3. 回退翻译表 ----------
const fallback = new Map();
{
  const txt = fs.readFileSync(path.join(__dirname, 'word_translation.csv'), 'utf8');
  const re = /^"((?:[^"]|"")*)"\s*,\s*"((?:[^"]|"")*)"\s*$/;
  for (const line of txt.split('\n')) {
    const m = re.exec(line.trim());
    if (!m) continue;
    const w = m[1].replace(/""/g, '"').trim().toLowerCase();
    if (!need.has(w) || fallback.has(w)) continue;
    fallback.set(w, m[2].replace(/""/g, '"').replace(/\\n/g, '；'));
  }
}
console.log('回退表命中:', fallback.size);

// ---------- 4. 释义清洗 ----------
const DOMAIN = /[\[【(（][^\]】)）]{1,6}[\]】)）]/g;
function cleanZh(raw) {
  if (!raw) return '';
  return raw
    .replace(/\\n/g, '\n')
    .split(/[\n;；]+/)
    .map((s) => s.replace(DOMAIN, ' ').replace(/\s+/g, ' ').trim())
    .filter((s) => s && /[\u4e00-\u9fa5]/.test(s))
    .join('；')
    .slice(0, 110);
}

function entryFor(w) {
  const d = dict.get(w);
  const fb = fallback.get(w);
  const zh = cleanZh(d ? d.t : fb || '');
  if (!zh) return null;
  return { w, p: d && d.p ? d.p : '', t: zh, f: d ? d.frq : 0 };
}

// ---------- 5. 分层 ----------
const usedLower = new Set();
function build(levelSet, name) {
  const arr = [];
  for (const w of levelSet) {
    if (usedLower.has(w)) continue;
    const e = entryFor(w);
    if (!e) continue;
    usedLower.add(w);
    arr.push(e);
  }
  arr.sort((a, b) => (a.f || 1e9) - (b.f || 1e9) || a.w.localeCompare(b.w));
  console.log(name, arr.length);
  return arr;
}

const primary = build(primarySet, 'primary');
// 初中 = 教材初中词 ∪ 小学词（保证不断层）里还没收的
const junior = build(new Set([...juniorSet, ...primarySet]), 'junior');
// 高中 = 教材高中词 ∪ 四级词（用户要求覆盖四六级）
const senior = build(new Set([...seniorSet, ...cet4Set]), 'senior');

const banks = {
  primary: { id: 'primary', name: '小学', words: primary },
  junior: { id: 'junior', name: '初中', words: junior },
  senior: { id: 'senior', name: '高中', words: senior },
  meta: {
    builtAt: new Date().toISOString(),
    levels: '教材词书分级（小学/初中/高中/四级）+ ECDICT 释义',
    counts: { primary: primary.length, junior: junior.length, senior: senior.length },
  },
};

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, 'window.VOCAB_BANKS = ' + JSON.stringify(banks) + ';\n', 'utf8');
console.log('bank.js:', (fs.statSync(OUT).size / 1024).toFixed(0), 'KB');
