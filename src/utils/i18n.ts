export type StudioLang = "ar" | "en";

export const STUDIO_LANG_STORAGE_KEY = "uni_erp_studio_lang";
export const UNI_ERP_LANG_EVENT = "uni_erp_lang_change";

export function normalizeLang(raw?: string | null): StudioLang {
  return raw === "en" ? "en" : "ar";
}

export function getDirectionForLang(lang: StudioLang): "rtl" | "ltr" {
  return lang === "ar" ? "rtl" : "ltr";
}

export function toggleLangValue(current: StudioLang): StudioLang {
  return current === "ar" ? "en" : "ar";
}

export interface SyncLangOptions {
  dispatchCustomEvent?: boolean;
  iframeWindow?: Window | null;
  source?: string;
}

/**
 * دالة موحدة لمزامنة حالة اللغة عبر كل من App.tsx و uni-erp/public/i18n.js
 * تقوم بتحديث localStorage وإرسال dispatchEvent مخصص وإبلاغ نافذة الـ ERP iframe فوراً
 */
export function syncStudioLang(
  targetLang: StudioLang,
  options?: SyncLangOptions
): StudioLang {
  const lang = normalizeLang(targetLang);
  const dir = getDirectionForLang(lang);

  // 1. تحديث الذاكرة المحلية المشتركة
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(STUDIO_LANG_STORAGE_KEY, lang);
    }
  } catch {
    // ignore quota/security errors
  }

  // 2. تحديث سمات وثيقة HTML الحالية
  try {
    if (typeof document !== "undefined" && document.documentElement) {
      document.documentElement.lang = lang;
      document.documentElement.dir = dir;
    }
  } catch {}

  // 3. إرسال حدث مخصص (dispatchEvent) لجميع المستمعين داخل الصفحة
  if (options?.dispatchCustomEvent !== false && typeof window !== "undefined") {
    try {
      window.dispatchEvent(
        new CustomEvent(UNI_ERP_LANG_EVENT, {
          detail: { lang, dir, source: options?.source || "studio" },
        })
      );
    } catch {}
  }

  // 4. إرسال رسالة فورية إلى إطار الـ ERP الداخلي دون الحاجة لإعادة تحميل الصفحة
  if (options?.iframeWindow) {
    try {
      options.iframeWindow.postMessage(
        { type: "UNI_ERP_LANG", lang, dir, source: options?.source || "studio" },
        "*"
      );
    } catch {}
  }

  return lang;
}

export const STUDIO_I18N: Record<StudioLang, Record<string, string>> = {
  ar: {
    appTitle: "منظومة Uni-ERP الجامعية المتكاملة — الإصدار المطور v12",
    unitsBadge: "17/17 وحدة مكتملة",
    appSubtitle: "الجامعة السورية للعلوم الأمنية · استكمال الوحدات (5.12–5.15) + توسعات (5.5–5.8) + البنية التحتية + الذكاء الاصطناعي",
    roleSwitchLabel: "تبديل الدور الفوري:",
    role_admin: "مدير النظام",
    role_admin_sub: "صلاحيات كاملة (17 وحدة)",
    role_staff: "موظف شؤون الطلاب",
    role_staff_sub: "القبول والطلبات والسجل",
    role_student: "بوابة الطالب",
    role_student_sub: "طارق محمود العلي",
    role_auditor: "مدقق الجودة",
    role_auditor_sub: "التدقيق وسلسلة البصمات",
    unitsIndexBtn: "لوحة الإدارة والـ 17 وحدة",
    rechartsBtn: "لوحة تحليلات Recharts",
    rechartsBtnTitle: "لوحة تحليلات Recharts لإحصائيات DevOps ولكافة الأقسام",
    editCodeBtn: "تعديل الكود المصدري v12",
    quickDemoBtn: "ملف العرض المحدث (HTML)",
    reloadSystemTitle: "إعادة تحميل النظام",
    hideToolbarBtn: "إخفاء الشريط ✕",
    hideToolbarTitle: "إخفاء الشريط العلوي لمعاينة وضع النشر الكامل",
    showToolbarBtn: "⚙️ إظهار شريط أدوات المطور",
    langToggleBtn: "English",
    langToggleTitle: "Switch interface language to English",
    langSwitchedToast: "تم التبديل إلى اللغة العربية وحفظ التفضيل في المتصفح",

    // Phases & Modules
    phase_enterprise: "الهيكلة الموحدة والدليل التفاعلي",
    mod_es_academics: "الأكاديمي وفحص الامتحان PDF",
    mod_es_pki: "التسجيل الذاتي والبطاقة والتحقق PKI",
    mod_es_hr: "قسائم الرواتب والعبء والأقساط",
    mod_es_ux: "اللوحة الرئيسية (لوحة التحكم + مكتبي)",
    mod_guidelines: "دليل الإرشادات التفاعلي الشامل",
    mod_exchange_unified: "الاستيراد الموحد وصفحة التصدير",
    mod_es_exec: "آليات المراقبة والتدقيق وDevOps",

    phase_student_affairs: "تطوير شؤون الطلاب الشامل (1، 2، 3، 5، 6)",
    mod_sa_admissions: "القبول والمفاضلة ومعادلة المواد",
    mod_sa_advising: "الخطة التفاعلية والإرشاد والإنذار",
    mod_sa_lifecycle: "حركات القيد والانضباط المسلكي",
    mod_sa_digital_card: "البطاقة الرقمية وسجل حركات التحقق (NFC / QR)",
    mod_sa_disciplinary: "اللجنة التأديبية وسجل المخالفات",
    mod_sa_scholarships: "المنح والإعفاءات (مدمجة مالياً)",
    mod_sa_desk: "مكتب خدمة الطالب والدور الذكي",

    phase_rbac: "الحسابات والصلاحيات المهيكلة (RBAC)",
    mod_rbac_users: "استوديو تأسيس الحسابات ومصفوفة الوصول",
    mod_rbac_units: "صلاحيات الأقسام والوحدات الإدارية",
    mod_rbac_roles: "الأدوار والقوالب الوظيفية",
    mod_rbac_matrix: "مصفوفة الصلاحيات الشاملة (70+ صلاحية)",

    phase_hr: "شؤون الموظفين الموحدة (الرواتب + الحضور + البصمة + التقييم)",
    mod_hr_hub: "شؤون الموظفين والرواتب والبصمة والتقييم",
    mod_hr_contract: "تجديد العقود والتنبيهات",
    mod_hr_analytics: "إحصائيات الموارد البشرية",
    mod_hr_config: "إعدادات التنبيهات والسيستم",

    phase_restructured: "المالية والإمداد والديوان والإدارة المركزية",
    mod_procurement: "المشتريات والمخازن والأصول",
    mod_finance: "المالية والمحاسبة",
    mod_corr: "الديوان والمراسلات والطلبات الداخلية",
    mod_internal: "الطلبات الداخلية",
    mod_admin_unified: "الإدارة والوحدات والتحقق وإعداداتي",

    phase_1_4: "المراحل 1–4",
    mod_lms: "التعلم والمكتبة",
    mod_research: "البحث والدراسات",
    mod_alumni: "الخريجون والتوظيف",
    mod_qa: "الجودة والاعتماد",
    mod_expansions: "الامتحانات والسكن",
    mod_devops: "البنية التحتية",
    mod_ai: "الذكاء الاصطناعي",

    // Code Inspector Modal
    codeStudioTitle: "استوديو الكود المصدري الحي — Uni-ERP v12",
    codeStudioSub: "عدّل ملفات الوحدات الجديدة مباشرة وسيتم حفظها في الخادم وتحديث المعاينة الحية فوراً",
    simulateErrorBtn: "🧪 محاكاة خطأ",
    simulatingErrorBtn: "جارٍ المحاكاة...",
    simulateErrorTitle: "محاكاة حدوث خطأ تجريبي أثناء الحفظ وإرساله إلى وحدة DevOps فوراً",
    devopsLogBtn: "سجل أخطاء DevOps",
    devopsLogTitle: "سجل بلاغات أخطاء الاستوديو وDevOps",
    saveApplyBtn: "حفظ والتطبيق",
    savingBtn: "جارٍ الحفظ...",
    saveTitle: "حفظ التعديلات (Ctrl+S / Cmd+S)",
    closeTitle: "إغلاق النافذة (Esc)",
    incidentBannerTitle: "نظام رصد وتسجيل الأخطاء التلقائي (DevOps Incident Logging)",
    incidentStatusActive: "اتصال DevOps: نشط ولحظي",
    openDevopsUnitBtn: "فتح وحدة DevOps بالمنظومة لمتابعة البلاغات",
    clearLocalLogBtn: "مسح السجل المحلي",
    noErrorsMsg: "لم يتم رصد أي أخطاء في عمليات الحفظ أو التحميل حتى الآن. النظام يعمل بحالة مثالية.",
    sentToDevopsBadge: "✓ أُرسل لوحدة DevOps",
    failedSendBadge: "فشل الإرسال",
    detailsBtn: "🔍 التفاصيل",
    devFilesHeader: "ملفات التطوير (v12)",
    searchPlaceholder: "ابحث... (Ctrl+F)",
    noMatchingFiles: "لا توجد ملفات مطابقة للبحث",

    // Incident Detail Modal
    diagReportTitle: "تقرير البلاغ التشخيصي لـ DevOps:",
    opTypeLabel: "نوع العملية:",
    severityLabel: "مستوى الخطورة:",
    affectedFileLabel: "الملف المتأثر:",
    devopsStatusLabel: "حالة الإرسال لـ DevOps:",
    errorMessageLabel: "رسالة الخطأ:",
    stackTraceLabel: "التفاصيل الفنية وتتبع المكدس (Stack Trace):",
    clientContextLabel: "سياق العميل والمستخدم (Client Context):",
    copyJsonBtn: "نسخ التقرير (JSON)",
    rechartsChartsBtn: "رسوم Recharts البيانية",
    goToDevopsBtn: "الانتقال لوحدة DevOps",

    // Recharts Dashboard
    rcTitle: "مركز التحليلات والرسوم البيانية التفاعلية (Recharts Analytics Studio)",
    rcBadge: "Recharts Engine v2 · حي ومباشر",
    rcSubtitle: "مراقبة تواتر أخطاء الاستوديو ونسبة النجاح في إرسال البلاغات إلى DevOps + إحصائيات كافة الأقسام حسب الصلاحية",
    rcTabDevops: "إحصائيات أخطاء DevOps (Recharts)",
    rcTabDepts: "إحصائيات كافة الأقسام والمنظومة",
    rcSimulateBtn: "🧪 محاكاة خطأ وتحديث الرسم",
    rcSimulatingBtn: "جارٍ الإرسال...",
    rcRefreshTitle: "تحديث البيانات",
    rcCollapseBtn: "طي اللوحة",

    // Toasts
    toastSwitchingRole: "جارٍ التبديل إلى حساب:",
    toastOpening: "فتح:",
    toastSaved: "تم حفظ التعديلات مباشرة في ملفات المشروع وإعادة تحميل المعاينة",
    toastCopiedJson: "تم نسخ التقرير التشخيصي الكامل بصيغة JSON",
  },
  en: {
    appTitle: "Uni-ERP Integrated University System — Enterprise Edition v12",
    unitsBadge: "17/17 Modules Complete",
    appSubtitle: "Syrian University for Security Sciences · Core Modules (5.12–5.15) + Expansions (5.5–5.8) + DevOps + AI",
    roleSwitchLabel: "Quick Role Switch:",
    role_admin: "System Admin",
    role_admin_sub: "Full Access (17 Modules)",
    role_staff: "Student Affairs Staff",
    role_staff_sub: "Admissions, Requests & Records",
    role_student: "Student Portal",
    role_student_sub: "Tarek Mahmoud Al-Ali",
    role_auditor: "Quality Auditor",
    role_auditor_sub: "Audit Trail & Hash Chain",
    unitsIndexBtn: "Admin & 17 Modules Hub",
    rechartsBtn: "Recharts Analytics",
    rechartsBtnTitle: "Interactive Recharts Analytics for DevOps & All University Departments",
    editCodeBtn: "Live Code Studio v12",
    quickDemoBtn: "Updated Demo (HTML)",
    reloadSystemTitle: "Reload System Preview",
    hideToolbarBtn: "Hide Bar ✕",
    hideToolbarTitle: "Collapse developer toolbar for full-screen preview",
    showToolbarBtn: "⚙️ Show Studio Toolbar",
    langToggleBtn: "العربية",
    langToggleTitle: "تبديل لغة واجهة الاستوديو إلى العربية",
    langSwitchedToast: "Switched to English and saved preference in LocalStorage",

    // Phases & Modules
    phase_enterprise: "Unified Architecture & Interactive Guide",
    mod_es_academics: "Academics & Master Exam PDF",
    mod_es_pki: "Self-Enrollment, Smart ID & PKI Verifier",
    mod_es_hr: "Signed Payslips, Overload & Installments",
    mod_es_ux: "Main Hub (Dashboard + My Desk)",
    mod_guidelines: "Interactive System Guidelines",
    mod_exchange_unified: "Unified Import & Export Hub",
    mod_es_exec: "Audit, Monitoring & DevOps",

    phase_student_affairs: "Student Affairs Suite (1, 2, 3, 5 & 6)",
    mod_sa_admissions: "Smart Admissions & Credit Equivalence",
    mod_sa_advising: "Degree Audit, Prereq Tree & Early Warning",
    mod_sa_lifecycle: "Lifecycle Workflows & Disciplinary",
    mod_sa_digital_card: "Digital Pass & Verification Log (NFC / QR)",
    mod_sa_disciplinary: "Disciplinary Board & Violations Log",
    mod_sa_scholarships: "Scholarships & Aid (Finance-Linked)",
    mod_sa_desk: "One-Stop Student Desk & Smart Queue",

    phase_rbac: "Expanded RBAC & Account Studio",
    mod_rbac_users: "Account Studio & 17-Module Access Matrix",
    mod_rbac_units: "Department & Unit Default Permissions",
    mod_rbac_roles: "Roles & Job Templates",
    mod_rbac_matrix: "Full Permissions Matrix (70+ Perms)",

    phase_hr: "Unified HR (Payroll + Attendance + Biometrics + Appraisals)",
    mod_hr_hub: "Unified HR, Biometrics & Appraisals",
    mod_hr_contract: "Contract Renewals & Alerts",
    mod_hr_analytics: "HR Analytics & Metrics",
    mod_hr_config: "System & Alert Settings",

    phase_restructured: "Finance, Procurement, Diwan & Central Admin",
    mod_procurement: "Procurement, Inventory & Assets",
    mod_finance: "Finance & Double-Entry Accounting",
    mod_corr: "Diwan, Correspondence & Internal Requests",
    mod_internal: "Internal Staff Requests",
    mod_admin_unified: "Admin, Units, Verification & My Settings",

    phase_1_4: "Phases 1–4",
    mod_lms: "E-Learning & Digital Library",
    mod_research: "Research & Graduate Studies",
    mod_alumni: "Alumni & Career Portal",
    mod_qa: "Quality & Accreditation",
    mod_expansions: "Exams, Dorms & Activities",
    mod_devops: "Infrastructure & DevOps",
    mod_ai: "University AI Assistant",

    // Code Inspector Modal
    codeStudioTitle: "Live Source Code Studio — Uni-ERP v12",
    codeStudioSub: "Edit module files directly on the server and hot-reload the live ERP preview immediately",
    simulateErrorBtn: "🧪 Simulate Error",
    simulatingErrorBtn: "Simulating...",
    simulateErrorTitle: "Simulate a save error and dispatch diagnostic report to DevOps",
    devopsLogBtn: "DevOps Error Log",
    devopsLogTitle: "Studio & DevOps Incident Reports Log",
    saveApplyBtn: "Save & Apply",
    savingBtn: "Saving...",
    saveTitle: "Save Changes (Ctrl+S / Cmd+S)",
    closeTitle: "Close Window (Esc)",
    incidentBannerTitle: "Automated DevOps Incident Detection & Logging",
    incidentStatusActive: "DevOps Link: Active & Real-Time",
    openDevopsUnitBtn: "Open DevOps Module in ERP to Track Incidents",
    clearLocalLogBtn: "Clear Local Log",
    noErrorsMsg: "No save or load errors detected so far. The system is operating normally.",
    sentToDevopsBadge: "✓ Delivered to DevOps",
    failedSendBadge: "Delivery Failed",
    detailsBtn: "🔍 Details",
    devFilesHeader: "Development Files (v12)",
    searchPlaceholder: "Search files... (Ctrl+F)",
    noMatchingFiles: "No matching files found",

    // Incident Detail Modal
    diagReportTitle: "DevOps Diagnostic Incident Report:",
    opTypeLabel: "Operation Type:",
    severityLabel: "Severity Level:",
    affectedFileLabel: "Affected File:",
    devopsStatusLabel: "DevOps Delivery Status:",
    errorMessageLabel: "Error Message:",
    stackTraceLabel: "Technical Details & Stack Trace:",
    clientContextLabel: "Client & User Context:",
    copyJsonBtn: "Copy Report (JSON)",
    rechartsChartsBtn: "Recharts Analytics",
    goToDevopsBtn: "Go to DevOps Module",

    // Recharts Dashboard
    rcTitle: "Interactive Analytics & Charts Center (Recharts Analytics Studio)",
    rcBadge: "Recharts Engine v2 · Live",
    rcSubtitle: "Monitor Studio error frequency, DevOps delivery success rate & department statistics by role",
    rcTabDevops: "DevOps Error Analytics (Recharts)",
    rcTabDepts: "All Departments & ERP Statistics",
    rcSimulateBtn: "🧪 Simulate Error & Update Chart",
    rcSimulatingBtn: "Sending...",
    rcRefreshTitle: "Refresh Data",
    rcCollapseBtn: "Collapse Panel",

    // Toasts
    toastSwitchingRole: "Switching account to:",
    toastOpening: "Opening:",
    toastSaved: "Changes saved directly to project files and preview reloaded",
    toastCopiedJson: "Full diagnostic report copied as JSON",
  },
};

export function translateStudio(lang: StudioLang, key: string): string {
  return STUDIO_I18N[lang]?.[key] || STUDIO_I18N.ar[key] || key;
}
