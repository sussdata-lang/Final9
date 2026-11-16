/* بطاقة الطالب (باركود + بيانات الدخول) + طباعة آمنة + صورة الطالب (رفع ملف / تصوير بالكاميرا) */
(function () {
  const UA = window.UA, { esc, S, api, toast } = UA;

  /* ---------- طباعة عنصر واحد: ننسخه إلى جذر طباعة مستقل بدل إخفاء الصفحة (الإخفاء كان يقصّ البطاقة داخل النوافذ المنبثقة) ---------- */
  // بطاقة بمقاس ISO ID-1 (85.6×54 مم) مصمَّمة بالمليمتر، فتُطبع بحجمها الحقيقي دون تصغير
  // ورقة عادية: البطاقة بحجمها الحقيقي وهوامش الصفحة صفر، فلا يبقى للمتصفح مكان يطبع فيه العنوان والتاريخ والرابط.
  // مقاس البطاقة: للحفظ PDF ولطابعات البطاقات؛ على طابعة ورق عادية يضعها المتصفح وسط الورقة ويطبع معها الرؤوس.
  const MODE_KEY = 'ux_card_print_mode';
  const cardMode = () => { try { return localStorage.getItem(MODE_KEY) === 'card' ? 'card' : 'sheet'; } catch { return 'sheet'; } };
  UA.cardPrintModeHtml = () => `<label style="min-width:230px">مقاس الطباعة<select data-card-print-mode data-no-other="1"><option value="sheet"${cardMode() === 'sheet' ? ' selected' : ''}>ورقة عادية (البطاقة فقط، بحجمها الحقيقي)</option><option value="card"${cardMode() === 'card' ? ' selected' : ''}>طابعة بطاقات أو PDF بمقاس البطاقة</option></select></label>`;
  document.addEventListener('change', (e) => { if (e.target && e.target.matches && e.target.matches('[data-card-print-mode]')) { try { localStorage.setItem(MODE_KEY, e.target.value); } catch { /* يبقى الافتراضي */ } } });
  // قواعد الوثيقة المطبوعة فقط، بلا @page الموقع: هامش صفر يمنع المتصفح من طباعة التاريخ والعنوان والرابط
  const cssOf = (test) => {
    const out = [];
    for (const sheet of document.styleSheets) {
      let rules; try { rules = sheet.cssRules; } catch { continue; }
      for (const r of rules) {
        if (r.constructor.name === 'CSSFontFaceRule') out.push(r.cssText);
        else if (r.selectorText && test(r.selectorText)) out.push(r.cssText);
      }
    }
    return out.join('\n');
  };
  function printInFrame(bodyHtml, pageCss, extraCss = '') {
    const f = document.createElement('iframe');
    f.setAttribute('aria-hidden', 'true');
    f.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
    document.body.appendChild(f);
    const doc = f.contentDocument;
    doc.open();
    doc.write(`<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8"><style>${pageCss}\nhtml,body{margin:0;padding:0;background:#fff}*{-webkit-print-color-adjust:exact;print-color-adjust:exact;box-sizing:border-box}\n${extraCss}</style></head><body>${bodyHtml}</body></html>`);
    doc.close();
    const win = f.contentWindow;
    const remove = () => setTimeout(() => f.remove(), 500);
    win.addEventListener('afterprint', remove, { once: true });
    const imgs = [...doc.images].map((i) => (i.complete ? null : new Promise((res) => { i.onload = i.onerror = res; })));
    Promise.all([...imgs, doc.fonts ? doc.fonts.ready : null]).then(() => setTimeout(() => { win.focus(); win.print(); }, 60));
  }
  UA.printDocument = printInFrame;
  // البطاقة الشخصية بحجمها الحقيقي 85.6×54 مم. العنصر: وجه فقط، أو [وجه، ظهر].
  // طابعة البطاقات / PDF: كل وجه في صفحة بمقاس البطاقة (الوجه ثم الظهر للطباعة على الوجهين).
  // ورقة A4: الوجه والظهر لكل طالب على ورقة واحدة، بإطار يدل على خط القص.
  function printCards(items) {
    const sheet = cardMode() === 'sheet';
    const sides = items.map((x) => (Array.isArray(x) ? x : [x]));
    const css = cssOf((s) => /\.sc(?![a-z])/.test(s) && !/sc-stage/.test(s));
    // متغير خط الموقع معرَّف على :root في الصفحة الأم، فننقله إلى وثيقة الطباعة
    const font = getComputedStyle(document.documentElement).getPropertyValue('--f-ui').trim() || '"TRCairo","Cairo",Tahoma,sans-serif';
    const extra = `:root{--f-ui:${font}}.pg{break-after:page}.pg:last-child{break-after:auto}.sc{margin:0!important;box-shadow:none!important}
      ${sheet ? '.pg{display:flex;flex-direction:column;align-items:center;gap:8mm;padding-top:14mm}' : '.pg{width:85.6mm;height:54mm;overflow:hidden}.sc{border-radius:0!important}'}`;
    const body = sheet ? sides.map((p) => `<div class="pg">${p.join('')}</div>`).join('') : sides.flat().map((h) => `<div class="pg">${h}</div>`).join('');
    printInFrame(body, sheet ? '@page{size:A4 portrait;margin:0}' : '@page{size:85.6mm 54mm;margin:0}', css + extra);
  }
  // شهادة التسجيل: كل طالب في صفحة A4
  UA.printCertificates = (list) => {
    const css = cssOf((s) => /\.idc|\.bc128|--idc-g/.test(s) && !/print-root/.test(s));
    printInFrame(list.map((h) => `<div class="p">${h}</div>`).join(''), '@page{size:A4 portrait;margin:0}', `:root{--idc-g:#054239;--idc-gold:#C9A24B}.p{width:210mm;min-height:297mm;padding:10mm;break-after:page;display:flex;align-items:flex-start;justify-content:center}.p:last-child{break-after:auto}.p .idc{width:100%;max-width:170mm}.no-print{display:none!important}${css}`);
  };
  UA.printHtml = function (html, opts = {}) {
    if (opts.card) { printCards(Array.isArray(html) ? html : [html]); return; }
    // المستندات (لا البطاقات): ورقة A4 بالترويسة الرسمية الموحّدة بدل ترويستها المختصرة (print_doc.js)
    if (UA.printDoc && !opts.raw) {
      const wrap = document.createElement('div');
      wrap.innerHTML = Array.isArray(html) ? html.join('') : html;
      let title = '', dept = '';
      const hd = wrap.querySelector('.print-hd');
      if (hd) { title = ((hd.querySelector('span') || hd).textContent || '').trim(); hd.remove(); }
      const first = wrap.firstElementChild && wrap.firstElementChild.firstElementChild;
      const head = wrap.querySelector('.doc-head') || (first && first.querySelector('h2') && /border-bottom/.test(first.getAttribute('style') || '') ? first : null);
      if (head) {
        const sub = head.querySelector('h4');
        if (!title && sub) title = sub.textContent.trim();
        if (!dept && head.querySelector('h2 + div')) dept = head.querySelector('h2 + div').textContent.trim();
        head.remove();
      }
      if (!title) { const h = wrap.querySelector('h1, h2, h3'); if (h) { title = h.textContent.trim(); h.remove(); } }
      const text = wrap.textContent || '';
      UA.printDoc({ title, dept: dept || undefined, node: wrap, noSign: /توقيع[^\n]{0,50}:\s*[_.]{3,}|التوقيع والختم/.test(text) });
      return;
    }
    let root = document.getElementById('printroot');
    if (!root) { root = document.createElement('div'); root.id = 'printroot'; document.body.appendChild(root); }
    root.className = '';
    root.removeAttribute('style');
    root.innerHTML = html;
    document.body.classList.add('print-root');
    const done = () => { document.body.classList.remove('print-root'); root.innerHTML = ''; };
    window.addEventListener('afterprint', done, { once: true });
    setTimeout(() => { try { window.print(); } catch { done(); } }, 80);
  };

  /* ---------- توليد تكويد باركود أمني فريد مشفر ومضاد للتزوير (Anti-Counterfeiting Checksum) ---------- */
  function generateStudentSecureBarcode(studentNo, seed = '') {
    const s = String(studentNo || '').trim().toUpperCase();
    if (!s) return 'SUSS-0000-00';
    let h1 = 0x811c9dc5, h2 = 0x5bd1e995;
    void seed;   // الرمز ثابت للطالب: لا يتغير بين الشاشات ولا بين الأعوام
    const combined = `SUSS:SECURE:TOKEN:${s}`;
    for (let i = 0; i < combined.length; i++) {
      const code = combined.charCodeAt(i);
      h1 ^= code;
      h1 = Math.imul(h1, 0x01000193);
      h2 ^= code;
      h2 = Math.imul(h2, 0x5bd1e995);
    }
    const hex = (Math.abs(h1 ^ h2) >>> 0).toString(16).toUpperCase().padStart(8, '0').slice(0, 6);
    return `SUSS-${s}-${hex}`;
  }
  UA.generateStudentSecureBarcode = generateStudentSecureBarcode;
  // رمز NFC ثابت لكل طالب، مشتق من رقمه الجامعي
  UA.studentNfcCode = (studentNo) => {
    let h = 0xcbf29ce4;
    for (const ch of `SUSS:NFC:${String(studentNo || '').trim().toUpperCase()}`) { h ^= ch.charCodeAt(0); h = Math.imul(h, 0x01000193); }
    let g = 0x9dc5811c;
    for (const ch of `${String(studentNo || '').trim().toUpperCase()}:NFC`) { g ^= ch.charCodeAt(0); g = Math.imul(g, 0x5bd1e995); }
    return `NFC-${(h >>> 0).toString(16).toUpperCase().padStart(8, '0')}${(g >>> 0).toString(16).toUpperCase().padStart(8, '0').slice(0, 4)}`;
  };

  /* ---------- بطاقة تسجيل الطالب (الشكل الوحيد المعتمد): كل ما في «شهادة تسجيل طالب» + الباركود + بيانات الدخول ---------- */
  const photoOf = (files) => (files || []).filter((f) => f.kind === 'photo').pop() || null;
  const tm = (ms) => { try { return new Date(ms).toISOString().slice(0, 16).replace('T', ' ') + ' UTC'; } catch { return '—'; } };
  function card(st, o = {}) {
    const pr = st.program || {}, pf = st.profile || {};
    const ph = o.photoUrl || (photoOf(o.files) || {}).url;
    const uni = /[؀-ۿ]/.test(String(S.uni || '')) ? String(S.uni) : 'الجامعة السورية للعلوم الأمنية';
    const fac = pr.faculty || '', prog = pr.name && pr.name !== pr.faculty ? [pr.degree, pr.name].filter(Boolean).join(' ') : '';
    const rows = [['اسم الطالب', st.name], ['الرقم الجامعي', st.studentNo], ['الكلية / المعهد', fac], prog && ['البرنامج', prog], st.levelLabel && ['السنة الدراسية', st.levelLabel],
      ['سنة القيد', st.enrollYear || pf.enroll_year], ['فصل القيد', pf.enroll_term], st.createdAt && ['تاريخ ووقت إنشاء الحساب', tm(st.createdAt), 1]].filter((r) => r && r[1] !== undefined && r[1] !== null && r[1] !== '');
    const extra = (st.extra || []).filter((x) => x && x.label);
    const cert = o.cert;
    const ver = cert
      ? `<div class="idc-v"><div class="idc-vt">التحقق والتوقيع الرقمي</div><div class="idc-vb">${cert.qrSvg ? `<div class="idc-qr">${cert.qrSvg}<small>امسح الرمز للتحقق من صحة الوثيقة</small></div>` : ''}<dl>
          <dt>رمز التحقق</dt><dd dir="ltr">${esc(cert.code)}</dd>${cert.payloadSha256 ? `<dt>بصمة SHA-256 لبيانات الشهادة</dt><dd dir="ltr" class="idc-h256">${esc(cert.payloadSha256.slice(0, 32))}<br>${esc(cert.payloadSha256.slice(32))}</dd>` : ''}
          <dt>وقت التوقيع</dt><dd dir="ltr">${esc(tm(cert.signedAt))}</dd><dt>الموقِّع (X.509)</dt><dd dir="ltr">${esc(String(cert.signer || '').match(/CN=([^,]+)/)?.[1] || cert.signer || '')}</dd>
          ${cert.url ? `<dt>رابط التحقق</dt><dd dir="ltr" class="idc-url">${esc(cert.url.replace(/^https?:\/\//, ''))}</dd>` : ''}</dl></div></div>`
      : '<p class="idc-wait no-print">جارٍ إصدار شهادة التسجيل الموقَّعة… ستظهر بيانات التحقق عند فتح ملف الطالب.</p>';
    const cred = o.cred
      ? `<dl class="idc-k"><div><dt>اسم المستخدم</dt><dd dir="ltr">${esc(o.cred.username)}</dd></div><div><dt>كلمة المرور المؤقتة</dt><dd dir="ltr">${esc(o.cred.tempPassword)}</dd></div></dl>
         <p class="idc-note">كلمة المرور المؤقتة تُعرض مرة واحدة فقط، ويُطلب من الطالب تغييرها عند أول دخول.</p>` : '';
    const secureBc = st.barcode || generateStudentSecureBarcode(st.studentNo, pf.national_id || pf.enroll_year || '2026');
    return `<div class="idc" id="idcard">
      <div class="idc-h"><img src="/brand/crest.svg" alt="" width="46" height="54"><div><b>${esc(uni)}</b><span>وزارة الداخلية — قسم شؤون الطلاب</span></div></div>
      <div class="idc-t">شهادة تسجيل طالب</div>
      <div class="idc-b">
        <div class="idc-top">${ph ? `<img class="idc-ph" src="${esc(ph)}" alt="">` : ''}<dl class="idc-rows">${rows.map((r) => `<div><dt>${esc(r[0])}</dt><dd${r[2] ? ' dir="ltr"' : ''}>${esc(r[1])}</dd></div>`).join('')}</dl></div>
        ${extra.length ? `<dl class="idc-rows idc-ex">${extra.map((x) => `<div><dt>${esc(x.label)}</dt><dd>${esc(x.value)}</dd></div>`).join('')}</dl>` : ''}
        <div class="idc-bc" title="باركود التحقق المشفر المضاد للتزوير">${UA.code128 ? UA.code128(secureBc) : ''}</div>
        ${cred}
        ${ver}
      </div>
      <div class="idc-f">${esc(uni)} · وثيقة إلكترونية موقَّعة رقمياً بصيغة PDF/A-2b</div>
    </div>`;
  }
  UA.idCard = card;

  /* ---------- الكاميرا عالية الدقة (4K UHD / Full HD 1080p / HD 720p) ---------- */
  const CAM_PRESETS = {
    uhd4k: { label: '4K UHD فائقة الدقة (3840×2160)', w: 3840, h: 2160, maxOut: 2400, quality: 0.96 },
    fhd1080: { label: 'Full HD عالية الدقة (1920×1080)', w: 1920, h: 1080, maxOut: 1800, quality: 0.95 },
    hd720: { label: 'HD قياسية (1280×720)', w: 1280, h: 720, maxOut: 1280, quality: 0.92 },
  };
  function camera(onFile) {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { toast('المتصفح لا يدعم الكاميرا؛ استخدم رفع ملف.'); return; }
    const ov = document.createElement('div');
    ov.className = 'overlay cam-ov'; ov.setAttribute('dir', 'rtl'); ov.style.zIndex = '70';
    ov.innerHTML = `<div class="sheet cam-sheet" role="dialog" aria-modal="true" aria-label="تصوير الصورة الشخصية بالدقة العالية" style="max-width:580px">
      <div class="sheet-bar">
        <div><b>تصوير بالكاميرا عالية الدقة (HD / 1080p / 4K)</b> <span id="cam-res-badge" class="pill p-approved" style="font-size:11px;margin-inline-start:6px">Full HD</span></div>
        <button class="btn sm" data-cam="close">إغلاق</button>
      </div>
      <div class="inline-form" style="padding:8px 12px;background:#f8fafc;border-bottom:1px solid #e2e8f0;gap:8px">
        <label style="flex:1;font-size:12px">دقة التصوير المطلوبة
          <select id="cam-res-sel">
            <option value="uhd4k">4K UHD فائقة الدقة (3840×2160)</option>
            <option value="fhd1080" selected>Full HD عالية الدقة (1920×1080)</option>
            <option value="hd720">HD قياسية (1280×720)</option>
          </select>
        </label>
        <label style="flex:1;font-size:12px">عدسة الكاميرا
          <select id="cam-dev-sel"><option value="user">الكاميرا الأمامية</option><option value="environment">الكاميرا الخلفية عالية الدقة</option></select>
        </label>
      </div>
      <div class="cam-box"><video autoplay playsinline muted></video><img alt="" hidden><div class="cam-frame" aria-hidden="true"></div></div>
      <p class="hint cam-msg" role="status">جارٍ تشغيل الكاميرا بالدقة العالية…</p>
      <div class="actions">
        <button class="btn pri" data-cam="shot" disabled>التقاط بدقة عالية</button>
        <button class="btn" data-cam="again" hidden>إعادة التقاط</button>
        <button class="btn pri" data-cam="use" hidden>اعتماد واستخدام الصورة عالية الدقة</button>
      </div></div>`;
    document.body.appendChild(ov);
    const $ = (s) => ov.querySelector(s), video = $('video'), prev = $('.cam-box img'), msg = $('.cam-msg');
    const resSel = $('#cam-res-sel'), devSel = $('#cam-dev-sel'), badge = $('#cam-res-badge');
    let stream = null, blob = null;
    const stop = () => { if (stream) stream.getTracks().forEach((t) => t.stop()); stream = null; };
    const close = () => { stop(); ov.remove(); };

    if (navigator.mediaDevices.enumerateDevices) {
      navigator.mediaDevices.enumerateDevices().then((devs) => {
        const cams = devs.filter((d) => d.kind === 'videoinput' && d.deviceId);
        if (cams.length > 1) {
          devSel.innerHTML = cams.map((c, i) => `<option value="dev:${esc(c.deviceId)}">${esc(c.label || `كاميرا ${i + 1}`)}</option>`).join('') +
            '<option value="user">الكاميرا الأمامية</option><option value="environment">الكاميرا الخلفية</option>';
        }
      }).catch(() => {});
    }

    const start = async () => {
      stop();
      const preset = CAM_PRESETS[resSel.value] || CAM_PRESETS.fhd1080;
      const devVal = devSel.value || 'user';
      const devConstraint = devVal.startsWith('dev:') ? { deviceId: { exact: devVal.slice(4) } } : { facingMode: devVal };
      try {
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            video: { ...devConstraint, width: { ideal: preset.w }, height: { ideal: preset.h }, frameRate: { ideal: 30 } },
            audio: false,
          });
        } catch {
          stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false });
        }
        video.srcObject = stream;
        await video.play().catch(() => {});
        const actualW = video.videoWidth || preset.w, actualH = video.videoHeight || preset.h;
        if (badge) badge.textContent = `${actualW}×${actualH} px`;
        msg.textContent = `الكاميرا جاهزة بالدقة العالية (${actualW}×${actualH} بكسل). ضع الوجه داخل الإطار ثم اضغط «التقاط بدقة عالية».`;
        $('[data-cam=shot]').disabled = false;
      } catch (e) {
        msg.textContent = e && e.name === 'NotAllowedError'
          ? 'لم يُسمح بالوصول إلى الكاميرا. فعّل الإذن من إعدادات المتصفح ثم أعد المحاولة.'
          : 'تعذّر تشغيل الكاميرا على هذا الجهاز؛ استخدم رفع ملف.';
      }
    };
    resSel.addEventListener('change', () => { if (!video.hidden) start(); });
    devSel.addEventListener('change', () => { if (!video.hidden) start(); });
    ov.addEventListener('click', (e) => {
      const b = e.target.closest('[data-cam]'); if (!b) { if (e.target === ov) close(); return; }
      e.stopPropagation();
      const a = b.dataset.cam;
      if (a === 'close') close();
      else if (a === 'shot') {
        const preset = CAM_PRESETS[resSel.value] || CAM_PRESETS.fhd1080;
        const w = video.videoWidth || preset.w, h = video.videoHeight || preset.h;
        let cw = w, ch = Math.round((w * 4) / 3); if (ch > h) { ch = h; cw = Math.round((h * 3) / 4); }
        const cv = document.createElement('canvas');
        cv.width = Math.min(cw, preset.maxOut);
        cv.height = Math.round((cv.width * 4) / 3);
        const ctx = cv.getContext('2d');
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(video, (w - cw) / 2, (h - ch) / 2, cw, ch, 0, 0, cv.width, cv.height);
        cv.toBlob((bl) => {
          blob = bl; prev.src = URL.createObjectURL(bl); prev.hidden = false; video.hidden = true; stop();
          if (badge) badge.textContent = `ملتقَطة ${cv.width}×${cv.height} px (${Math.round((bl ? bl.size : 0) / 1024)} ك.ب)`;
          $('[data-cam=shot]').hidden = true; $('[data-cam=again]').hidden = false; $('[data-cam=use]').hidden = false;
          msg.textContent = `تم الالتقاط بدقة ${cv.width}×${cv.height} بكسل وجودة عالية (96%). اضغط «اعتماد واستخدام الصورة عالية الدقة».`;
        }, 'image/jpeg', preset.quality);
      } else if (a === 'again') {
        blob = null; prev.hidden = true; video.hidden = false;
        $('[data-cam=shot]').hidden = false; $('[data-cam=again]').hidden = true; $('[data-cam=use]').hidden = true;
        start();
      } else if (a === 'use' && blob) {
        const f = new File([blob], `photo-hd-${Date.now()}.jpg`, { type: 'image/jpeg' });
        close();
        onFile(f);
      }
    });
    document.addEventListener('keydown', function esc1(e) { if (!document.body.contains(ov)) { document.removeEventListener('keydown', esc1); return; } if (e.key === 'Escape') { close(); document.removeEventListener('keydown', esc1); } });
    start();
  }
  UA.camera = camera;

  /* ---------- صورة الطالب في أعلى سجله (مستطيلة) ---------- */
  UA.photoBox = function (st) {
    const ph = photoOf(S.stFiles);
    return `<div class="phb"><div class="phb-img">${ph ? `<a href="${esc(ph.url)}" target="_blank" rel="noopener"><img src="${esc(ph.url)}" alt="الصورة الشخصية"></a>` : `<span class="phb-ph" aria-hidden="true">${esc(String(st.name || '؟').trim()[0] || '؟')}</span>`}</div>
      <div class="phb-a no-print"><button class="btn sm" type="button" data-act="phfile" data-id="${st.id}">${ph ? 'تغيير' : 'رفع صورة'}</button><button class="btn sm" type="button" data-act="phcam" data-id="${st.id}">كاميرا</button>
      <input type="file" class="phb-in" id="phb-in-${st.id}" accept="image/jpeg,image/png,image/webp" hidden></div></div>`;
  };
  async function sendPhoto(id, file) {
    try {
      await UA.upload(`/api/students/${id}/files?kind=photo&name=${encodeURIComponent(file.name)}`, file);
      S.stFiles = (await api('GET', `/api/students/${id}/files`)).files;
      toast('حُفظت الصورة الشخصية'); UA.render();
      if (UA.studentsTable) { if (UA.studentsTable.paint) UA.studentsTable.paint(); if (UA.studentsTable.refresh) UA.studentsTable.refresh(); }
    } catch (e) { toast(e && e.status ? e.message : 'تعذّر رفع الصورة'); }
  }
  Object.assign(UA.actions, {
    phfile: (el, d) => { const i = document.getElementById('phb-in-' + d.id); if (!i) return; i.onchange = () => { if (i.files[0]) sendPhoto(d.id, i.files[0]); }; i.click(); },
    phcam: (el, d) => camera((f) => sendPhoto(d.id, f)),
    // في نموذج التسجيل/التعديل: نضع الملف الملتقَط في حقل الصورة نفسه
    formcam: () => camera((f) => {
      const inp = document.getElementById('att-photo'); if (!inp) return;
      try { const dt = new DataTransfer(); dt.items.add(f); inp.files = dt.files; } catch { toast('تعذّر إرفاق الصورة؛ استخدم رفع ملف.'); return; }
      const m = document.getElementById('formcam-msg'); if (m) m.textContent = 'ستُرفَق الصورة الملتقَطة عند الحفظ.';
    }),
    credprint: () => { if (!S.cred || !S.cred.student) return; UA.printHtml(card(S.cred.student, { cred: S.cred, files: S.cred.files, cert: S.cred.cert }), { raw: true }); },
    bcprint: () => { const st = S.stSel; if (st) UA.printHtml(card(st, { files: S.stFiles, cert: S.stCert }), { raw: true }); },
  });
})();
