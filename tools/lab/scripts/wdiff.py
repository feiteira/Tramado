import sys, re, difflib
def words(p):
    t = open(p, encoding='utf-8').read().lower()
    return re.sub(r"[^\w\s'-]", " ", t).split()
a, b = words(sys.argv[1]), words(sys.argv[2])
sm = difflib.SequenceMatcher(a=a, b=b, autojunk=False)
for op, i1, i2, j1, j2 in sm.get_opcodes():
    if op != 'equal':
        print("%-8s [%s] -> [%s]" % (op, " ".join(a[i1:i2]), " ".join(b[j1:j2])))
