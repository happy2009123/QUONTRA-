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

/** Session cookie captured by register/login and sent with every call. */
let cookie = '';

function authHeaders(extra = {}) {
  return cookie ? { Cookie: cookie, ...extra } : extra;
}

const get = async (p) => {
  const r = await fetch(base + p, { headers: authHeaders() });
  return { status: r.status, body: await r.json(), headers: r.headers };
};
const post = async (p, b) => {
  const r = await fetch(base + p, {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify(b),
  });
  return { status: r.status, body: await r.json(), headers: r.headers };
};

// 0. AUTH bootstrap — register the demo desk (or log in) and keep the cookie
console.log('\n0. AUTH bootstrap');
const AUTH_EMAIL = 'desk@quantora.demo';
const AUTH_PASSWORD = 'e2e-password-1';
let auth = await post('/api/auth/register', {
  email: AUTH_EMAIL,
  password: AUTH_PASSWORD,
  displayName: 'Research Desk',
});
if (auth.status !== 201) {
  auth = await post('/api/auth/login', { email: AUTH_EMAIL, password: AUTH_PASSWORD });
}
check(
  'signed in via register or login',
  (auth.status === 201 || auth.status === 200) && !!auth.body?.data,
  JSON.stringify(auth.body).slice(0, 200),
);
cookie = (auth.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
check('session cookie captured', cookie.startsWith('quantora_session=') && cookie.length > 20, cookie.slice(0, 48));
const bootSession = await get('/api/auth/session');
check(
  'session endpoint confirms identity',
  bootSession.status === 200 && bootSession.body?.data?.user?.email === AUTH_EMAIL,
  JSON.stringify(bootSession.body).slice(0, 200),
);

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

// 10. STOP_LOSS / TAKE_PROFIT validation
console.log('\n10. SL/TP validation');
r = await post('/api/paper-order', { instrumentId: 'eq-reliance', direction: 'BUY', orderType: 'STOP_LOSS', quantity: 1, price: lastPrice });
check('BUY STOP_LOSS rejected', r.status === 400, JSON.stringify(r.body));
r = await post('/api/paper-order', { instrumentId: 'eq-tcs', direction: 'SELL', orderType: 'STOP_LOSS', quantity: 1, price: lastPrice * 0.5 });
check('SL without position rejected', r.status === 400 && r.body?.error?.code === 'INSUFFICIENT_POSITION', JSON.stringify(r.body));
r = await post('/api/paper-order', { instrumentId: 'eq-reliance', direction: 'SELL', orderType: 'TAKE_PROFIT', quantity: 1 });
check('TP without trigger price rejected', r.status === 400, JSON.stringify(r.body));

// 11. TAKE_PROFIT far below market triggers on next read
console.log('\n11. TAKE_PROFIT triggers');
r = await get('/api/paper-positions');
const posA = (r.body?.data ?? []).find((p) => p.instrument_id === 'eq-reliance');
const qtyA = posA ? posA.quantity : 0;
const tpTrigger = Math.max(1, Math.floor(lastPrice * 0.5));
r = await post('/api/paper-order', { instrumentId: 'eq-reliance', direction: 'SELL', orderType: 'TAKE_PROFIT', quantity: 1, price: tpTrigger });
check('TP placed PENDING', r.status === 200 && r.body?.data?.status === 'PENDING', JSON.stringify(r.body));
const tpId = r.body?.data?.orderId;
r = await get('/api/paper-orders');
const tpOrder = (r.body?.data ?? []).find((o) => o.id === tpId);
check('TP swept to FILLED', tpOrder && tpOrder.status === 'FILLED', JSON.stringify(tpOrder));
check('TP filled near market (not at deep trigger)', tpOrder && Math.abs(tpOrder.price - lastPrice) < lastPrice * 0.1, `${tpOrder?.price} vs ${lastPrice}`);
r = await get('/api/paper-positions');
const posB = (r.body?.data ?? []).find((p) => p.instrument_id === 'eq-reliance');
check('position reduced by TP', posB && posB.quantity === qtyA - 1, `${posB?.quantity} vs ${qtyA}`);

// 12. BUY STOP below market triggers on next read (fills at market, top-up charged)
console.log('\n12. BUY STOP triggers');
const stopTrigger = Math.max(1, Math.floor(lastPrice * 0.5));
r = await post('/api/paper-order', { instrumentId: 'eq-reliance', direction: 'BUY', orderType: 'STOP', quantity: 1, price: stopTrigger });
check('stop placed PENDING', r.status === 200 && r.body?.data?.status === 'PENDING', JSON.stringify(r.body));
const stopId = r.body?.data?.orderId;
r = await get('/api/paper-orders');
const stopOrder = (r.body?.data ?? []).find((o) => o.id === stopId);
check('stop swept to FILLED', stopOrder && stopOrder.status === 'FILLED', JSON.stringify(stopOrder));
check('stop filled at market, above trigger', stopOrder && stopOrder.price > stopTrigger, `${stopOrder?.price} vs trigger ${stopTrigger}`);
r = await get('/api/paper-positions');
const posC = (r.body?.data ?? []).find((p) => p.instrument_id === 'eq-reliance');
check('position grew by 1', posC && posC.quantity === qtyA, `${posC?.quantity} vs ${qtyA}`);

// 13. Modify pending LIMIT (price + quantity), reservation rebalanced, cancel refunds new terms
console.log('\n13. MODIFY pending LIMIT');
const modLimit = Math.max(1, Math.floor(lastPrice * 0.4));
r = await post('/api/paper-order', { instrumentId: 'eq-reliance', direction: 'BUY', orderType: 'LIMIT', quantity: 1, price: modLimit });
check('limit placed', r.status === 200 && r.body?.data?.status === 'PENDING', JSON.stringify(r.body));
const modId = r.body?.data?.orderId;
const pfBeforeMod = (await get('/api/paper-portfolio')).body.data;
const newPrice = Math.max(1, Math.floor(lastPrice * 0.3));
r = await post('/api/paper-order/modify', { orderId: modId, price: newPrice, quantity: 2 });
check('modify 200', r.status === 200 && r.body?.data?.price === newPrice && r.body?.data?.quantity === 2, JSON.stringify(r.body));
const pfAfterMod = (await get('/api/paper-portfolio')).body.data;
check(
  'reservation rebalanced (available+used invariant)',
  Math.abs((pfAfterMod.available_capital + pfAfterMod.used_capital) - (pfBeforeMod.available_capital + pfBeforeMod.used_capital)) < 0.01,
  `${pfBeforeMod.available_capital + pfBeforeMod.used_capital} vs ${pfAfterMod.available_capital + pfAfterMod.used_capital}`,
);
r = await get('/api/paper-orders');
const modOrder = (r.body?.data ?? []).find((o) => o.id === modId);
check('order reflects new terms', modOrder && modOrder.price === newPrice && modOrder.quantity === 2, JSON.stringify(modOrder));
r = await post('/api/paper-cancel', { orderId: modId });
const expectedRefund = newPrice * 2 + newPrice * 2 * 0.0005;
check('cancel refunds NEW reservation', r.status === 200 && Math.abs((r.body?.data?.capitalReturned ?? 0) - expectedRefund) < 0.01, `${r.body?.data?.capitalReturned} vs ${expectedRefund}`);

// 14. Modify validation
console.log('\n14. MODIFY validation');
r = await post('/api/paper-order/modify', { orderId: modId, price: newPrice });
check('modify cancelled order 409', r.status === 409, JSON.stringify(r.body));
r = await post('/api/paper-order/modify', { orderId: 'nope', price: 10 });
check('modify unknown order 404', r.status === 404, JSON.stringify(r.body));
r = await post('/api/paper-order/modify', { orderId: modId });
check('modify without fields 400', r.status === 400, JSON.stringify(r.body));
r = await post('/api/paper-order/modify', { orderId: modId, price: -1 });
check('modify negative price 400', r.status === 400, JSON.stringify(r.body));

// 15. STOP_LOSS above market triggers on next read (protective sell)
console.log('\n15. STOP_LOSS triggers');
const slTrigger = Math.ceil(lastPrice * 1.5);
r = await post('/api/paper-order', { instrumentId: 'eq-reliance', direction: 'SELL', orderType: 'STOP_LOSS', quantity: 1, price: slTrigger });
check('SL placed PENDING', r.status === 200 && r.body?.data?.status === 'PENDING', JSON.stringify(r.body));
const slId = r.body?.data?.orderId;
r = await get('/api/paper-orders');
const slOrder = (r.body?.data ?? []).find((o) => o.id === slId);
check('SL swept to FILLED', slOrder && slOrder.status === 'FILLED', JSON.stringify(slOrder));
check('SL filled at market, below trigger', slOrder && slOrder.price <= slTrigger, `${slOrder?.price} vs ${slTrigger}`);

// 16. REJECTED path: stop-buy that cannot cover its top-up releases the reservation
console.log('\n16. REJECTED releases reservation');
const q16 = (await get('/api/paper-portfolio')).body.data.available_capital;
const px16 = (await get('/api/quotes?ids=eq-reliance')).body?.data?.[0]?.quote?.lastPrice;
const trig16 = Math.max(1, Math.floor(px16 * 0.5));
const qty16 = Math.floor(q16 / (trig16 * 1.0005));
r = await post('/api/paper-order', { instrumentId: 'eq-reliance', direction: 'BUY', orderType: 'STOP', quantity: qty16, price: trig16 });
check('oversized stop accepted (reserved)', r.status === 200 && r.body?.data?.status === 'PENDING', JSON.stringify(r.body).slice(0, 200));
const rejId = r.body?.data?.orderId;
r = await get('/api/paper-orders');
const rejOrder = (r.body?.data ?? []).find((o) => o.id === rejId);
check('stop REJECTED (cannot cover top-up)', rejOrder && rejOrder.status === 'REJECTED', JSON.stringify(rejOrder));
const pfRej = (await get('/api/paper-portfolio')).body.data;
check('reservation released after reject', Math.abs(pfRej.available_capital - q16) < 0.01, `${pfRej.available_capital} vs ${q16}`);

// 17. Strategy tagging + per-playbook performance
console.log('\n17. Strategy tagging + performance');
r = await post('/api/paper-order', {
  instrumentId: 'eq-reliance',
  direction: 'BUY',
  orderType: 'MARKET',
  quantity: 1,
  strategyId: 'str-ema-pullback',
});
check('tagged order accepted', r.status === 200 && r.body?.data?.status === 'FILLED', JSON.stringify(r.body));
check('response echoes strategyId', r.body?.data?.strategyId === 'str-ema-pullback', JSON.stringify(r.body?.data));
const tagId = r.body?.data?.orderId;
r = await get('/api/paper-orders');
const tagOrder = (r.body?.data ?? []).find((o) => o.id === tagId);
check('order history carries strategy_id', tagOrder && tagOrder.strategy_id === 'str-ema-pullback', JSON.stringify(tagOrder));
check('order history carries strategy_name', tagOrder && tagOrder.strategy_name === 'EMA Trend Pullback', JSON.stringify(tagOrder));
r = await post('/api/paper-order', {
  instrumentId: 'eq-reliance',
  direction: 'BUY',
  orderType: 'MARKET',
  quantity: 1,
  strategyId: 'str-not-a-strategy',
});
check('unknown strategyId 404', r.status === 404 && r.body?.error?.code === 'NOT_FOUND', JSON.stringify(r.body));
r = await get('/api/paper-strategy-performance');
check('performance 200', r.status === 200, JSON.stringify(r.body).slice(0, 200));
check('performance simulated meta', r.body?.meta?.simulated === true, JSON.stringify(r.body?.meta));
const perfRow = (r.body?.data ?? []).find((x) => x.strategyId === 'str-ema-pullback');
check('performance row exists', !!perfRow, JSON.stringify(r.body?.data).slice(0, 300));
check('performance counts the order', perfRow && perfRow.orders >= 1, JSON.stringify(perfRow));
check('performance counts filled order + opened trade', perfRow && perfRow.filled >= 1 && perfRow.trades >= 1, JSON.stringify(perfRow));
check('performance resolves playbook name', perfRow && perfRow.name === 'EMA Trend Pullback', JSON.stringify(perfRow));

// 18. AUTH lifecycle: anonymous blocked, logout clears, re-login restores
console.log('\n18. AUTH lifecycle');
const anonRes = await fetch(base + '/api/paper-portfolio');
const anonBody = await anonRes.json().catch(() => ({}));
check(
  'anonymous paper 401',
  anonRes.status === 401 && anonBody?.error?.code === 'UNAUTHORIZED',
  `status ${anonRes.status} ${JSON.stringify(anonBody).slice(0, 160)}`,
);

const ovAnon = await fetch(base + '/api/admin/overview');
check('admin overview requires session', ovAnon.status === 401, `status ${ovAnon.status}`);
const ov = await get('/api/admin/overview');
check(
  'admin overview 200 with full telemetry',
  ov.status === 200 && ov.body?.data?.service?.name === 'quantora-backend' && Array.isArray(ov.body?.data?.routes),
  JSON.stringify(ov.body).slice(0, 160),
);

const out = await post('/api/auth/logout', {});
check('logout 200', out.status === 200, JSON.stringify(out.body));
const cleared = out.headers.get('set-cookie') ?? '';
check('logout expires cookie', cleared.includes('Max-Age=0'), cleared.slice(0, 140));
cookie = cleared.split(';')[0] ?? '';
const afterLogout = await fetch(base + '/api/paper-portfolio');
check('paper blocked after logout', afterLogout.status === 401, `status ${afterLogout.status}`);

const rel = await post('/api/auth/login', { email: AUTH_EMAIL, password: AUTH_PASSWORD });
check('re-login 200', rel.status === 200 && !!rel.body?.data, JSON.stringify(rel.body).slice(0, 200));
cookie = (rel.headers.get('set-cookie') ?? '').split(';')[0] ?? '';
const restored = await get('/api/paper-portfolio');
check('access restored after login', restored.status === 200 && !!restored.body?.data, `status ${restored.status}`);

srv.close();
console.log(failures === 0 ? '\nALL PASS' : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
