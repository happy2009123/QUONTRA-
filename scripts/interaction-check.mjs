import puppeteer from 'puppeteer-core';
const b = await puppeteer.launch({executablePath:'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',headless:true,args:['--no-sandbox']});
const p = await b.newPage(); await p.setViewport({width:1440,height:900});
const errs=[]; p.on('pageerror',e=>errs.push(String(e))); p.on('console',m=>{if(m.type()==='error')errs.push(m.text())});
let bad=0;
// risk calculators
await p.goto('http://127.0.0.1:4173/risk',{waitUntil:'networkidle0'}); await new Promise(r=>setTimeout(r,700));
const t0 = await p.evaluate(()=>document.body.innerText);
const inputs = await p.$$('input[type=number]');
if(inputs.length>=4){
  await inputs[0].click({clickCount:3}); await inputs[0].type('500000');
  await inputs[1].click({clickCount:3}); await inputs[1].type('1.5');
  await new Promise(r=>setTimeout(r,500));
} else { console.log('risk: number inputs =', inputs.length); bad++; }
const t1 = await p.evaluate(()=>document.body.innerText);
console.log('risk calc changed:', t0!==t1);
if(t0===t1) bad++;
// scanner search
await p.goto('http://127.0.0.1:4173/scanner',{waitUntil:'networkidle0'}); await new Promise(r=>setTimeout(r,700));
const s0 = await p.evaluate(()=>document.body.innerText);
const rowsBefore = await p.evaluate(()=>document.querySelectorAll('tbody tr').length);
const si = await p.$('input[placeholder^="Symbol"]');
if(si){ await si.click({clickCount:3}); await si.type('RELIANCE'); await new Promise(r=>setTimeout(r,800)); } else { console.log('scanner: no search input'); bad++; }
const rowsAfter = await p.evaluate(()=>document.querySelectorAll('tbody tr').length);
const s1 = await p.evaluate(()=>document.body.innerText);
console.log('scanner rows', rowsBefore, '->', rowsAfter, 'text changed:', s0!==s1);
if(!(rowsAfter < rowsBefore)) bad++;
// settings modal
await p.goto('http://127.0.0.1:4173/settings',{waitUntil:'networkidle0'}); await new Promise(r=>setTimeout(r,600));
const btns = await p.$$('button');
let opened=false;
for(const x of btns){ const t=await x.evaluate(el=>el.innerText.trim()); if(t==='Reset all settings'){ await x.click(); opened=true; break; } }
await new Promise(r=>setTimeout(r,500));
const modal = await p.evaluate(()=>!!document.querySelector('[role="dialog"]'));
console.log('settings reset modal:', opened && modal);
if(!(opened&&modal)) bad++;
console.log('errs', JSON.stringify(errs.slice(0,3)));
await b.close(); process.exit(errs.length?1:bad);
