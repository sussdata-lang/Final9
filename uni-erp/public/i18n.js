/* منظومة الترجمة والتعريب ثنائية اللغة الشاملة (عربي / إنجليزي) لجامعة العلوم الأمنية */
(function () {
  window.UA = window.UA || {};
  const UA = window.UA;

  const STORAGE_KEY = 'uni_erp_studio_lang';

  let currentLang = (function () {
    try {
      const q = new URLSearchParams(window.location.search).get('lang');
      if (q === 'en' || q === 'ar') return q;
      const v = localStorage.getItem(STORAGE_KEY);
      return v === 'en' ? 'en' : 'ar';
    } catch (e) {
      return 'ar';
    }
  })();

  const LANG_EVENT_NAME = 'uni_erp_lang_change';

  function getLang() {
    return currentLang;
  }

  function syncLang(targetLang, opts) {
    opts = opts || {};
    const l = targetLang === 'en' ? 'en' : 'ar';
    const isEn = l === 'en';
    const dir = isEn ? 'ltr' : 'rtl';
    const prevLang = currentLang;
    currentLang = l;

    // 1. تحديث الذاكرة المحلية المشتركة
    try {
      localStorage.setItem(STORAGE_KEY, l);
    } catch (e) {}

    // 2. تحديث الرابط دون إعادة تحميل الصفحة
    try {
      const url = new URL(window.location.href);
      url.searchParams.set('lang', l);
      window.history.replaceState(null, '', url.pathname + url.search);
    } catch (e) {}

    // 3. تطبيق سمات الاتجاه واللغة على عناصر الجذر
    applyLang(l);
    if (prevLang === 'en' && l === 'ar' && opts.reloadOnArabic !== false) { window.location.reload(); return l; }

    // 4. إرسال حدث مخصص (dispatchEvent) لجميع المستمعين داخل نافذة التطبيق
    if (opts.dispatchCustomEvent !== false && typeof window !== 'undefined') {
      try {
        window.dispatchEvent(
          new CustomEvent(LANG_EVENT_NAME, {
            detail: { lang: l, dir, prevLang, source: opts.source || 'erp_i18n' },
          })
        );
      } catch (e) {}
    }

    // 5. إشعار النافذة الحاضنة (الاستوديو) فوراً إن وُجدت
    if (opts.notifyParent !== false && window.parent && window.parent !== window) {
      try {
        window.parent.postMessage(
          { type: 'STUDIO_LANG_CHANGED', lang: l, dir },
          '*'
        );
      } catch (e) {}
    }

    return l;
  }

  function setLang(lang, opts) {
    return syncLang(lang, opts);
  }

  function applyLang(lang) {
    const isEn = lang === 'en';
    const dir = isEn ? 'ltr' : 'rtl';
    document.documentElement.lang = lang;
    document.documentElement.dir = dir;
    const appEl = document.getElementById('app');
    if (appEl) {
      appEl.lang = lang;
      appEl.dir = dir;
    }
  }

  // قاموس شامل لجميع مصطلحات وشاشات المنظومة الجامعية
  const DICT = {
    // Brand & Institution
    'الجامعة السورية للعلوم الأمنية': 'Syrian University for Security Sciences',
    'نظام إدارة الجامعة': 'University ERP System',
    'نظام إدارة وأتمتة البيانات في الجامعة السورية للعلوم الأمنية': 'University ERP & Data Automation System — SUSS',
    'قسم شؤون الطلاب': 'Student Affairs Department',
    'وزارة الداخلية · دمشق': 'Ministry of Interior · Damascus',
    'جميع الحقوق محفوظة': 'All Rights Reserved',
    'جميع الحقوق محفوظة للجامعة السورية للعلوم الأمنية © 2026': 'All Rights Reserved © 2026 Syrian University for Security Sciences',
    'بوابة خدمات الطلاب': 'Student Services Portal',

    // Roles
    'مدير النظام': 'System Admin',
    'موظف شؤون الطلاب': 'Student Affairs Officer',
    'بوابة الطالب': 'Student Portal',
    'طالب': 'Student',
    'مدقق الجودة': 'Quality Auditor',
    'محاسب مالي': 'Financial Accountant',
    'أخصائي موارد بشرية': 'HR Specialist',
    'عضو هيئة تدريسية': 'Faculty Member',
    'عضو هيئة إدارية': 'Administrative Staff Member',
    'هيئة إدارية': 'Administrative Staff',
    'هيئة تدريسية': 'Faculty Staff',

    // Desk & Greetings
    'مرحباً، مدير النظام': 'Welcome, System Admin',
    'ديوان العمل الإداري · مدير النظام': 'Administrative Office · System Admin',
    'بصمة اليوم': "Today's Attendance",
    'لم تسجّل دخولك بعد': 'Not clocked in yet',
    'تسجيل الدخول': 'Clock In',
    'بانتظار وحدتي': 'Pending for My Unit',
    'طلباتي المفتوحة': 'My Open Requests',
    'مراسلات تنتظر اعتمادي': 'Correspondence Awaiting Approval',
    'إشعارات غير مقروءة': 'Unread Notifications',
    'رصيد الإجازة': 'Leave Balance',
    'حضور هذا الشهر': 'Attendance This Month',
    'أعمالي الإدارية': 'My Administrative Operations',
    'أعمالي الأكاديمية': 'My Academic Operations',
    'المواد والعلامات وسجل القاعات والمراسلات.': 'Courses, grades, hall logs, and correspondence.',
    'ينتظرك الآن': 'Waiting for you',
    'لا شيء ينتظرك الآن.': 'Nothing is waiting for you.',
    'مسودات لم تُرسل': 'Unsent drafts',
    'إجراءات سريعة': 'Quick actions',
    'المثبتة': 'Pinned',
    'الأخيرة': 'Recent',
    'كل أقسامي': 'All my sections',
    'اضغط النجمة بجانب أي قسم ليبقى هنا.': 'Press the star next to any section to keep it here.',
    'ابحث في كل النظام': 'Search the whole system',
    'متابعة الطلبات والمعاملات والمراسلات الرسمية.': 'Monitor requests, official paperwork, and formal correspondence.',
    'ملفي وصلاحياتي': 'My Profile & Permissions',
    'إعداداتي': 'My Settings',
    'طلب': 'Requests',
    'مستند': 'Documents',
    'إشعار': 'Notifications',

    // Navigation Groups (Sidebar)
    'الرئيسية ولوحة القيادة': 'Dashboard & Control Center',
    'الشؤون الطلابية والطلبات': 'Student Affairs & Requests',
    'الديوان والمراسلات والطلبات': 'Registry, Correspondence & Requests',
    'الشؤون الأكاديمية والامتحانات': 'Academic Affairs & Examinations',
    'المنظومة الأكاديمية المتقدمة (5.12–5.15)': 'Advanced Academic Modules (5.12–5.15)',
    'الموارد البشرية والرواتب': 'Human Resources & Payroll',
    'المالية والمشتريات والمخازن': 'Finance, Procurement & Assets',
    'التقارير والذكاء الاصطناعي': 'Analytics, Reports & AI',
    'التواصل والإعلانات': 'Communications & Announcements',
    'إدارة النظام والأمن السيبراني': 'System Admin & Cybersecurity',
    'مرجع الوحدات والتحقق': 'Modules Directory & Verification',
    'القائمة الرئيسية': 'Main Navigation',

    // Navigation Items / Views
    'مكتبي': 'My Desk',
    'لوحة التحكم': 'Executive Dashboard',
    'التطوير المؤسسي (15 ميزة)': 'Enterprise Suite (15 Features)',
    'شؤون الطلاب': 'Student Affairs',
    'الطلبات': 'Student Requests',
    'الطلبات الداخلية': 'Internal Staff Requests',
    'المواد والعلامات': 'Courses & Grades',
    'سجل القاعات': 'Lecture Halls & Attendance',
    'الامتحانات والسكن والتقييم': 'Exams, Housing & Evaluation',
    'الامتحانات والسكن والأنشطة': 'Exams, Dorms & Activities',
    'التعلم الإلكتروني والمكتبة': 'E-Learning & Digital Library',
    'البحث والدراسات العليا': 'Research & Graduate Studies',
    'الخريجون والتوظيف': 'Alumni & Career Hub',
    'الجودة والاعتماد المؤسسي': 'Quality & Accreditation',
    'الجودة والاعتماد': 'Quality & Accreditation',
    'الحضور والإجازات': 'Attendance & Leaves',
    'الموظفون والرواتب': 'HR & Payroll Operations',
    'المراسلات': 'Official Correspondence',
    'الإحصاءات': 'Statistics & Analytics',
    'الاستيراد والتصدير': 'Data Import & Export',
    'الأخبار والشكاوى': 'Announcements & Inquiries',
    'الأخبار': 'University News',
    'الذكاء الاصطناعي الجامعي': 'University AI Assistant',
    'المرشد الذكي AI': 'Smart AI Advisor',
    'المشتريات والمخازن': 'Procurement & Warehouse',
    'المالية والمحاسبة': 'Finance & Accounting',
    'لوحة الإدارة': 'Administration Panel',
    'الحسابات والصلاحيات': 'Accounts & Permissions Studio',
    'التدقيق': 'Security Audit Trail',
    'البنية التحتية والتوسع': 'Infrastructure & DevOps',
    'البنية التحتية': 'Infrastructure & Servers',
    'وحدات النظام': '17 Modules Directory',
    'التحقق العام': 'PKI Document Verifier',
    'الرئيسية': 'Home',
    'دليل المواد': 'Courses Catalog',
    'علاماتي': 'My Academic Grades',
    'معاملاتي': 'My Active Requests',

    // Header & Shell Actions
    'النظام يعمل بشكل طبيعي': 'All Systems Operational',
    'الإشعارات': 'Notifications',
    'لا توجد إشعارات جديدة.': 'No new notifications.',
    'تسجيل الخروج': 'Sign Out',
    'التحقق من الوثائق': 'Document Verification',
    'تحقّق من صحة أي وثيقة صادرة عن الجامعة.': 'Verify official certificates & transcripts with PKI signature.',
    'فتح صفحة التحقق': 'Open Verifier',
    'تبديل المظهر: تلقائي (حسب الجهاز)': 'Theme: Auto (System)',
    'المظهر: فاتح': 'Theme: Light',
    'المظهر: ليلي': 'Theme: Dark',
    'ابحث عن طالب بالاسم أو الرقم الجامعي...': 'Search student by name or national ID...',
    'ابحث...': 'Quick Search...',
    'عرض الطلبات': 'View Requests',
    'إغلاق القائمة': 'Close Menu',
    'فتح القائمة': 'Open Navigation',
    'تبديل اللغة': 'Switch Language',
    'قائمة المستخدم': 'User Profile Menu',

    // HR & Payroll (From Screenshot and Core System)
    'سيستم الموارد البشرية وشؤون الموظفين المتكامل': 'Integrated Human Resources & Staff Management System',
    'إدارة متكاملة لبيانات الموظفين، الحضور والالتزام، الغياب، الإجازات، الرواتب، السلف، العقود، التحليلات، والتنبيهات الذكية':
      'Comprehensive suite for employee records, biometric attendance, leaves, payroll calculations, salary advances, contracts, real-time analytics, and automated alert rules.',
    'لوحة التحليلات والإحصائيات': 'Analytics & Executive Dashboard',
    'إعدادات التنبيهات وبرمجة النظام (26)': 'System & Alert Automation Rules (26)',
    'الرئيسية والتنبيهات': 'Overview & Alerts Hub',
    'بيانات الموظفين': 'Staff Directory',
    'الحضور والانصراف': 'Attendance & Clock-In',
    'الغياب والخصومات': 'Absence & Deductions',
    'الإجازات والأرصدة': 'Leaves & Balances',
    'الرواتب والحسابات': 'Payroll & Compensation',
    'إدارة السلف': 'Loans & Advances',
    'عقود الموظفين والتجديد': 'Contracts & Renewals',
    'عقود الموظفين': 'Staff Contracts',
    'برمجة النظام والتنبيهات': 'Alert Rules & System Config',
    'الإحصائيات والتحليلات': 'Analytics & Reports',
    'داشبورد التحليلات': 'Analytics Dashboard',
    'سيستم الموارد البشرية المتكامل — بوابة التحكم السريع': 'Integrated HR System — Quick Action Gateway',
    'إجمالي الموظفين': 'Total Employees',
    'الموظفون المتواجدون فعلياً': 'Active Present Employees',
    'عدد أيام الغياب': 'Absence Days',
    'عدد أيام الإجازات': 'Leave Days',
    'إجمالي رواتب الموظفين': 'Total Gross Payroll',
    'إجمالي سلف الموظفين': 'Total Salary Advances',
    'انتهاء العقود (منتهي / قريباً)': 'Contracts (Expired / Soon)',
    'متوسط الرواتب الأساسية': 'Average Base Salary',
    'مركز التنبيهات الاستباقية لشؤون الموظفين': 'Proactive Staff Alerts Hub',
    'مستوى التنبيه': 'Alert Level',
    'التصنيف': 'Category',
    'الموظف': 'Employee',
    'تفاصيل التنبيه': 'Alert Details',
    'البيانات المرجعية': 'Reference Data',
    'تخصيص شروط وفترات التنبيهات ⚙️': 'Customize Alert Thresholds ⚙️',
    'موظف مسجّل': 'registered employees',
    'مخططات الأقسام والإجازات': 'Department & leave charts',
    'القوائم المرجعية وشروط العقود': 'Reference lists & contract terms',

    // Student Affairs Tabs
    'سجل الطلبات والتتبع الحي': 'Requests & Live SLA Tracking',
    'سجل الطلاب (360°)': 'Students 360° Directory',
    'تسجيل طالب جديد': 'Register New Student',
    '1. القبول والمفاضلة والمعادلة': '1. Admissions, Ranking & Credit Transfer',
    '2. الخطة التفاعلية والإرشاد والإنذار': '2. Degree Audit, Advising & Early Warning',
    '2. الخطة والإرشاد والإنذار': '2. Degree Audit, Advising & Early Warning',
    '3. حركات القيد والانضباط المسلكي': '3. Enrollment Status & Student Conduct',
    '3. حركات القيد والانضباط': '3. Enrollment Status & Student Conduct',
    '5. المنح والإعفاءات (مدمجة مالياً)': '5. Scholarships & Tuition Waivers',
    '5. المنح والإعفاءات المالية': '5. Scholarships & Tuition Waivers',
    '6. مكتب خدمة الطالب والدور الذكي': '6. Student Service Desk & Smart Queue',
    '6. مكتب خدمة الطالب والدور': '6. Student Service Desk & Smart Queue',
    '6. سجل الطلبات والتتبع الحي': '6. Requests Registry & Live Tracking',

    // Common Buttons & Modifiers
    'حفظ': 'Save',
    'إلغاء': 'Cancel',
    'تعديل': 'Edit',
    'حذف': 'Delete',
    'عرض': 'View',
    'تصدير': 'Export',
    'استيراد': 'Import',
    'بحث': 'Search',
    'فلترة': 'Filter',
    'تأكيد': 'Confirm',
    'إضافة': 'Add',
    'اعتماد': 'Approve',
    'رفض': 'Reject',
    'فعّال': 'Active',
    'معطّل': 'Disabled',
    'قيد المراجعة': 'Under Review',
    'معتمد': 'Approved',
    'مرفوض': 'Rejected',
    'تم': 'Done',
    'تحميل': 'Download',
    'طباعة': 'Print',
    'توليد': 'Generate',
    'تحديث': 'Refresh',
    'نسخ': 'Copy',
    'إخفاء': 'Hide',
    'إغلاق': 'Close',
    'دخول': 'Sign In',
    'اسم المستخدم': 'Username',
    'كلمة المرور': 'Password',
    'كلمة مرور مؤقتة': 'Temporary Password',
    'الاسم الكامل': 'Full Name',
    'البريد الإلكتروني': 'Email Address',
    'رقم الهاتف': 'Phone Number',
    'المسمى الوظيفي': 'Job Title',
    'الوحدة': 'Organizational Unit',
    'الكلية': 'Faculty / College',
    'القسم': 'Department',
    'الدرجة العلمية': 'Degree',
    'الحالة': 'Status',
    'الإجراء': 'Action',
    'إجراءات': 'Actions',
    'التاريخ': 'Date',
    'الملاحظات': 'Notes',
    'التفاصيل': 'Details',
    'الرصيد': 'Balance',
    'الراتب الأساسي': 'Base Salary',
    'صافي الراتب': 'Net Salary',
    'إجمالي المستحق': 'Total Earnings',
    'إجمالي الخصومات': 'Total Deductions',
  };

  Object.assign(DICT, window.UA_DICT_EN || {});

  const AR_RE = /[\u0600-\u06FF]/;
  const NUM_RE = /[\d\u0660-\u0669][\d\u0660-\u0669,.\u060C\u066B\u066C]*%?/g;
  const memo = new Map();
  const flipArrows = (t) => t.replace(/[←→]/g, (c) => (c === '←' ? '→' : '←'));

  // مطابقة حرفية، أو مع تسامح في الأرقام: مفتاح القاموس يكتبها {n}
  const foldAr = (s) => s.replace(/[ً-ْـ]/g, '');
  let folded = null;   // الحركات لا تُغيّر المعنى: «المفعّلة» و«المفعلة» مفتاح واحد
  function lookup(s) {
    if (DICT[s]) return DICT[s];
    if (!folded) {
      folded = new Map();
      for (const k of Object.keys(DICT)) { const f = foldAr(k); if (!folded.has(f)) folded.set(f, DICT[k]); }
    }
    return folded.get(foldAr(s)) || null;
  }
  function hit(s) {
    const direct = lookup(s);
    if (direct) return direct;
    const nums = s.match(NUM_RE);
    if (!nums) return null;
    const t = lookup(s.replace(NUM_RE, '{n}'));
    if (!t) return null;
    let i = 0;
    return t.replace(/\{n\}/g, () => (nums[i++] ?? ''));
  }

  // يعيد الترجمة أو null. ما لا يُعرف من الأجزاء (الأسماء والأرقام) يبقى كما هو
  function resolve(s, depth) {
    const h = hit(s);
    if (h) return h;
    if (depth > 5) return null;
    let m;
    // رمز أو أيقونة في الأول أو الآخر: «📊 العنوان» و«انتقال ←» و«الاسم *»
    m = /^([^\p{L}\u064B-\u065F\p{N}(«]+)(.+)$/su.exec(s);
    if (m) {
      const r = resolve(m[2], depth + 1);
      if (r) return flipArrows(m[1]) + r;
    }
    m = /^([^\p{L}\u064B-\u065F\p{N}(«]*)(.*?)([^\p{L}\u064B-\u065F\p{N})»%]*)$/su.exec(s);
    if (m && m[2] && (m[1] || m[3])) {
      const r = resolve(m[2], depth + 1);
      if (r) return flipArrows(m[1]) + r + flipArrows(m[3]);
    }
    // ترقيم في الأول: «4. العنوان»
    m = /^([\d\u0660-\u0669]+[.\-)]\s*)(.+)$/su.exec(s);
    if (m) { const r = resolve(m[2], depth + 1); if (r) return m[1] + r; }
    // عدد قبل النص: «3 طلبات»
    m = /^([\d\u0660-\u0669][\d\u0660-\u0669,.%]*\s+)(.+)$/su.exec(s);
    if (m) { const r = resolve(m[2], depth + 1); if (r) return m[1] + r; }
    // عدد أو تاريخ بعد النص: «شباط 26» و«الخميس 29/10»
    m = /^(.+?)(\s+[\d\u0660-\u0669][\d\u0660-\u0669/.:%\-]*)$/su.exec(s);
    if (m) { const r = resolve(m[1], depth + 1); if (r) return r + m[2]; }
    // نص بين قوسين كامل أو في الآخر
    m = /^\((.+)\)$/su.exec(s);
    if (m) { const r = resolve(m[1], depth + 1); if (r) return `(${r})`; }
    m = /^(.+?)\s*\(([^()]*)\)$/su.exec(s);
    if (m) {
      const r = AR_RE.test(m[1]) ? resolve(m[1], depth + 1) : m[1];
      const inner = AR_RE.test(m[2]) ? resolve(m[2], depth + 1) : m[2];
      if (r && (inner || AR_RE.test(m[1]))) return `${r} (${inner || m[2]})`;
    }
    // نص قصّته الشاشة لضيق المكان: «المعهد العالي…»
    m = /^(.{2,})…$/su.exec(s);
    if (m) {
      for (const k of Object.keys(DICT)) {
        if (k.startsWith(m[1]) && k !== s) { const t = DICT[k]; return t.length > 18 ? `${t.slice(0, 16)}…` : t; }
      }
    }
    // أجزاء مفصولة: «القسم · الوحدة» و«الاسم: القيمة»
    for (const sep of [' — ', ' – ', ' · ', ' | ', ' ← ', ' → ', ' / ', '، ', ' + ', ' - ', ': ']) {
      if (!s.includes(sep)) continue;
      const parts = s.split(sep);
      const done = parts.map((p) => (AR_RE.test(p) ? resolve(p.trim(), depth + 1) : null));
      const ok = sep === ': ' ? done[0] || !AR_RE.test(parts[0]) : done.some(Boolean);
      if (!ok) continue;
      const joint = sep === '، ' ? ', ' : flipArrows(sep);
      return parts.map((p, i) => done[i] || p).join(joint);
    }
    return null;
  }

  function tr(str) {
    if (!str || typeof str !== 'string' || getLang() === 'ar' || !AR_RE.test(str)) return str;
    const trimmed = str.trim();
    let out = memo.get(trimmed);
    if (out === undefined) {
      out = resolve(trimmed.replace(/\s+/g, ' '), 0) || '';
      memo.set(trimmed, out);
    }
    return out ? str.replace(trimmed, () => out) : str;
  }

  // ما لا يُترجم: حقول الإدخال ومحتوى الوثائق الرسمية العربية، وما يُعلَّم بـ no-i18n
  const SKIP = '.doc,.no-i18n,textarea,script,style,[contenteditable="true"]';
  const INLINE = /^(B|STRONG|I|EM|SPAN|SMALL|CODE|A|U|KBD|SVG)$/i;

  function translateText(node) {
    const val = node.nodeValue;
    if (!val || !AR_RE.test(val)) return false;
    const parent = node.parentElement;
    if (!parent || parent.closest(SKIP)) return false;
    const translated = tr(val);
    if (translated !== val) node.nodeValue = translated;
    return AR_RE.test(translated);
  }

  function translateAttrs(el) {
    if (el.closest(SKIP) && el.tagName !== 'TEXTAREA') return;
    for (const a of ['placeholder', 'title', 'aria-label', 'label', 'alt']) {
      const v = el.getAttribute(a);
      if (!v || !AR_RE.test(v)) continue;
      const t = tr(v);
      if (t !== v) el.setAttribute(a, t);
    }
    if (el.tagName === 'INPUT' && (el.type === 'button' || el.type === 'submit') && AR_RE.test(el.value)) el.value = tr(el.value);
  }

  // نص قسمه عنصر داخلي: «عدد <b>5</b> طلاب» يُطابق جملة واحدة إن وُجد مفتاحها
  function translateSplit(el) {
    if (!el.childElementCount || el.childElementCount > 4 || el.closest(SKIP)) return;
    for (const c of el.children) if (!INLINE.test(c.tagName) || c.childElementCount > 1) return;
    const full = el.textContent.replace(/\s+/g, ' ').trim();
    if (!full || full.length > 240 || !AR_RE.test(full)) return;
    const t = resolve(full, 3);
    if (!t) return;
    let placed = false;
    for (const n of [...el.childNodes]) {
      if (n.nodeType === 3) {
        if (!n.nodeValue.trim()) continue;
        n.nodeValue = placed ? '' : t;
        placed = true;
      } else if (n.nodeType === 1 && /[\p{L}\p{N}]/u.test(n.textContent)) {
        if (placed) n.textContent = '';
        else { n.textContent = t; placed = true; }
      }
    }
  }

  // مترجم تلقائي لعناصر DOM عند تفعيل الإنجليزية
  function translateDom(root) {
    if (getLang() !== 'en') return;
    const target = root || document.getElementById('app') || document.body;
    if (!target) return;
    if (target.nodeType === 3) { translateText(target); return; }
    if (target.nodeType !== 1) return;

    // 1. ترجمة النصوص، ومنها نص الخيارات داخل القوائم
    const walker = document.createTreeWalker(target, NodeFilter.SHOW_TEXT, null, false);
    const left = new Set();
    let node;
    while ((node = walker.nextNode())) {
      if (translateText(node) && node.parentElement) left.add(node.parentElement);
    }
    for (const el of left) translateSplit(el);

    // 2. ترجمة الـ Placeholders والـ Titles والـ Aria-Labels وعناوين مجموعات الخيارات
    translateAttrs(target);
    const attrs = target.querySelectorAll('[placeholder],[title],[aria-label],optgroup[label],option[label],img[alt],input[type="button"],input[type="submit"]');
    for (const el of attrs) translateAttrs(el);
  }

  // تطبيق اللغة الحالية فور تحميل الملف
  applyLang(getLang());

  // تواريخ وأرقام الواجهة: محلية عربية في العربية فقط، حتى ما يمر عبر toLocale* وIntl
  const enLocale = (loc) => (getLang() === 'en' && (!loc || String(Array.isArray(loc) ? loc[0] : loc).startsWith('ar')) ? 'en-GB' : loc);
  for (const [proto, names] of [[Date.prototype, ['toLocaleDateString', 'toLocaleTimeString', 'toLocaleString']], [Number.prototype, ['toLocaleString']]]) {
    for (const name of names) {
      const orig = proto[name];
      proto[name] = function (loc, opts) { return orig.call(this, enLocale(loc), opts); };
    }
  }
  for (const name of ['DateTimeFormat', 'NumberFormat']) {
    const orig = Intl[name];
    const wrapped = function (loc, opts) { return new orig(enLocale(loc), opts); };
    wrapped.prototype = orig.prototype;
    wrapped.supportedLocalesOf = orig.supportedLocalesOf;
    Intl[name] = wrapped;
  }
  // رسائل المتصفح الأصلية
  for (const name of ['alert', 'confirm', 'prompt']) {
    const orig = window[name];
    window[name] = function (msg, ...rest) { return orig.call(window, tr(msg), ...rest); };
  }

  // ما يُرسم لاحقاً (الشاشات غير المتزامنة والنوافذ المنبثقة والإشعارات) يُترجم عند ظهوره، قبل أن يُرى
  let combosQueued = false;
  function watchLate() {
    if (getLang() === 'en') document.title = tr(document.title);
    new MutationObserver((records) => {
      if (getLang() !== 'en') return;
      for (const r of records) {
        if (r.type === 'childList') { for (const n of r.addedNodes) translateDom(n); }
        else if (r.type === 'characterData') translateText(r.target);
        else translateAttrs(r.target);
      }
      if (UA.enhanceCombos && !combosQueued) {
        combosQueued = true;
        setTimeout(() => { combosQueued = false; UA.enhanceCombos(); }, 0);
      }
    }).observe(document.documentElement, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['placeholder', 'title', 'aria-label', 'label'] });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', watchLate); else watchLate();

  // مستمع للحدث المخصص للتزامن الفوري
  if (typeof window !== 'undefined') {
    window.addEventListener(LANG_EVENT_NAME, function (ev) {
      const detail = ev && ev.detail;
      if (detail && (detail.lang === 'en' || detail.lang === 'ar') && detail.lang !== currentLang) {
        syncLang(detail.lang, { dispatchCustomEvent: false, notifyParent: false });
        if (UA.render) UA.render();
      }
    });

    // مستمع لأحداث التخزين عبر النوافذ أو التبويبات المتعددة
    window.addEventListener('storage', function (ev) {
      if (ev.key === STORAGE_KEY && (ev.newValue === 'en' || ev.newValue === 'ar') && ev.newValue !== currentLang) {
        syncLang(ev.newValue, { dispatchCustomEvent: true, notifyParent: false });
        if (UA.render) UA.render();
      }
    });
  }

  UA.i18n = {
    getLang,
    setLang,
    syncLang,
    applyLang,
    LANG_EVENT_NAME,
    tr,
    translateDom,
    DICT,
  };
})();
