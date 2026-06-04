#!/usr/bin/env python3
"""Seed 6 published showcase sites through the live generation pipeline.

Drives the REAL prod pipeline as a Pro `showcase` account, then reserves a stable
slug + publishes via psql. Idempotent: clears any prior showcase slug before
re-publishing, so re-runs replace cleanly.

Env: BASE (default https://ai-webbuilder.com), PGURL (DATABASE_PUBLIC_URL),
     SHOW_PASS (stable password for the showcase account — set it so re-runs log in).
"""
import json, os, subprocess, sys, urllib.request, urllib.error

BASE = os.environ.get("BASE", "https://ai-webbuilder.com")
PGURL = os.environ["PGURL"]
SHOW_USER = "showcase"
SHOW_PASS = os.environ.get("SHOW_PASS", "showcase-" + os.urandom(6).hex())

SITES = [
    ("showcase-cafe",    "a cozy specialty coffee shop called Bean & Bough in Austin"),
    ("showcase-plumber", "Northside Plumbing, a licensed 24/7 plumbing company in Denver"),
    ("showcase-salon",   "Lumen Studio, a modern hair and beauty salon in Brooklyn"),
    ("showcase-law",     "Hart & Vale, a boutique family and estate law firm in Seattle"),
    ("showcase-florist", "Wild Stem, a seasonal florist and plant shop in Portland"),
    ("showcase-gym",     "Iron Atlas, a strength-focused fitness gym in Chicago"),
]


def http(method, path, data=None, cookie=None, timeout=180):
    url = BASE + path
    body = json.dumps(data).encode() if data is not None else None
    req = urllib.request.Request(url, data=body, method=method)
    if data is not None:
        req.add_header("Content-Type", "application/json")
    if cookie:
        req.add_header("Cookie", cookie)
    try:
        r = urllib.request.urlopen(req, timeout=timeout)
        return r.status, r.read(), r.headers.get("Set-Cookie")
    except urllib.error.HTTPError as e:
        return e.code, e.read(), None


def psql(sql):
    subprocess.run(["psql", PGURL, "-v", "ON_ERROR_STOP=1", "-c", sql], check=True)


def sq(s):  # single-quote a literal for psql -c
    return "'" + str(s).replace("'", "''") + "'"


# 1. ensure showcase account (register; ignore "exists"), then log in for a cookie
http("POST", "/api/auth/register", {"username": SHOW_USER, "password": SHOW_PASS})
st, bod, cookie = http("POST", "/api/auth/login", {"username": SHOW_USER, "password": SHOW_PASS})
if st != 200:
    print("login failed (set SHOW_PASS to the existing showcase password):", st, bod[:200])
    sys.exit(1)
session = cookie.split(";")[0] if cookie else None

# 2. make it Pro so generated images render
psql(f"UPDATE users SET plan='pro' WHERE username={sq(SHOW_USER)};")

for slug, prompt in SITES:
    print(f"--- {slug}: {prompt}")
    st, bod, _ = http("POST", "/api/generate/document", {"prompt": prompt}, session)
    if st != 200:
        print("  gen failed:", st, bod[:200]); continue
    gen = json.loads(bod)
    st, bod, _ = http("POST", "/api/projects",
                       {"name": gen["document"]["meta"]["name"], "html": gen["html"], "css": gen["css"]}, session)
    if st not in (200, 201):
        print("  create failed:", st, bod[:200]); continue
    pid = json.loads(bod)["id"]
    # add Pro images, then persist the enriched doc (creates a site_document row)
    st, bod, _ = http("POST", "/api/generate/images", {"document": gen["document"]}, session)
    doc = json.loads(bod)["document"] if st == 200 else gen["document"]
    if st != 200:
        print("  images skipped:", st, str(bod)[:120])
    http("PUT", f"/api/projects/{pid}/document", {"document": doc}, session)
    # idempotent slug reservation: free the slug from any prior showcase project, then claim it
    psql(f"UPDATE projects SET slug=NULL, is_published=false WHERE slug={sq(slug)} AND id<>{sq(pid)};")
    psql(f"UPDATE projects SET slug={sq(slug)}, is_published=true, "
         f"published_url={sq(f'https://{slug}.ai-webbuilder.com')} WHERE id={sq(pid)};")
    print(f"  published https://{slug}.ai-webbuilder.com  (project {pid})")

print("done.")
