// Optional screenshots of an environment, for agents that want to look at their work.
// Uses Playwright when it is installed (npm i -g playwright, or in this folder); otherwise the
// feature reports itself as unavailable and nothing else changes.

import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
let pw = undefined;
let browser = null;

function load() {
  if (pw !== undefined) return pw;
  try {
    pw = require("playwright");
  } catch {
    try {
      pw = require(require.resolve("playwright", { paths: [process.cwd(), ...(process.env.NODE_PATH || "").split(":").filter(Boolean)] }));
    } catch {
      pw = null;
    }
  }
  return pw;
}

export async function screenshotAvailable() {
  return !!load();
}

export async function screenshot(url, { width = 1728, height = 1117, wait = 1500 } = {}) {
  const p = load();
  if (!p) {
    const e = new Error("Screenshots need Playwright: run npm i -g playwright && npx playwright install chromium");
    e.code = "no_playwright";
    e.status = 501;
    throw e;
  }
  // Guard: keep screenshots to a sane size so an agent can't ask for a gigapixel image.
  const w = Math.max(240, Math.min(4096, Math.round(width)));
  const h = Math.max(240, Math.min(4096, Math.round(height)));
  if (!browser) {
    browser = await p.chromium.launch(process.env.WORKSHOP_CHROMIUM ? { executablePath: process.env.WORKSHOP_CHROMIUM } : {});
    process.once("exit", () => {
      try {
        browser.close();
      } catch {}
    });
  }
  const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
  try {
    await page.goto(url, { waitUntil: "load", timeout: 60000 });
    await page.waitForTimeout(wait);
    return await page.screenshot({ type: "png" });
  } finally {
    await page.close();
  }
}

export async function closeBrowser() {
  if (browser) {
    const b = browser;
    browser = null;
    await b.close().catch(() => {});
  }
}
