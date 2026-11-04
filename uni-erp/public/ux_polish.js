/* تحسين شكل الواجهة، إضافة فوق الموجود ولا تحذف منه شيئاً: أيقونات مرسومة بدل الرموز التعبيرية، ولون ورمز لكل خدمة،
   وصور رمزية للأسماء في الجداول، ومؤشر القائمة الجانبية، وزر الانتقال السريع في الشريط العلوي، وقائمة «بانتظار إجراء منك»،
   وأخطاء تحت الحقول، والجداول سطوراً على الهاتف، و«استدعاء التالي» في مكتب الخدمة. */
(function () {
  const UA = window.UA, { S, api, esc, can } = UA;

  /* ---------- الأيقونات ---------- */
  const PATHS = {
    bolt: '<path d="M13 2 4 14h7l-1 8 9-12h-7l1-8Z"/>', chart: '<path d="M3 3v18h18"/><path d="m7 16 4-5 4 3 5-7"/>',
    down: '<path d="M12 4v12M7 11l5 5 5-5"/><path d="M20 15v5H4v-5"/>', up: '<path d="M12 16V4M7 9l5-5 5 5"/><path d="M20 15v5H4v-5"/>',
    check: '<circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 5-6"/>', cap: '<path d="m2 9 10-5 10 5-10 5Z"/><path d="M6 11.5V16c0 1.5 3 3 6 3s6-1.5 6-3v-4.5"/>',
    file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6M8 13h8M8 17h5"/>',
    pen: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>', bank: '<path d="m3 9 9-6 9 6"/><path d="M5 9v9M10 9v9M14 9v9M19 9v9M3 21h18"/>',
    sync: '<path d="M21 12a9 9 0 0 1-15 6.7L3 16"/><path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M21 3v5h-5M3 21v-5h5"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/>',
    list: '<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4V2h6v2M9 11h6M9 15h6"/>', alert: '<path d="M12 3 2 20h20Z"/><path d="M12 10v4M12 17h.01"/>',
    bell: '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/>', scale: '<path d="M12 3v18M7 21h10M5 7h14M5 7l-3 7a4 4 0 0 0 6 0ZM19 7l-3 7a4 4 0 0 0 6 0Z"/>',
    eye: '<path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12Z"/><circle cx="12" cy="12" r="3"/>', user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
    users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
    receipt: '<path d="M5 2v20l3-2 2 2 2-2 2 2 2-2 3 2V2l-3 2-2-2-2 2-2-2-2 2Z"/><path d="M8 9h8M8 13h8"/>', print: '<path d="M6 9V2h12v7"/><rect x="3" y="9" width="18" height="8" rx="2"/><path d="M6 14h12v8H6Z"/>',
    shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"/><path d="m9 12 2 2 4-4"/>', save: '<path d="M5 3h11l5 5v13H3V5a2 2 0 0 1 2-2Z"/><path d="M7 3v6h8V3M7 21v-8h10v8"/>',
    cash: '<rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="3"/>', book: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2Z"/>',
    truck: '<path d="M2 6h13v11H2ZM15 10h4l3 3v4h-7Z"/><circle cx="7" cy="18" r="2"/><circle cx="18" cy="18" r="2"/>', phone: '<rect x="6" y="2" width="12" height="20" rx="2"/><path d="M11 18h2"/>',
    camera: '<path d="M3 7h4l2-3h6l2 3h4v13H3Z"/><circle cx="12" cy="13" r="4"/>', tool: '<path d="M14.7 6.3a4 4 0 0 1 5-5l-3 3 2 2 3-3a4 4 0 0 1-5 5L8 19a2.1 2.1 0 0 1-3-3Z"/>',
    building: '<rect x="4" y="2" width="16" height="20" rx="1"/><path d="M9 7h1M14 7h1M9 12h1M14 12h1M10 22v-5h4v5"/>', plus: '<path d="M12 5v14M5 12h14"/>',
    mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>', spark: '<path d="m12 3 1.5 4.5L18 9l-4.5 1.5L12 15l-1.5-4.5L6 9l4.5-1.5L12 3Z"/>',
    calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/>', trash: '<path d="M4 7h16M9 7V4h6v3M6 7l1 14h10l1-14M10 11v6M14 11v6"/>',
    card: '<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="8.5" cy="11" r="2"/><path d="M6 16h5M14 10h4M14 14h4"/>', wallet: '<path d="M20 7V5a2 2 0 0 0-2-2H5a3 3 0 0 0 0 6h15v10a2 2 0 0 1-2 2H5a3 3 0 0 1-3-3V6"/><path d="M16 13h4"/>',
    target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="4"/><path d="M12 12h.01"/>', ruler: '<path d="M3 17 17 3l4 4L7 21ZM8 12l2 2M11 9l2 2M14 6l2 2"/>',
    lock: '<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>', globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18"/>',
    desktop: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 21h8M12 16v5"/>', box: '<path d="m21 8-9 5-9-5 9-5 9 5Z"/><path d="M3 8v8l9 5 9-5V8M12 13v8"/>',
    tree: '<path d="M12 22v-6M12 2 6 10h3l-4 6h14l-4-6h3Z"/>', medal: '<circle cx="12" cy="9" r="6"/><path d="m8.5 14-1.5 8 5-3 5 3-1.5-8"/>', tag: '<path d="M3 3h8l10 10-8 8L3 11Z"/><circle cx="7.5" cy="7.5" r="1.5"/>',
    ticket: '<path d="M3 7h18v4a2 2 0 0 0 0 4v4H3v-4a2 2 0 0 0 0-4Z"/><path d="M14 7v12"/>', search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>', clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    flask: '<path d="M9 3h6M10 3v6l-5 9a2 2 0 0 0 2 3h10a2 2 0 0 0 2-3l-5-9V3"/>', home: '<path d="m3 10 9-7 9 7"/><path d="M5 9v11h14V9"/><path d="M9 20v-6h6v6"/>', ban: '<circle cx="12" cy="12" r="9"/><path d="m5.6 5.6 12.8 12.8"/>',
    chat: '<path d="M21 15a2 2 0 0 1-2 2H8l-5 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2Z"/>', folder: '<path d="M3 6h6l2 3h10v11H3Z"/>', pin: '<path d="M12 22s7-7 7-12a7 7 0 0 0-14 0c0 5 7 12 7 12Z"/><circle cx="12" cy="10" r="2.5"/>', star: '<path d="m12 3 2.6 5.6 6.1.7-4.5 4.2 1.2 6L12 16.5 6.6 19.5l1.2-6-4.5-4.2 6.1-.7Z"/>',
    door: '<path d="M6 21V3h12v18M3 21h18M14 12h.01"/>', hands: '<path d="m8 12 3 3a2 2 0 0 0 3 0l5-5"/><path d="m3 8 5-3 4 2 4-2 5 3v7l-5 4-5-3-4 3-4-4Z"/>', robot: '<rect x="4" y="8" width="16" height="12" rx="2"/><path d="M12 4v4M9 13h.01M15 13h.01M9 17h6"/>', film: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M8 3v18M16 3v18M3 8h5M3 16h5M16 8h5M16 16h5"/>',
    bulb: '<path d="M9 18h6M10 22h4M12 2a7 7 0 0 0-4 12.7V16h8v-1.3A7 7 0 0 0 12 2Z"/>', compass: '<circle cx="12" cy="12" r="9"/><path d="m15 9-2 4-4 2 2-4Z"/>', key: '<circle cx="8" cy="15" r="4"/><path d="m11 12 9-9M16 7l3 3"/>', gift: '<rect x="3" y="8" width="18" height="4"/><path d="M5 12v9h14v-9M12 8v13M12 8S10 3 7.500 4 9 8 12 8Zm0 0s2-5 4.500-4S15 8 12 8Z"/>', map: '<path d="m3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3ZM9 3v15M15 6v15"/>',
    crown: '<path d="m3 7 4 5 5-7 5 7 4-5-2 12H5Z"/>', news: '<path d="M4 22h16a2 2 0 0 0 2-2V4H8v16a2 2 0 0 1-4 0V6H2v14a2 2 0 0 0 2 2Z"/><path d="M12 8h6M12 12h6M12 16h6"/>', edit: '<path d="M12 20h9"/><path d="M16.500 3.500a2.100 2.100 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
  };
  const svg = (n, cls = 'ux-ico') => `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${PATHS[n] || ''}</svg>`;
  const EMOJI = {
    '⚡': 'bolt', '📊': 'chart', '📥': 'down', '✅': 'check', '🎓': 'cap', '📄': 'file', '✍': 'pen', '🏛': 'bank', '🔄': 'sync', '⚙': 'gear', '📋': 'list', '⚠': 'alert', '📤': 'up', '📝': 'pen', '🔔': 'bell', '⚖': 'scale', '👁': 'eye', '👤': 'user', '🧾': 'receipt', '🖨': 'print', '🛡': 'shield', '💾': 'save', '💵': 'cash', '📚': 'book', '📖': 'book', '🚚': 'truck', '📳': 'phone', '📷': 'camera', '🛠': 'tool', '🏢': 'building', '➕': 'plus', '📅': 'calendar', '📨': 'mail', '✨': 'spark', '👥': 'users', '🗑': 'trash', '🪪': 'card', '💰': 'wallet', '🎯': 'target', '📐': 'ruler', '🔒': 'lock', '🌐': 'globe', '🖥': 'desktop', '📦': 'box', '🌳': 'tree', '📈': 'chart', '💼': 'list', '🎖': 'medal', '🚨': 'alert', '🏭': 'building', '🏷': 'tag', '🎟': 'ticket', '✉': 'mail', '🔍': 'search', '🕒': 'clock', '🧪': 'flask', '🏠': 'home', '🏫': 'building', '🚫': 'ban', '🗂': 'folder', '💬': 'chat', '✏': 'edit', '✒': 'pen', '📜': 'file', '📂': 'folder', '⏱': 'clock', '🤝': 'hands', '📘': 'book', '🔓': 'lock', '📌': 'pin', '🗄': 'box', '🚪': 'door', '🔬': 'flask', '⭐': 'star', '🎬': 'film', '🤖': 'robot', '🔧': 'tool', '📇': 'card', '📎': 'file', '💳': 'card', '📴': 'phone', '🏦': 'bank', '📒': 'book', '📑': 'file', '👑': 'crown', '🛒': 'box', '📍': 'pin', '🏗': 'building', '🍽': 'home', '💡': 'bulb', '🧭': 'compass', '🔁': 'sync', '🎁': 'gift', '💻': 'desktop', '📰': 'news', '🔑': 'key', '🗓': 'calendar', '🔐': 'lock', '🗺': 'map', '🏅': 'medal', '👨': 'user',
  };
  const DOTS = { '🟢': 'ok', '🔴': 'bad', '🔵': 'info' };
  const EMOJI_RE = /\p{Extended_Pictographic}️?/u;
  const SKIP = 'SCRIPT,STYLE,TEXTAREA,OPTION,SELECT,TITLE,CODE,PRE,KBD';
  function swapEmoji(root) {
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, { acceptNode: (n) => (EMOJI_RE.test(n.nodeValue) && !n.parentElement.closest(`${SKIP},.doc,#printroot,.idc,[contenteditable]`) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT) });
    const nodes = []; let node;
    while ((node = w.nextNode())) nodes.push(node);
    for (const n of nodes) {
      const parts = n.nodeValue.split(/(\p{Extended_Pictographic}️?)/u);
      if (!parts.some((p) => EMOJI[p.replace('️', '')] || DOTS[p])) continue;
      const frag = document.createDocumentFragment();
      for (const p of parts) {
        const key = p.replace('️', '');
        if (DOTS[key]) { const i = document.createElement('i'); i.className = `ux-dot ${DOTS[key]}`; i.setAttribute('aria-hidden', 'true'); frag.append(i); }
        else if (EMOJI[key]) { const t = document.createElement('template'); t.innerHTML = svg(EMOJI[key]); frag.append(t.content); }
        else if (p) frag.append(p);
      }
      n.replaceWith(frag);
    }
  }

  /* ---------- لون ورمز الخدمة، والصورة الرمزية ---------- */
  const fold = (s) => String(s ?? '').replace(/[ً-ْـ]/g, '').replace(/[أإآ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه');
  const SERVICE_LOOK = [
    [/مصدق|شهاد|تخرج|certificate|graduat/i, 'medal', 'gold'], [/كشف|علامات|transcript|grade/i, 'file', 'teal'], [/تظلم|اعتراض|appeal/i, 'scale', 'rose'], [/تاجيل|defer|postpone/i, 'clock', 'blue'],
    [/ايقاف|انسحاب|suspen|withdraw/i, 'ban', 'plum'], [/بطاق|card/i, 'card', 'teal'], [/تعديل|بيانات|update/i, 'user', 'blue'], [/تقويم|جدول|calendar|schedule/i, 'calendar', 'gold'], [/قيد|تسجيل|enrol|regist/i, 'pen', 'plum'],
  ];
  const TONES = ['teal', 'gold', 'blue', 'plum', 'rose'];
  const hashTone = (s) => TONES[[...String(s)].reduce((a, c) => a + c.charCodeAt(0), 0) % TONES.length];
  const serviceTile = (label) => { const f = fold(label), hit = SERVICE_LOOK.find(([re]) => re.test(f)); return `<span class="ux-tile ${hit ? hit[2] : hashTone(label)}" aria-hidden="true">${svg(hit ? hit[1] : 'file')}</span>`; };
  const faceOf = (name) => `<span class="ux-face ${hashTone(name)}" aria-hidden="true">${esc(String(name).trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join(' '))}</span>`;
  const NAME_HEADS = new Set(['الطالب', 'اسم الطالب', 'الموظف', 'اسم الموظف', 'العضو', 'المدرس', 'المدرّس', 'المتقدم', 'اسم المتقدم', 'المحاضر', 'الأستاذ المحاضر', 'Student', 'Student Name', 'Employee', 'Employee Name', 'Member', 'Instructor', 'Lecturer', 'Applicant Name', 'Faculty Member', 'Name']);
  const SERVICE_HEADS = new Set(['الخدمة', 'نوع الخدمة', 'نوع الطلب', 'Service', 'Request Type']);

  function decorateTables() {
    for (const tbl of document.querySelectorAll('.sx-main table')) {
      const ths = [...tbl.querySelectorAll(':scope > thead > tr:first-child > th')];
      if (!ths.length) continue;
      const labels = ths.map((th) => th.textContent.replace(/\s+/g, ' ').trim());
      const nameCol = labels.findIndex((l) => NAME_HEADS.has(l)), svcCol = labels.findIndex((l) => SERVICE_HEADS.has(l));
      const phone = !tbl.classList.contains('matrix') && labels.length >= 3 && !tbl.querySelector('thead tr:nth-child(2) input');
      if (phone) tbl.classList.add('ux-cards');
      for (const tr of tbl.querySelectorAll(':scope > tbody > tr')) {
        [...tr.children].forEach((td, i) => { if (phone && labels[i] && td.dataset.label !== labels[i]) td.dataset.label = labels[i]; });
        const decorate = (col, make) => {
          const td = tr.children[col];
          if (!td || td.colSpan > 1 || td.dataset.uxDeco) return;
          const text = (td.querySelector('b,strong') || td).firstChild?.textContent?.trim() || td.textContent.trim();
          if (!text || text === '—') return;
          td.dataset.uxDeco = '1';
          td.classList.add('ux-with-tile');
          const box = document.createElement('div'); box.className = 'ux-tile-body';
          while (td.firstChild) box.append(td.firstChild);
          td.insertAdjacentHTML('afterbegin', make(text));
          td.append(box);
        };
        if (nameCol >= 0) decorate(nameCol, faceOf);
        if (svcCol >= 0) decorate(svcCol, serviceTile);
      }
    }
  }

  /* ---------- مؤشر القائمة الجانبية ---------- */
  let navY = null, lastView = null;
  function navMarker() {
    const nav = document.querySelector('.sx-nav'), cur = nav && nav.querySelector(':scope > button[aria-current="page"]');
    if (!nav) return;
    if (lastView !== S.view) { const sub = nav.querySelector('.sx-sub-list'); if (sub) sub.classList.add('ux-sub-in'); lastView = S.view; }
    if (!cur) return;
    nav.classList.add('ux-nav');
    let m = nav.querySelector(':scope > .ux-nav-marker');
    if (!m) { m = document.createElement('i'); m.className = 'ux-nav-marker'; m.setAttribute('aria-hidden', 'true'); nav.prepend(m); if (navY !== null) { m.style.transition = 'none'; m.style.transform = `translateY(${navY}px)`; m.getBoundingClientRect(); m.style.transition = ''; } }
    const y = cur.offsetTop;
    if (m.dataset.y !== String(y)) { m.style.transform = `translateY(${y}px)`; m.style.height = `${cur.offsetHeight}px`; m.dataset.y = y; navY = y; }
  }

  /* ---------- الشريط العلوي بسطر واحد ---------- */
  function mergeTopBar() {
    const bar = document.querySelector('.sx-ws-bar'), actions = document.querySelector('.sx-top .sx-actions'), add = bar && bar.querySelector('.sx-ws-add');
    if (add && actions) { add.classList.add('ux-top-jump'); actions.prepend(add); }
    if (bar) bar.classList.toggle('ux-ws-empty', !bar.querySelector('button, a'));
  }

  /* ---------- بانتظار إجراء منك ---------- */
  const Q = { requests: [] };
  const prevOverviewLoader = UA.loaders.overview;
  UA.loaders.overview = async () => {
    await Promise.all([prevOverviewLoader ? prevOverviewLoader() : null, (can('request:read_all') || can('request:read_unit')) ? api('GET', '/api/requests').then((r) => { Q.requests = r.requests || []; }).catch(() => {}) : null]);
  };
  const isLate = (r) => r.service && r.service.sla_hours && Date.now() - r.createdAt > r.service.sla_hours * 3600000;
  const ageText = (t) => (UA.sx && UA.sx.ago ? UA.sx.ago(t) : '');
  function queuePanel() {
    const wait = Q.requests.filter((r) => r.status === 'review').sort((a, b) => (isLate(b) - isLate(a)) || a.createdAt - b.createdAt);
    const desk = UA.deskParts ? UA.deskParts() : null, corr = desk && desk.counts ? desk.counts.corrTurn : 0;
    const rows = wait.slice(0, 6).map((r) => `<li><button type="button" data-act="uxopenreq" data-id="${r.id}">${serviceTile(r.service.label)}<span class="ux-q-t"><b>${esc(r.service.label)}</b><small>${esc(r.student.name)}${r.unit ? ` · ${esc(r.unit.name)}` : ''}</small></span><em class="${isLate(r) ? 'late' : ''}">${isLate(r) ? 'متأخر · ' : ''}${esc(ageText(r.createdAt))}</em></button></li>`).join('');
    const corrRow = corr ? `<li><button type="button" data-act="view" data-v="corr"><span class="ux-tile gold" aria-hidden="true">${svg('mail')}</span><span class="ux-q-t"><b>مراسلات تنتظر اعتمادي</b><small>الديوان والمراسلات</small></span><em>${corr}</em></button></li>` : '';
    return `<section class="card ux-queue"><div class="ux-q-head"><h2>بانتظار إجراء منك${wait.length ? ` <span class="ux-q-n">${wait.length}</span>` : ''}</h2>${wait.length > 6 ? '<button type="button" class="btn sm" data-act="view" data-v="affairs">كل الطلبات</button>' : ''}</div>
      ${rows || corrRow ? `<ul>${rows}${corrRow}</ul>` : '<p class="hint" style="margin:0">لا شيء ينتظرك الآن.</p>'}</section>`;
  }
  UA.flowQueuePanel = queuePanel;

  /* ---------- البحث الشامل: التبويبات كلها والإجراءات والطلبات ---------- */
  const ACTIONS = [
    ['طلب داخلي جديد', 'corr', 'corrunified', 'internal_new', ['request:create_internal']], ['كتاب رسمي جديد', 'corr', 'corrunified', 'new_corr', ['corr:use']], ['تسجيل طالب جديد', 'affairs', 'sttab', 'new', ['student:register']],
    ['إدخال علامات', 'academics', 'acadtab', 'grades', ['grade:manage']], ['استيراد ملف', 'exchange', 'extab', 'import'], ['تصدير بيانات', 'exchange', 'extab', 'export', ['data:export']],
  ];
  UA.flowPaletteItems = (existing) => {
    const seen = new Set(existing.map((i) => `${i.view}:${i.val || ''}`)), out = [];
    const viewsAllowed = new Map((UA.viewsFor && S.me ? UA.viewsFor(S.me.role) : []).map((v) => [v[0], v[1]]));
    const gate = UA.gate;
    if (gate) for (const [view, list] of Object.entries(gate.TABS)) {
      if (!viewsAllowed.has(view)) continue;
      for (const [a, t, label] of list) {
        if (a.startsWith('v12:') || !gate.allowed(a, t, S.me) || seen.has(`${view}:${t}`)) continue;
        seen.add(`${view}:${t}`);
        out.push({ cat: viewsAllowed.get(view), title: label, view, act: a, val: t });
      }
    }
    for (const [title, view, act, val, need] of ACTIONS) {
      if (!viewsAllowed.has(view) || (need && !need.some((p) => can(p))) || seen.has(`${view}:${val}`)) continue;
      out.push({ cat: 'إجراءات', title, view, act, val });
    }
    for (const r of Q.requests.slice(0, 30)) {
      out.push({ cat: 'الطلبات', title: `${r.no} · ${r.student.name} · ${r.service.label}`, run: async () => { await openRequest(r.id); } });
    }
    return out;
  };
  async function openRequest(id) {
    S.stTab = 'requests'; S.sel = Number(id); S.rej = null;
    await UA.go('affairs');
  }
  UA.actions.uxopenreq = (el, d) => openRequest(d.id);

  /* ---------- الخطأ تحت الحقل ---------- */
  const fieldMessage = (el) => (el.validity.valueMissing ? 'هذا الحقل مطلوب.' : el.validity.tooShort ? `الحد الأدنى ${el.minLength} أحرف.` : el.validity.rangeUnderflow ? `أدخل قيمة لا تقل عن ${el.min}.` : el.validity.rangeOverflow ? `أدخل قيمة لا تزيد على ${el.max}.` : el.validity.typeMismatch || el.validity.patternMismatch ? 'الصيغة غير صحيحة.' : el.validationMessage);
  function showFieldError(el, message) {
    const host = el.closest('label') || el.parentElement;
    if (!host) return;
    host.classList.add('ux-bad');
    el.setAttribute('aria-invalid', 'true');
    let m = host.querySelector(':scope > .ux-field-err');
    if (!m) { m = document.createElement('span'); m.className = 'ux-field-err'; m.setAttribute('role', 'alert'); host.append(m); }
    m.textContent = message;
  }
  const clearFieldError = (el) => {
    const host = el.closest('label.ux-bad, .ux-bad');
    if (!host) return;
    host.classList.remove('ux-bad');
    el.removeAttribute('aria-invalid');
    const m = host.querySelector(':scope > .ux-field-err'); if (m) m.remove();
  };
  let firstInvalid = false;
  document.addEventListener('invalid', (e) => {
    if (!e.target.matches || !e.target.matches('input,select,textarea')) return;
    e.preventDefault();
    showFieldError(e.target, fieldMessage(e.target));
    if (!firstInvalid) {
      firstInvalid = true;
      e.target.scrollIntoView({ block: 'center', behavior: 'smooth' });
      e.target.focus({ preventScroll: true });
      setTimeout(() => { firstInvalid = false; }, 0);
    }
  }, true);
  for (const type of ['input', 'change']) document.addEventListener(type, (e) => { if (e.target.closest) clearFieldError(e.target); }, true);
  function serverFieldError() {
    const el = S.fieldErr && S.err && document.getElementById(`sf-${S.fieldErr}`);
    if (el && !(el.closest('label') || el.parentElement).querySelector('.ux-field-err')) showFieldError(el, S.err);
  }

  /* ---------- إضافة خيار القائمة بالضغط على Enter ---------- */
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || !e.target.matches || !e.target.matches('.g-list-mgr input[id$="-add"]')) return;
    e.preventDefault();
    const btn = e.target.parentElement.querySelector('[data-act="glistadd"]');
    if (btn) btn.click();
  }, true);

  /* ---------- مكتب خدمة الطالب: استدعاء التالي ---------- */
  function deskNext() {
    const panel = document.querySelector('[data-testid="sa-desk-queue-panel"]');
    if (!panel) return;
    const waiting = [...panel.querySelectorAll('[data-act="sa-q-status"][data-st="serving"]')];
    let bar = panel.querySelector('.ux-desk-next');
    if (!bar) {
      bar = document.createElement('div');
      bar.className = 'ux-desk-next';
      panel.querySelector('.inline-form')?.before(bar);
    }
    const text = `<span><b>${waiting.length}</b> في الانتظار</span><button type="button" class="btn gold-btn" data-act="uxdesknext"${waiting.length ? '' : ' disabled'}>استدعاء التالي</button>`;
    if (bar.dataset.n !== String(waiting.length)) { bar.innerHTML = text; bar.dataset.n = waiting.length; }
  }
  UA.actions.uxdesknext = () => {
    const panel = document.querySelector('[data-testid="sa-desk-queue-panel"]');
    const list = panel ? [...panel.querySelectorAll('[data-act="sa-q-status"][data-st="serving"]')] : [];
    const next = list.sort((a, b) => Number(a.dataset.id) - Number(b.dataset.id))[0];
    if (next) next.click();
  };

  /* ---------- التشغيل ---------- */
  let queued = false;
  const pass = () => {
    queued = false;
    const main = document.querySelector('.sx-content');
    if (!main) return;
    swapEmoji(main);
    const layer = document.getElementById('layer'); if (layer) swapEmoji(layer);
    const side = document.getElementById('ux-drawer-host'); if (side) swapEmoji(side);
    const palette = document.getElementById('sx-cmd-palette'); if (palette) swapEmoji(palette);
    decorateTables(); navMarker(); mergeTopBar(); deskNext(); serverFieldError();
  };
  const queue = () => { if (!queued) { queued = true; requestAnimationFrame(pass); } };
  const prevAfter = UA.afterRenderEnhance;
  UA.afterRenderEnhance = function () { if (prevAfter) prevAfter(); queue(); };
  const start = () => {
    new MutationObserver(queue).observe(document.body, { childList: true, subtree: true });
    queue();
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
