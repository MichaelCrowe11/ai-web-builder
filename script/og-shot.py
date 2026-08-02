# Renders script/og-card.html into client/public/og.png at exactly 1200x630.
#
# Shot at 2x and downsampled: the card is mostly large type on a dark ground,
# where 1x rasterisation of a serif shows its teeth.
#
# Usage: python3 script/og-shot.py   (from the repo root)

import os
import subprocess

from playwright.sync_api import sync_playwright

CARD = "file://" + os.path.abspath("script/og-card.html")
OUT = "client/public/og.png"

with sync_playwright() as pw:
    browser = pw.chromium.launch()
    page = browser.new_page(viewport={"width": 1200, "height": 630}, device_scale_factor=2)
    page.goto(CARD)
    page.wait_for_timeout(1200)
    page.screenshot(path="/tmp/og-2x.png")
    browser.close()

subprocess.run(
    ["magick", "/tmp/og-2x.png", "-resize", "1200x630", "-strip", "-quality", "92", OUT],
    check=True,
)
print(OUT)
