// Слой данных. Сейчас хранится в localStorage (демо), позже заменяется запросами к серверу (Supabase).
(function () {
  'use strict';
  const KEY = '3dk_state_v1', SKEY = '3dk_session', PKEY = '3dk_photos';
  const listeners = [];
  let state;

  const uid = p => p + Math.random().toString(36).slice(2, 8);
  const clone = o => JSON.parse(JSON.stringify(o));
  const rub = n => Math.round(n).toLocaleString('ru-RU') + ' ₽';

  const STATUS = {
    pending: 'Ожидает подтверждения администратора',
    approved: 'Одобрен',
    paid: 'Оплачен',
    shipped: 'Передан в СДЭК',
    delivered: 'Выдан',
    rejected: 'Отклонён',
    cancelled: 'Отменён'
  };

  function defaults() {
    return {
      v: 1,
      settings: {
        earnPercent: 5, maxPointsPercent: 100, socialReward: 100, welcomeBonus: 0, adminPass: '3dk-admin',
        loyalty: [
          { name: 'Старт', from: 0, discount: 0 },
          { name: 'Серебро', from: 50000, discount: 3 },
          { name: 'Золото', from: 150000, discount: 5 }
        ]
      },
      products: clone(window.CATALOG),
      users: {}, orders: [], notifications: [], social: [], pointsLog: [], journal: [], sms: {},
      promos: [{ code: '3DFAMILY', percent: 5, active: true }],
      orderSeq: 1000
    };
  }

  function load() {
    try {
      const s = JSON.parse(localStorage.getItem(KEY));
      if (s && s.v === 1) return s;
    } catch (e) { /* пусто */ }
    return defaults();
  }
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) { console.warn('save failed', e); }
    emit();
  }
  function emit() { listeners.forEach(f => { try { f(); } catch (e) { console.error(e); } }); }

  state = load();
  window.addEventListener('storage', e => {
    if (e.key === KEY) { state = load(); emit(); }
  });

  // ---------- сессия клиента ----------
  const normPhone = p => {
    const d = String(p || '').replace(/\D/g, '');
    if (d.length === 11 && (d[0] === '7' || d[0] === '8')) return '+7' + d.slice(1);
    if (d.length === 10) return '+7' + d;
    return null;
  };
  const currentPhone = () => { try { return localStorage.getItem(SKEY); } catch (e) { return null; } };
  function currentUser() { const ph = currentPhone(); return ph ? state.users[ph] || null : null; }

  function requestCode(phone) {
    const ph = normPhone(phone);
    if (!ph) return { error: 'Введите номер в формате +7 900 000-00-00' };
    const code = String(Math.floor(1000 + Math.random() * 9000));
    state.sms[ph] = { code, t: Date.now() };
    save();
    return { phone: ph, code }; // в боевой версии код уходит SMS-провайдером и не возвращается
  }
  function verifyCode(phone, code) {
    const rec = state.sms[phone];
    if (!rec || rec.code !== String(code).trim()) return { error: 'Неверный код' };
    delete state.sms[phone];
    if (!state.users[phone]) {
      state.users[phone] = { phone, name: '', city: '', points: 0, spent: 0, fav: [], cart: [], created: Date.now(), blocked: false };
      if (state.settings.welcomeBonus > 0) addPoints(phone, state.settings.welcomeBonus, 'Приветственный бонус');
    }
    localStorage.setItem(SKEY, phone);
    save();
    return { ok: true };
  }
  function logout() { localStorage.removeItem(SKEY); emit(); }
  function updateProfile(patch) {
    const u = currentUser(); if (!u) return;
    Object.assign(u, patch); save();
  }

  // ---------- уровни и расчёт ----------
  function levelOf(user) {
    const lv = state.settings.loyalty.slice().sort((a, b) => a.from - b.from);
    let cur = lv[0], next = null;
    lv.forEach(l => { if ((user.spent || 0) >= l.from) cur = l; });
    next = lv.find(l => l.from > cur.from) || null;
    return { cur, next };
  }
  const product = id => state.products.find(p => p.id === id);
  const variantOf = (p, vid) => p && p.variants.find(v => v.id === vid);

  function cartLines(user) {
    return (user.cart || []).map(c => {
      const p = product(c.pid), v = variantOf(p, c.vid);
      if (!p || !v) return null;
      return { pid: p.id, vid: v.id, name: p.name, label: v.label, price: v.price, qty: c.qty, available: p.inStock && v.inStock };
    }).filter(Boolean);
  }

  function calc(user, opts) {
    opts = opts || {};
    const lines = opts.lines || cartLines(user);
    const subtotal = lines.reduce((s, l) => s + l.price * l.qty, 0);
    const levelPct = opts.levelPct != null ? opts.levelPct : levelOf(user).cur.discount;
    const promo = opts.promoPct != null ? { percent: opts.promoPct } : (opts.promo ? state.promos.find(p => p.active && p.code === String(opts.promo).toUpperCase()) : null);
    const promoPct = promo ? promo.percent : 0;
    const levelDisc = Math.round(subtotal * levelPct / 100);
    const promoDisc = Math.round(subtotal * promoPct / 100);
    const afterDisc = Math.max(0, subtotal - levelDisc - promoDisc);
    const maxByRule = Math.floor(afterDisc * state.settings.maxPointsPercent / 100);
    const pointsMax = Math.max(0, Math.min(user.points + (opts.pointsAlready || 0), maxByRule));
    const points = Math.max(0, Math.min(Math.floor(opts.points || 0), pointsMax));
    return { lines, subtotal, levelPct, levelDisc, promoPct, promoDisc, afterDisc, pointsMax, points, total: afterDisc - points };
  }

  // ---------- корзина и избранное ----------
  function addToCart(pid, vid, qty) {
    const u = currentUser(); if (!u) return;
    const it = u.cart.find(c => c.pid === pid && c.vid === vid);
    if (it) it.qty += qty || 1; else u.cart.push({ pid, vid, qty: qty || 1 });
    save();
  }
  function setQty(pid, vid, qty) {
    const u = currentUser(); if (!u) return;
    const i = u.cart.findIndex(c => c.pid === pid && c.vid === vid);
    if (i < 0) return;
    if (qty <= 0) u.cart.splice(i, 1); else u.cart[i].qty = Math.min(qty, 9999);
    save();
  }
  function clearCart() { const u = currentUser(); if (u) { u.cart = []; save(); } }
  function toggleFav(pid) {
    const u = currentUser(); if (!u) return;
    const i = u.fav.indexOf(pid);
    if (i >= 0) u.fav.splice(i, 1); else u.fav.push(pid);
    save();
  }

  // ---------- уведомления, баллы, журнал ----------
  function notify(phone, title, text, orderId) {
    state.notifications.unshift({ id: uid('n'), phone, title, text, orderId: orderId || null, t: Date.now(), read: false });
    if (state.notifications.length > 500) state.notifications.length = 500;
  }
  function addPoints(phone, delta, reason) {
    const u = state.users[phone]; if (!u) return;
    u.points = Math.max(0, u.points + delta);
    state.pointsLog.unshift({ id: uid('p'), phone, delta, reason, t: Date.now() });
  }
  function journal(text) { state.journal.unshift({ id: uid('j'), t: Date.now(), text }); if (state.journal.length > 500) state.journal.length = 500; }
  function myNotifs() { const ph = currentPhone(); return state.notifications.filter(n => n.phone === ph); }
  function markRead() { const ph = currentPhone(); state.notifications.forEach(n => { if (n.phone === ph) n.read = true; }); save(); }

  // ---------- заказы ----------
  function logOrder(o, text) { o.history.push({ t: Date.now(), text }); }

  function createOrder(opts) {
    const u = currentUser(); if (!u) return { error: 'Войдите в приложение' };
    const c = calc(u, { points: opts.points, promo: opts.promo });
    if (!c.lines.length) return { error: 'Корзина пуста' };
    if (c.lines.some(l => !l.available)) return { error: 'В корзине есть товары, которых нет в наличии' };
    if (!opts.pvz) return { error: 'Выберите пункт выдачи СДЭК' };
    if (!opts.name || !opts.name.trim()) return { error: 'Укажите имя получателя' };
    const o = {
      id: uid('o'), num: ++state.orderSeq, phone: u.phone, name: opts.name.trim(),
      items: c.lines.map(l => ({ pid: l.pid, vid: l.vid, name: l.name, label: l.label, price: l.price, qty: l.qty })),
      pvz: opts.pvz, comment: (opts.comment || '').trim(),
      subtotal: c.subtotal, levelPct: c.levelPct, promoPct: c.promoPct, promoCode: c.promoPct ? String(opts.promo).toUpperCase() : '',
      pointsUsed: c.points, total: c.total,
      status: 'pending', noPay: c.total === 0, edited: false, paid: false,
      rejectReason: '', adminComment: '', changes: [], history: [], created: Date.now()
    };
    logOrder(o, 'Заявка отправлена');
    if (c.points) addPoints(u.phone, -c.points, 'Списание за заказ №' + o.num);
    u.cart = []; u.name = u.name || o.name; u.city = u.city || o.pvz.city;
    state.orders.unshift(o);
    notify(u.phone, 'Заявка №' + o.num + ' отправлена', 'Ожидает подтверждения администратора', o.id);
    save();
    return { order: o };
  }

  function refundPoints(o, why) {
    if (o.pointsUsed > 0) { addPoints(o.phone, o.pointsUsed, why + ' №' + o.num); o.pointsRefunded = (o.pointsRefunded || 0) + o.pointsUsed; o.pointsUsed = 0; }
  }
  const order = id => state.orders.find(o => o.id === id);

  function cancelOrder(id) {
    const o = order(id); if (!o || o.phone !== currentPhone()) return;
    if (['shipped', 'delivered', 'rejected', 'cancelled'].includes(o.status)) return;
    if (o.paid) return { error: 'Оплаченный заказ отменяет администратор' };
    refundPoints(o, 'Возврат баллов за отменённый заказ');
    o.status = 'cancelled'; logOrder(o, 'Отменён клиентом');
    journal('Клиент ' + o.phone + ' отменил заказ №' + o.num);
    save();
  }
  function payOrder(id) { // демо-оплата ЮKassa
    const o = order(id); if (!o || o.status !== 'approved' || o.noPay || o.paid) return;
    o.paid = true; o.status = 'paid'; logOrder(o, 'Оплата получена (' + rub(o.total) + ')');
    notify(o.phone, 'Оплата заказа №' + o.num + ' получена', 'Заказ передан в сборку', o.id);
    save();
  }
  function repeatOrder(id) {
    const o = order(id), u = currentUser(); if (!o || !u) return 0;
    let n = 0;
    o.items.forEach(it => {
      const p = product(it.pid), v = variantOf(p, it.vid);
      if (p && v && p.inStock && v.inStock) { addToCart(it.pid, it.vid, it.qty); n++; }
    });
    return n;
  }

  // ---------- действия администратора ----------
  function approveOrder(id, noPay) {
    const o = order(id); if (!o || o.status !== 'pending') return;
    o.noPay = !!noPay || o.total === 0;
    o.status = 'approved';
    logOrder(o, o.edited ? 'Одобрен с изменениями' : 'Одобрен администратором');
    if (o.noPay) logOrder(o, 'Согласован без онлайн-оплаты');
    notify(o.phone,
      (o.edited ? 'Заказ №' + o.num + ' одобрен с изменениями' : 'Заказ №' + o.num + ' одобрен'),
      o.noPay ? 'Оплата не требуется, заказ передан в работу' + (o.adminComment ? '. ' + o.adminComment : '')
              : 'Оплатите заказ в приложении: ' + rub(o.total) + (o.adminComment ? '. ' + o.adminComment : ''), o.id);
    journal('Одобрен заказ №' + o.num + (o.noPay ? ' (без оплаты)' : '') + (o.edited ? ' с изменениями' : ''));
    save();
  }
  function rejectOrder(id, reason) {
    const o = order(id); if (!o || !['pending', 'approved'].includes(o.status) || o.paid) return;
    o.status = 'rejected'; o.rejectReason = reason || 'Причина не указана';
    refundPoints(o, 'Возврат баллов за отклонённый заказ');
    logOrder(o, 'Отклонён: ' + o.rejectReason);
    notify(o.phone, 'Заказ №' + o.num + ' отклонён', o.rejectReason, o.id);
    journal('Отклонён заказ №' + o.num + ': ' + o.rejectReason);
    save();
  }

  function diffItems(oldO, nw) {
    const out = [], key = i => i.pid + '|' + i.vid;
    const om = {}; oldO.items.forEach(i => om[key(i)] = i);
    const nm = {}; nw.items.forEach(i => nm[key(i)] = i);
    oldO.items.forEach(i => {
      const n = nm[key(i)];
      if (!n) out.push('Убрана позиция: ' + i.name + ' (' + i.label + ')');
      else {
        if (n.qty !== i.qty) out.push(i.name + ' (' + i.label + '): ' + i.qty + ' → ' + n.qty + ' шт');
        if (n.price !== i.price) out.push(i.name + ': цена ' + rub(i.price) + ' → ' + rub(n.price));
      }
    });
    if (nw.pointsUsed !== oldO.pointsUsed) out.push('Списано баллов: ' + oldO.pointsUsed + ' → ' + nw.pointsUsed);
    if (nw.noPay !== oldO.noPay) out.push(nw.noPay ? 'Без онлайн-оплаты' : 'Требуется онлайн-оплата');
    return out;
  }

  // patch: {items:[{pid,vid,qty,price}], pointsUsed, noPay, adminComment}
  function editOrder(id, patch, approve) {
    const o = order(id); if (!o || !['pending', 'approved'].includes(o.status) || o.paid) return { error: 'Заказ нельзя изменить' };
    const u = state.users[o.phone];
    const before = clone(o);
    const items = patch.items.filter(i => i.qty > 0).map(i => {
      const old = o.items.find(x => x.pid === i.pid && x.vid === i.vid);
      return Object.assign({}, old, { qty: Math.floor(i.qty), price: Number(i.price) });
    });
    if (!items.length) return { error: 'В заказе должна остаться хотя бы одна позиция. Для отказа используйте «Отклонить»' };
    const c = calc(u, { lines: items, levelPct: o.levelPct, promoPct: o.promoPct, points: patch.pointsUsed, pointsAlready: o.pointsUsed });
    const delta = c.points - o.pointsUsed;
    o.items = items; o.subtotal = c.subtotal; o.total = c.total;
    if (delta !== 0) addPoints(o.phone, -delta, 'Корректировка заказа №' + o.num);
    o.pointsUsed = c.points;
    o.noPay = !!patch.noPay || o.total === 0;
    o.adminComment = patch.adminComment || '';
    const diff = diffItems(before, o);
    if (diff.length || (before.adminComment !== o.adminComment)) {
      o.edited = true;
      o.changes.push({ t: Date.now(), list: diff, total: o.total, comment: o.adminComment });
      logOrder(o, 'Администратор изменил заказ');
      if (!approve) notify(o.phone, 'Заказ №' + o.num + ' изменён', diff.concat(['Сумма: ' + rub(o.total)]).join('; '), o.id);
    }
    journal('Изменён заказ №' + o.num + (diff.length ? ': ' + diff.join('; ') : ''));
    if (approve && o.status === 'pending') { save(); approveOrder(id, o.noPay); return { ok: true }; }
    if (!approve && o.status === 'approved' && diff.length) { /* уже одобрен: клиент получил уведомление об изменении */ }
    save();
    return { ok: true };
  }
  function markPaidManually(id) {
    const o = order(id); if (!o || o.status !== 'approved') return;
    o.paid = true; o.noPay = false; o.status = 'paid'; logOrder(o, 'Оплата отмечена администратором');
    notify(o.phone, 'Оплата заказа №' + o.num + ' подтверждена', 'Заказ передан в сборку', o.id);
    journal('Отмечена оплата заказа №' + o.num); save();
  }
  function advanceOrder(id, status) {
    const o = order(id); if (!o) return;
    if (status === 'shipped' && (o.status === 'paid' || (o.status === 'approved' && o.noPay))) {
      o.status = 'shipped'; logOrder(o, 'Передан в СДЭК');
      notify(o.phone, 'Заказ №' + o.num + ' передан в СДЭК', 'Пункт выдачи: ' + o.pvz.address, o.id);
    } else if (status === 'delivered' && o.status === 'shipped') {
      o.status = 'delivered'; logOrder(o, 'Выдан');
      const u = state.users[o.phone];
      const base = o.total;
      const earn = Math.floor(base * state.settings.earnPercent / 100);
      if (u) { u.spent = (u.spent || 0) + o.subtotal; }
      if (earn > 0) { addPoints(o.phone, earn, 'Баллы за заказ №' + o.num); o.pointsEarned = earn; }
      notify(o.phone, 'Заказ №' + o.num + ' получен', earn > 0 ? 'Начислено баллов: ' + earn : 'Спасибо за заказ!', o.id);
    } else return;
    journal('Заказ №' + o.num + ' → ' + STATUS[o.status]); save();
  }

  // ---------- соцсети ----------
  function submitSocial(network, url, note, shot) {
    const u = currentUser(); if (!u) return;
    state.social.unshift({ id: uid('s'), phone: u.phone, network, url, note, shot: shot || '', status: 'pending', t: Date.now(), reward: 0 });
    save();
  }
  function reviewSocial(id, ok, reward) {
    const s = state.social.find(x => x.id === id); if (!s || s.status !== 'pending') return;
    s.status = ok ? 'approved' : 'rejected';
    if (ok) {
      s.reward = Math.max(0, Math.floor(reward));
      addPoints(s.phone, s.reward, 'Публикация в ' + s.network);
      notify(s.phone, 'Публикация одобрена', 'Начислено баллов: ' + s.reward);
    } else notify(s.phone, 'Публикация не принята', 'Проверьте, что ссылка открыта, и отправьте ещё раз');
    journal('Публикация ' + s.phone + (ok ? ' одобрена (+' + s.reward + ')' : ' отклонена'));
    save();
  }

  // ---------- каталог (админ) ----------
  function parseCsv(text) {
    const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter(l => l.trim());
    if (lines.length < 2) return { error: 'Файл пуст' };
    const sep = lines[0].includes(';') ? ';' : ',';
    const head = lines[0].split(sep).map(h => h.trim().toLowerCase());
    const col = n => head.indexOf(n);
    const need = ['sku', 'name', 'price'];
    for (const n of need) if (col(n) < 0) return { error: 'Нет колонки «' + n + '». Нужны: sku, name, brand, category, variant, price, stock' };
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
        p = {
          id: sku.toLowerCase().replace(/[^a-z0-9а-я]+/gi, '-'), sku,
          name: c[col('name')], brand: col('brand') >= 0 ? c[col('brand')] : '', category: cat || 'Прочее',
          desc: col('desc') >= 0 ? c[col('desc')] : '', variants: [], inStock: true, merch: /мерч/i.test(cat)
        };
        map.set(sku, p);
      }
      const label = col('variant') >= 0 && c[col('variant')] ? c[col('variant')] : 'шт';
      p.variants.push({ id: 'v' + (p.variants.length + 1), label, price, inStock });
    }
    return { products: [...map.values()] };
  }
  function importProducts(products, mode) {
    if (mode === 'replace') state.products = products;
    else products.forEach(np => {
      const i = state.products.findIndex(p => p.sku === np.sku);
      if (i >= 0) { np.photo = state.products[i].photo; state.products[i] = np; } else state.products.push(np);
    });
    journal('Импорт прайса: ' + products.length + ' товаров (' + (mode === 'replace' ? 'замена' : 'обновление') + ')');
    save();
  }
  function upsertProduct(p) {
    const i = state.products.findIndex(x => x.id === p.id);
    if (i >= 0) state.products[i] = p; else state.products.push(p);
    save();
  }
  function setStock(pid, vid, inStock) {
    const p = product(pid); if (!p) return;
    if (vid) { const v = variantOf(p, vid); if (v) v.inStock = inStock; } else p.inStock = inStock;
    save();
  }
  function deleteProduct(pid) { state.products = state.products.filter(p => p.id !== pid); save(); }

  // фото хранятся отдельно: ключ — артикул
  function photos() { try { return JSON.parse(localStorage.getItem(PKEY)) || {}; } catch (e) { return {}; } }
  function setPhoto(sku, dataUrl) {
    const ph = photos(); ph[sku] = dataUrl;
    try { localStorage.setItem(PKEY, JSON.stringify(ph)); emit(); return true; } catch (e) { return false; }
  }
  const photoOf = sku => photos()[sku] || '';

  function adjustPoints(phone, delta, reason) {
    addPoints(phone, delta, reason || 'Корректировка администратором');
    notify(phone, delta > 0 ? 'Начислены баллы: ' + delta : 'Списаны баллы: ' + (-delta), reason || '');
    journal('Баллы ' + phone + ': ' + (delta > 0 ? '+' : '') + delta + (reason ? ' (' + reason + ')' : ''));
    save();
  }
  function updateSettings(patch) { Object.assign(state.settings, patch); journal('Изменены настройки'); save(); }
  function resetAll() { localStorage.removeItem(KEY); localStorage.removeItem(PKEY); localStorage.removeItem(SKEY); state = load(); emit(); }

  window.Store = {
    get: () => state, subscribe: f => listeners.push(f), STATUS, rub, uid,
    normPhone, currentUser, currentPhone, requestCode, verifyCode, logout, updateProfile,
    levelOf, product, variantOf, cartLines, calc, addToCart, setQty, clearCart, toggleFav,
    myNotifs, markRead, createOrder, cancelOrder, payOrder, repeatOrder, order,
    approveOrder, rejectOrder, editOrder, markPaidManually, advanceOrder,
    submitSocial, reviewSocial, parseCsv, importProducts, upsertProduct, setStock, deleteProduct,
    photoOf, setPhoto, adjustPoints, updateSettings, resetAll, save,
    statusLabel(o) {
      if (o.status === 'approved') return (o.edited ? 'Одобрен с изменениями' : 'Одобрен') + (o.noPay ? ' · без онлайн-оплаты' : ' · ожидает оплаты');
      return STATUS[o.status];
    }
  };
})();
