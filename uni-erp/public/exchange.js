/* بوابة موحدة للاستيراد والتصدير: تم دمج الاستيراد العام مع استيراد الإكسل (الطلبات) في فورم استيراد موحد، وحصر كافة عمليات التصدير في صفحة التصدير الموحدة */
(function () {
  const UA = window.UA, { S, can } = UA;
  const tabs = () => {
    const t = [];
    if (can('student:register') || can('course:manage') || can('grade:manage') || can('request:import') || ['import:academic', 'import:procurement', 'import:finance', 'import:hr', 'import:student_fin', 'import:misc'].some(can)) {
      t.push(['import', 'فورم الاستيراد الموحد (البيانات والإكسل)']);
    }
    if (can('data:export')) {
      t.push(['export', 'صفحة التصدير المركزية الموحدة']);
    }
    return t;
  };
  const cur = () => {
    if (S.exTab === 'reqx') S.exTab = 'import';
    const t = tabs();
    if (!t.some((x) => x[0] === S.exTab)) S.exTab = t[0] && t[0][0];
    return S.exTab;
  };
  UA.views.exchange = () => {
    const t = tabs(), c = cur();
    return `<div class="sub-tabs no-print" role="tablist">${t.map((x) => `<button class="chip" role="tab" data-act="extab" data-t="${x[0]}" aria-pressed="${c === x[0]}">${x[1]}</button>`).join('')}</div>${UA.views[c] ? UA.views[c]() : ''}`;
  };
  UA.loaders.exchange = async () => { const c = cur(); if (c && UA.loaders[c]) await UA.loaders[c](); };
  UA.actions.extab = async (el, d) => { S.exTab = d.t === 'reqx' ? 'import' : d.t; await UA.loaders.exchange(); UA.render(); };
})();
