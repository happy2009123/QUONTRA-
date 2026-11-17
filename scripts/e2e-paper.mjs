/* Local E2E for the paper trading fill engine — run: node scripts/e2e-paper.mjs */
import { createServer } from 'node:http';

const mod = await import('../api/index.ts');
const srv = createServer((req, res) => {
  mod.default(req, res);
});
await new Promise((r) => srv.listen(0, r));
const base = `http://127.0.0.1:${srv.address().port}`;

let failures = 0;
function check(name, cond, detail) {
  if (cond) console.log(`  PASS ${name}`);
  else {
    failures += 1;
    console.log(`  FAIL ${name} :: ${detail}`);
  }
}

const get = async (p) => {
  const r = await fetch(base + p);
  return { status: r.status, body: await r.json() };
};
const post = async (p, b) => {
  const r = await fetch(base + p, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(b),
  });
  return { status: r.status, body: await r.json() };
};

// Learn the current market price for eq-reliance
const q = await get('/api/quotes?ids=eq-reliance');
const lastPrice = q.body?.data?.[0]?.quote?.lastPrice;
console.log(`market price: ${lastPrice}`);
if (!lastPrice || lastPrice <= 0) {
  console.log('FATAL: no quote price available', JSON.stringify(q.body).slice(0, 300));
  process.exit(1);
}

// 1. MARKET BUY fills immediately
console.log('\n1. MARKET BUY');
let r = await post('/api/paper-order', {
  instrumentId: 'eq-reliance',
  direction: 'BUY',
  orderType: 'MARKET',
  quantity: 5,
});
check('status 200', r.status === 200, JSON.stringify(r.body));
check('order FILLED', r.body?.data?.status === 'FILLED', JSON.stringify(r.body?.data));
const buyPrice = r.body?.data?.price ?? 0;
check('fill price is market price', Math.abs(buyPrice - lastPrice) < 0.01, `${buyPrice} vs ${lastPrice}`);

r = await get('/api/paper-positions');
const pos = (r.body?.data ?? []).find((p) => p.instrument_id === 'eq-reliance');
check('position exists qty 5', pos && pos.quantity === 5, JSON.stringify(r.body?.data));

r = await get('/api/paper-portfolio');
const pf1 = r.body?.data;
check('cash reduced', pf1.available_capital < 1000000, JSON.stringify(pf1));
check('used capital > 0', pf1.used_capital > 0, JSON.stringify(pf1));

// 2. SELL more than held → rejected
console.log('\n2. SELL excess rejected');
r = await post('/api/paper-order', {
  instrumentId: 'eq-reliance',
  direction: 'SELL',
  orderType: 'MARKET',
  quantity: 9999,
});
check('400/403 INSUFFICIENT_POSITION', r.status === 400 && r.body?.error?.code === 'INSUFFICIENT_POSITION', JSON.stringify(r.body));

// 3. MARKET SELL partial → position shrinks, cash rises, realised P&L
console.log('\n3. MARKET SELL partial');
const before = (await get('/api/paper-portfolio')).body.data;
r = await post('/api/paper-order', {
  instrumentId: 'eq-reliance',
  direction: 'SELL',
  orderType: 'MARKET',
  quantity: 2,
});
check('sell 200 FILLED', r.status === 200 && r.body?.data?.status === 'FILLED', JSON.stringify(r.body));
const after = (await get('/api/paper-portfolio')).body.data;
check('cash increased', after.available_capital > before.available_capital, `${before.available_capital} -> ${after.available_capital}`);
r = await get('/api/paper-positions');
const pos2 = (r.body?.data ?? []).find((p) => p.instrument_id === 'eq-reliance');
check('position qty 3', pos2 && pos2.quantity === 3, JSON.stringify(r.body?.data));
check('realised pnl recorded', after.realised_pnl !== 0, JSON.stringify(after));

// 4. LIMIT BUY far below market stays PENDING and reserves capital
console.log('\n4. LIMIT BUY resting');
const deepLimit = Math.max(1, Math.floor(lastPrice * 0.5));
r = await post('/api/paper-order', {
  instrumentId: 'eq-reliance',
  direction: 'BUY',
  orderType: 'LIMIT',
  quantity: 1,
  price: deepLimit,
});
check('limit 200 PENDING', r.status === 200 && r.body?.data?.status === 'PENDING', JSON.stringify(r.body));
const pendId = r.body?.data?.orderId;
const pfPend = (await get('/api/paper-portfolio')).body.data;
check('capital reserved while pending', pfPend.available_capital < after.available_capital, JSON.stringify(pfPend));

// 5. Cancel resting LIMIT → refund
console.log('\n5. CANCEL resting LIMIT');
r = await post('/api/paper-cancel', { orderId: pendId });
check('cancel 200', r.status === 200 && r.body?.data?.status === 'CANCELLED', JSON.stringify(r.body));
check('capital returned', r.body?.data?.capitalReturned > 0, JSON.stringify(r.body?.data));
const pfCancel = (await get('/api/paper-portfolio')).body.data;
check('portfolio restored', Math.abs(pfCancel.available_capital - after.available_capital) < 0.01, `${pfCancel.available_capital} vs ${after.available_capital}`);

// 6. LIMIT BUY above market → swept and filled on next read
console.log('\n6. CROSSING LIMIT fills via sweep');
const crossLimit = Math.ceil(lastPrice * 1.5);
r = await post('/api/paper-order', {
  instrumentId: 'eq-reliance',
  direction: 'BUY',
  orderType: 'LIMIT',
  quantity: 1,
  price: crossLimit,
});
check('placed', r.status === 200, JSON.stringify(r.body));
const crossId = r.body?.data?.orderId;
r = await get('/api/paper-orders');
const order = (r.body?.data ?? []).find((o) => o.id === crossId);
check('swept to FILLED', order && order.status === 'FILLED', JSON.stringify(order));
const pfSweep = (await get('/api/paper-portfolio')).body.data;
check('used capital absorbed', pfSweep.used_capital > 0, JSON.stringify(pfSweep));
r = await get('/api/paper-positions');
const pos3 = (r.body?.data ?? []).find((p) => p.instrument_id === 'eq-reliance');
check('position qty 4 (3+1)', pos3 && pos3.quantity === 4, JSON.stringify(r.body?.data));

// 7. SELL without position on a fresh instrument
console.log('\n7. SELL no position rejected');
r = await post('/api/paper-order', {
  instrumentId: 'eq-tcs',
  direction: 'SELL',
  orderType: 'MARKET',
  quantity: 1,
});
check('INSUFFICIENT_POSITION', r.status === 400 && r.body?.error?.code === 'INSUFFICIENT_POSITION', JSON.stringify(r.body));

// 8. Validation errors
console.log('\n8. VALIDATION');
r = await post('/api/paper-order', { instrumentId: 'nope', direction: 'BUY', orderType: 'MARKET', quantity: 1 });
check('unknown instrument 404', r.status === 404, JSON.stringify(r.body));
r = await post('/api/paper-order', { instrumentId: 'eq-tcs', direction: 'BUY', orderType: 'LIMIT', quantity: 1, price: -5 });
check('bad limit price 400', r.status === 400, JSON.stringify(r.body));
r = await post('/api/paper-order', { instrumentId: 'eq-tcs', direction: 'BUY', orderType: 'MARKET', quantity: 0 });
check('qty 0 400', r.status === 400, JSON.stringify(r.body));

// 9. Insufficient balance
console.log('\n9. INSUFFICIENT_BALANCE');
r = await post('/api/paper-order', { instrumentId: 'eq-reliance', direction: 'BUY', orderType: 'MARKET', quantity: 1000000 });
check('INSUFFICIENT_BALANCE', r.status === 400 && r.body?.error?.code === 'INSUFFICIENT_BALANCE', JSON.stringify(r.body).slice(0, 200));

srv.close();
console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
