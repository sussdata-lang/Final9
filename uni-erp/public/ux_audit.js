/* آليات المراقبة والتدقيق (مفصول من ux_restructure.js) */
(function () {
  'use strict';
  const UA = window.UA;
  if (!UA) return;
  const { S, api, esc, fmt, toast, can } = UA;
  const U = UA.uxState;
  const renderArchifyDiagramsBlock = (...a) => UA.renderArchifyDiagramsBlock(...a);

  /* ==========================================================================
     3. دمج «البنية التحتية والتوسع» مع «التدقيق» باسم «آليات المراقبة والتدقيق»
     ========================================================================== */
  function renderHighConcurrencyTab() {
    const t = U.hcTelemetry || {};
    const dbInfo = t.database || {};
    const dbStats = t.dbStats || {};
    const sess = t.sessionStats || {};
    const http = t.httpStats || {};
    const cache = t.cacheTelemetry || {};
    const ns = cache.namespaces || {};
    const b = U.hcBenchmarkResult;
    const val = (v, unit = '') => (v === null || v === undefined ? '—' : `${v}${unit}`);
    const nsRate = (x) => (x && (x.hits || x.misses) ? `${x.hitRatePercent}%` : '—');

    return `<section class="card" style="border:2px solid #054239;background:linear-gradient(135deg,#F6F8F5 0%,#ffffff 100%)">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap">
        <div>
          <span class="pill" style="background:#054239;color:#fff;font-weight:700">قياسات حية من الخادم</span>
          <h2 style="margin:6px 0 4px;color:#054239">أداء النظام</h2>
          <p class="small" style="margin:0">الأرقام أدناه محسوبة من الخادم وقاعدة البيانات لحظة التحديث.</p>
          <p class="small" style="margin:6px 0 0"><b>آخر اختبار حمل موثق</b> (جهاز التطوير، 5000 طالب، 4 تشرين الثاني 2026): مع 200 مستخدم يرسل كلٌّ منهم طلباً كل نحو 3 ثوانٍ اكتمل 95% من الطلبات خلال 86 مللي ثانية دون أخطاء، وأقصى ضغط مقيس 165 طلباً في الثانية. لم يُختبر أكثر من 200 مستخدم، وقد تختلف الأرقام على خادم النشر.</p>
        </div>
        <div class="actions" style="margin:0">
          <button type="button" class="btn pri" data-act="hcrunbench" ${U.hcBenchRunning ? 'disabled' : ''}>⚡ ${U.hcBenchRunning ? 'جارٍ تنفيذ الاختبار...' : 'تشغيل اختبار حي (360 طلباً بتزامن حتى 50)'}</button>
          <button type="button" class="btn sm" data-act="hcrefresh">🔄 تحديث المؤشرات الحية</button>
        </div>
      </div>

      <div class="stats" style="margin-top:16px">
        <div class="stat">
          <small>التخزين المؤقت (${esc(cache.engine || '—')})</small>
          <b style="color:#054239">${val(cache.overallHitRatePercent, '%')} إصابة</b>
          <div class="small">إصابات: <b>${val(cache.totalHits)}</b> · عناصر: <b>${val(cache.totalEntries)}</b></div>
        </div>
        <div class="stat">
          <small>فهارس قاعدة البيانات</small>
          <b style="color:#047857">${val(dbInfo.indexes)} فهرس</b>
          <div class="small">إصابة SQL: <b>${val(dbStats.stmtCacheHitRate, '%')}</b> · قراءات: <b>${val(dbStats.totalReads)}</b></div>
        </div>
        <div class="stat">
          <small>الجلسات في الذاكرة المؤقتة</small>
          <b style="color:#0A5A4D">${val(sess.cachedSessions)} جلسة</b>
          <div class="small">السقف: <b>${val(sess.maxCapacity)}</b> (ليس عدد المستخدمين الممكن) · الإصابة: <b>${val(sess.hitRatePercent, '%')}</b> · p50: <b>${val(http.p50Ms, ' ms')}</b></div>
        </div>
        <div class="stat">
          <small>اتصالات PostgreSQL</small>
          <b style="color:#0A5A4D">${val(dbInfo.openConnections)} مفتوح</b>
          <div class="small">الحد لكل مجمع: <b>${val(dbInfo.poolMax)}</b> · ${cache.redisConnected ? 'Redis متصل' : 'Redis غير مضبوط: التخزين في ذاكرة الخادم فقط'}</div>
        </div>
      </div>

      ${(() => {
        const table = (title, head, rows) => `<div style="margin-top:14px"><b style="font-size:13px">${title}</b><div class="tbl-wrap"><table class="grid-tbl"><thead><tr>${head.map((h) => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.join('') || `<tr><td colspan="${head.length}" class="empty">لا قياسات بعد</td></tr>`}</tbody></table></div></div>`;
        const nums = (r) => `<td>${r.count}</td><td>${r.avgMs}</td><td>${r.maxMs}</td><td>${r.totalMs}</td>`;
        const pg = t.pgStatements || {};
        return table('أبطأ المسارات منذ تشغيل هذه العملية', ['المسار', 'مرات', 'متوسط ms', 'أقصى ms', 'مجموع ms'], (t.slowRoutes || []).slice(0, 10).map((r) => `<tr><td class="mono" dir="ltr" style="text-align:start">${esc(r.route)}</td>${nums(r)}</tr>`))
          + table('أبطأ الاستعلامات منذ تشغيل هذه العملية', ['الاستعلام', 'مرات', 'متوسط ms', 'أقصى ms', 'مجموع ms'], (t.slowQueries || []).slice(0, 10).map((r) => `<tr><td class="mono small" dir="ltr" style="text-align:start;white-space:normal">${esc(r.sql)}</td>${nums(r)}</tr>`))
          + `<p class="small" style="margin:8px 0 0">pg_stat_statements: ${pg.enabled ? 'مفعّل' : 'غير مفعّل على هذه القاعدة؛ القياس أعلاه من داخل النظام'}. مدة تشغيل العملية: ${val(t.uptimeSec, ' ثانية')}.</p>`;
      })()}

      <div style="margin-top:14px;padding:12px 14px;background:#F6F8F5;border:1px solid #DCE3DD;border-radius:10px">
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:8px">
          <b style="color:#054239;font-size:13px">نطاقات التخزين المؤقت (تُبطَل تلقائياً عند التعديل):</b>
          <span class="pill" style="background:#E2EEE9;color:#0A5A4D;font-size:11px">عمليات الإبطال: ${val(cache.invalidations)}</span>
        </div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:8px;font-size:12px">
          <div style="background:#fff;padding:8px 10px;border-radius:8px;border:1px solid #DCE3DD">
            <b>بيانات الهوية والأدوار (Identity)</b>
            <div class="small">الإصابة: <b>${nsRate(ns.identity)}</b> (${ns.identity?.hits ?? 0} إصابة / ${ns.identity?.size ?? 0} مفتاح)</div>
          </div>
          <div style="background:#fff;padding:8px 10px;border-radius:8px;border:1px solid #DCE3DD">
            <b>الوحدات التنظيمية (Org Units)</b>
            <div class="small">الإصابة: <b>${nsRate(ns.org_units)}</b> (${ns.org_units?.hits ?? 0} إصابة / ${ns.org_units?.size ?? 0} مفتاح)</div>
          </div>
          <div style="background:#fff;padding:8px 10px;border-radius:8px;border:1px solid #DCE3DD">
            <b>الإعدادات والحدود (Settings)</b>
            <div class="small">الإصابة: <b>${nsRate(ns.settings)}</b> (${ns.settings?.hits ?? 0} إصابة / ${ns.settings?.size ?? 0} مفتاح)</div>
          </div>
          <div style="background:#fff;padding:8px 10px;border-radius:8px;border:1px solid #DCE3DD">
            <b>دليل الخدمات والنماذج (Catalog)</b>
            <div class="small">الإصابة: <b>${nsRate(ns.catalog)}</b> (${ns.catalog?.hits ?? 0} إصابة / ${ns.catalog?.size ?? 0} مفتاح)</div>
          </div>
          <div style="background:#fff;padding:8px 10px;border-radius:8px;border:1px solid #DCE3DD">
            <b>اللوحة الرئيسية ومكتبي (Desk)</b>
            <div class="small">الإصابة: <b>${nsRate(ns.desk)}</b> (${ns.desk?.hits ?? 0} إصابة / ${ns.desk?.size ?? 0} مفتاح)</div>
          </div>
          <div style="background:#fff;padding:8px 10px;border-radius:8px;border:1px solid #DCE3DD">
            <b>الإحصاءات والتقارير (Analytics)</b>
            <div class="small">الإصابة: <b>${nsRate(ns.analytics)}</b> (${ns.analytics?.hits ?? 0} إصابة / ${ns.analytics?.size ?? 0} مفتاح)</div>
          </div>
        </div>
      </div>

      ${b ? `<div style="margin-top:16px;padding:16px;background:#F6F8F5;border:1.5px solid #DCE3DD;border-radius:12px">
        <h3 style="margin:0;color:#054239">نتيجة الاختبار الحي</h3>
        <p class="small" style="margin:4px 0 10px">${b.totalRequests} طلب قراءة حقيقي من داخل الخادم نفسه، خلال ${(b.durationMs / 1000).toFixed(1)} ثانية. يكشف بطء الخادم الآن، ولا يقيس عدد المستخدمين الممكن.</p>
        <div class="tbl-wrap"><table><thead><tr><th>اتصالات متزامنة</th><th>طلب/ثانية</th><th>الوسيط</th><th>95% خلال</th><th>أخطاء</th></tr></thead><tbody>${b.stages.map((s) => `<tr><td>${s.concurrency}</td><td>${s.requestsPerSec}</td><td>${val(s.p50Ms, ' ms')}</td><td>${val(s.p95Ms, ' ms')}</td><td>${s.errors ? `<b style="color:#B3261E">${s.errors}</b>` : 0}</td></tr>`).join('')}</tbody></table></div>
        <p class="small" style="margin:10px 0 0">الكتابة: ${b.writes.inserted} سجلاً في ${b.writes.durationMs} مللي ثانية (${val(b.writes.perSec)} سجل/ثانية داخل معاملة واحدة)، وأُلغيت كلها فلم يبقَ منها شيء.</p>
      </div>` : ''}

      <div class="grid2" style="margin-top:16px">
        <div style="background:#fff;padding:14px;border:1px solid #DCE3DD;border-radius:10px">
          <h4 style="margin:0 0 8px;color:#054239">التخزين المؤقت للهوية والوحدات التنظيمية</h4>
          <ul style="margin:0;padding-inline-start:18px;line-height:1.8;font-size:13px;color:#10211D">
            <li><b>كاش الهوية والصلاحيات (Identity Cache):</b> تخزين ملفات المستخدمين، الأدوار (<code>roles</code>)، الصلاحيات الفعالة، ودليل الموظفين في الذاكرة لتقليل استعلامات الجلسات والمراسلات والطلبات.</li>
            <li><b>كاش شجرة الوحدات التنظيمية (Org Units Hierarchy Cache):</b> حساب شجرة الوحدات الفرعية ومسارات الإحالة في الذاكرة بزمن <code>O(1)</code> بدلاً من استعلامات <code>WITH RECURSIVE</code> المتكررة.</li>
            <li><b>الإبطال الانتقائي الذكي (Table-Aware Cache Invalidation):</b> أي عملية كتابة على جدول تقوم بإبطال النطاق المرتبط به فقط دون مسح بقية الكاش.</li>
          </ul>
        </div>
        <div style="background:#fff;padding:14px;border:1px solid #DCE3DD;border-radius:10px">
          <h4 style="margin:0 0 8px;color:#054239">تحسين الاستعلامات وفهرسة الجداول عالية التردد (Query & Index Optimization)</h4>
          <ul style="margin:0;padding-inline-start:18px;line-height:1.8;font-size:13px;color:#10211D">
            <li><b>إلغاء استعلامات N+1 في اللوحة الرئيسية والمراسلات والطلبات:</b> استبدال الجلب الكامل لصفوف المراجعة في <code>deskSummary</code> باستعلام عدّ مفهرس فوري، وتجميع فئات العلامات في استعلام واحد.</li>
            <li><b>فهارس مركبة شاملة (031_high_frequency_table_indexes):</b> فهارس مركبة لجداول <code>users</code>، <code>org_units</code>، <code>requests</code>، <code>corr_docs</code>، <code>fin_entries</code>، <code>hr_employees</code>، <code>grades</code>، و<code>audit_log</code>.</li>
            <li><b>فهرسة PostgreSQL ومجمع الاتصالات:</b> تنفيذ الاستعلامات عبر مجمع اتصالات PostgreSQL (حتى 20 اتصالاً لكل عملية).</li>
          </ul>
        </div>
      </div>
    </section>`;
  }

  UA.views.audit = () => {
    const tab = S.auditTab || U.auditSection || 'chain';
    U.auditSection = tab;
    const tabs = [
      ['chain', '1. سجل التدقيق وسلسلة البصمات (Hash Chain)'],
      ['hc_perf', '2. أداء النظام والاختبار الحي'],
      ['archify', '3. خرائط المعمارية التفاعلية (Archify Diagrams)'],
      ['logs', '4. سجل أحداث النظام والخادم'],
      ['devops', '5. البنية التحتية والتوسع والمراقبة الحية (DevOps)'],
      ['exec_offline', '6. آليات المراقبة المؤسسية'],
    ];
    const bar = `<div class="sub-tabs no-print" role="tablist" style="margin-bottom:14px">
      ${tabs.map((t) => `<button class="chip" role="tab" data-act="audtab2" data-t="${t[0]}" aria-pressed="${tab === t[0]}">${esc(t[1])}</button>`).join('')}
    </div>`;

    if (tab === 'archify') {
      return bar + renderArchifyDiagramsBlock();
    }

    if (tab === 'hc_perf') {
      if (!U.hcTelemetry && !U.hcLoading) {
        U.hcLoading = true;
        api('GET', '/api/v12/high-concurrency/telemetry').then((r) => { U.hcTelemetry = r; U.hcLoading = false; UA.render(); }).catch(() => { U.hcLoading = false; });
      }
      return bar + renderHighConcurrencyTab();
    }
    if (tab === 'logs') {
      const LV = { error: ['p-rejected', 'خطأ'], warn: ['p-review', 'تحذير'], info: ['p-approved', 'معلومة'] };
      return bar + `<section class="card"><h2>سجل النظام وأحداث الخادم (آخر ${(S.logs || []).length} حدثاً)</h2>
        <div class="tbl-wrap"><table><thead><tr><th>الوقت</th><th>المستوى</th><th>الحدث</th><th>التفاصيل</th></tr></thead><tbody>${(S.logs || []).map((l) => `<tr><td class="small">${fmt(l.t)}</td><td><span class="pill ${(LV[l.level] || LV.info)[0]}">${(LV[l.level] || LV.info)[1]}</span></td><td>${esc(l.msg)}</td><td>${l.meta ? `<details><summary class="small">عرض</summary><pre class="mono small" dir="ltr" style="white-space:pre-wrap;margin:6px 0 0">${esc(l.meta.stack || l.meta.detail || JSON.stringify(l.meta))}</pre></details>` : '—'}</td></tr>`).join('') || '<tr><td colspan="4" class="empty">لا أحداث مسجَّلة.</td></tr>'}</tbody></table></div></section>`;
    }
    if (tab === 'devops') {
      return bar + `<div id="audit-devops-mount"></div>`;
    }
    if (tab === 'exec_offline') {
      const esHtml = UA.renderEnterpriseSection ? UA.renderEnterpriseSection('ux_offline') : '';
      return bar + `<div id="audit-enterprise-mount" data-mounted="${esHtml ? '1' : ''}">${esHtml}</div>`;
    }
    const c = S.chain;
    return bar + `<section class="card">
      <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap">
        <div>
          <h2 style="margin:0">آليات المراقبة والتدقيق — سجل التدقيق غير القابل للتعديل (Hash Chain)</h2>
          <p class="hint" style="margin:4px 0 0">تم دمج قسم التدقيق مع البنية التحتية وأداء النظام ضمن واجهة موحدة.</p>
        </div>
        <div class="actions" style="margin:0">
          <button class="btn sm" data-act="audtab2" data-t="hc_perf">⚡ أداء النظام</button>
          <button class="btn pri sm" data-act="chain">تحقق من سلامة السلسلة الرقمية</button>
          ${c ? `<span class="${c.ok ? 'ok-t' : 'bad-t'}" style="align-self:center">${c.ok ? `السلسلة سليمة (${c.checked} سجلاً)` : `كُسرت السلسلة عند السجل ${c.brokenAtId}`}</span>` : ''}
        </div>
      </div>
      <div class="tbl-wrap" style="margin-top:12px"><table><thead><tr><th>#</th><th>الوقت</th><th>المنفِّذ</th><th>الإجراء</th><th>المرجع</th><th>IP</th></tr></thead><tbody>${(S.audit || []).map((a) => `<tr><td>${a.id}</td><td style="white-space:nowrap">${fmt(a.at)}</td><td>${esc(a.actor)}</td><td>${esc(a.action)}</td><td class="mono">${esc(a.ref)}</td><td class="mono">${esc(a.ip ?? '')}</td></tr>`).join('')}</tbody></table></div>
    </section>`;
  };

})();
