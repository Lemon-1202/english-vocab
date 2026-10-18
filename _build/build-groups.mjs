// 生成「按词性 / 按词缀 / 按词根」分组数据 → data/groups.js
// 输入：data/bank.js（每级词表，词条形如 { w, p, t, f }，t 以词性缩写开头）
// 输出：window.VOCAB_GROUPS = { pos, prefix, suffix, root }，每个维度按级别分开
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const IN = path.join(ROOT, 'data', 'bank.js');
const OUT = path.join(ROOT, 'data', 'groups.js');

// ---------- 读 bank.js ----------
const src = fs.readFileSync(IN, 'utf8');
const sandbox = { window: {} };
const vm = await import('node:vm');
vm.runInNewContext(src, sandbox);
const BANKS = sandbox.window.VOCAB_BANKS;
const LEVELS = ['primary', 'junior', 'senior'];

// 全体词表（三个级别合起来），用来判断「剥掉词缀后剩下的词干是不是一个真词」
const WORD_SET = new Set();
for (const lv of LEVELS) for (const e of BANKS[lv]?.words || []) WORD_SET.add(e.w);
function stemOk(stem) {
  if (!stem || stem.length < 3) return false;
  return WORD_SET.has(stem) || WORD_SET.has(stem + 'e') || WORD_SET.has(stem + 'y');
}

// ---------- 1. 词性：从 t 的首个缩写取 ----------
const POS_MAP = {
  n: ['n', '名词'], v: ['v', '动词'], vt: ['v', '动词'], vi: ['v', '动词'],
  aux: ['aux', '助动词'], modal: ['aux', '情态动词'],
  a: ['adj', '形容词'], adj: ['adj', '形容词'],
  ad: ['adv', '副词'], adv: ['adv', '副词'],
  prep: ['prep', '介词'], conj: ['conj', '连词'], pron: ['pron', '代词'],
  art: ['art', '冠词'], num: ['num', '数词'],
  int: ['int', '感叹词'], interj: ['int', '感叹词'],
  pl: ['n', '名词（复数）'], abbr: ['abbr', '缩写'],
};
const POS_ORDER = ['n', 'v', 'adj', 'adv', 'prep', 'pron', 'conj', 'art', 'num', 'aux', 'int', 'abbr', 'other'];
const POS_LABEL = {
  n: '名词 n.', v: '动词 v.', adj: '形容词 adj.', adv: '副词 adv.',
  prep: '介词 prep.', pron: '代词 pron.', conj: '连词 conj.', art: '冠词 art.',
  num: '数词 num.', aux: '助动词 aux.', int: '感叹词 int.', abbr: '缩写',
  other: '其他 / 未标注',
};
const LEAD_RE = /^\s*([a-z]{1,6})\./;
const ANY_RE = /\b(n|v|vt|vi|a|adj|ad|adv|prep|conj|pron|art|num|int|aux|abbr)\./;

function posKey(t) {
  const s = String(t || '').trim();
  const lead = LEAD_RE.exec(s);
  if (lead && POS_MAP[lead[1]]) return POS_MAP[lead[1]][0];
  const any = ANY_RE.exec(s);
  if (any && POS_MAP[any[1]]) return POS_MAP[any[1]][0];
  return 'other';
}

// ---------- 2. 前缀 ----------
const PREFIXES = [
  ['un', '不、相反'], ['re', '再、回'], ['dis', '不、分开'], ['in', '不、向内'],
  ['im', '不、向内'], ['il', '不'], ['ir', '不'], ['pre', '在前、预先'],
  ['pro', '向前、赞成'], ['ex', '出、向外、前'], ['en', '使…'], ['em', '使…、进入'],
  ['con', '共同、一起'], ['com', '共同、一起'], ['col', '共同'], ['cor', '共同'],
  ['sub', '在下、次'], ['sus', '在下'], ['su', '在下'], ['super', '在上、超过'], ['sur', '在上、超过'],
  ['trans', '穿过、转移'], ['inter', '在…之间'], ['over', '过度、在上'], ['under', '不足、在下'],
  ['mis', '错误、坏'], ['anti', '反对'], ['de', '向下、去除'], ['co', '共同'],
  ['per', '贯穿、彻底'], ['post', '在后'], ['fore', '在前'], ['out', '向外、超过'],
  ['mid', '中间'], ['non', '非、不'], ['auto', '自己、自动'], ['tele', '远'],
  ['micro', '微小'], ['macro', '宏大'], ['hyper', '过度'], ['ultra', '极端'],
  ['multi', '多'], ['mono', '单一'], ['semi', '一半'], ['bi', '二'], ['tri', '三'],
  ['up', '向上'], ['bi', '二'],
];
const PREFIX_SET = new Map();
for (const [p, m] of PREFIXES) if (!PREFIX_SET.has(p)) PREFIX_SET.set(p, m);
const PREFIX_BY_LEN = [...PREFIX_SET.keys()].sort((a, b) => b.length - a.length);

// ---------- 3. 后缀 ----------
const SUFFIXES = [
  ['ion', '名词：行为/状态'],
  ['ment', '名词：行为/结果'], ['ness', '名词：性质'], ['ity', '名词：性质'],
  ['ance', '名词：状态'], ['ence', '名词：状态'], ['ship', '名词：身份/关系'],
  ['hood', '名词：时期/身份'], ['ism', '名词：主义/行为'], ['ist', '名词：人'],
  ['age', '名词：行为/集合'], ['ure', '名词：行为/结果'],
  ['able', '形容词：能…的'], ['ible', '形容词：能…的'], ['ive', '形容词：有…性质'],
  ['ous', '形容词：充满…的'], ['ious', '形容词：充满…的'], ['ful', '形容词：充满…的'],
  ['less', '形容词：没有…的'], ['al', '形容词：…的'], ['ial', '形容词：…的'],
  ['ic', '形容词：…的'], ['ary', '形容词/名词：…的'],
  ['ory', '形容词/名词：…的'], ['ent', '形容词：…的'], ['ant', '形容词/名词：…的'],
  ['ize', '动词：使…化'], ['ise', '动词：使…化'], ['ify', '动词：使…'],
  ['fy', '动词：使…'], ['ate', '动词：使…'],
  ['er', '名词：人/物'], ['or', '名词：人/物'], ['ly', '副词：…地'],
];
const SUFFIX_SET = new Map();
for (const [s, m] of SUFFIXES) if (!SUFFIX_SET.has(s)) SUFFIX_SET.set(s, m);
const SUFFIX_BY_LEN = [...SUFFIX_SET.keys()].sort((a, b) => b.length - a.length);

// ---------- 4. 词根 ----------
// 匹配方式：先剥掉一个已知前缀，再看词干是否以词根开头；或整词直接以词根开头。
const ROOTS = [
  ['spect', '看', ['spect']],
  ['vis/vid', '看', ['vis', 'vid']],
  ['port', '搬运', ['port']],
  ['dict', '说', ['dict']],
  ['duc/duct', '引导', ['duc', 'duct']],
  ['fac/fect', '做', ['fac', 'fect']],
  ['form', '形状', ['form']],
  ['graph/gram', '写、画', ['graph', 'gram']],
  ['ject', '投掷', ['ject']],
  ['log', '说、学科', ['log']],
  ['manu', '手', ['manu']],
  ['mit/miss', '送、放', ['mit', 'miss']],
  ['mot/mov', '动', ['mot', 'mov']],
  ['ped/pod', '脚', ['ped', 'pod']],
  ['pel/puls', '推、驱', ['pel', 'puls']],
  ['pos/pon', '放、置', ['pos', 'pon']],
  ['rupt', '断裂', ['rupt']],
  ['scrib/script', '写', ['scrib', 'script']],
  ['sect', '切', ['sect']],
  ['sent/sens', '感觉', ['sent', 'sens']],
  ['serv', '服务、保存', ['serv']],
  ['sist/stat', '站立', ['sist', 'stat']],
  ['struct', '建造', ['struct']],
  ['tain/ten/tin', '握、持', ['tain', 'ten', 'tin']],
  ['tract', '拉、拖', ['tract']],
  ['ven/vent', '来', ['ven', 'vent']],
  ['vert/vers', '转', ['vert', 'vers']],
  ['voc/vok', '喊、声音', ['voc', 'vok']],
  ['cred', '相信', ['cred']],
  ['fer', '带来、拿', ['fer']],
  ['gen', '产生、出生', ['gen']],
  ['grad/gress', '走、步', ['grad', 'gress']],
  ['lect/leg', '读、选', ['lect', 'leg']],
  ['nat', '出生', ['nat']],
  ['part', '部分', ['part']],
  ['path', '感情、病痛', ['path']],
  ['phon', '声音', ['phon']],
  ['photo', '光', ['photo']],
  ['psych', '心理', ['psych']],
  ['sol', '太阳、单独', ['sol']],
  ['son', '声音', ['son']],
  ['spir', '呼吸', ['spir']],
  ['tempor', '时间', ['tempor']],
  ['terr', '土地', ['terr']],
  ['therm', '热', ['therm']],
  ['vac', '空', ['vac']],
  ['val', '价值、强壮', ['val']],
  ['viv/vit', '生命', ['viv', 'vit']],
  ['audi', '听', ['audi']],
  ['bio', '生命', ['bio']],
  ['chron', '时间', ['chron']],
  ['cid/cis', '切、杀', ['cid', 'cis']],
  ['clar', '清楚、明亮', ['clar']],
  ['cur/curs', '跑', ['cur', 'curs']],
  ['fin', '结束、界限', ['fin']],
  ['flu', '流', ['flu']],
  ['frag/fract', '打碎', ['frag', 'fract']],
  ['grat', '感谢、喜欢', ['grat']],
  ['labor', '劳动', ['labor']],
  ['liber', '自由', ['liber']],
  ['luc/lum', '光', ['luc', 'lum']],
  ['magn', '大', ['magn']],
  ['memor', '记忆', ['memor']],
  ['min', '小', ['min']],
  ['nov', '新', ['nov']],
  ['opt', '看、选择', ['opt']],
  ['prob/prov', '证明', ['prob', 'prov']],
  ['rect/reg', '直、统治', ['rect', 'reg']],
  ['simil', '相同', ['simil']],
  ['urb', '城市', ['urb']],
  ['volv/volut', '滚、转', ['volv', 'volut']],
];

const MIN_ROOT_WORD = 4;

// 少量形近词会误落进某个词根组（不是同源），直接拉黑
const ROOT_BLACKLIST = {
  fin: ['finger', 'fingernail', 'fingerprint'],
  'pos/pon': ['impossible'],
  'tain/ten/tin': ['tennessee', 'tendency', 'tender'],
};

function stripPrefix(w) {
  for (const p of PREFIX_BY_LEN) {
    if (w.length - p.length >= MIN_ROOT_WORD && w.startsWith(p)) return w.slice(p.length);
  }
  return w;
}
// 一个词可能有多种剥前缀的读法（suspect = su + spect），全都试一遍
function stemCandidates(w) {
  const out = [w];
  for (const p of PREFIX_BY_LEN) {
    if (w.length - p.length >= MIN_ROOT_WORD && w.startsWith(p)) out.push(w.slice(p.length));
  }
  return out;
}
function matchRoot(w) {
  const cands = stemCandidates(w);
  for (const [k, m, variants] of ROOTS) {
    if (ROOT_BLACKLIST[k]?.includes(w)) continue;
    for (const v of variants) {
      for (const c of cands) {
        if (c.length >= v.length && c.startsWith(v)) return { k, m };
      }
    }
  }
  return null;
}

// ---------- 5. 组装 ----------
function sortedByFreq(words, freqOf) {
  return words.slice().sort((a, b) => (freqOf(a) || 1e9) - (freqOf(b) || 1e9) || a.localeCompare(b));
}

const out = { builtAt: new Date().toISOString(), pos: {}, prefix: {}, suffix: {}, root: {} };

for (const level of LEVELS) {
  const entries = BANKS[level]?.words || [];
  const freq = new Map(entries.map((e) => [e.w, e.f || 0]));

  // 词性
  const posBuckets = new Map();
  for (const e of entries) {
    const k = posKey(e.t);
    if (!posBuckets.has(k)) posBuckets.set(k, []);
    posBuckets.get(k).push(e.w);
  }
  out.pos[level] = POS_ORDER.filter((k) => posBuckets.has(k)).map((k) => ({
    k,
    label: POS_LABEL[k] || k,
    words: sortedByFreq(posBuckets.get(k), (w) => freq.get(w)),
  }));

  // 前缀 / 后缀（每个词只归入最长匹配的一个；剩下的词干必须是个真词，滤掉 coincident 这类假朋友）
  const prefixBuckets = new Map();
  const suffixBuckets = new Map();
  for (const e of entries) {
    const w = e.w;
    for (const p of PREFIX_BY_LEN) {
      if (!w.startsWith(p)) continue;
      const stem = w.slice(p.length);
      if (stemOk(stem)) {
        if (!prefixBuckets.has(p)) prefixBuckets.set(p, []);
        prefixBuckets.get(p).push(w);
        break;
      }
    }
    for (const s of SUFFIX_BY_LEN) {
      if (!w.endsWith(s)) continue;
      const stem = w.slice(0, w.length - s.length);
      if (stemOk(stem)) {
        if (!suffixBuckets.has(s)) suffixBuckets.set(s, []);
        suffixBuckets.get(s).push(w);
        break;
      }
    }
  }
  const mk = (buckets, table, prefixDash) => [...buckets.entries()]
    .filter(([, ws]) => ws.length >= 3)
    .sort((a, b) => b[1].length - a[1].length)
    .map(([k, ws]) => ({
      k,
      label: (prefixDash ? '-' : '') + k + (prefixDash ? '' : '-'),
      meaning: table.get(k) || '',
      words: sortedByFreq(ws, (w) => freq.get(w)),
    }));
  out.prefix[level] = mk(prefixBuckets, PREFIX_SET, false);
  out.suffix[level] = mk(suffixBuckets, SUFFIX_SET, true);

  // 词根
  const rootBuckets = new Map();
  const rootInfo = new Map();
  for (const e of entries) {
    const hit = matchRoot(e.w);
    if (!hit) continue;
    if (!rootBuckets.has(hit.k)) { rootBuckets.set(hit.k, []); rootInfo.set(hit.k, hit.m); }
    rootBuckets.get(hit.k).push(e.w);
  }
  out.root[level] = [...rootBuckets.entries()]
    .filter(([, ws]) => ws.length >= 2)
    .sort((a, b) => b[1].length - a[1].length)
    .map(([k, ws]) => ({
      k,
      label: k,
      meaning: rootInfo.get(k) || '',
      words: sortedByFreq(ws, (w) => freq.get(w)),
    }));

  console.log(
    level,
    'pos:', out.pos[level].map((g) => g.k + ':' + g.words.length).join(' '),
    '| prefix:', out.prefix[level].length,
    '| suffix:', out.suffix[level].length,
    '| root:', out.root[level].length,
  );
}

fs.writeFileSync(OUT, 'window.VOCAB_GROUPS = ' + JSON.stringify(out) + ';\n', 'utf8');
console.log('groups.js:', (fs.statSync(OUT).size / 1024).toFixed(0), 'KB');
