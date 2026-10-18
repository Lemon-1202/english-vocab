# -*- coding: utf-8 -*-
"""Build data/examples.js from Tatoeba eng<->cmn sentence pairs.

Strategy: sentences that already have a Chinese translation win; otherwise the
shortest clean English sentence containing the word is used.

Inputs in _build/tatoeba:
  eng_sentences.tsv.bz2     id \t eng \t text
  cmn-eng_links.tsv.bz2     cmn_id \t eng_id
  cmn_sentences.tsv.bz2     id \t cmn \t text

Output: data/examples.js -> window.VOCAB_EXAMPLES = { word: [english, chinese] }
"""
import bz2, json, re, time

try:
    import zhconv  # 繁转简，Tatoeba 中文语料简繁混杂
except ImportError:  # pragma: no cover
    zhconv = None

TAT = r"D:\CODE\english-vocab\_build\tatoeba"
BANK = r"D:\CODE\english-vocab\data\bank.js"
OUT = r"D:\CODE\english-vocab\data\examples.js"

CJK = re.compile(r"[\u4e00-\u9fff]")
TRAD = set("們這說會來時過還對樣麼開關沒發學國現點電話進動車個為與從裡後問道見錯長間實號機聲讓給帶嗎歡無應該當邊聽寫讀習題語詞義記準確認識難簡單雙舊親愛熱鬧靜幾經濟價錢買賣農鄉")
STRIP = ".,!?;:\"'()[]{}"


def load_words():
    raw = open(BANK, encoding="utf-8").read()
    i, j = raw.index("{"), raw.rindex("}")
    data = json.loads(raw[i:j + 1])
    words = []
    for lvl in ("primary", "junior", "senior"):
        for item in data[lvl]["words"]:
            w = item["w"].strip().lower()
            if w and w not in words:
                words.append(w)
    return words


def is_clean(text):
    if len(text) < 12 or len(text) > 120:
        return False
    if any(ch in text for ch in "@#<>|\\_*{}[]\t\""):
        return False
    if "http" in text or "www." in text:
        return False
    good = sum(ch.isalpha() or ch in " .,!?;:'-" for ch in text)
    return good / max(1, len(text)) > 0.75


def base_forms(tok):
    out = [tok]
    if tok.endswith("s"):
        out.append(tok[:-1])
    if tok.endswith("es"):
        out.append(tok[:-2])
    if tok.endswith("ies"):
        out.append(tok[:-3] + "y")
    if tok.endswith("ed"):
        out.append(tok[:-2]); out.append(tok[:-1]); out.append(tok[:-3])
        if len(tok) > 4 and tok[-3] == tok[-4]:
            out.append(tok[:-3])
    if tok.endswith("ied"):
        out.append(tok[:-3] + "y")
    if tok.endswith("ing"):
        out.append(tok[:-3]); out.append(tok[:-3] + "e")
        if len(tok) > 5 and tok[-4] == tok[-5]:
            out.append(tok[:-4])
    if tok.endswith("ly"):
        out.append(tok[:-2])
    if tok.endswith("er"):
        out.append(tok[:-2]); out.append(tok[:-1])
    if tok.endswith("est"):
        out.append(tok[:-3]); out.append(tok[:-2])
    return out


def main():
    t0 = time.time()
    words = load_words()
    want = set(words)
    print("target words:", len(want))

    links = {}
    with bz2.open(TAT + r"\cmn-eng_links.tsv.bz2", "rt", encoding="utf-8", errors="replace") as f:
        for line in f:
            p = line.rstrip("\n").split("\t")
            if len(p) == 2:
                links.setdefault(p[1], []).append(p[0])
    print("eng sentences with a cmn link:", len(links), f"{time.time()-t0:.1f}s")

    cmn = {}
    with bz2.open(TAT + r"\cmn_sentences.tsv.bz2", "rt", encoding="utf-8", errors="replace") as f:
        for line in f:
            p = line.rstrip("\n").split("\t")
            if len(p) == 3 and p[1] == "cmn":
                cmn[p[0]] = p[2]
    print("cmn sentences:", len(cmn), f"{time.time()-t0:.1f}s")

    best = {}  # word -> (prio, n, sid, text); prio 0 = has chinese

    def offer(word, prio, n, sid, text):
        cur = best.get(word)
        if cur is None or (prio, n) < (cur[0], cur[1]):
            best[word] = (prio, n, sid, text)

    with bz2.open(TAT + r"\eng_sentences.tsv.bz2", "rt", encoding="utf-8", errors="replace") as f:
        for line in f:
            p = line.rstrip("\n").split("\t")
            if len(p) != 3:
                continue
            sid, lang, text = p
            if lang != "eng" or not is_clean(text):
                continue
            toks = text.split()
            n = len(toks)
            if n < 4 or n > 14:
                continue
            prio = 0 if sid in links else 1
            for raw in toks:
                tok = raw.lower().strip(STRIP)
                if tok in want:
                    offer(tok, prio, n, sid, text)
    print("covered exactly:", len(best), f"{time.time()-t0:.1f}s")

    missing = want - set(best)
    print("missing after exact pass:", len(missing))
    if missing:
        with bz2.open(TAT + r"\eng_sentences.tsv.bz2", "rt", encoding="utf-8", errors="replace") as f:
            for line in f:
                p = line.rstrip("\n").split("\t")
                if len(p) != 3:
                    continue
                sid, lang, text = p
                if lang != "eng" or not is_clean(text):
                    continue
                toks = text.split()
                n = len(toks)
                if n < 4 or n > 14:
                    continue
                prio = 2 if sid in links else 3
                for raw in toks:
                    tok = raw.lower().strip(STRIP)
                    if not tok or tok in want:
                        continue
                    for base in base_forms(tok):
                        if base in missing and (base not in best or best[base][0] > prio):
                            offer(base, prio, n, sid, text)
                            break
        print("covered after inflection pass:", len(best), f"{time.time()-t0:.1f}s")

    out = {}
    with_cn = 0
    for w, (prio, n, sid, text) in best.items():
        cn = ""
        tr = [cmn[c] for c in links.get(sid, []) if c in cmn]
        tr = [c for c in tr if 5 <= len(c) <= 80 and CJK.search(c)]
        if tr:
            tr.sort(key=len)
            cn = tr[0]
            if zhconv is not None:
                cn = zhconv.convert(cn, "zh-cn")
            with_cn += 1
        out[w] = [text, cn]

    payload = "window.VOCAB_EXAMPLES = " + json.dumps(out, ensure_ascii=False, separators=(",", ":")) + ";\n"
    open(OUT, "w", encoding="utf-8").write(payload)
    print("examples:", len(out), "with chinese:", with_cn, "size:", len(payload))
    print("done", f"{time.time()-t0:.1f}s")
    for probe in ("abandon", "study", "apple", "government", "beautiful", "stop", "make"):
        print(probe, "->", out.get(probe))


if __name__ == "__main__":
    main()
