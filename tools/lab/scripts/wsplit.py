# Splits the disagreement with a reference into whole-phrase drops/insertions (>= 4 words in one
# run, i.e. whisper skipping or repeating) and word-level differences (substitutions, short indels).
import sys, re, difflib
def words(p):
    t = open(p, encoding='utf-8').read().lower()
    return re.sub(r"[^\w\s'-]", " ", t).split()
ref = words(sys.argv[1])
print("%-18s %6s %8s %10s %10s" % ("file", "words", "total%", "phrase%", "word-lvl%"))
for p in sys.argv[2:]:
    h = words(p)
    sm = difflib.SequenceMatcher(a=ref, b=h, autojunk=False)
    phrase = word = 0
    for op, i1, i2, j1, j2 in sm.get_opcodes():
        if op == 'equal':
            continue
        n = max(i2 - i1, j2 - j1)
        if op in ('delete', 'insert') and n >= 4:
            phrase += n
        else:
            word += n
    t = len(ref)
    print("%-18s %6d %7.2f%% %9.2f%% %9.2f%%" % (p, len(h), 100*(phrase+word)/t, 100*phrase/t, 100*word/t))
