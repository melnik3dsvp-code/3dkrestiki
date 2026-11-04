(function () {
  'use strict';
  const S = window.Store, { esc, date } = window.U, rub = S.rub;
  const root = document.getElementById('adm'), modalEl = document.getElementById('modal');
  const st = { tab: 'orders', statusFilter: 'all', q: '', modal: null, err: '', busy: false, ready: false, email: '' };
  const isAdmin = () => { const u = S.currentUser(); return !!(u && u.isAdmin); };
  // выполняет действие на сервере и показывает результат
  async function run(promise, okMsg) {
    const r = await promise;
    if (r && r.error) { toast(r.error); return r; }
    if (okMsg) toast(okMsg);
    return r || {};
  }
  const tagCls = o => ({ pending: 'y', approved: 'blue', paid: 'blue', shipped: 'blue', delivered: 'ok', rejected: 'err', cancelled: '' }[o.status]);
  const toast = m => { const t = document.createElement('div'); t.className = 'toast'; t.textContent = m; document.body.appendChild(t); setTimeout(() => t.remove(), 3000); };
  const D = () => S.get();

  // ---------- вход ----------
  function viewAuth() {
    root.innerHTML = `<div style="max-width:380px;margin:12vh auto"><div class="card">
      <img class="logo-img" src="assets/logo.webp" alt="3D KRESTIKI" style="margin-bottom:10px"><h2>Админ-панель</h2>
      <label class="f">Email администратора</label><input class="input" id="em" type="email" autocomplete="username" value="${esc(st.email)}">
      <label class="f">Пароль</label><input class="input" type="password" id="pw" autocomplete="current-password">
      ${st.err ? `<div class="small" style="color:var(--err);margin-top:6px">${esc(st.err)}</div>` : ''}
      <button class="btn y full gap" data-act="login" ${st.busy ? 'disabled' : ''}>${st.busy ? 'Подождите…' : 'Войти'}</button>
      <div class="small muted gap">Аккаунт создаётся в Supabase (Authentication → Users), права выдаёт SQL из инструкции.</div></div></div>`;
  }

  // ---------- шапка ----------
  function tabs() {
    const pend = D().orders.filter(o => o.status === 'pending').length, soc = D().social.filter(s => s.status === 'pending').length;
    const t = (id, name, b) => `<a class="${st.tab === id ? 'on' : ''}" data-act="tab" data-t="${id}">${name}${b ? `<span class="badge">${b}</span>` : ''}</a>`;
    return `<div class="abar"><img class="logo-img" src="assets/logo.webp" alt="3D KRESTIKI"><div class="atabs">
      ${t('orders', 'Заказы', pend)}${t('catalog', 'Каталог и прайс')}${t('clients', 'Клиенты')}${t('social', 'Публикации', soc)}${t('settings', 'Настройки')}${t('journal', 'Журнал')}</div>
      <a class="btn sm" href="index.html" target="_blank">Открыть приложение</a><button class="btn sm ghost" data-act="exit">Выйти</button></div>`;
  }

  // ---------- заказы ----------
  function viewOrders() {
    const names = { all: 'Все', pending: 'На согласовании', approved: 'Одобрены', paid: 'Оплачены', shipped: 'В СДЭК', delivered: 'Выданы', rejected: 'Отклонены', cancelled: 'Отменены' };
    const l = D().orders.filter(o => st.statusFilter === 'all' || o.status === st.statusFilter);
    return `<div class="toolbar">${Object.keys(names).map(k => `<span class="chip ${st.statusFilter === k ? 'on' : ''}" data-act="sf" data-v="${k}">${names[k]}</span>`).join('')}</div>
    ${l.length ? `<div class="scroll"><table class="t"><tr><th>№</th><th>Дата</th><th>Клиент</th><th>Сумма</th><th>Статус</th><th>ПВЗ</th></tr>
      ${l.map(o => `<tr class="click" data-act="openOrder" data-id="${o.id}"><td><b>${o.num}</b></td><td>${date(o.created)}</td><td>${esc(o.name)}<br><span class="small muted">${esc(o.phone)}</span></td>
      <td><b>${rub(o.total)}</b>${o.pointsUsed ? `<br><span class="small muted">баллы: ${o.pointsUsed}</span>` : ''}</td>
      <td><span class="tag ${tagCls(o)}">${esc(S.statusLabel(o))}</span></td><td class="small">${esc(o.pvz.city)}</td></tr>`).join('')}</table></div>`
    : '<div class="empty"><div class="big">📋</div>Заказов нет. Оформите заказ в приложении, он появится здесь.</div>'}`;
  }

  function modalOrder(id) {
    const o = S.order(id); if (!o) return '';
    const open = ['pending', 'approved'].includes(o.status) && !o.paid;
    const acts = [];
    if (o.status === 'pending') acts.push(
      `<button class="btn ok" data-act="approve" data-id="${o.id}">✔ Одобрить</button>`,
      `<button class="btn y" data-act="approveNoPay" data-id="${o.id}">✔ Одобрить без оплаты</button>`);
    if (open) acts.push(`<button class="btn ghost" data-act="editOrder" data-id="${o.id}">✎ Изменить</button>`, `<button class="btn err" data-act="reject" data-id="${o.id}">✖ Отклонить</button>`);
    if (o.status === 'approved' && !o.noPay) acts.push(`<button class="btn ghost" data-act="markPaid" data-id="${o.id}">Отметить оплату</button>`);
    if (o.status === 'paid' || (o.status === 'approved' && o.noPay)) acts.push(`<button class="btn" data-act="ship" data-id="${o.id}">Передан в СДЭК</button>`);
    if (o.status === 'shipped') acts.push(`<button class="btn ok" data-act="deliver" data-id="${o.id}">Выдан клиенту</button>`);
    return `<div class="amodal" data-act="closeModal"><div class="abox">
      <div class="row between"><h2>Заказ №${o.num}</h2><button class="btn sm ghost" data-act="closeModal">✕</button></div>
      <span class="tag ${tagCls(o)}">${esc(S.statusLabel(o))}</span> ${o.noPay ? '<span class="tag bk">без оплаты</span>' : ''} ${o.paid ? '<span class="tag ok">оплачен</span>' : ''}
      <div class="two gap">
        <div class="card"><b>Клиент</b><div>${esc(o.name)}</div><div class="small muted">${esc(o.phone)}</div>
          <div class="gap"><b>Пункт выдачи СДЭК</b></div><div class="small">${esc(o.pvz.name)}<br>${esc(o.pvz.address)}</div>
          ${o.comment ? `<div class="gap small"><b>Комментарий клиента:</b> ${esc(o.comment)}</div>` : ''}</div>
        <div class="card sum"><div><span>Товары</span><span>${rub(o.subtotal)}</span></div>
          ${o.levelPct ? `<div><span>Уровень ${o.levelPct}%</span><span>−${rub(Math.round(o.subtotal * o.levelPct / 100))}</span></div>` : ''}
          ${o.promoPct ? `<div><span>Промокод ${esc(o.promoCode)}</span><span>−${rub(Math.round(o.subtotal * o.promoPct / 100))}</span></div>` : ''}
          ${o.pointsUsed ? `<div><span>Баллы</span><span>−${rub(o.pointsUsed)}</span></div>` : ''}
          <div class="tot"><span>К оплате</span><span>${rub(o.total)}</span></div></div></div>
      <div class="card"><table class="t"><tr><th>Товар</th><th>Вариант</th><th>Цена</th><th>Кол-во</th><th>Сумма</th></tr>
        ${o.items.map(i => `<tr><td>${esc(i.name)}</td><td>${esc(i.label)}</td><td>${rub(i.price)}</td><td>${i.qty}</td><td>${rub(i.price * i.qty)}</td></tr>`).join('')}</table></div>
      ${o.rejectReason ? `<div class="chg" style="background:#fdecec;border-color:var(--err)">Причина отказа: ${esc(o.rejectReason)}</div>` : ''}
      ${o.changes.length ? `<div class="chg"><b>Изменения администратора</b>${o.changes.map(c => `<div class="small gap">${date(c.t)}<ul>${c.list.map(x => `<li>${esc(x)}</li>`).join('')}</ul></div>`).join('')}</div>` : ''}
      <div class="card"><b>История</b><div class="tl gap">${o.history.map(h => `<div>${esc(h.text)}<small>${date(h.t)}</small></div>`).join('')}</div></div>
      <div class="row" style="flex-wrap:wrap">${acts.join('')}</div>
    </div></div>`;
  }

  function modalEdit(id) {
    const o = S.order(id), u = D().users[o.phone];
    return `<div class="amodal" data-act="closeModal"><div class="abox">
      <h2>Изменить заказ №${o.num}</h2>
      <div class="small muted">Клиент получит уведомление со списком изменений. Позиции с количеством 0 будут убраны.</div>
      <div class="card gap scroll"><table class="t" id="etbl"><tr><th>Товар</th><th>Вариант</th><th>Цена, ₽</th><th>Кол-во</th></tr>
        ${o.items.map(i => `<tr data-pid="${i.pid}" data-vid="${i.vid}"><td>${esc(i.name)}</td><td>${esc(i.label)}</td>
          <td><input class="input num" type="number" min="0" data-f="price" value="${i.price}"></td>
          <td><input class="input num" type="number" min="0" data-f="qty" value="${i.qty}"></td></tr>`).join('')}</table></div>
      <div class="two">
        <div><label class="f">Списано баллов (баланс клиента + уже списано: ${u.points + o.pointsUsed})</label><input class="input" type="number" min="0" id="epts" value="${o.pointsUsed}"></div>
        <div><label class="f">Оплата</label><label class="row" style="padding:10px 0"><input type="checkbox" id="enopay" ${o.noPay ? 'checked' : ''}> <span>Согласовать без онлайн-оплаты</span></label></div>
      </div>
      <label class="f">Комментарий клиенту</label><textarea class="input" id="ecom" rows="2" placeholder="Например: заменили позицию — нет в наличии">${esc(o.adminComment)}</textarea>
      <div class="row gap" style="flex-wrap:wrap">
        ${o.status === 'pending' ? `<button class="btn ok" data-act="saveApprove" data-id="${o.id}">Сохранить и одобрить</button>` : ''}
        <button class="btn y" data-act="saveOnly" data-id="${o.id}">Сохранить изменения</button>
        <button class="btn ghost" data-act="openOrder" data-id="${o.id}">Назад</button></div>
    </div></div>`;
  }
  function modalReject(id) {
    return `<div class="amodal" data-act="closeModal"><div class="abox" style="max-width:460px">
      <h2>Отклонить заказ</h2><label class="f">Причина (увидит клиент)</label>
      <textarea class="input" id="rrs" rows="3" placeholder="Например: нет товара на складе"></textarea>
      <div class="row gap"><button class="btn err" data-act="doReject" data-id="${id}">Отклонить</button><button class="btn ghost" data-act="openOrder" data-id="${id}">Назад</button></div></div></div>`;
  }

  // ---------- каталог ----------
  function viewCatalog() {
    const q = st.q.trim().toLowerCase();
    const l = D().products.filter(p => !q || (p.name + p.sku + p.brand + p.category).toLowerCase().includes(q));
    return `${D().products.length ? '' : `<div class="dz"><b>Каталог пуст.</b> Загрузите стартовый набор из прайс-скриншотов (${window.CATALOG.length} товаров) или свой CSV ниже. <div class="gap"><button class="btn y sm" data-act="seedCatalog">Загрузить стартовый каталог</button></div></div>`}
    <div class="dz"><b>Загрузка прайса</b>
      <div class="small muted">CSV с разделителем «;» или «,». Колонки: <b>sku; name; brand; category; variant; price; stock</b>. Одна строка = один вариант товара; строки с одним sku объединяются. stock: 1 — в наличии, 0 — нет. Для мерча в category напишите «Мерч».</div>
      <div class="row gap" style="flex-wrap:wrap"><input type="file" id="csv" accept=".csv,.txt">
        <select class="input" id="csvmode" style="max-width:240px"><option value="merge">Обновить и добавить</option><option value="replace">Заменить весь каталог</option></select>
        <button class="btn y sm" data-act="importCsv">Загрузить прайс</button><button class="btn sm ghost" data-act="exportCsv">Скачать текущий прайс</button></div>
      <div class="gap"><b>Фото</b> <span class="small muted">— имя файла = артикул (например, SLIM-1.jpg)</span><div class="row gap"><input type="file" id="photos" accept="image/*" multiple><button class="btn y sm" data-act="uploadPhotos">Загрузить фото</button></div></div></div>
    <div class="toolbar"><input class="input" id="aq" placeholder="Поиск по товарам" value="${esc(st.q)}"><button class="btn sm" data-act="newProduct">+ Новый товар</button><span class="muted small">Товаров: ${l.length}</span></div>
    <div class="scroll" id="ptable">${prodTable(l)}</div>`;
  }
  function prodTable(l) {
    return `<table class="t"><tr><th></th><th>Артикул</th><th>Товар</th><th>Варианты: цена и наличие</th><th>Весь товар</th><th></th></tr>
      ${l.map(p => { const ph = S.photoOf(p.sku); return `<tr><td>${ph ? `<img class="thumb" src="${ph}">` : '<div class="thumb"></div>'}</td><td class="small">${esc(p.sku)}</td>
      <td><b>${esc(p.name)}</b><br><span class="small muted">${esc(p.brand)} · ${esc(p.category)}</span></td>
      <td>${p.variants.map(v => `<div class="row gap" style="margin:0 0 4px"><span class="small" style="min-width:130px">${esc(v.label)}</span>
        <input class="input num" type="number" min="0" value="${v.price}" data-act="price" data-p="${p.id}" data-v="${v.id}">
        <label class="small row" style="gap:4px"><input type="checkbox" data-act="vstock" data-p="${p.id}" data-v="${v.id}" ${v.inStock ? 'checked' : ''}> есть</label></div>`).join('')}</td>
      <td><label class="small row"><input type="checkbox" data-act="pstock" data-p="${p.id}" ${p.inStock ? 'checked' : ''}> в наличии</label></td>
      <td><button class="btn sm ghost" data-act="delProduct" data-p="${p.id}">Удалить</button></td></tr>`; }).join('')}</table>`;
  }

  // ---------- клиенты ----------
  function viewClients() {
    const l = Object.values(D().users);
    return l.length ? `<div class="scroll"><table class="t"><tr><th>Телефон</th><th>Имя</th><th>Город</th><th>Баллы</th><th>Выкуплено</th><th>Заказы</th><th></th></tr>
      ${l.map(u => `<tr><td>${esc(u.phone)}</td><td>${esc(u.name)}</td><td>${esc(u.city)}</td><td><b>${u.points}</b></td><td>${rub(u.spent || 0)}</td>
      <td>${D().orders.filter(o => o.phone === u.phone).length}</td><td><button class="btn sm" data-act="adjPts" data-ph="${esc(u.phone)}">Баллы ±</button></td></tr>`).join('')}</table></div>`
      : '<div class="empty"><div class="big">👥</div>Клиентов пока нет</div>';
  }

  // ---------- публикации ----------
  function viewSocial() {
    const l = D().social;
    return l.length ? l.map(s => `<div class="card"><div class="row between"><b>${esc(s.network)} · ${esc(s.phone)}</b><span class="small muted">${date(s.t)}</span></div>
      ${s.url ? `<div class="small"><a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.url)}</a></div>` : ''}${s.note ? `<div class="small muted">${esc(s.note)}</div>` : ''}
      ${s.shot ? `<img src="${s.shot}" style="max-width:220px;border-radius:10px;margin-top:8px">` : ''}
      ${s.status === 'pending' ? `<div class="row gap"><input class="input num" type="number" id="rw-${s.id}" value="${D().settings.socialReward}"><span class="small">баллов</span>
        <button class="btn ok sm" data-act="socOk" data-id="${s.id}">Одобрить</button><button class="btn err sm" data-act="socNo" data-id="${s.id}">Отклонить</button></div>`
      : `<div class="gap"><span class="tag ${s.status === 'approved' ? 'ok' : 'err'}">${s.status === 'approved' ? 'Одобрено +' + s.reward : 'Отклонено'}</span></div>`}</div>`).join('')
      : '<div class="empty"><div class="big">📣</div>Заявок на баллы за публикации нет</div>';
  }

  // ---------- настройки ----------
  function viewSettings() {
    const s = D().settings;
    return `<div class="two"><div class="card"><h3>Баллы</h3>
        <label class="f">Начислять % от суммы заказа (после выдачи)</label><input class="input" type="number" id="s_earn" value="${s.earnPercent}">
        <label class="f">Максимум % заказа, оплачиваемый баллами</label><input class="input" type="number" id="s_max" value="${s.maxPointsPercent}">
        <label class="f">Баллов за публикацию в соцсети (по умолчанию)</label><input class="input" type="number" id="s_soc" value="${s.socialReward}">
        <label class="f">Приветственный бонус новому клиенту</label><input class="input" type="number" id="s_wel" value="${s.welcomeBonus}">
        <button class="btn y gap" data-act="saveSettings">Сохранить</button></div>
      <div class="card"><h3>Уровни лояльности</h3><div class="small muted">Скидка зависит от суммы выкупленных заказов</div>
        ${s.loyalty.map((l, i) => `<div class="row gap" style="margin-top:8px"><input class="input" data-lv="${i}" data-k="name" value="${esc(l.name)}"><input class="input num" type="number" data-lv="${i}" data-k="from" value="${l.from}" title="от суммы"><input class="input num" type="number" data-lv="${i}" data-k="discount" value="${l.discount}" title="скидка %"><span class="small">%</span></div>`).join('')}
        <div class="small muted gap">Поля: название · сумма от, ₽ · скидка</div>
        <h3 class="gap" style="margin-top:18px">Промокоды</h3>
        ${D().promos.map((p, i) => `<div class="row between gap small"><span><b>${esc(p.code)}</b> · ${p.percent}%</span><button class="btn sm ${p.active ? 'ok' : 'ghost'}" data-act="togglePromo" data-i="${i}">${p.active ? 'активен' : 'выключен'}</button></div>`).join('')}
        <div class="row gap"><input class="input" id="pc" placeholder="КОД"><input class="input num" id="pp" type="number" placeholder="%"><button class="btn sm" data-act="addPromo">Добавить</button></div></div></div>
`;
  }
  function viewJournal() {
    const l = D().journal;
    return l.length ? `<table class="t"><tr><th>Время</th><th>Действие</th></tr>${l.map(j => `<tr><td style="white-space:nowrap">${date(j.t)}</td><td>${esc(j.text)}</td></tr>`).join('')}</table>` : '<div class="empty">Журнал пуст</div>';
  }

  // ---------- рендер ----------
  function render() {
    if (!st.ready) { root.innerHTML = '<div class="empty" style="padding-top:30vh"><div class="big">⏳</div>Загрузка…</div>'; return; }
    if (!isAdmin()) { modalEl.innerHTML = ''; return viewAuth(); }
    const body = { orders: viewOrders, catalog: viewCatalog, clients: viewClients, social: viewSocial, settings: viewSettings, journal: viewJournal }[st.tab]();
    const fy = window.scrollY, active = document.activeElement && document.activeElement.id;
    root.innerHTML = tabs() + body;
    window.scrollTo(0, fy);
    if (active) { const el = document.getElementById(active); if (el) { el.focus(); try { el.setSelectionRange(el.value.length, el.value.length); } catch (e) { /* */ } } }
    // модалки: только детали заказа обновляем «вживую»
    if (st.modal && st.modal.type === 'order') modalEl.innerHTML = modalOrder(st.modal.id);
  }
  function showModal(type, id) {
    st.modal = { type, id };
    modalEl.innerHTML = type === 'order' ? modalOrder(id) : type === 'edit' ? modalEdit(id) : modalReject(id);
  }
  const closeModal = () => { st.modal = null; modalEl.innerHTML = ''; };

  document.addEventListener('click', async e => {
    const el = e.target.closest('[data-act]'); if (!el || el.tagName === 'INPUT') return;
    const a = el.dataset.act, d = el.dataset;
    if (a === 'closeModal' && el.classList.contains('amodal') && e.target !== el) return;
    switch (a) {
      case 'login': {
        st.email = document.getElementById('em').value;
        const pass = document.getElementById('pw').value; // читаем до перерисовки формы
        st.busy = true; st.err = ''; render();
        const r = await S.adminLogin(st.email, pass);
        st.busy = false; st.err = r.error || ''; return render();
      }
      case 'exit': await S.logout(); return render();
      case 'tab': st.tab = d.t; return render();
      case 'sf': st.statusFilter = d.v; return render();
      case 'openOrder': return showModal('order', d.id);
      case 'closeModal': return closeModal();
      case 'approve': return void run(S.approveOrder(d.id, false), 'Заказ одобрен, клиент уведомлён');
      case 'approveNoPay': return void run(S.approveOrder(d.id, true), 'Одобрен без оплаты, клиент уведомлён');
      case 'reject': return showModal('reject', d.id);
      case 'doReject': {
        const reason = document.getElementById('rrs').value.trim(); if (!reason) return toast('Укажите причину');
        const r = await run(S.rejectOrder(d.id, reason), 'Заказ отклонён'); if (!r.error) showModal('order', d.id); return;
      }
      case 'editOrder': return showModal('edit', d.id);
      case 'saveApprove': case 'saveOnly': {
        const items = [...document.querySelectorAll('#etbl tr[data-pid]')].map(tr => ({
          pid: tr.dataset.pid, vid: tr.dataset.vid,
          price: Number(tr.querySelector('[data-f=price]').value), qty: Number(tr.querySelector('[data-f=qty]').value) }));
        const r = await run(S.editOrder(d.id, { items, pointsUsed: Number(document.getElementById('epts').value) || 0,
          noPay: document.getElementById('enopay').checked, adminComment: document.getElementById('ecom').value.trim() }, a === 'saveApprove'),
          a === 'saveApprove' ? 'Одобрен с изменениями, клиент уведомлён' : 'Изменения сохранены, клиент уведомлён');
        if (!r.error) showModal('order', d.id); return;
      }
      case 'markPaid': return void run(S.markPaidManually(d.id), 'Оплата отмечена');
      case 'ship': return void run(S.advanceOrder(d.id, 'shipped'), 'Передан в СДЭК, клиент уведомлён');
      case 'deliver': return void run(S.advanceOrder(d.id, 'delivered'), 'Выдан, баллы начислены');
      case 'seedCatalog': {
        if (!confirm('Загрузить в базу стартовый каталог (' + window.CATALOG.length + ' товаров)?')) return;
        return void run(S.importProducts(window.CATALOG.map(p => Object.assign({}, p)), 'merge'), 'Каталог загружен');
      }
      case 'importCsv': {
        const f = document.getElementById('csv').files[0]; if (!f) return toast('Выберите файл');
        const r = S.parseCsv(await f.text()); if (r.error) return toast(r.error);
        if (!r.products.length) return toast('В файле нет товаров');
        return void run(S.importProducts(r.products, document.getElementById('csvmode').value), 'Загружено товаров: ' + r.products.length);
      }
      case 'exportCsv': {
        const rows = ['sku;name;brand;category;variant;price;stock'];
        D().products.forEach(p => p.variants.forEach(v => rows.push([p.sku, p.name, p.brand, p.category, v.label, v.price, p.inStock && v.inStock ? 1 : 0].join(';'))));
        const a2 = document.createElement('a'); a2.href = URL.createObjectURL(new Blob(['﻿' + rows.join('\n')], { type: 'text/csv' })); a2.download = 'price-3dkrestiki.csv'; a2.click(); return;
      }
      case 'uploadPhotos': {
        const fs = [...document.getElementById('photos').files]; if (!fs.length) return toast('Выберите фото');
        let ok = 0, miss = [];
        for (const f of fs) {
          const sku = f.name.replace(/\.[^.]+$/, '').toUpperCase();
          const p = D().products.find(x => x.sku.toUpperCase() === sku);
          if (!p) { miss.push(f.name); continue; }
          try { if (await S.setPhoto(p.sku, await window.U.shrink(f, 420, .7))) ok++; else miss.push(f.name); } catch (er) { miss.push(f.name); }
        }
        return toast('Фото загружено: ' + ok + (miss.length ? '. Не загружено: ' + miss.slice(0, 5).join(', ') : ''));
      }
      case 'newProduct': {
        const sku = prompt('Артикул (латиницей, например NEW-1):'); if (!sku) return;
        const name = prompt('Название товара:'); if (!name) return;
        const price = Number(prompt('Цена, ₽:')); if (!price) return;
        return void run(S.saveProduct({ id: sku.toLowerCase().replace(/[^a-z0-9]+/g, '-'), sku, name, brand: '3D KRESTIKI', category: 'Прочее', desc: '', variants: [{ id: 'v1', label: 'шт', price, inStock: true }], inStock: true }), 'Товар добавлен');
      }
      case 'delProduct': if (confirm('Удалить товар из каталога?')) S.deleteProduct(d.p); return;
      case 'adjPts': {
        const n = Number(prompt('Сколько баллов начислить (отрицательное число — списать)?')); if (!n) return;
        return void run(S.adjustPoints(d.ph, n, prompt('Причина (увидит клиент):') || ''), 'Баллы изменены');
      }
      case 'socOk': return void run(S.reviewSocial(d.id, true, Number(document.getElementById('rw-' + d.id).value) || 0), 'Публикация одобрена, баллы начислены');
      case 'socNo': return void run(S.reviewSocial(d.id, false), 'Публикация отклонена');
      case 'saveSettings': {
        const g = id => Number(document.getElementById(id).value) || 0, loyalty = D().settings.loyalty.map(l => Object.assign({}, l));
        document.querySelectorAll('[data-lv]').forEach(i => { loyalty[+i.dataset.lv][i.dataset.k] = i.dataset.k === 'name' ? i.value : Number(i.value) || 0; });
        return void run(S.updateSettings({ earnPercent: g('s_earn'), maxPointsPercent: Math.min(100, g('s_max')), socialReward: g('s_soc'), welcomeBonus: g('s_wel'), loyalty }), 'Настройки сохранены');
      }
      case 'togglePromo': { const p = D().promos[+d.i]; return void run(S.savePromo(p.code, p.percent, !p.active)); }
      case 'addPromo': {
        const c = document.getElementById('pc').value.trim().toUpperCase(), p = Number(document.getElementById('pp').value);
        if (!c || !(p > 0 && p <= 100)) return toast('Введите код и скидку 1–100%');
        return void run(S.savePromo(c, p, true), 'Промокод добавлен');
      }
    }
  });
  document.addEventListener('change', e => {
    const el = e.target, a = el.dataset && el.dataset.act; if (!a) return;
    const d = el.dataset;
    if (a === 'price') run(S.setPrice(d.p, d.v, el.value), 'Цена сохранена');
    if (a === 'vstock') run(S.setStock(d.p, d.v, el.checked));
    if (a === 'pstock') run(S.setStock(d.p, null, el.checked));
  });
  document.addEventListener('input', e => {
    if (e.target.id === 'aq') { st.q = e.target.value; const q = st.q.trim().toLowerCase(); document.getElementById('ptable').innerHTML = prodTable(D().products.filter(p => !q || (p.name + p.sku + p.brand + p.category).toLowerCase().includes(q))); }
  });
  document.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.id === 'pw') document.querySelector('[data-act=login]').click(); });

  S.subscribe(render);
  render();
  S.ready.then(() => { st.ready = true; render(); });
})();
