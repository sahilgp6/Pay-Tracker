#!/usr/bin/env python3
"""Build lab/index.html from the live index.html.
The lab is a test copy: its own saved data (crewpaylog.lab.v1), no service worker of its own,
and the lab bar plus the optional new look (lab/lab.css, lab/lab.js). Run from the repo root."""
import re, sys, os
if os.path.exists("lab/index.html") and "lab revamp" in open("lab/index.html", encoding="utf-8").read() and "--force" not in sys.argv:
    sys.exit("make-lab: lab/index.html holds the revamp (a hand-built fork). Rebuilding would erase it; pass --force only if you mean that.")
src = open("index.html", encoding="utf-8").read()
s = src
def sub(old, new, count=None):
    global s
    n = s.count(old)
    if not n: sys.exit(f"make-lab: expected text not found: {old[:60]!r}")
    s = s.replace(old, new) if count is None else s.replace(old, new, count)
sub('"crewpaylog.v1', '"crewpaylog.lab.v1')                       # separate saved data, incl. .year
sub('navigator.serviceWorker.register("sw.js")', 'Promise.resolve()')  # the lab never installs its own worker
sub('"pdfjs/', '"../pdfjs/')
sub('<link rel="manifest" href="manifest.json">', '')
sub('href="icon-192.png"', 'href="../icon-192.png"')
sub('href="apple-touch-icon.png"', 'href="../apple-touch-icon.png"')
sub('<title>Pay Tracker</title>', '<title>Pay Tracker LAB</title>', 1)
sub('</head>', '<link rel="stylesheet" href="lab.css">\n<script src="lab.js"></script>\n</head>', 1)
open("lab/index.html", "w", encoding="utf-8").write(s)
print("lab/index.html built from index.html")
