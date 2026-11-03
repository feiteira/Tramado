# Word error rate of hypothesis files against a reference file (lowercased, punctuation stripped).
import sys, re, unicodedata
def words(p):
    t = open(p, encoding='utf-8').read().lower()
    t = re.sub(r"[^\w\s'-]", " ", t)
    return t.split()
def wer(r, h):
    d = list(range(len(h) + 1))
    for i in range(1, len(r) + 1):
        prev, d[0] = d[0], i
        for j in range(1, len(h) + 1):
            cur = min(d[j] + 1, d[j-1] + 1, prev + (r[i-1] != h[j-1]))
            prev, d[j] = d[j], cur
    return d[len(h)] / max(1, len(r))
ref = words(sys.argv[1])
print("reference %s: %d words" % (sys.argv[1], len(ref)))
for p in sys.argv[2:]:
    print("%-28s WER vs ref %.2f%%" % (p, 100 * wer(ref, words(p))))
