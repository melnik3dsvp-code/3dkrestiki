// Слой данных на Supabase. Интерфейс для app.js и admin.js: чтение из кэша (Store.get()),
// изменения выполняются на сервере через функции базы (supabase/schema.sql), после чего кэш обновляется.
(function () {
  'use strict';
  const cfg = window.APP_CONFIG;
  const sb = window.supabase.createClient(cfg.url, cfg.key, { auth: { persistSession: true, autoRefreshToken: true } });
  const listeners = [];
  const rub = n => Math.round(n).toLocaleString('ru-RU') + ' ₽';

  const STATUS = {
    pending: 'Ожидает подтверждения администратора', approved: 'Одобрен', paid: 'Оплачен',
    shipped: 'Передан в СДЭК', delivered: 'Выдан', rejected: 'Отклонён', cancelled: 'Отменён'
  };
  const DEFAULT_SETTINGS = {
    earnPercent: 5, maxPointsPercent: 100, socialReward: 100, welcomeBonus: 0,
    loyalty: [{ name: 'Старт', from: 0, discount: 0 }, { name: 'Серебро', from: 50000, discount: 3 }, { name: 'Золото', from: 150000, discount: 5 }]
  };

  const state = { settings: DEFAULT_SETTINGS, products: [], users: {}, orders: [], notifications: [], social: [], pointsLog: [], journal: [], promos: [] };
  let me = null, session = null, channel = null, poller = null, loadError = '';
  let readyResolve; const ready = new Promise(r => { readyResolve = r; });

  const emit = () => listeners.forEach(f => { try { f(); } catch (e) { console.error(e); } });
  const ts = s => Date.parse(s);

  // ---------- маппинг строк БД в формат интерфейса ----------
  const mapProfile = r => ({ id: r.id, phone: r.phone, name: r.name, city: r.city, points: r.points, spent: r.spent,
    fav: r.fav || [], cart: r.cart || [], isAdmin: r.is_admin, blocked: r.blocked, created: ts(r.created_at) });
  const mapOrder = r => ({ id: r.id, num: r.num, userId: r.user_id, phone: r.phone, name: r.name, items: r.items, pvz: r.pvz, comment: r.comment,
    subtotal: r.subtotal, levelPct: r.level_pct, promoPct: r.promo_pct, promoCode: r.promo_code, pointsUsed: r.points_used, total: r.total,
    status: r.status, noPay: r.no_pay, edited: r.edited, paid: r.paid, rejectReason: r.reject_reason, adminComment: r.admin_comment,
    changes: r.changes || [], history: r.history || [], pointsEarned: r.points_earned, pointsRefunded: r.points_refunded, created: ts(r.created_at) });

  // ---------- загрузка данных ----------
  let busy = false, again = false;
  async function refresh() {
    if (!session) return;
    if (busy) { again = true; return; }
    busy = true;
    try {
      do {
        again = false;
        const T = (t, q) => q || sb.from(t).select('*');
        const [pr, st, pd, od, nt, pl, so, jr, pm] = await Promise.all([
          sb.from('profiles').select('*'),
          sb.from('settings').select('data').eq('id', 1).maybeSingle(),
          sb.from('products').select('*').order('sort').order('id'),
          sb.from('orders').select('*').order('created_at', { ascending: false }).limit(500),
          sb.from('notifications').select('*').order('created_at', { ascending: false }).limit(100),
          sb.from('points_log').select('*').order('created_at', { ascending: false }).limit(300),
          sb.from('social').select('*').order('created_at', { ascending: false }).limit(300),
          sb.from('journal').select('*').order('created_at', { ascending: false }).limit(300),
          sb.from('promos').select('*').order('code')
        ]);
        const bad = [pr, pd, od].find(x => x.error);
        if (bad) { loadError = bad.error.message; console.error('load error', bad.error); break; }
        loadError = '';
        const profiles = (pr.data || []).map(mapProfile);
        const mine = profiles.find(p => p.id === session.user.id);
        if (mine) {
          if (me) { mine.cart = me.cart; mine.fav = me.fav; } // корзину и избранное ведёт клиент
          me = mine;
        }
        state.users = {}; profiles.forEach(p => { state.users[p.phone] = p; });
        if (st.data) state.settings = Object.assign({}, DEFAULT_SETTINGS, st.data.data);
        state.products = (pd.data || []).map(r => Object.assign({}, r.data, { id: r.id, sku: r.sku }));
        state.orders = (od.data || []).map(mapOrder);
        state.notifications = (nt.data || []).map(r => ({ id: r.id, phone: me ? me.phone : '', title: r.title, text: r.text, orderId: r.order_id, read: r.read, t: ts(r.created_at) }));
        state.pointsLog = (pl.data || []).map(r => ({ id: r.id, phone: me ? me.phone : '', delta: r.delta, reason: r.reason, t: ts(r.created_at), userId: r.user_id }));
        state.social = (so.data || []).map(r => ({ id: r.id, userId: r.user_id, phone: r.phone, network: r.network, url: r.url, note: r.note, shot: r.shot, status: r.status, reward: r.reward, t: ts(r.created_at) }));
        state.journal = (jr.data || []).map(r => ({ id: r.id, text: r.text, t: ts(r.created_at) }));
        state.promos = pm.data || [];
      } while (again);
    } catch (e) { loadError = String(e.message || e); console.error(e); }
    busy = false;
    emit();
  }
  let sched;
  const scheduleRefresh = () => { clearTimeout(sched); sched = setTimeout(refresh, 300); };

  function startRealtime() {
    if (channel) return;
    channel = sb.channel('db-changes').on('postgres_changes', { event: '*', schema: 'public' }, scheduleRefresh).subscribe();
    poller = setInterval(() => { if (!document.hidden) refresh(); }, 30000);
  }
  function resetState() {
    if (channel) { sb.removeChannel(channel); channel = null; }
    clearInterval(poller);
    me = null; session = null;
    Object.assign(state, { users: {}, orders: [], notifications: [], social: [], pointsLog: [], journal: [], promos: [] });
  }

  sb.auth.onAuthStateChange((ev, s) => {
    session = s;
    setTimeout(async () => {
      if (s) { await refresh(); startRealtime(); } else { resetState(); emit(); }
      readyResolve();
    }, 0);
  });

  // ---------- вход ----------
  const normPhone = p => {
    const d = String(p || '').replace(/\D/g, '');
    if (d.length === 11 && (d[0] === '7' || d[0] === '8')) return '+7' + d.slice(1);
    if (d.length === 10) return '+7' + d;
    return null;
  };
  const emailOf = ph => ph.replace(/\D/g, '') + '@phone.3dkrestiki.app';
  const authMsg = e => {
    const m = String(e.message || e);
    if (/already registered|already been registered/i.test(m)) return 'Этот номер уже зарегистрирован. Нажмите «Войти»';
    if (/invalid login/i.test(m)) return 'Неверный номер или пароль';
    if (/password/i.test(m) && /6/.test(m)) return 'Пароль не короче 6 символов';
    if (/rate limit|too many/i.test(m)) return 'Слишком много попыток. Подождите минуту';
    return m;
  };
  async function register(phone, password, name) {
    const ph = normPhone(phone);
    if (!ph) return { error: 'Введите номер в формате +7 900 000-00-00' };
    if (!password || password.length < 6) return { error: 'Пароль не короче 6 символов' };
    const { data, error } = await sb.auth.signUp({ email: emailOf(ph), password, options: { data: { phone: ph, name: (name || '').trim() } } });
    if (error) return { error: authMsg(error) };
    if (!data.session) return { error: 'Регистрация требует подтверждения почты: в Supabase отключите «Confirm email» (Authentication → Sign In / Providers → User Signups)' };
    session = data.session;
    await refresh();
    return { ok: true };
  }
  async function login(phone, password) {
    const ph = normPhone(phone);
    if (!ph) return { error: 'Введите номер в формате +7 900 000-00-00' };
    const { data, error } = await sb.auth.signInWithPassword({ email: emailOf(ph), password: password || '' });
    if (error) return { error: authMsg(error) };
    session = data.session; // сессия нужна до первой загрузки данных
    await refresh();
    return { ok: true };
  }
  async function adminLogin(email, password) {
    const { data, error } = await sb.auth.signInWithPassword({ email: String(email || '').trim(), password: password || '' });
    if (error) return { error: authMsg(error) };
    session = data.session; // сессия нужна до первой загрузки данных
    await refresh();
    if (!me || !me.isAdmin) {
      const why = loadError ? 'Не удалось загрузить данные: ' + loadError : 'У этого аккаунта нет прав администратора';
      await sb.auth.signOut();
      return { error: why };
    }
    return { ok: true };
  }
  const logout = async () => { await sb.auth.signOut(); };

  // ---------- вспомогательные ----------
  const currentUser = () => me;
  const currentPhone = () => (me ? me.phone : null);
  const product = id => state.products.find(p => p.id === id);
  const variantOf = (p, vid) => p && p.variants.find(v => v.id === vid);
  const order = id => state.orders.find(o => o.id === id);

  function levelOf(user) {
    const lv = state.settings.loyalty.slice().sort((a, b) => a.from - b.from);
    let cur = lv[0];
    lv.forEach(l => { if ((user.spent || 0) >= l.from) cur = l; });
    return { cur, next: lv.find(l => l.from > cur.from) || null };
  }
  function cartLines(user) {
    return (user.cart || []).map(c => {
      const p = product(c.pid), v = variantOf(p, c.vid);
      if (!p || !v) return null;
      return { pid: p.id, vid: v.id, name: p.name, label: v.label, price: v.price, qty: c.qty, available: p.inStock && v.inStock };
    }).filter(Boolean);
  }
  // Расчёт для показа на экране. Итог по заказу всегда пересчитывает сервер.
  function calc(user, opts) {
    opts = opts || {};
    const lines = opts.lines || cartLines(user);
    const subtotal = lines.reduce((s, l) => s + l.price * l.qty, 0);
    const levelPct = opts.levelPct != null ? opts.levelPct : levelOf(user).cur.discount;
    const promoPct = opts.promoPct || 0;
    const levelDisc = Math.round(subtotal * levelPct / 100), promoDisc = Math.round(subtotal * promoPct / 100);
    const afterDisc = Math.max(0, subtotal - levelDisc - promoDisc);
    const maxByRule = Math.floor(afterDisc * state.settings.maxPointsPercent / 100);
    const pointsMax = Math.max(0, Math.min(user.points + (opts.pointsAlready || 0), maxByRule));
    const points = Math.max(0, Math.min(Math.floor(opts.points || 0), pointsMax));
    return { lines, subtotal, levelPct, levelDisc, promoPct, promoDisc, afterDisc, pointsMax, points, total: afterDisc - points };
  }

  async function rpc(fn, args) {
    const { data, error } = await sb.rpc(fn, args || {});
    if (error) return { error: error.message };
    await refresh();
    return { data };
  }
  async function checkPromo(code) {
    const { data, error } = await sb.rpc('check_promo', { p_code: code || '' });
    return error ? 0 : (data || 0);
  }

  // ---------- корзина и профиль (сохраняются в профиле клиента) ----------
  let saveTimer;
  function persistProfile() {
    emit();
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => { if (me) sb.from('profiles').update({ cart: me.cart, fav: me.fav }).eq('id', me.id).then(() => {}); }, 400);
  }
  function addToCart(pid, vid, qty) {
    if (!me) return;
    const it = me.cart.find(c => c.pid === pid && c.vid === vid);
    if (it) it.qty += qty || 1; else me.cart.push({ pid, vid, qty: qty || 1 });
    persistProfile();
  }
  function setQty(pid, vid, qty) {
    if (!me) return;
    const i = me.cart.findIndex(c => c.pid === pid && c.vid === vid);
    if (i < 0) return;
    if (qty <= 0) me.cart.splice(i, 1); else me.cart[i].qty = Math.min(qty, 9999);
    persistProfile();
  }
  function toggleFav(pid) {
    if (!me) return;
    const i = me.fav.indexOf(pid);
    if (i >= 0) me.fav.splice(i, 1); else me.fav.push(pid);
    persistProfile();
  }
  async function updateProfile(patch) {
    if (!me) return;
    Object.assign(me, patch);
    await sb.from('profiles').update(patch).eq('id', me.id);
    emit();
  }

  // ---------- клиент: заказы, уведомления, соцсети ----------
  const myNotifs = () => state.notifications;
  function markRead() {
    if (!state.notifications.some(n => !n.read)) return;
    state.notifications.forEach(n => { n.read = true; });
    emit();
    sb.rpc('mark_notifs_read').then(() => {});
  }
  async function createOrder(opts) {
    if (!me) return { error: 'Войдите в приложение' };
    const items = me.cart.map(c => ({ pid: c.pid, vid: c.vid, qty: c.qty }));
    const r = await rpc('create_order', { p_items: items, p_pvz: opts.pvz || null, p_name: opts.name || '', p_comment: opts.comment || '', p_points: opts.points || 0, p_promo: opts.promo || '' });
    if (r.error) return r;
    me.cart = [];
    emit();
    return { order: mapOrder(r.data) };
  }
  const cancelOrder = id => rpc('cancel_order', { p_id: id });
  const payOrder = id => rpc('pay_order', { p_id: id });
  function repeatOrder(id) {
    const o = order(id); if (!o || !me) return 0;
    let n = 0;
    o.items.forEach(it => {
      const p = product(it.pid), v = variantOf(p, it.vid);
      if (p && v && p.inStock && v.inStock) { addToCart(it.pid, it.vid, it.qty); n++; }
    });
    return n;
  }
  const submitSocial = (network, url, note, shot) => rpc('submit_social', { p_network: network, p_url: url, p_note: note, p_shot: shot || '' });

  // ---------- администратор ----------
  const approveOrder = (id, noPay) => rpc('admin_approve', { p_id: id, p_no_pay: !!noPay });
  const rejectOrder = (id, reason) => rpc('admin_reject', { p_id: id, p_reason: reason });
  const markPaidManually = id => rpc('admin_mark_paid', { p_id: id });
  const advanceOrder = (id, status) => rpc('admin_advance', { p_id: id, p_status: status });
  const reviewSocial = (id, ok, reward) => rpc('admin_review_social', { p_id: id, p_ok: !!ok, p_reward: Math.floor(reward || 0) });
  function adjustPoints(phone, delta, reason) {
    const u = state.users[phone]; if (!u) return Promise.resolve({ error: 'Клиент не найден' });
    return rpc('admin_adjust_points', { p_user: u.id, p_delta: delta, p_reason: reason || '' });
  }

  // patch: {items:[{pid,vid,qty,price}], pointsUsed, noPay, adminComment}
  async function editOrder(id, patch, approve) {
    const o = order(id); if (!o) return { error: 'Заказ не найден' };
    const u = state.users[o.phone];
    const items = patch.items.filter(i => i.qty > 0).map(i => Object.assign({}, o.items.find(x => x.pid === i.pid && x.vid === i.vid), { qty: Math.floor(i.qty), price: Number(i.price) }));
    if (!items.length) return { error: 'В заказе должна остаться хотя бы одна позиция. Для отказа используйте «Отклонить»' };
    const c = calc(u, { lines: items, levelPct: o.levelPct, promoPct: o.promoPct, points: patch.pointsUsed, pointsAlready: o.pointsUsed });
    const key = i => i.pid + '|' + i.vid, nm = {};
    items.forEach(i => { nm[key(i)] = i; });
    const diff = [];
    o.items.forEach(i => {
      const n = nm[key(i)];
      if (!n) diff.push('Убрана позиция: ' + i.name + ' (' + i.label + ')');
      else {
        if (n.qty !== i.qty) diff.push(i.name + ' (' + i.label + '): ' + i.qty + ' → ' + n.qty + ' шт');
        if (n.price !== i.price) diff.push(i.name + ': цена ' + rub(i.price) + ' → ' + rub(n.price));
      }
    });
    if (c.points !== o.pointsUsed) diff.push('Списано баллов: ' + o.pointsUsed + ' → ' + c.points);
    const np = !!patch.noPay || c.total === 0;
    if (np !== o.noPay) diff.push(np ? 'Без онлайн-оплаты' : 'Требуется онлайн-оплата');
    return rpc('admin_edit_order', {
      p_id: id, p_items: items.map(i => ({ pid: i.pid, vid: i.vid, qty: i.qty, price: i.price })), p_points: c.points,
      p_no_pay: np, p_comment: patch.adminComment || '', p_approve: !!approve, p_diff: diff
    });
  }

  // каталог
  const sortIndex = p => state.products.findIndex(x => x.id === p.id);
  function productRow(p, sort) {
    const data = Object.assign({}, p); delete data.id; delete data.sku;
    return { id: p.id, sku: p.sku, data, sort };
  }
  async function saveProduct(p) {
    let s = sortIndex(p); if (s < 0) s = state.products.length;
    const { error } = await sb.from('products').upsert(productRow(p, s));
    if (error) return { error: error.message };
    await refresh(); return { ok: true };
  }
  async function importProducts(list, mode) {
    if (mode === 'replace') {
      const d = await sb.from('products').delete().neq('id', '');
      if (d.error) return { error: d.error.message };
    }
    const base = mode === 'replace' ? 0 : state.products.length;
    const rows = list.map((p, i) => {
      const old = state.products.find(x => x.sku === p.sku);
      if (old && mode !== 'replace') { p.id = old.id; if (old.photo) p.photo = old.photo; }
      return productRow(p, old && mode !== 'replace' ? sortIndex(old) : base + i);
    });
    for (let i = 0; i < rows.length; i += 100) {
      const { error } = await sb.from('products').upsert(rows.slice(i, i + 100), { onConflict: 'id' });
      if (error) return { error: error.message };
    }
    await sb.rpc('admin_log', { p_text: 'Импорт прайса: ' + list.length + ' товаров (' + (mode === 'replace' ? 'замена' : 'обновление') + ')' });
    await refresh(); return { ok: true };
  }
  function setStock(pid, vid, inStock) {
    const p = product(pid); if (!p) return;
    if (vid) { const v = variantOf(p, vid); if (v) v.inStock = inStock; } else p.inStock = inStock;
    return saveProduct(p);
  }
  function setPrice(pid, vid, price) {
    const v = variantOf(product(pid), vid); if (!v) return;
    v.price = Math.max(0, Number(price) || 0);
    return saveProduct(product(pid));
  }
  async function deleteProduct(pid) { await sb.from('products').delete().eq('id', pid); await refresh(); }

  const photoKey = sku => String(sku).replace(/[^A-Za-z0-9._-]/g, '_') + '.jpg';
  function photoOf(sku) {
    const p = state.products.find(x => x.sku === sku);
    return p && p.photo ? cfg.url + '/storage/v1/object/public/photos/' + encodeURIComponent(photoKey(sku)) + '?v=' + p.photo : '';
  }
  async function setPhoto(sku, dataUrl) {
    const p = state.products.find(x => x.sku === sku); if (!p) return false;
    const blob = await (await fetch(dataUrl)).blob();
    const up = await sb.storage.from('photos').upload(photoKey(sku), blob, { upsert: true, contentType: 'image/jpeg' });
    if (up.error) { console.error(up.error); return false; }
    p.photo = Date.now();
    const r = await saveProduct(p);
    return !r.error;
  }

  // настройки и промокоды
  async function updateSettings(patch) {
    const data = Object.assign({}, state.settings, patch);
    const { error } = await sb.from('settings').upsert({ id: 1, data });
    if (error) return { error: error.message };
    await sb.rpc('admin_log', { p_text: 'Изменены настройки' });
    await refresh(); return { ok: true };
  }
  async function savePromo(code, percent, active) {
    const { error } = await sb.from('promos').upsert({ code: String(code).trim().toUpperCase(), percent, active });
    if (error) return { error: error.message };
    await refresh(); return { ok: true };
  }

  function parseCsv(text) {
    const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter(l => l.trim());
    if (lines.length < 2) return { error: 'Файл пуст' };
    const sep = lines[0].includes(';') ? ';' : ',';
    const head = lines[0].split(sep).map(h => h.trim().toLowerCase());
    const col = n => head.indexOf(n);
    for (const n of ['sku', 'name', 'price']) if (col(n) < 0) return { error: 'Нет колонки «' + n + '». Нужны: sku, name, brand, category, variant, price, stock' };
    const map = new Map();
    for (let i = 1; i < lines.length; i++) {
      const c = lines[i].split(sep).map(x => x.trim());
      const sku = c[col('sku')]; if (!sku) continue;
      const price = Number(String(c[col('price')]).replace(/\s/g, '').replace(',', '.'));
      if (!isFinite(price)) continue;
      const stockRaw = col('stock') >= 0 ? String(c[col('stock')]).toLowerCase() : '1';
      const inStock = !['0', 'нет', 'no', 'false', ''].includes(stockRaw);
      let p = map.get(sku);
      if (!p) {
        const cat = col('category') >= 0 ? c[col('category')] : '';
        p = { id: sku.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || ('p' + i), sku, name: c[col('name')],
          brand: col('brand') >= 0 ? c[col('brand')] : '', category: cat || 'Прочее', desc: col('desc') >= 0 ? c[col('desc')] : '',
          variants: [], inStock: true, merch: /мерч/i.test(cat) };
        map.set(sku, p);
      }
      const label = col('variant') >= 0 && c[col('variant')] ? c[col('variant')] : 'шт';
      p.variants.push({ id: 'v' + (p.variants.length + 1), label, price, inStock });
    }
    return { products: [...map.values()] };
  }

  window.Store = {
    get: () => state, subscribe: f => listeners.push(f), ready, STATUS, rub, loadError: () => loadError,
    normPhone, currentUser, currentPhone, register, login, adminLogin, logout, updateProfile,
    levelOf, product, variantOf, cartLines, calc, checkPromo, addToCart, setQty, toggleFav,
    myNotifs, markRead, createOrder, cancelOrder, payOrder, repeatOrder, order, submitSocial,
    approveOrder, rejectOrder, editOrder, markPaidManually, advanceOrder, reviewSocial, adjustPoints,
    parseCsv, importProducts, saveProduct, setStock, setPrice, deleteProduct, photoOf, setPhoto,
    updateSettings, savePromo, refresh,
    statusLabel(o) {
      if (o.status === 'approved') return (o.edited ? 'Одобрен с изменениями' : 'Одобрен') + (o.noPay ? ' · без онлайн-оплаты' : ' · ожидает оплаты');
      return STATUS[o.status];
    }
  };
})();
