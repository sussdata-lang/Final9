/* النسخ الاحتياطي: النسخ الفعلية على الخادم، والتشفير يتبع إعداد BACKUP_PASSPHRASE، والفحص يقارن بصمة قاعدة البيانات في النسخة نفسها */
(function () {
  const UA = window.UA, { S, api, esc, toast, fmt } = UA;
  const sz = (n) => (n > 1048576 ? (n / 1048576).toFixed(1) + ' م.ب' : Math.max(1, Math.round(n / 1024)) + ' ك.ب');
  const lastStatus = (ls) => {
    if (!ls) return '<p class="hint">لم تُنشأ نسخة بعد.</p>';
    if (ls.error && !ls.name) return `<div class="err" role="alert">آخر محاولة فشلت (${fmt(ls.createdAt)}): ${esc(ls.error)}</div>`;
    if (ls.error) return `<div class="err" role="alert">أُنشئت آخر نسخة (${fmt(ls.createdAt)}) محلياً، لكن: ${esc(ls.error)}</div>`;
    return `<p class="ok-t">آخر نسخة ناجحة: ${fmt(ls.createdAt)}${ls.uploaded === true ? ' — رُفعت إلى المخزن الخارجي' : ''}</p>`;
  };
  const checkCell = (name) => {
    const c = S.admin.bkCheck && S.admin.bkCheck[name];
    if (!c) return '<span class="pill p-review">لم تُفحص</span>';
    if (c.ok) return `<span class="pill p-approved">البصمة مطابقة</span><div class="small">${c.files} ملف · قاعدة البيانات ${sz(c.dbBytes)}</div>`;
    return `<span class="pill p-rejected">فشل الفحص</span><div class="small">${esc(c.message)}</div>`;
  };

  UA.backupView = () => {
    const b = S.admin && S.admin.backup;
    if (!b) return '<div class="empty">جارٍ التحميل…</div>';

    return `<section class="card">
      <div class="tool-row" style="margin-bottom:8px">
        <h2 style="margin:0;display:flex;align-items:center;gap:8px">
          ${UA.icon('backup', 22)} <span>النسخ الاحتياطي المجدول</span>
        </h2>
        <button class="btn pri" type="button" data-act="bknow"${S.admin.bkBusy ? ' disabled' : ''}>${S.admin.bkBusy ? 'جارٍ إنشاء النسخة…' : 'إنشاء نسخة الآن'}</button>
      </div>
      <p class="hint" style="margin-top:0">تضم النسخة قاعدة البيانات والمرفقات والشهادات ومفتاح التوقيع، مع بصمة SHA-256 لقاعدة البيانات يمكن فحصها في أي وقت.</p>

      <div style="background:rgba(14,102,85,.05);padding:12px 16px;border-radius:10px;margin-bottom:16px;border:1px solid #DCE3DD">
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
          <div>
            <b>الجدولة التلقائية:</b> ${b.auto ? 'مفعَّلة يومياً نحو الساعة ' + b.hourUtc + ' UTC' : 'متوقفة'} ·
            <b>التشفير:</b> ${b.encrypted ? '<span class="pill p-approved">AES-256-GCM مفعَّل</span>' : '<span class="pill p-rejected">غير مفعَّل</span>'} ·
            <b>الاحتفاظ:</b> آخر ${b.keep} نسخة
          </div>
          ${lastStatus(b.last)}
        </div>
        ${b.encrypted ? '' : '<div class="err" role="alert" style="margin-top:6px">النسخ غير مشفرة وتحوي بيانات الطلاب ومفتاح التوقيع. اضبط BACKUP_PASSPHRASE على الخادم لتشفير النسخ الجديدة.</div>'}
        <div class="small" style="margin-top:6px;color:#566660">${esc(b.persistentHint)}${b.remote ? ' (الرفع الخارجي مفعَّل.)' : ''}</div>
      </div>

      <h3 style="margin:16px 0 8px;font-size:14px">النسخ المتاحة (${b.backups.length})</h3>
      <div class="tbl-wrap">
        <table class="grid-tbl">
          <thead>
            <tr><th>اسم النسخة</th><th>التاريخ</th><th>التشفير</th><th>الحجم</th><th>فحص السلامة</th><th>الإجراءات</th></tr>
          </thead>
          <tbody>
            ${b.backups.map((x) => `<tr>
              <td class="mono" dir="ltr" style="text-align:start"><b>${esc(x.name)}</b></td>
              <td class="small">${fmt(x.createdAt)}</td>
              <td>${x.encrypted ? '<span class="pill p-approved">AES-256-GCM</span>' : '<span class="pill p-rejected">غير مشفرة</span>'}</td>
              <td>${sz(x.size)}</td>
              <td>${checkCell(x.name)}</td>
              <td class="nowrap">
                <button class="btn sm" data-act="bkverify" data-n="${esc(x.name)}"${S.admin.bkVerifying === x.name ? ' disabled' : ''}>${S.admin.bkVerifying === x.name ? 'جارٍ الفحص…' : 'فحص البصمة'}</button>
                <button class="btn sm" data-act="bkdl" data-n="${esc(x.name)}">تنزيل</button>
                <button class="btn sm bad" data-act="bkdel" data-n="${esc(x.name)}">حذف</button>
              </td>
            </tr>`).join('') || '<tr><td colspan="6" class="empty">لا توجد نسخ بعد. أنشئ أول نسخة من الزر أعلاه.</td></tr>'}
          </tbody>
        </table>
      </div>

      <h3 class="sec-h" style="margin-top:20px">الاستعادة</h3>
      <p class="small">أوقف الخادم ثم نفّذ أمر الاستعادة:<br>
      <span class="mono" dir="ltr" style="background:#F6F8F5;padding:4px 8px;border-radius:4px;display:inline-block;margin-top:4px">node scripts/restore.js data/backups/&lt;اسم_الملف&gt;</span><br>
      يتحقق الأمر من البصمة قبل أي كتابة، ويحفظ نسخة من الوضع الحالي قبل الاستبدال.</p>
    </section>`;
  };

  async function reload() { S.admin.backup = await api('GET', '/api/admin/backups'); UA.render(); }

  Object.assign(UA.actions, {
    bknow: async () => {
      S.admin.bkBusy = true; UA.render();
      try {
        const r = await api('POST', '/api/admin/backups', {});
        toast(r.backup && r.backup.error ? `أُنشئت النسخة محلياً، لكن: ${r.backup.error}` : 'تم إنشاء النسخة الاحتياطية');
      } catch (e) {
        toast(`تعذّر إنشاء النسخة: ${e.message}`);
      }
      S.admin.bkBusy = false;
      await reload();
    },
    bkverify: async (el, d) => {
      S.admin.bkVerifying = d.n; UA.render();
      try {
        const r = await api('POST', `/api/admin/backups/${encodeURIComponent(d.n)}/verify`, {});
        S.admin.bkCheck = { ...(S.admin.bkCheck || {}), [d.n]: r };
        toast(r.ok ? 'بصمة قاعدة البيانات مطابقة' : `فشل الفحص: ${r.message}`);
      } catch (e) {
        toast(`تعذّر الفحص: ${e.message}`);
      }
      S.admin.bkVerifying = null;
      UA.render();
    },
    bkdl: async (el, d) => {
      const res = await fetch('/api/admin/backups/' + encodeURIComponent(d.n), { credentials: 'same-origin' });
      if (!res.ok) { toast('تعذّر تنزيل النسخة'); return; }
      const a = document.createElement('a'); a.href = URL.createObjectURL(await res.blob()); a.download = d.n; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    },
    bkdel: async (el, d) => { if (!confirm('حذف هذه النسخة نهائياً؟')) return; await api('DELETE', '/api/admin/backups/' + encodeURIComponent(d.n)); await reload(); toast('حُذفت النسخة'); },
  });
})();
