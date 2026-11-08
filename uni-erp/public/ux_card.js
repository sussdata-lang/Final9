/* البطاقة الجامعية الرقمية واللجنة التأديبية (مفصول من ux_restructure.js) */
(function () {
  'use strict';
  const UA = window.UA;
  if (!UA) return;
  const { S, api, esc, fmt, toast, can } = UA;
  const U = UA.uxState;

  /* ==========================================================================
     6. شؤون الطلاب: البطاقة الجامعية الذكية والباركود المشفر + اللجنة التأديبية
     ========================================================================== */
  /* ---------- تخزين واسترجاع سجل نشاط البطاقة الرقمية (Check-in / Check-out Logs) ---------- */
  // السجل على الخادم وحده؛ ويُزال ما تركته النسخ السابقة في المتصفح
  for (const k of ['suss_digital_card_activity_logs_v2', 'suss_digital_card_activity_logs_v3']) { try { localStorage.removeItem(k); } catch {} }
  const cardLogState = { studentId: null, logs: [] };
  const fromServer = (r) => ({ id: r.id, studentId: r.student_id, studentNo: r.student_no, studentName: r.student_name, eventType: r.event_type, locationName: r.location_name, locationCode: r.location_code, method: r.method, terminalId: r.terminal_id, status: r.status, reason: r.reason, pkiHash: r.pki_hash, timestamp: Number(r.created_at) });
  async function loadCardLogs(studentId) {
    cardLogState.studentId = studentId;
    const d = await UA.api('GET', `/api/students/${studentId}/card-activity`);
    if (cardLogState.studentId !== studentId) return;
    cardLogState.logs = (d.logs || []).map(fromServer);
    UA.render();
  }
  const getCardLogs = () => cardLogState.logs;



  function formatCardLogTime(ts) {
    if (!ts) return { fullText: '—', rel: '—', timeStr: '—', dateStr: '—' };
    const d = new Date(ts);
    const dateStr = d.toISOString().slice(0, 10);
    const hours = d.getHours();
    const mins = String(d.getMinutes()).padStart(2, '0');
    const secs = String(d.getSeconds()).padStart(2, '0');
    const isPm = hours >= 12;
    const h12 = hours % 12 || 12;
    const timeStr = `${h12}:${mins}:${secs} ${isPm ? 'م' : 'ص'}`;
    const diffMs = Date.now() - ts;
    let rel = '';
    if (diffMs < 60000) rel = 'منذ لحظات';
    else if (diffMs < 3600000) rel = `منذ ${Math.floor(diffMs / 60000)} دقيقة`;
    else if (diffMs < 86400000) rel = `اليوم (${Math.floor(diffMs / 3600000)} س)`;
    else if (diffMs < 172800000) rel = 'أمس';
    else rel = `منذ ${Math.floor(diffMs / 86400000)} يوم`;
    return { dateStr, timeStr, rel, fullText: `${dateStr} ${timeStr}` };
  }

  /* ==========================================================================
     6. شؤون الطلاب: البطاقة الجامعية الذكية والباركود المشفر + سجل نشاط التحقق اللحظي
     ========================================================================== */
  UA.renderDigitalCardSection = () => {
    const stList = (S.stList && S.stList.students) || [];
    // قائمة الطلاب لا تكون محمّلة إن فُتح هذا التبويب قبل «سجل الطلاب»
    if (!stList.length && !U.cardStudentsAsked && UA.can('student:read')) {
      U.cardStudentsAsked = true;
      api('GET', '/api/students?limit=500').then((r) => { S.stList.students = r.students; S.stList.total = r.total; UA.render(); }).catch(() => {});
    }
    const st = S.stSel || stList[0];
    if (!st) return '<section class="card" style="margin-top:0"><h2 style="margin-top:0">🪪 البطاقة الجامعية الرقمية</h2><p class="hint">لا يوجد طلاب لعرض بطاقاتهم. سجّل طالباً أولاً من «تسجيل طالب جديد».</p></section>';
    const secureBarcode = UA.generateStudentSecureBarcode ? UA.generateStudentSecureBarcode(st.studentNo, st.nationalId || '2026') : `SUSS-${st.studentNo}-SEC94`;

    if (cardLogState.studentId !== st.id) { cardLogState.logs = []; loadCardLogs(st.id).catch(() => {}); }
    const allLogs = getCardLogs();
    // تصفية سجلات الطالب المحدد
    const stLogs = allLogs.filter((l) => Number(l.studentId) === Number(st.id) || String(l.studentNo) === String(st.studentNo));

    // استخراج آخر عملية تحقق (Check-in و Check-out)
    const latestEvent = stLogs[0] || null;
    const latestCheckIn = stLogs.find((l) => l.eventType === 'check_in') || null;
    const latestCheckOut = stLogs.find((l) => l.eventType === 'check_out') || null;

    const isCurrentlyCheckedIn = latestEvent && latestEvent.eventType === 'check_in';
    const totalLogsCount = stLogs.length;
    const nfcCount = stLogs.filter((l) => l.method === 'nfc').length;
    const barcodeCount = stLogs.filter((l) => l.method === 'barcode').length;
    const nfcPercent = totalLogsCount ? Math.round((nfcCount / totalLogsCount) * 100) : 0;
    const barcodePercent = totalLogsCount ? 100 - nfcPercent : 0;

    // تطبيق فلاتر العرض
    const ca = U.cardActivity || { filterEvent: 'all', filterMethod: 'all', filterLocation: 'all', searchQuery: '', selectedLocation: 'GATE-MAIN-01', selectedMethod: 'nfc' };
    const filterEvent = ca.filterEvent || 'all';
    const filterMethod = ca.filterMethod || 'all';
    const filterLocation = ca.filterLocation || 'all';
    const searchQ = (ca.searchQuery || '').trim().toLowerCase();

    const filteredLogs = stLogs.filter((log) => {
      if (filterEvent !== 'all' && log.eventType !== filterEvent) return false;
      if (filterMethod !== 'all' && log.method !== filterMethod) return false;
      if (filterLocation !== 'all') {
        if (filterLocation === 'gates' && !log.locationCode.startsWith('GATE')) return false;
        if (filterLocation === 'library' && !log.locationCode.startsWith('LIB')) return false;
        if (filterLocation === 'halls' && !log.locationCode.startsWith('HALL') && !log.locationCode.startsWith('LAB')) return false;
      }
      if (searchQ) {
        const text = `${log.locationName} ${log.locationCode} ${log.terminalId} ${log.reason || ''} ${log.pkiHash}`.toLowerCase();
        if (!text.includes(searchQ)) return false;
      }
      return true;
    });

    const latestInTime = latestCheckIn ? formatCardLogTime(latestCheckIn.timestamp) : null;
    const latestOutTime = latestCheckOut ? formatCardLogTime(latestCheckOut.timestamp) : null;

    return `<section class="card" style="margin-top:0">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;flex-wrap:wrap;gap:8px">
        <h2 style="margin:0;display:flex;align-items:center;gap:8px">
          <span>🪪 البطاقة الجامعية الرقمية الذكية (NFC / Dynamic QR Pass & Barcode)</span>
        </h2>
        <span style="background:#054239;color:#D5B65D;font-weight:800;font-size:11px;padding:3px 9px;border-radius:6px;font-family:monospace">ميزة #6 المحدثة والمطورة</span>
      </div>
      <p class="sub" style="margin-top:0;color:#566660;font-size:13px">إصدار وتصديق البطاقة الجامعية الذكية مع تكويد باركود فريد مشفر مضاد للتزوير وربط مباشر بسجل حركات التحقق (Check-in/Check-out) اللحظي عبر بوابات الحرم الجامعي.</p>

      <div class="inline-form" style="gap:12px;margin-bottom:16px;align-items:flex-end;flex-wrap:wrap">
        <label style="flex:1;min-width:240px">اختر الطالب لإصدار وتصديق بطاقته وعرض سجل نشاطه
          <input id="digicard-stu" data-student-picker value="${esc(st.studentNo)}" placeholder="اكتب اسم الطالب أو رقمه الجامعي" style="width:100%">
          <small class="sp-name" style="display:block;margin-top:3px;color:var(--muted,#566660);font-weight:600">👤 ${esc(st.name)}</small>
        </label>
        ${UA.cardPrintModeHtml ? UA.cardPrintModeHtml() : ''}
        <button class="btn pri" type="button" data-act="printdigicard" style="height:38px;padding:0 18px">🖨️ طباعة البطاقة الذكية الرسمية</button>
      </div>

      <p class="small" style="margin:0 0 10px">رمز البطاقة الثابت: <b class="mono" dir="ltr">${esc(UA.generateStudentSecureBarcode(st.studentNo))}</b> · رمز NFC الثابت: <b class="mono" dir="ltr">${esc(UA.studentNfcCode(st.studentNo))}</b></p>
      ${UA.digitalCardHtml(st, { screen: true })}

      <!-- ==========================================================================
           واجهة سجل نشاط البطاقة الرقمية (Check-in / Check-out Activity Log)
           ========================================================================== -->
      <div style="margin-top:24px;border-top:2px solid #DCE3DD;padding-top:20px" id="card-activity-log-interface">
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;margin-bottom:12px">
          <div>
            <h3 style="margin:0;display:flex;align-items:center;gap:8px;font-size:16px;color:#042f28">
              <span>📋 سجل نشاط وحركات التحقق من البطاقة الرقمية (NFC / Barcode Activity & Gate Pass Log)</span>
            </h3>
            <p style="margin:4px 0 0;font-size:12.5px;color:#566660">تتبع وتوثيق عمليات التحقق الميداني (Check-in / Check-out) عبر بوابات الحرم الجامعي وقاعات الامتحانات والمكتبة.</p>
          </div>
          <div>
            ${isCurrentlyCheckedIn ? `
              <span style="display:inline-flex;align-items:center;gap:6px;background:#F6F8F5;color:#054239;border:1px solid #a7f3d0;padding:5px 12px;border-radius:99px;font-size:12px;font-weight:700">
                <span style="width:8px;height:8px;border-radius:50%;background:#1B7F4B;display:inline-block"></span>
                الحالة الحالية: متواجد داخل الحرم الجامعي
              </span>
            ` : `
              <span style="display:inline-flex;align-items:center;gap:6px;background:#F6F8F5;color:#566660;border:1px solid #DCE3DD;padding:5px 12px;border-radius:99px;font-size:12px;font-weight:700">
                <span style="width:8px;height:8px;border-radius:50%;background:#8B9591;display:inline-block"></span>
                الحالة الحالية: خارج الحرم الجامعي (مغادر)
              </span>
            `}
          </div>
        </div>

        <!-- بطاقات مؤشرات آخر عمليات التحقق (Check-in / Check-out) -->
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:12px;margin-bottom:18px">
          <!-- آخر عملية دخول Check-in -->
          <div style="background:#fff;border:1px solid #DCE3DD;border-inline-start:4px solid #1B7F4B;border-radius:12px;padding:14px;box-shadow:0 2px 6px rgba(0,0,0,.03)">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
              <span style="font-size:12px;font-weight:700;color:#054239;display:flex;align-items:center;gap:6px">
                <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#1B7F4B"></span>
                آخر عملية تحقق ودخول (Check-in)
              </span>
              ${latestCheckIn ? `<span style="background:#F6F8F5;color:#054239;font-size:11px;font-weight:700;padding:2px 7px;border-radius:4px">${latestCheckIn.method === 'nfc' ? '📳 شريحة NFC' : '📷 باركود مشفر'}</span>` : ''}
            </div>
            ${latestCheckIn ? `
              <strong style="display:block;font-size:14px;color:#042f28;margin-bottom:4px">${esc(latestCheckIn.locationName)}</strong>
              <div style="font-size:12px;color:#566660;display:flex;flex-wrap:wrap;gap:8px;align-items:center">
                <span>🕒 <b>${latestInTime.timeStr}</b> (${latestInTime.rel})</span>
                <span>•</span>
                <span class="mono" style="font-size:11px;background:#F6F8F5;padding:1px 5px;border-radius:4px">${esc(latestCheckIn.terminalId)}</span>
              </div>
            ` : `
              <div style="color:#8B9591;font-size:13px;padding:6px 0">لا توجد حركات دخول مسجلة مؤخراً</div>
            `}
          </div>

          <!-- آخر عملية خروج Check-out -->
          <div style="background:#fff;border:1px solid #DCE3DD;border-inline-start:4px solid #0A5A4D;border-radius:12px;padding:14px;box-shadow:0 2px 6px rgba(0,0,0,.03)">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
              <span style="font-size:12px;font-weight:700;color:#0A5A4D;display:flex;align-items:center;gap:6px">
                <span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#0A5A4D"></span>
                آخر عملية تحقق وخروج (Check-out)
              </span>
              ${latestCheckOut ? `<span style="background:#F6F8F5;color:#0A5A4D;font-size:11px;font-weight:700;padding:2px 7px;border-radius:4px">${latestCheckOut.method === 'nfc' ? '📳 شريحة NFC' : '📷 باركود مشفر'}</span>` : ''}
            </div>
            ${latestCheckOut ? `
              <strong style="display:block;font-size:14px;color:#042f28;margin-bottom:4px">${esc(latestCheckOut.locationName)}</strong>
              <div style="font-size:12px;color:#566660;display:flex;flex-wrap:wrap;gap:8px;align-items:center">
                <span>🕒 <b>${latestOutTime.timeStr}</b> (${latestOutTime.rel})</span>
                <span>•</span>
                <span class="mono" style="font-size:11px;background:#F6F8F5;padding:1px 5px;border-radius:4px">${esc(latestCheckOut.terminalId)}</span>
              </div>
            ` : `
              <div style="color:#8B9591;font-size:13px;padding:6px 0">لا توجد حركات خروج مسجلة مؤخراً</div>
            `}
          </div>

          <!-- إحصائيات التوزيع والاعتماد -->
          <div style="background:#fff;border:1px solid #DCE3DD;border-inline-start:4px solid #D5B65D;border-radius:12px;padding:14px;box-shadow:0 2px 6px rgba(0,0,0,.03)">
            <small style="color:#566660;font-size:12px">إجمالي حركات البطاقة والوسيلة</small>
            <div style="display:flex;justify-content:space-between;align-items:baseline;margin-top:2px">
              <strong style="font-size:19px;color:#042f28">${totalLogsCount} عملية تحقق</strong>
              <span style="background:#FBEBD0;color:#8A6A1B;font-size:11px;font-weight:700;padding:2px 6px;border-radius:4px">100% مصرح</span>
            </div>
            <div style="margin-top:6px;font-size:11.5px;color:#566660;display:flex;justify-content:space-between">
              <span>📳 NFC: <b>${nfcPercent}%</b> (${nfcCount})</span>
              <span>📷 باركود: <b>${barcodePercent}%</b> (${barcodeCount})</span>
            </div>
          </div>
        </div>

        <!-- منصة محاكاة وتمرير البطاقة اللحظي (Interactive Card Scan Console) -->
        <div style="background:#F6F8F5;border:1px solid #DCE3DD;border-radius:12px;padding:14px;margin-bottom:18px">
          <div style="font-size:13px;font-weight:800;color:#042f28;margin-bottom:8px;display:flex;align-items:center;gap:6px">
            <span>⚡ منصة التحقق وتمرير البطاقة الميداني اللحظي (Live Card Tap Simulator)</span>
            <small style="font-weight:normal;color:#566660;font-size:11.5px">تسجيل يدوي لحركة البطاقة على الخادم، ولا يتصل بقارئ فعلي</small>
          </div>
          <div class="inline-form" style="gap:10px;align-items:flex-end;flex-wrap:wrap">
            <label style="flex:2;min-width:200px">موقع البوابة / المرفق الأكاديمي
              <select id="card-sim-loc" style="width:100%">
                <option value="GATE-MAIN-01">🏛️ البوابة الرئيسية — الحرم المركزي (GATE-MAIN-01)</option>
                <option value="GATE-NORTH-03">🚪 البوابة الشمالية — مواقف السيارات (GATE-NORTH-03)</option>
                <option value="LIB-ENTRANCE">📚 المكتبة المركزية — مدخل المطالعة والبحوث (LIB-ENTRANCE)</option>
                <option value="HALL-EXAM-102">🎓 مجمع القاعات الامتحانية (HALL-EXAM-102)</option>
                <option value="LAB-CYB-03">🧪 مختبر الأمن السيبراني والشبكات (LAB-CYB-03)</option>
                <option value="HUB-CAMPUS">🍽️ مجمع الخدمات والمطاعم الجامعية (HUB-CAMPUS)</option>
              </select>
            </label>
            <label style="flex:1;min-width:160px">تقنية التحقق
              <select id="card-sim-method" style="width:100%">
                <option value="nfc">📳 شريحة NFC الذكية (NFC Pass)</option>
                <option value="barcode">📷 مسح الباركود المشفر (Barcode)</option>
              </select>
            </label>
            <div style="display:flex;gap:6px;flex-wrap:wrap">
              <button class="btn pri" type="button" data-act="simcardcheckin" style="height:38px;padding:0 14px;background:#059669;color:#fff;font-weight:700">
                🟢 تسجيل دخول (Check-in)
              </button>
              <button class="btn pri" type="button" data-act="simcardcheckout" style="height:38px;padding:0 14px;background:#0A5A4D;color:#fff;font-weight:700">
                🔵 تسجيل خروج (Check-out)
              </button>
              <button class="btn" type="button" data-act="simcarddenied" style="height:38px;padding:0 12px;color:#B3261E;border-color:#F2B8B5" title="محاكاة محاولة دخول غير مصرحة">
                ⚠️ تسجيل رفض
              </button>
            </div>
          </div>
        </div>

        <!-- شريط الفلترة والبحث والتصدير -->
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:10px;margin-bottom:12px">
          <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center;flex:1">
            <!-- فلتر نوع الحركة -->
            <select data-act="cardfilterevent" style="padding:6px 10px;border-radius:6px;border:1px solid #DCE3DD;font-size:12.5px;background:#fff">
              <option value="all" ${filterEvent === 'all' ? 'selected' : ''}>كافة العمليات (دخول وخروج)</option>
              <option value="check_in" ${filterEvent === 'check_in' ? 'selected' : ''}>🟢 عمليات الدخول (Check-in)</option>
              <option value="check_out" ${filterEvent === 'check_out' ? 'selected' : ''}>🔵 عمليات الخروج (Check-out)</option>
              <option value="denied" ${filterEvent === 'denied' ? 'selected' : ''}>🔴 محاولات مرفوضة (Denied)</option>
            </select>

            <!-- فلتر التقنية -->
            <select data-act="cardfiltermethod" style="padding:6px 10px;border-radius:6px;border:1px solid #DCE3DD;font-size:12.5px;background:#fff">
              <option value="all" ${filterMethod === 'all' ? 'selected' : ''}>كافة الوسائل (NFC و باركود)</option>
              <option value="nfc" ${filterMethod === 'nfc' ? 'selected' : ''}>📳 شريحة NFC الذكية</option>
              <option value="barcode" ${filterMethod === 'barcode' ? 'selected' : ''}>📷 مسح الباركود المشفر</option>
            </select>

            <!-- فلتر الموقع -->
            <select data-act="cardfilterloc" style="padding:6px 10px;border-radius:6px;border:1px solid #DCE3DD;font-size:12.5px;background:#fff">
              <option value="all" ${filterLocation === 'all' ? 'selected' : ''}>كافة المواقع والمرافق</option>
              <option value="gates" ${filterLocation === 'gates' ? 'selected' : ''}>🏛️ بوابات الحرم الخارجية</option>
              <option value="library" ${filterLocation === 'library' ? 'selected' : ''}>📚 المكتبة المركزية</option>
              <option value="halls" ${filterLocation === 'halls' ? 'selected' : ''}>🎓 القاعات والمختبرات</option>
            </select>

            <!-- حقل البحث الفوري -->
            <input type="text" data-act="cardlogsearch" placeholder="بحث بالموقع، الجهاز، أو البصمة..." value="${esc(searchQ)}" style="padding:6px 10px;border-radius:6px;border:1px solid #DCE3DD;font-size:12.5px;min-width:180px;background:#fff">
          </div>

          <div style="display:flex;gap:6px;flex-wrap:wrap">
            <button class="btn" type="button" data-act="exportcardcsv" style="height:32px;padding:0 12px;font-size:12px;display:flex;align-items:center;gap:4px">
              📥 تصدير CSV
            </button>
            <button class="btn" type="button" data-act="printcardlogs" style="height:32px;padding:0 12px;font-size:12px;display:flex;align-items:center;gap:4px">
              🖨️ طباعة السجل
            </button>
          </div>
        </div>

        <!-- جدول سجل نشاط وتحقق البطاقة -->
        <div class="tbl-wrap" style="border:1px solid #DCE3DD;border-radius:10px;overflow:hidden;background:#fff" id="printable-card-logs-table">
          <table style="width:100%;border-collapse:collapse;margin:0">
            <thead>
              <tr style="background:#F6F8F5;border-bottom:1px solid #DCE3DD;font-size:12px;color:#566660">
                <th style="padding:10px 12px;text-align:start">التاريخ والوقت</th>
                <th style="padding:10px 12px;text-align:start">نوع الحركة</th>
                <th style="padding:10px 12px;text-align:start">الموقع / المرفق الأكاديمي</th>
                <th style="padding:10px 12px;text-align:start">وسيلة التحقق</th>
                <th style="padding:10px 12px;text-align:start">معرف القارئ (Terminal)</th>
                <th style="padding:10px 12px;text-align:start">حالة التصريح</th>
                <th style="padding:10px 12px;text-align:start">بصمة التوثيق الأمني</th>
                <th style="padding:10px 12px;text-align:start">بيان التدقيق</th>
              </tr>
            </thead>
            <tbody>
              ${filteredLogs.length > 0 ? filteredLogs.map((log) => {
                const tInfo = formatCardLogTime(log.timestamp);
                const isCheckIn = log.eventType === 'check_in';
                const isCheckOut = log.eventType === 'check_out';
                const isDenied = log.eventType === 'denied' || log.status === 'denied';

                return `<tr style="border-bottom:1px solid #F6F8F5;font-size:12.5px;transition:background .15s">
                  <td style="padding:10px 12px;white-space:nowrap">
                    <strong style="color:#042f28">${tInfo.timeStr}</strong>
                    <div style="font-size:11px;color:#566660">${tInfo.dateStr} <span style="color:#D5B65D;font-weight:700">(${tInfo.rel})</span></div>
                  </td>
                  <td style="padding:10px 12px;white-space:nowrap">
                    ${isCheckIn ? `
                      <span style="background:#F6F8F5;color:#054239;border:1px solid #a7f3d0;padding:3px 8px;border-radius:6px;font-size:11px;font-weight:700;display:inline-flex;align-items:center;gap:4px">
                        🟢 دخول (Check-in)
                      </span>
                    ` : isCheckOut ? `
                      <span style="background:#F6F8F5;color:#0A5A4D;border:1px solid #BFD8CF;padding:3px 8px;border-radius:6px;font-size:11px;font-weight:700;display:inline-flex;align-items:center;gap:4px">
                        🔵 خروج (Check-out)
                      </span>
                    ` : `
                      <span style="background:#F6F8F5;color:#B3261E;border:1px solid #F2B8B5;padding:3px 8px;border-radius:6px;font-size:11px;font-weight:700;display:inline-flex;align-items:center;gap:4px">
                        🔴 مرفوض (Denied)
                      </span>
                    `}
                  </td>
                  <td style="padding:10px 12px">
                    <strong style="color:#10211D;display:block">${esc(log.locationName)}</strong>
                    <span class="mono" style="font-size:10.5px;color:#566660">${esc(log.locationCode)}</span>
                  </td>
                  <td style="padding:10px 12px;white-space:nowrap">
                    ${log.method === 'nfc' ? `
                      <span style="background:#F6F8F5;color:#0E4D2E;border:1px solid #A8D8BE;padding:2px 7px;border-radius:4px;font-size:11px;font-weight:700">📳 شريحة NFC</span>
                    ` : `
                      <span style="background:#F6F8F5;color:#10211D;border:1px solid #DCE3DD;padding:2px 7px;border-radius:4px;font-size:11px;font-weight:700">📷 باركود مشفر</span>
                    `}
                  </td>
                  <td style="padding:10px 12px;white-space:nowrap">
                    <span class="mono" style="font-size:11.5px;background:#F6F8F5;padding:2px 6px;border-radius:4px;color:#10211D">${esc(log.terminalId)}</span>
                  </td>
                  <td style="padding:10px 12px;white-space:nowrap">
                    ${!isDenied ? `
                      <span style="color:#059669;font-weight:700;display:inline-flex;align-items:center;gap:4px">✓ مصرح به</span>
                    ` : `
                      <span style="color:#B3261E;font-weight:700;display:inline-flex;align-items:center;gap:4px">✕ محظور / مرفوض</span>
                    `}
                  </td>
                  <td style="padding:10px 12px;white-space:nowrap">
                    <code class="mono" style="font-size:11px;background:#F6F8F5;border:1px solid #DCE3DD;padding:2px 6px;border-radius:4px;color:#042f28">${esc(log.pkiHash || '0x29ac88')}</code>
                  </td>
                  <td style="padding:10px 12px;font-size:12px;color:#566660">
                    ${esc(log.reason || 'تحقق أمني نظامي')}
                  </td>
                </tr>`;
              }).join('') : `
                <tr>
                  <td colspan="8" style="padding:24px;text-align:center;color:#8B9591">
                    لا توجد حركات مطابقة للفلتر المحدد. يمكنك تسجيل أول حركة من النموذج أعلاه.
                  </td>
                </tr>
              `}
            </tbody>
          </table>
        </div>
        <div style="margin-top:8px;font-size:11.5px;color:#566660;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap">
          <span>تُحفظ كل حركة على الخادم مع بصمة SHA-256 للسجل، وهي ليست توقيعًا من البطاقة.</span>
          <span>عرض <b>${filteredLogs.length}</b> من أصل <b>${stLogs.length}</b> حركة للطالب</span>
        </div>
      </div>
    </section>`;
  };

  UA.renderDisciplinarySection = () => {
    const a = S.admin || {};
    const holdsList = a.holds || [];

    return `<section class="card" style="margin-top:0">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;flex-wrap:wrap;gap:8px">
        <h2 style="margin:0;display:flex;align-items:center;gap:8px">
          <span>🏛️ اللجنة التأديبية وسجل اللجان الانضباطية والمخالفات المسلكية</span>
        </h2>
        <span style="background:#054239;color:#D5B65D;font-weight:800;font-size:11px;padding:3px 9px;border-radius:6px;font-family:monospace">نقلت إلى شؤون الطلاب</span>
      </div>
      <p class="sub" style="margin-top:0;color:#566660;font-size:13px">تسجيل قرارات اللجان الانضباطية والتأديبية، وفرض حواجز الحظر الفوري على المعاملات وبراءة الذمة مع التتبع الأكاديمي.</p>

      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;margin-bottom:16px">
        <div style="background:#fff;border:1px solid #DCE3DD;border-inline-start:4px solid #B3261E;border-radius:10px;padding:12px">
          <small style="color:#566660">حالات الحظر النشطة</small>
          <strong style="display:block;font-size:22px;color:#B3261E;margin-top:2px">${holdsList.filter(h => h.active).length} طالب</strong>
        </div>
        <div style="background:#fff;border:1px solid #DCE3DD;border-inline-start:4px solid #C9A24B;border-radius:10px;padding:12px">
          <small style="color:#566660">إنذارات مسلكية وتأديبية</small>
          <strong style="display:block;font-size:22px;color:#8A6A1B;margin-top:2px">${holdsList.length} قرار</strong>
        </div>
        <div style="background:#fff;border:1px solid #DCE3DD;border-inline-start:4px solid #1B7F4B;border-radius:10px;padding:12px">
          <small style="color:#566660">عقوبات تمت تسويتها</small>
          <strong style="display:block;font-size:22px;color:#1B7F4B;margin-top:2px">${holdsList.filter(h => !h.active).length} قرار</strong>
        </div>
      </div>

      <div class="inline-form" style="margin-bottom:16px;background:rgba(14,102,85,.03);padding:14px;border-radius:10px;border:1px solid #DCE3DD;gap:10px;align-items:flex-end;flex-wrap:wrap">
        <label style="flex:1;min-width:180px">الرقم الجامعي للطالب<input id="h-no" placeholder="CYB-2026-0001" dir="ltr"></label>
        <label style="flex:1;min-width:160px">نوع العقوبة / الحجز
          <select id="h-type">
            <option value="disciplinary">تأديبية / مسلكية</option>
            <option value="financial">مالية</option>
            <option value="library">مكتبة وعهدة</option>
          </select>
        </label>
        <label style="flex:2;min-width:240px">قرار اللجنة / نص المخالفة<input id="h-note" maxlength="200" placeholder="اكتب قرار اللجنة التأديبية..."></label>
        <button class="btn pri" data-act="addhold" style="height:38px;padding:0 18px">تسجيل العقوبة وتطبيق الحظر</button>
      </div>

      <h3 style="font-size:14px;margin:16px 0 8px">سجل العقوبات والحواجز الفورية المعتمدة</h3>
      <div class="tbl-wrap">
        <table>
          <thead>
            <tr><th>الطالب</th><th>الرقم الجامعي</th><th>النوع</th><th>الملاحظة / قرار اللجنة</th><th>الحالة</th><th>الإجراءات</th></tr>
          </thead>
          <tbody>
            ${holdsList.map((h) => `<tr>
              <td><b>${esc(h.student)}</b></td>
              <td class="mono">${esc(h.studentNo)}</td>
              <td>${{ financial: 'مالية', disciplinary: 'تأديبية', library: 'مكتبة' }[h.holdType] || esc(h.holdType)}</td>
              <td>${esc(h.note)}</td>
              <td>${h.active ? '<span class="bad-t">قائمة / محظور</span>' : '<span class="ok-t">مسددة / مرفوعة</span>'}</td>
              <td style="white-space:nowrap">
                ${h.active ? `<button class="btn sm" data-act="clearhold" data-id="${h.id}">تسوية ورفع</button> ` : ''}
                <button class="btn sm" data-act="edithold" data-id="${h.id}">تعديل</button>
                <button class="btn sm bad" data-act="delhold" data-id="${h.id}">حذف</button>
              </td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>
    </section>`;
  };

  UA.cardLogs = { getCardLogs, loadCardLogs, formatCardLogTime };
})();
