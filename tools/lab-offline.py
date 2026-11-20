#!/usr/bin/env python3
"""Write the lab's offline file list into lab/sw.js from what is actually in lab/, so the lab opens fully with no signal.
Run from the repo root after adding or removing lab files (every build is fine). Bumps the cache name when the list changes.
Licence texts are left out; the icons, the lab manifest and the PDF reader one level up are added."""
import os, re, hashlib
LAB = "lab"
skip_ext = {".txt", ".md", ".py", ".map"}
files = []
for root, dirs, names in os.walk(LAB):
    dirs[:] = sorted(d for d in dirs if not d.startswith("."))
    for n in sorted(names):
        p = os.path.join(root, n); rel = os.path.relpath(p, LAB).replace(os.sep, "/")
        if n.startswith(".") or os.path.splitext(n)[1].lower() in skip_ext or n.upper().startswith("LICENSE") or rel == "sw.js": continue
        files.append(rel)
root_extra = ["icon-192.png", "icon-512.png", "apple-touch-icon.png", "pdfjs/pdf.min.js", "pdfjs/pdf.worker.min.js"]
for r in root_extra: assert os.path.exists(r), r
lab_list = [""] + files            # "" is the lab's own address (/lab/)
sw = open(f"{LAB}/sw.js", encoding="utf-8").read()
block = "const PRECACHE = [\n" + "".join(f"  '{f}',\n" for f in lab_list) + "].map(p => SCOPE + p).concat([\n" + "".join(f"  '{r}',\n" for r in root_extra) + "].map(p => ROOT + p));"
new = re.sub(r"const PRECACHE = \[.*?\]\.map\(p => SCOPE \+ p\)\.concat\(\[.*?\]\.map\(p => ROOT \+ p\)\);|const PRECACHE = \[.*?\]\.map\(p => SCOPE \+ p\)\.concat\(\[[^\]]*\]\);", block, sw, flags=re.S)
assert new != sw or block in sw, "PRECACHE block not found"
if new != sw:
    m = re.search(r"const CACHE = 'pay-tracker-lab-v(\d+)';", new); new = new.replace(m.group(0), f"const CACHE = 'pay-tracker-lab-v{int(m.group(1)) + 1}';")
    open(f"{LAB}/sw.js", "w", encoding="utf-8").write(new)
    print(f"lab/sw.js: {len(lab_list)} lab files + {len(root_extra)} shared, cache v{int(m.group(1)) + 1}")
else: print("lab/sw.js: list unchanged")
