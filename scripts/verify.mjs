import puppeteer from 'puppeteer-core';
import { mkdir } from 'node:fs/promises';

const BASE = process.env.BASE_URL ?? 'http://127.0.0.1:4173';
const ROUTES = [
  '/',
  '/scanner',
  '/charts',
  '/intelligence',
  '/reports',
  '/strategy-lab',
  '/backtesting',
  '/risk',
  '/data',
  '/notifications',
  '/settings',
  '/does-not-exist',
];
const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'tablet', width: 834, height: 1112 },
  { name: 'mobile', width: 390, height: 844 },
];

const results = [];
let failures = 0;

const browser = await puppeteer.launch({
  executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  headless: true,
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});

await mkdir('.verify', { recursive: true });

for (const vp of VIEWPORTS) {
  const page = await browser.newPage();
  await page.setViewport({ width: vp.width, height: vp.height });

  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => pageErrors.push(String(err)));

  for (const route of ROUTES) {
    consoleErrors.length = 0;
    pageErrors.length = 0;
    let status = 'OK';
    let detail = '';
    try {
      const res = await page.goto(BASE + route, { waitUntil: 'networkidle0', timeout: 30000 });
      if (res && res.status() >= 400) {
        status = 'HTTP';
        detail = String(res.status());
      }
      await new Promise((r) => setTimeout(r, 700));

      const audit = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        innerWidth: window.innerWidth,
        text: (document.body.innerText || '').replace(/\s+/g, ' ').trim().length,
        title: document.title,
        h1: document.querySelector('h1')?.textContent?.trim() ?? '',
        buttons: document.querySelectorAll('button').length,
        links: document.querySelectorAll('a[href]').length,
      }));

      if (audit.scrollWidth > audit.innerWidth + 1) {
        status = 'OVERFLOW';
        detail = `${audit.scrollWidth} > ${audit.innerWidth}`;
      } else if (audit.text < 120) {
        status = 'EMPTY';
        detail = `text=${audit.text}`;
      }
      if (pageErrors.length) {
        status = 'JS_ERROR';
        detail = pageErrors.slice(0, 2).join(' | ');
      } else if (consoleErrors.length) {
        status = 'CONSOLE';
        detail = consoleErrors.slice(0, 2).join(' | ');
      }

      if (status !== 'OK') failures += 1;

      const slug = route === '/' ? 'dashboard' : route.replace(/\//g, '_');
      await page.screenshot({ path: `.verify/${vp.name}${slug}.png`, fullPage: false });

      results.push({ vp: vp.name, route, status, detail, h1: audit.h1, buttons: audit.buttons, links: audit.links });
      console.log(`${vp.name.padEnd(8)} ${route.padEnd(18)} ${status} ${detail}`);
    } catch (err) {
      failures += 1;
      results.push({ vp: vp.name, route, status: 'NAV_FAIL', detail: String(err) });
      console.log(`${vp.name.padEnd(8)} ${route.padEnd(18)} NAV_FAIL ${err}`);
    }
  }
  await page.close();
}

await browser.close();

const bad = results.filter((r) => r.status !== 'OK');
console.log(`\n=== ${results.length} checks, ${failures} failures ===`);
if (bad.length) {
  console.log(JSON.stringify(bad, null, 2));
}
process.exit(failures ? 1 : 0);
