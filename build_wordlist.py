#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""从 ECDICT 生成词频 5000-20000 段的词表（见 PLAN.md §3）。"""
import csv, json, os, re, datetime
csv.field_size_limit(10**7)
SRC='data_src/ecdict.csv'; OUT='assets/data'
LOW, HIGH = 5001, 20000
WORD_RE = re.compile(r'^[a-z]+$')
os.makedirs(os.path.join(OUT,'bands'), exist_ok=True)

def clean_tr(t):
    t=t.replace('\\n','\n')   # ECDICT 用字面 \n 作换行
    out=[]
    for line in t.split('\n'):
        line=line.strip()
        if not line or line.startswith('['): continue
        out.append(line)
        if len(out)>=2: break
    return ' '.join(out)[:80]

def lemma_of(exch):
    for p in (exch or '').split('/'):
        if p.startswith('0:'): return p[2:]
    return None

def pos_of(tr):
    m=re.match(r'\s*([a-z]+)\.', tr)
    return m.group(1) if m else ''

rows=[]
with open(SRC, newline='', encoding='utf-8') as f:
    for x in csv.DictReader(f):
        w=x['word']
        if not WORD_RE.match(w) or len(w)<3: continue
        tr=(x['translation'] or '').strip()
        if not tr: continue
        try: frq=int(x['frq'] or 0)
        except: frq=0
        if not (LOW<=frq<=HIGH): continue
        lem=lemma_of(x['exchange'])
        if lem and lem!=w: continue
        ctr=clean_tr(tr)
        rows.append({"w":w,"ph":(x['phonetic'] or '').strip(),"tr":ctr,
                     "pos":pos_of(ctr),"frq":frq,"band":frq//1000,
                     "tag":(x['tag'] or '').strip(),
                     "co":int(x['collins']) if x['collins'] else 0,
                     "ox":1 if x['oxford'] else 0})
rows.sort(key=lambda r:r['frq'])

json.dump(rows, open(os.path.join(OUT,'words.json'),'w',encoding='utf-8'),
          ensure_ascii=False, separators=(',',':'))
bands={}
for r in rows: bands.setdefault(r['band'],[]).append(r)
meta_bands=[]
for b in sorted(bands):
    json.dump(bands[b], open(os.path.join(OUT,'bands',f'band-{b}.json'),'w',encoding='utf-8'),
              ensure_ascii=False, separators=(',',':'))
    meta_bands.append({"id":b,"title":f"Rank {b*1000}–{b*1000+999}","count":len(bands[b])})
meta={"generated":datetime.datetime.now().isoformat(timespec='seconds'),
      "total":len(rows),"bands":meta_bands}
json.dump(meta, open(os.path.join(OUT,'meta.json'),'w',encoding='utf-8'), ensure_ascii=False, indent=1)

aff={}
try:
    aff=json.load(open('data_src/wordroot.txt',encoding='utf-8'))
    aff={k:v for k,v in aff.items() if isinstance(v,dict)}
    json.dump(aff, open(os.path.join(OUT,'affixes.json'),'w',encoding='utf-8'),
              ensure_ascii=False, separators=(',',':'))
except Exception as e:
    print('affix skip:', e)

# 内联 bundle：让网页用 <script> 直接加载，无需 fetch / 本地服务器（可 file:// 双击打开）
with open(os.path.join(OUT,'bundle.js'),'w',encoding='utf-8') as f:
    f.write('/* 自动生成：内联数据，供 file:// 直接打开。由 build_wordlist.py 产出 */\n')
    f.write('window.VG_DATA=')
    json.dump({"meta":meta,"words":rows,"affixes":aff}, f,
              ensure_ascii=False, separators=(',',':'))
    f.write(';\n')

print('words:', len(rows), '| bands:', len(meta_bands),
      '| bundle.js %.1fMB'%(os.path.getsize(os.path.join(OUT,'bundle.js'))/1e6))
