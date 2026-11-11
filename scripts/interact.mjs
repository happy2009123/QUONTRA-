import puppeteer from 'puppeteer-core';

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:4173';
const ROUTES = ['/', '/scanner', '/charts', '/intelligence', '/reports', '/strategy-lab', '/backtesting', '/risk', '/data', '/notifications', '/settings'];

const browser = await puppeteer.launch({
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1440, height: 900 });

const errors = [];
page.on('pageerror', (e) => errors.push(String(e)));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

let clicked = 0;
let failed = 0;

for (const route of ROUTES) {
  errors.length = 0;
  await page.goto(BASE + route, { waitUntil: 'networkidle0', timeout: 30000 });
  await new Promise((r) => setTimeout(r, 500));

  const before = await page.evaluate(() => document.body.innerText.length);

  // click up to 8 in-content action buttons (exclude nav shell + icon-only header)
  const handles = await page.$$eval('main button, [class*="space-y"] button', (btns) =>
    btns
      .filter((b) => {
        const r = b.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) return false;
        const t = (b.innerText || b.getAttribute('aria-label') || '').trim();
        return t.length > 0;
      })
      .slice(0, 8)
      .map((b, i) => i),
  );

  for (const idx of handles) {
    const btns = await page.$$('main button, [class*="space-y"] button');
    const b = btns[idx];
    if (!b) continue;
    try {
      await b.click({ timeout: 2500 });
      clicked += 1;
      await new Promise((r) => setTimeout(r, 450));
      // dismiss any modal that opened
      await page.keyboard.press('Escape');
      await new Promise((r) => setTimeout(r, 200));
      const st = await page.evaluate(() => {
        const open = document.querySelector('[role="dialog"]');
        if (open) { open.querySelector('button')?.click(); }
        return document.body.innerText.length;
      });
      if (st === 0) failed += 1;
    } catch {
      failed += 1;
    }
  }

  const after = await page.evaluate(() => document.body.innerText.length);
  const ok = errors.length === 0 && after > 0;
  console.log(`${route.padEnd(16)} clicked=${handles.length} text ${before}->${after} ${ok ? 'OK' : 'ERR: ' + errors.slice(0, 2).join(' | ')}`);
  if (!ok) failed += 1;
}

await browser.close();
console.log(`\n=== clicks=${clicked} failures=${failed} ===`);
process.exit(failed ? 1 : 0);
