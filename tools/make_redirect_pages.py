#!/usr/bin/env python3
"""Write one small HTML page per legacy URL in redirects.csv so the old addresses keep working on a
static host that cannot send server-side 301s (GitHub Pages). Each page sends the visitor on at once
(meta refresh 0), names the new address as canonical, and asks search engines not to index it.
Run from the repository root:  python3 tools/make_redirect_pages.py
Every page written is plain 7-bit ASCII, like the rest of site/ (see README-SOURCE in the source kit)."""
import csv, os, sys
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SITE = os.path.join(ROOT, "site"); BASE = "https://www.theteethboutique.com"
PAGE = ('<!DOCTYPE html>\n<html lang="en">\n<head>\n<meta charset="UTF-8">\n<title>This page has moved</title>\n'
        '<link rel="canonical" href="{base}{new}">\n<meta http-equiv="refresh" content="0; url={new}">\n'
        '<meta name="robots" content="noindex">\n</head>\n<body>\n<p>This page has moved to <a href="{new}">{base}{new}</a>.</p>\n</body>\n</html>\n')
written = skipped = 0
with open(os.path.join(ROOT, "tools", "redirects.csv"), newline="") as f:
    for row in csv.DictReader(f):
        old, new = row["old_url"].strip(), row["new_url"].strip()
        if not old.startswith("/") or not new.startswith("/"): sys.exit("bad row: %r" % row)
        target = os.path.join(SITE, old.lstrip("/"), "index.html") if old.endswith("/") else os.path.join(SITE, old.lstrip("/"))
        if os.path.exists(target) and "This page has moved" not in open(target, encoding="ascii").read():
            print("skip (real page exists):", old); skipped += 1; continue
        os.makedirs(os.path.dirname(target), exist_ok=True)
        html = PAGE.format(base=BASE, new=new); html.encode("ascii")
        open(target, "w", encoding="ascii", newline="\n").write(html); written += 1
print("redirect pages written:", written, "skipped:", skipped)
