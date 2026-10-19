#!/usr/bin/env python3
import json, re, pronouncing
p = 'work/recording-worklist.json'
d = json.load(open(p, encoding='utf-8'))
A = {'AA':'ɑ','AE':'æ','AH':'ʌ','AO':'ɔ','AW':'aʊ','AY':'aɪ','B':'b','CH':'tʃ','D':'d','DH':'ð','EH':'ɛ','ER':'ɝ','EY':'eɪ','F':'f','G':'ɡ','HH':'h','IH':'ɪ','IY':'i','JH':'dʒ','K':'k','L':'l','M':'m','N':'n','NG':'ŋ','OW':'oʊ','OY':'ɔɪ','P':'p','R':'ɹ','S':'s','SH':'ʃ','T':'t','TH':'θ','UH':'ʊ','UW':'u','V':'v','W':'w','Y':'j','Z':'z','ZH':'ʒ'}
S = {'0':'','1':'ˈ','2':'ˌ'}
cmu = pronouncing.cmudict.dict()
def arp(pho):
    out = []
    for ph in pho:
        m = re.match(r'^([A-Z]+)(\d?)$', ph)
        if not m:
            continue
        c, st = m.groups()
        ip = A.get(c)
        if ip is None:
            continue
        out.append(S.get(st,'')+ip if st else ip)
    return ' '.join(out)
def wipa(w):
    e = cmu.get(w.lower())
    return arp(e[0]) if e else None
for it in d:
    ws = re.findall(r"[A-Za-z']+", it['text'])
    wi = []
    for w in ws:
        ip = wipa(w)
        wi.append(ip if ip else w)
    it['wordIpa'] = wi
open(p, 'w', encoding='utf-8').write(json.dumps(d, ensure_ascii=False, indent=2) + '\n')
print(len(d))
