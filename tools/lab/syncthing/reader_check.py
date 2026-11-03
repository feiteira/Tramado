# reader_check.py DIR FILE SECONDS : tight-loop reader; validates every read of FILE is whole JSON lines,
# records temp file names Syncthing creates in DIR, and inode changes (rename-into-place evidence).
import os, sys, json, time
d, fn, secs = sys.argv[1], sys.argv[2], float(sys.argv[3])
p = os.path.join(d, fn); end = time.time() + secs
reads = bad = 0; tmpnames = set(); inodes = set(); maxlines = 0
while time.time() < end:
    try:
        for n in os.listdir(d):
            if n != fn: tmpnames.add(n)
        st = os.stat(p); inodes.add(st.st_ino)
        with open(p, 'rb') as f: data = f.read()
    except FileNotFoundError:
        continue
    reads += 1
    if data and not data.endswith(b'\n'): bad += 1; continue
    for line in data.splitlines():
        try: json.loads(line)
        except Exception: bad += 1; break
    maxlines = max(maxlines, len(data.splitlines()))
print(json.dumps({"reads": reads, "partial_or_invalid_reads": bad, "distinct_inodes_seen": len(inodes), "max_lines": maxlines, "other_names_seen": sorted(tmpnames)}))
