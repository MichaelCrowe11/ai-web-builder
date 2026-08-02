# Captures the showcase images from the HTML that script/showcase.ts renders.
#
# Run script/showcase.ts first, then:
#   python3 script/showcase-shots.py
#
# Shoots at 2x and downsamples, because a 1x capture of small caption type turns
# to mush once the browser scales it into the card. Output is webp: these sit
# below the fold on the marketing page and the PNGs are five times the size for
# no visible gain at this scale.

import subprocess
import sys

from playwright.sync_api import sync_playwright

SLUGS = ["bakery", "trades", "studio"]
# Wide and tall on purpose. A one-viewport 1280 capture shows only the sample's
# hero, and a hero is the section every builder gets right; the proof is what
# the page does after it. Capturing wider means more of the page fits inside a
# fixed frame height on the marketing card, at a smaller apparent scale, which
# is what makes it read as a whole site rather than a zoomed headline.
W, H = 1600, 1500
OUT = "client/public/showcase"

subprocess.run(["mkdir", "-p", OUT], check=True)

with sync_playwright() as pw:
    browser = pw.chromium.launch()
    for slug in SLUGS:
        page = browser.new_page(viewport={"width": W, "height": H}, device_scale_factor=2)
        page.goto(f"file:///tmp/showcase/{slug}.html", wait_until="networkidle", timeout=60000)
        page.wait_for_timeout(1500)
        page.screenshot(path=f"/tmp/showcase/{slug}-2x.png")
        page.close()
    browser.close()

for slug in SLUGS:
    subprocess.run(
        ["magick", f"/tmp/showcase/{slug}-2x.png", "-resize", f"{W}x{H}",
         "-quality", "82", "-strip", f"{OUT}/{slug}.webp"],
        check=True,
    )
    print(f"{OUT}/{slug}.webp")
