(function () {
  'use strict';
  const S = window.Store, { esc, date } = window.U, rub = S.rub;
  const root = document.getElementById('app'), modalEl = document.getElementById('modal');

  // ---------- локальное состояние интерфейса ----------
  const ui = {
    q: '', brand: '', cat: '', loginPhone: '', loginStep: 1, loginCode: '', loginErr: '',
    cartPromo: '', cartPoints: 0, form: { name: '', city: '', pvz: null, comment: '' },
    modal: null, merchTab: 'shop', lastSeenNotif: null
  };
  let map = null;

  const glyph = { 'Системы выравнивания': '🟨', 'Инструмент': '🔧', 'Алмазные диски': '💿', 'Коронки': '🔩', 'Аксессуары': '🧽', 'Наборы': '📦', 'Крестики и клинья': '➕', 'Фрезы и шлифовка': '🪚', 'Мерч': '👕' };
  const brandCls = p => p.merch ? 'bmerch' : p.brand === 'PLM' ? 'bplm' : p.brand === 'KATANA' ? 'bkat' : 'b3d';
  const stTag = o => ({ pending: 'y', approved: 'blue', paid: 'blue', shipped: 'blue', delivered: 'ok', rejected: 'err', cancelled: '' }[o.status]);
  const route = () => (location.hash.replace(/^#\/?/, '') || 'catalog').split('/');
  const go = h => { location.hash = h; };
  const logoHtml = () => '<img class="logo-img" src="assets/logo.webp" alt="3D KRESTIKI">';

  function toast(msg) {
    const t = document.createElement('div'); t.className = 'toast'; t.textContent = msg;
    document.body.appendChild(t); setTimeout(() => t.remove(), 3800);
  }

  // ---------- вход ----------
  function viewLogin() {
    const demoCode = S.get().sms[ui.loginPhone];
    root.innerHTML = `<div class="login">
      <div style="padding:26px 20px 0;color:#121212">${logoHtml()}</div>
      <div class="box">
        <h2 style="font-size:26px">Вход для мастеров</h2>
        <p class="muted small" style="margin:6px 0 12px">Каталог, заказ с доставкой в пункт выдачи СДЭК, баллы и скидки</p>
        ${ui.loginStep === 1 ? `
          <label class="f">Номер телефона</label>
          <input class="input" id="lp" inputmode="tel" placeholder="+7 900 000-00-00" value="${esc(ui.loginPhone)}">
          ${ui.loginErr ? `<div class="small" style="color:var(--err);margin-top:6px">${esc(ui.loginErr)}</div>` : ''}
          <button class="btn y full gap" data-act="sendCode">Получить код</button>` : `
          <div class="small muted">Код отправлен на ${esc(ui.loginPhone)}</div>
          <label class="f">Код из SMS</label>
          <input class="input" id="lc" inputmode="numeric" maxlength="4" placeholder="••••" value="${esc(ui.loginCode)}" style="font-size:22px;letter-spacing:8px;text-align:center">
          ${ui.loginErr ? `<div class="small" style="color:var(--err);margin-top:6px">${esc(ui.loginErr)}</div>` : ''}
          ${demoCode ? `<div class="demo">Демо-режим: SMS не отправляются. Ваш код: <b>${demoCode.code}</b></div>` : ''}
          <button class="btn y full gap" data-act="verify">Войти</button>
          <button class="btn ghost full gap" data-act="backLogin">Изменить номер</button>`}
      </div></div>`;
  }

  // ---------- каркас ----------
  function shell(title, inner, opts) {
    opts = opts || {};
    const u = S.currentUser(), r = route()[0];
    const unread = S.myNotifs().filter(n => !n.read).length;
    const cartN = (u.cart || []).reduce((s, c) => s + c.qty, 0);
    const tab = (h, i, t, on, badge) => `<a href="#/${h}" class="${on ? 'on' : ''}"><span class="i">${i}</span>${t}${badge ? `<span class="badge">${badge}</span>` : ''}</a>`;
    root.innerHTML = `
      <div class="top">
        ${opts.back ? `<button class="icon-btn" data-act="back">←</button>` : ''}
        <div class="grow">${opts.back ? `<h2 style="font-size:20px">${esc(title)}</h2>` : logoHtml()}</div>
        <button class="icon-btn" data-act="goNotifs" title="Уведомления">🔔${unread ? `<span class="badge">${unread}</span>` : ''}</button>
      </div>
      ${inner}
      <div class="nav">
        ${tab('catalog', '🏠', 'Каталог', r === 'catalog' || r === 'merch')}
        ${tab('fav', '❤️', 'Избранное', r === 'fav')}
        ${tab('cart', '🛒', 'Корзина', r === 'cart' || r === 'checkout', cartN)}
        ${tab('orders', '📋', 'Заказы', r === 'orders' || r === 'order')}
        ${tab('profile', '👤', 'Профиль', ['profile', 'social', 'notifs'].includes(r))}
      </div>`;
  }

  // ---------- каталог ----------
  function productCard(p) {
    const u = S.currentUser(), min = Math.min.apply(null, p.variants.map(v => v.price));
    const photo = S.photoOf(p.sku), fav = u.fav.includes(p.id);
    return `<div class="pc ${p.inStock ? '' : 'off'}" data-act="openProduct" data-id="${p.id}">
      <div class="ph ${brandCls(p)}" ${photo ? `style="background-image:url(${photo})"` : ''}>
        ${photo ? '' : glyph[p.category] || '🧱'}<span class="br">${esc(p.brand)}</span>${p.isNew ? '<span class="nw">NEW</span>' : ''}
      </div>
      <div class="info">
        <div class="nm">${esc(p.name)}</div>
        <div class="pr">${p.variants.length > 1 ? 'от ' : ''}${rub(min)}</div>
        ${p.inStock ? '' : '<div class="small" style="color:var(--err);font-weight:700">Нет в наличии</div>'}
      </div>
      <button class="fav" data-act="fav" data-id="${p.id}">${fav ? '❤️' : '🤍'}</button>
    </div>`;
  }
  function filtered(merch) {
    const q = ui.q.trim().toLowerCase();
    return S.get().products.filter(p => !!p.merch === merch).filter(p =>
      (!ui.brand || p.brand === ui.brand) && (!ui.cat || p.category === ui.cat) &&
      (!q || (p.name + ' ' + p.sku + ' ' + p.brand + ' ' + p.category).toLowerCase().includes(q)));
  }
  function gridHtml(merch) {
    const l = filtered(merch);
    return l.length ? `<div class="grid">${l.map(productCard).join('')}</div>` : `<div class="empty"><div class="big">🔍</div>Ничего не найдено</div>`;
  }
  function viewCatalog() {
    const all = S.get().products.filter(p => !p.merch);
    const brands = [...new Set(all.map(p => p.brand))], cats = [...new Set(all.map(p => p.category))];
    shell('', `
      <div class="search">
        <input class="input" id="q" placeholder="Поиск по названию или артикулу" value="${esc(ui.q)}">
        <div class="chips gap"><span class="chip ${!ui.brand ? 'on' : ''}" data-act="brand" data-v="">Все бренды</span>${brands.map(b => `<span class="chip ${ui.brand === b ? 'on' : ''}" data-act="brand" data-v="${esc(b)}">${esc(b)}</span>`).join('')}</div>
        <div class="chips"><span class="chip ${!ui.cat ? 'on' : ''}" data-act="cat" data-v="">Все категории</span>${cats.map(c => `<span class="chip ${ui.cat === c ? 'on' : ''}" data-act="cat" data-v="${esc(c)}">${esc(c)}</span>`).join('')}</div>
      </div>
      <div id="grid">${gridHtml(false)}</div>
      <div class="pad" style="padding-top:0"><a href="#/merch" class="btn y full">👕 Мерч 3D KRESTIKI · обмен на баллы</a></div>`);
  }
  function viewMerch() {
    ui.cat = ''; ui.brand = '';
    shell('Мерч', `<div class="pad"><div class="card" style="margin-bottom:0"><b>Мерч 3D KRESTIKI</b><div class="small muted">1 балл = 1 ₽. Оплатите мерч баллами при оформлении заказа в корзине. Ваш баланс: <b>${S.currentUser().points}</b> баллов.</div></div></div>${gridHtml(true)}`, { back: true });
  }
  function viewFav() {
    const u = S.currentUser(), l = S.get().products.filter(p => u.fav.includes(p.id));
    shell('Избранное', l.length ? `<div class="pad"></div><div class="grid" style="margin-top:-14px">${l.map(productCard).join('')}</div>` : `<div class="empty"><div class="big">🤍</div>Добавляйте товары в избранное сердечком</div>`, { back: true });
  }

  // ---------- карточка товара ----------
  function modalProduct() {
    const p = S.product(ui.modal.id); if (!p) return '';
    const u = S.currentUser(), photo = S.photoOf(p.sku), fav = u.fav.includes(p.id);
    const inCart = (vid) => (u.cart.find(c => c.pid === p.id && c.vid === vid) || {}).qty || 0;
    return `<div class="ov" data-act="closeModal"><div class="sheet">
      <div class="ph ${brandCls(p)}" style="border-radius:14px;aspect-ratio:16/9;${photo ? `background-image:url(${photo})` : ''}">${photo ? '' : glyph[p.category] || '🧱'}<span class="br">${esc(p.brand)}</span></div>
      <div class="row between gap"><h2 style="font-size:20px;flex:1">${esc(p.name)}</h2><button class="icon-btn" style="background:var(--g2)" data-act="fav" data-id="${p.id}">${fav ? '❤️' : '🤍'}</button></div>
      <div class="small muted">Арт. ${esc(p.sku)} · ${esc(p.category)}</div>
      ${p.desc ? `<p style="margin:8px 0">${esc(p.desc)}</p>` : ''}
      ${p.inStock ? '' : '<div class="tag err">Нет в наличии</div>'}
      <div class="card gap" style="padding:4px 14px">
        ${p.variants.map(v => { const q = inCart(v.id), ok = p.inStock && v.inStock; return `<div class="var">
          <div class="grow"><div class="b">${esc(v.label)}</div>${ok ? '' : '<div class="small" style="color:var(--err)">Нет в наличии</div>'}</div>
          <div class="b">${rub(v.price)}</div>
          ${ok ? (q ? `<div class="qty"><button data-act="qty" data-p="${p.id}" data-v="${v.id}" data-d="-1">−</button><span>${q}</span><button data-act="qty" data-p="${p.id}" data-v="${v.id}" data-d="1">+</button></div>`
                    : `<button class="btn y sm" data-act="add" data-p="${p.id}" data-v="${v.id}">В корзину</button>`) : ''}
        </div>`; }).join('')}
      </div>
      <button class="btn full" data-act="closeModal">Закрыть</button>
    </div></div>`;
  }

  // ---------- корзина ----------
  function viewCart() {
    const u = S.currentUser(), c = S.calc(u, { promo: ui.cartPromo, points: ui.cartPoints });
    ui.cartPoints = c.points;
    if (!c.lines.length) return shell('Корзина', `<div class="empty"><div class="big">🛒</div>Корзина пуста<div class="gap"><a class="btn y" href="#/catalog">В каталог</a></div></div>`, { back: true });
    const promoOk = ui.cartPromo && c.promoPct;
    shell('Корзина', `<div class="pad">
      ${c.lines.map(l => `<div class="card"><div class="row"><div class="grow"><div class="b">${esc(l.name)}</div><div class="small muted">${esc(l.label)} · ${rub(l.price)}</div>
        ${l.available ? '' : '<div class="small" style="color:var(--err);font-weight:700">Нет в наличии — удалите из корзины</div>'}</div>
        <div class="qty"><button data-act="qty" data-p="${l.pid}" data-v="${l.vid}" data-d="-1">−</button><span>${l.qty}</span><button data-act="qty" data-p="${l.pid}" data-v="${l.vid}" data-d="1">+</button></div>
        <div class="b" style="min-width:68px;text-align:right">${rub(l.price * l.qty)}</div></div></div>`).join('')}
      <div class="card">
        <label class="f" style="margin-top:0">Промокод</label>
        <div class="row"><input class="input" id="promo" placeholder="Например, 3DFAMILY" value="${esc(ui.cartPromo)}"><button class="btn sm" data-act="applyPromo">ОК</button></div>
        ${ui.cartPromo ? `<div class="small gap" style="color:${promoOk ? 'var(--ok)' : 'var(--err)'}">${promoOk ? 'Скидка ' + c.promoPct + '% применена' : 'Промокод не найден'}</div>` : ''}
        <label class="f">Списать баллы (доступно ${u.points}, максимум ${c.pointsMax})</label>
        <div class="row"><input class="input" id="pts" type="number" min="0" max="${c.pointsMax}" value="${c.points}"><button class="btn sm y" data-act="maxPts">Макс.</button></div>
      </div>
      <div class="card sum">
        <div><span>Товары</span><span>${rub(c.subtotal)}</span></div>
        ${c.levelDisc ? `<div><span>Скидка уровня ${c.levelPct}%</span><span>−${rub(c.levelDisc)}</span></div>` : ''}
        ${c.promoDisc ? `<div><span>Промокод ${c.promoPct}%</span><span>−${rub(c.promoDisc)}</span></div>` : ''}
        ${c.points ? `<div><span>Баллы</span><span>−${rub(c.points)}</span></div>` : ''}
        <div class="tot"><span>Итого</span><span>${rub(c.total)}</span></div>
      </div>
      <button class="btn y full" data-act="toCheckout" ${c.lines.some(l => !l.available) ? 'disabled' : ''}>Оформить заявку</button>
    </div>`, { back: true });
  }

  // ---------- оформление ----------
  function viewCheckout() {
    const u = S.currentUser(), c = S.calc(u, { promo: ui.cartPromo, points: ui.cartPoints });
    if (!c.lines.length) return go('#/cart');
    const f = ui.form; f.name = f.name || u.name; f.city = f.city || u.city || 'Москва';
    const list = window.PVZ.list.filter(p => p.city === f.city);
    shell('Оформление', `<div class="pad">
      <div class="card">
        <label class="f" style="margin-top:0">Имя получателя</label><input class="input" id="fname" value="${esc(f.name)}" placeholder="Как в паспорте">
        <label class="f">Телефон</label><input class="input" value="${esc(u.phone)}" disabled>
        <label class="f">Город</label><select class="input" id="fcity">${window.PVZ.cities.map(ct => `<option ${ct.name === f.city ? 'selected' : ''}>${ct.name}</option>`).join('')}</select>
      </div>
      <div class="card">
        <div class="b">Пункт выдачи СДЭК</div>
        <div class="small muted">Демо-версия: список и карта примерные. Реальные ПВЗ подключаются через API СДЭК.</div>
        <div id="map"></div>
        ${list.map(p => `<div class="pvz ${f.pvz && f.pvz.id === p.id ? 'on' : ''}" data-act="pickPvz" data-id="${p.id}"><div class="b">${esc(p.name)}</div><div class="small">${esc(p.address)}</div><div class="small muted">${esc(p.hours)}</div></div>`).join('')}
      </div>
      <div class="card"><label class="f" style="margin-top:0">Комментарий к заказу</label><textarea class="input" id="fcom" rows="2" placeholder="Необязательно">${esc(f.comment)}</textarea></div>
      <div class="card sum">
        <div><span>Товары</span><span>${rub(c.subtotal)}</span></div>
        ${c.levelDisc + c.promoDisc ? `<div><span>Скидки</span><span>−${rub(c.levelDisc + c.promoDisc)}</span></div>` : ''}
        ${c.points ? `<div><span>Баллы</span><span>−${rub(c.points)}</span></div>` : ''}
        <div class="tot"><span>К оплате</span><span>${rub(c.total)}</span></div>
        <div class="small muted gap">Сначала заявку подтверждает администратор. Оплатить можно после одобрения — вам придёт уведомление.</div>
      </div>
      <button class="btn y full" data-act="submitOrder">Отправить заявку</button>
    </div>`, { back: true });
    setTimeout(initMap, 0);
  }
  function initMap() {
    if (map) { map.remove(); map = null; }
    const el = document.getElementById('map'); if (!el) return;
    if (!window.L) { el.innerHTML = '<div class="empty small">Карта недоступна без интернета. Выберите пункт из списка ниже.</div>'; return; }
    const f = ui.form, pts = window.PVZ.list.filter(p => p.city === f.city);
    const sel = f.pvz && pts.find(p => p.id === f.pvz.id);
    map = L.map(el, { scrollWheelZoom: false }).setView(sel ? [sel.lat, sel.lng] : [pts[0].lat, pts[0].lng], sel ? 14 : 11);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 18, attribution: '© OpenStreetMap' }).addTo(map);
    pts.forEach(p => {
      const on = sel && sel.id === p.id;
      const icon = L.divIcon({ className: '', html: `<div style="background:${on ? '#121212' : '#FFB800'};color:${on ? '#FFB800' : '#121212'};border:2px solid #121212;border-radius:50% 50% 50% 0;transform:rotate(-45deg);width:28px;height:28px;display:flex;align-items:center;justify-content:center"><b style="transform:rotate(45deg);font-size:12px">C</b></div>`, iconSize: [28, 28], iconAnchor: [14, 28] });
      L.marker([p.lat, p.lng], { icon }).addTo(map).on('click', () => pick(p.id)).bindTooltip(p.name);
    });
  }
  function pick(id) { ui.form.pvz = window.PVZ.list.find(p => p.id === id); render(); }

  // ---------- заказы ----------
  function viewOrders() {
    const l = S.get().orders.filter(o => o.phone === S.currentPhone());
    shell('Мои заказы', l.length ? `<div class="pad">${l.map(o => `<a href="#/order/${o.id}" class="card" style="display:block;text-decoration:none">
      <div class="row between"><b>Заказ №${o.num}</b><span class="small muted">${date(o.created)}</span></div>
      <div class="gap"><span class="tag ${stTag(o)}">${esc(S.statusLabel(o))}</span></div>
      <div class="row between gap"><span class="small muted">${o.items.reduce((s, i) => s + i.qty, 0)} шт · ${esc(o.pvz.city)}</span><b>${rub(o.total)}</b></div></a>`).join('')}</div>`
      : `<div class="empty"><div class="big">📋</div>Заказов пока нет</div>`, { back: true });
  }
  function viewOrder(id) {
    const o = S.order(id); if (!o || o.phone !== S.currentPhone()) return go('#/orders');
    const last = o.changes[o.changes.length - 1];
    const needPay = o.status === 'approved' && !o.noPay && !o.paid;
    const canCancel = ['pending', 'approved'].includes(o.status) && !o.paid;
    shell('Заказ №' + o.num, `<div class="pad">
      <div class="card">
        <span class="tag ${stTag(o)}">${esc(S.statusLabel(o))}</span>
        ${o.status === 'pending' ? '<div class="small muted gap">Администратор проверяет заявку. Мы пришлём уведомление, когда она будет одобрена.</div>' : ''}
        ${o.status === 'rejected' ? `<div class="chg" style="background:#fdecec;border-color:var(--err)"><b>Причина отказа:</b> ${esc(o.rejectReason)}${o.pointsRefunded ? `<br>Баллы возвращены: ${o.pointsRefunded}` : ''}</div>` : ''}
        ${o.status === 'cancelled' && o.pointsRefunded ? `<div class="small muted gap">Баллы возвращены: ${o.pointsRefunded}</div>` : ''}
        ${last ? `<div class="chg"><b>Администратор изменил заказ</b> · ${date(last.t)}${last.list.length ? `<ul>${last.list.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}${last.comment ? `<div class="gap">Комментарий: ${esc(last.comment)}</div>` : ''}</div>` : (o.adminComment ? `<div class="chg">Комментарий администратора: ${esc(o.adminComment)}</div>` : '')}
        ${needPay ? `<button class="btn y full gap" data-act="pay" data-id="${o.id}">Оплатить ${rub(o.total)}</button>` : ''}
        ${o.status === 'approved' && o.noPay ? '<div class="small gap" style="color:var(--ok);font-weight:700">Оплата не требуется — заказ согласован администратором.</div>' : ''}
      </div>
      <div class="card"><b>Состав</b>${o.items.map(i => `<div class="row between gap"><div class="grow"><div>${esc(i.name)}</div><div class="small muted">${esc(i.label)} · ${i.qty} × ${rub(i.price)}</div></div><b>${rub(i.price * i.qty)}</b></div>`).join('')}
        <div class="sum gap">
          ${o.levelPct ? `<div><span>Скидка уровня ${o.levelPct}%</span><span>−${rub(Math.round(o.subtotal * o.levelPct / 100))}</span></div>` : ''}
          ${o.promoPct ? `<div><span>Промокод ${esc(o.promoCode)} ${o.promoPct}%</span><span>−${rub(Math.round(o.subtotal * o.promoPct / 100))}</span></div>` : ''}
          ${o.pointsUsed ? `<div><span>Баллы</span><span>−${rub(o.pointsUsed)}</span></div>` : ''}
          <div class="tot"><span>Итого</span><span>${rub(o.total)}</span></div></div>
        ${o.pointsEarned ? `<div class="small gap" style="color:var(--ok);font-weight:700">Начислено баллов: ${o.pointsEarned}</div>` : ''}</div>
      <div class="card"><b>Пункт выдачи СДЭК</b><div>${esc(o.pvz.name)}</div><div class="small muted">${esc(o.pvz.address)}</div>${o.comment ? `<div class="small gap">Комментарий: ${esc(o.comment)}</div>` : ''}</div>
      <div class="card"><b>История</b><div class="tl gap">${o.history.map(h => `<div>${esc(h.text)}<small>${date(h.t)}</small></div>`).join('')}</div></div>
      <div class="row"><button class="btn ghost grow" data-act="repeat" data-id="${o.id}">Повторить заказ</button>${canCancel ? `<button class="btn err grow" data-act="cancel" data-id="${o.id}">Отменить</button>` : ''}</div>
    </div>`, { back: true });
  }
  function modalPay() {
    const o = S.order(ui.modal.id);
    return `<div class="ov" data-act="closeModal"><div class="sheet">
      <h2>Оплата заказа №${o.num}</h2>
      <div class="demo">Тестовый режим ЮKassa: реальные деньги не списываются. В боевой версии здесь откроется платёжная страница ЮKassa (карта, СБП).</div>
      <div class="card gap"><div class="row between"><span>К оплате</span><b style="font-size:20px">${rub(o.total)}</b></div></div>
      <button class="btn y full" data-act="confirmPay" data-id="${o.id}">Оплатить (тест)</button>
      <button class="btn ghost full gap" data-act="closeModal">Отмена</button>
    </div></div>`;
  }

  // ---------- профиль, уведомления, соцсети ----------
  function viewProfile() {
    const u = S.currentUser(), lv = S.levelOf(u);
    const pct = lv.next ? Math.min(100, Math.round((u.spent - lv.cur.from) / (lv.next.from - lv.cur.from) * 100)) : 100;
    const log = S.get().pointsLog.filter(p => p.phone === u.phone).slice(0, 8);
    shell('Профиль', `<div class="pad">
      <div class="hero"><div class="small" style="opacity:.8">Ваши баллы</div><div class="pts">${u.points}</div>
        <div class="small" style="margin-top:6px">Уровень: <b style="color:var(--y)">${esc(lv.cur.name)}</b>${lv.cur.discount ? ` · скидка ${lv.cur.discount}%` : ''}</div>
        <div class="bar"><i style="width:${pct}%"></i></div>
        <div class="small" style="opacity:.8;margin-top:4px">${lv.next ? `До «${esc(lv.next.name)}»: ${rub(lv.next.from - u.spent)}` : 'Максимальный уровень'}</div></div>
      <div class="row"><a class="btn y grow" href="#/social">📣 Баллы за публикацию</a><a class="btn grow" href="#/merch">👕 Мерч</a></div>
      <div class="card gap"><label class="f" style="margin-top:0">Имя</label><input class="input" id="pname" value="${esc(u.name)}" placeholder="Ваше имя">
        <label class="f">Телефон</label><input class="input" value="${esc(u.phone)}" disabled>
        <button class="btn sm gap" data-act="saveProfile">Сохранить</button></div>
      <div class="card"><b>История баллов</b>${log.length ? log.map(p => `<div class="row between gap small"><span>${esc(p.reason)}<br><span class="muted">${date(p.t)}</span></span><b style="color:${p.delta > 0 ? 'var(--ok)' : 'var(--err)'}">${p.delta > 0 ? '+' : ''}${p.delta}</b></div>`).join('') : '<div class="small muted gap">Пока пусто</div>'}</div>
      <button class="btn ghost full" data-act="logout">Выйти</button>
    </div>`, { back: true });
  }
  function viewNotifs() {
    const l = S.myNotifs();
    shell('Уведомления', l.length ? `<div class="pad">${l.map(n => `<div class="card" ${n.orderId ? `data-act="goOrder" data-id="${n.orderId}" style="cursor:pointer"` : ''}>
      <div class="row between"><b>${esc(n.title)}</b>${n.read ? '' : '<span class="tag y">new</span>'}</div><div class="small">${esc(n.text)}</div><div class="small muted">${date(n.t)}</div></div>`).join('')}</div>`
      : `<div class="empty"><div class="big">🔔</div>Уведомлений нет</div>`, { back: true });
    if (l.some(n => !n.read)) setTimeout(() => S.markRead(), 600);
  }
  let socialShot = '';
  function viewSocial() {
    const u = S.currentUser(), list = S.get().social.filter(s => s.phone === u.phone);
    shell('Баллы за публикацию', `<div class="pad">
      <div class="card"><b>Опубликуйте пост или видео</b> с продукцией 3D KRESTIKI в своих соцсетях, пришлите ссылку или скриншот — после проверки начислим баллы (обычно ${S.get().settings.socialReward}).
        <label class="f">Соцсеть</label><select class="input" id="snet"><option>VK</option><option>Telegram</option><option>Instagram</option><option>YouTube</option><option>TikTok</option><option>Другая</option></select>
        <label class="f">Ссылка на публикацию</label><input class="input" id="surl" placeholder="https://">
        <label class="f">Скриншот (по желанию)</label><input type="file" id="sshot" accept="image/*">
        <label class="f">Комментарий</label><textarea class="input" id="snote" rows="2"></textarea>
        <button class="btn y full gap" data-act="sendSocial">Отправить на проверку</button></div>
      <div class="card"><b>Мои заявки</b>${list.length ? list.map(s => `<div class="row between gap small"><span>${esc(s.network)} · ${date(s.t)}</span><span class="tag ${s.status === 'approved' ? 'ok' : s.status === 'rejected' ? 'err' : 'y'}">${s.status === 'approved' ? '+' + s.reward : s.status === 'rejected' ? 'отказ' : 'на проверке'}</span></div>`).join('') : '<div class="small muted gap">Заявок нет</div>'}</div>
    </div>`, { back: true });
  }

  // ---------- рендер ----------
  function render() {
    if (map) { map.remove(); map = null; }
    const u = S.currentUser();
    if (!u) { modalEl.innerHTML = ''; return viewLogin(); }
    const [r, id] = route();
    ({ catalog: viewCatalog, merch: viewMerch, fav: viewFav, cart: viewCart, checkout: viewCheckout, orders: viewOrders,
       order: () => viewOrder(id), profile: viewProfile, notifs: viewNotifs, social: viewSocial }[r] || viewCatalog)();
    modalEl.innerHTML = ui.modal ? (ui.modal.type === 'product' ? modalProduct() : modalPay()) : '';
  }

  // ---------- события ----------
  document.addEventListener('click', async e => {
    const el = e.target.closest('[data-act]'); if (!el) return;
    const a = el.dataset.act, d = el.dataset;
    if (a === 'closeModal' && el.classList.contains('ov') && e.target !== el) return;
    if (a === 'fav') { e.stopPropagation(); S.toggleFav(d.id); return; }
    if (a === 'sendCode') {
      const r = S.requestCode(document.getElementById('lp').value);
      if (r.error) { ui.loginErr = r.error; return render(); }
      ui.loginPhone = r.phone; ui.loginStep = 2; ui.loginErr = ''; return render();
    }
    if (a === 'verify') {
      const r = S.verifyCode(ui.loginPhone, document.getElementById('lc').value);
      if (r.error) { ui.loginErr = r.error; return render(); }
      ui.loginStep = 1; ui.loginErr = ''; go('#/catalog'); return render();
    }
    if (a === 'backLogin') { ui.loginStep = 1; ui.loginErr = ''; return render(); }
    if (a === 'back') return history.length > 1 ? history.back() : go('#/catalog');
    if (a === 'goNotifs') return go('#/notifs');
    if (a === 'goOrder') return go('#/order/' + d.id);
    if (a === 'brand') { ui.brand = d.v; return render(); }
    if (a === 'cat') { ui.cat = d.v; return render(); }
    if (a === 'openProduct') { ui.modal = { type: 'product', id: d.id }; return render(); }
    if (a === 'closeModal') { ui.modal = null; return render(); }
    if (a === 'add') { S.addToCart(d.p, d.v, 1); toast('Добавлено в корзину'); return; }
    if (a === 'qty') {
      const u = S.currentUser(), it = u.cart.find(c => c.pid === d.p && c.vid === d.v);
      S.setQty(d.p, d.v, (it ? it.qty : 0) + Number(d.d)); return;
    }
    if (a === 'applyPromo') { ui.cartPromo = document.getElementById('promo').value.trim().toUpperCase(); return render(); }
    if (a === 'maxPts') { const c = S.calc(S.currentUser(), { promo: ui.cartPromo, points: 1e9 }); ui.cartPoints = c.points; return render(); }
    if (a === 'toCheckout') return go('#/checkout');
    if (a === 'pickPvz') return pick(d.id);
    if (a === 'submitOrder') {
      const f = ui.form;
      const r = S.createOrder({ name: f.name, pvz: f.pvz, comment: f.comment, points: ui.cartPoints, promo: ui.cartPromo });
      if (r.error) return toast(r.error);
      ui.cartPromo = ''; ui.cartPoints = 0; ui.form = { name: '', city: f.city, pvz: null, comment: '' };
      toast('Заявка отправлена администратору'); return go('#/order/' + r.order.id);
    }
    if (a === 'pay') { ui.modal = { type: 'pay', id: d.id }; return render(); }
    if (a === 'confirmPay') { S.payOrder(d.id); ui.modal = null; toast('Оплата прошла'); return render(); }
    if (a === 'cancel') { if (confirm('Отменить заказ? Списанные баллы вернутся.')) { const r = S.cancelOrder(d.id); if (r && r.error) toast(r.error); } return; }
    if (a === 'repeat') { const n = S.repeatOrder(d.id); toast(n ? 'Товары добавлены в корзину' : 'Товаров нет в наличии'); if (n) go('#/cart'); return; }
    if (a === 'saveProfile') { S.updateProfile({ name: document.getElementById('pname').value.trim() }); toast('Сохранено'); return; }
    if (a === 'logout') { S.logout(); ui.loginPhone = ''; return render(); }
    if (a === 'sendSocial') {
      const url = document.getElementById('surl').value.trim(), f = document.getElementById('sshot').files[0];
      if (!url && !f) return toast('Добавьте ссылку или скриншот');
      let shot = ''; if (f) { try { shot = await window.U.shrink(f, 700, .6); } catch (er) { /* без скриншота */ } }
      S.submitSocial(document.getElementById('snet').value, url, document.getElementById('snote').value.trim(), shot);
      toast('Отправлено на проверку'); return;
    }
  });
  document.addEventListener('input', e => {
    const id = e.target.id;
    if (id === 'q') { ui.q = e.target.value; document.getElementById('grid').innerHTML = gridHtml(false); }
    else if (id === 'fname') ui.form.name = e.target.value;
    else if (id === 'fcom') ui.form.comment = e.target.value;
    else if (id === 'pts') { ui.cartPoints = Number(e.target.value) || 0; }
  });
  document.addEventListener('change', e => {
    if (e.target.id === 'fcity') { ui.form.city = e.target.value; ui.form.pvz = null; render(); }
    if (e.target.id === 'pts') render();
  });
  window.addEventListener('hashchange', () => { ui.modal = null; render(); window.scrollTo(0, 0); });

  // всплывающее уведомление при новом событии
  S.subscribe(() => {
    const ph = S.currentPhone();
    if (ph) {
      const n = S.get().notifications.find(x => x.phone === ph);
      if (n && ui.lastSeenNotif && n.id !== ui.lastSeenNotif && !n.read) toast(n.title);
      ui.lastSeenNotif = n ? n.id : ui.lastSeenNotif;
    }
    const keep = document.activeElement && document.activeElement.id;
    const y = window.scrollY;
    render();
    if (keep) { const el = document.getElementById(keep); if (el && el.focus) { el.focus(); try { el.setSelectionRange(el.value.length, el.value.length); } catch (er) { /* number */ } } }
    window.scrollTo(0, y);
  });

  { const ph = S.currentPhone(); const n = ph && S.get().notifications.find(x => x.phone === ph); ui.lastSeenNotif = n ? n.id : null; }
  render();
})();
