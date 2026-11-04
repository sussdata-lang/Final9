import React, { useState, useEffect, useRef } from "react";
import {
  ShieldCheck,
  BookOpen,
  GraduationCap,
  Briefcase,
  Award,
  Layers,
  Server,
  Sparkles,
  Code2,
  Download,
  RefreshCw,
  UserCheck,
  CheckCircle2,
  Save,
  X,
  FileCode,
  LayoutGrid,
  AlertTriangle,
  AlertCircle,
  Bug,
  Terminal,
  Send,
  Check,
  Copy,
  ExternalLink,
  ChevronDown,
  ChevronUp,
  Clock,
  Radio,
  BarChart3,
  Search,
  Globe,
  Link2,
  LogIn,
  LogOut,
} from "lucide-react";
import { signInWithPopup, onAuthStateChanged, signOut, User as FirebaseUser } from "firebase/auth";
import { auth, googleAuthProvider } from "./lib/firebase";
import { DevOpsAnalyticsDashboard } from "./components/DevOpsAnalyticsDashboard";
import {
  StudioLang,
  STUDIO_LANG_STORAGE_KEY,
  UNI_ERP_LANG_EVENT,
  normalizeLang,
  getDirectionForLang,
  toggleLangValue,
  translateStudio,
  syncStudioLang,
} from "./utils/i18n";

export interface StudioErrorLog {
  id: string;
  reportCode: string;
  timestamp: number;
  timeFormatted: string;
  operation: "FILE_LOAD" | "FILE_SAVE" | "SYNTAX_CHECK" | "NETWORK";
  severity: "critical" | "error" | "warning";
  filePath: string;
  errorMessage: string;
  errorDetails?: string;
  sentToDevOps: boolean;
  statusText?: string;
  clientContext?: any;
}

interface StudioFile {
  path: string;
  label: string;
  lang: string;
  content: string;
  size: number;
  category?: string;
}

interface ChangelogEntry {
  id: string;
  version: string;
  title: string;
  description: string;
  category: "feature" | "improvement" | "fix" | "code_save";
  filePath?: string;
  author: string;
  timestamp: number;
  sizeBytes?: number;
}

interface InventoryItem {
  path: string;
  size: number;
  folder: string;
  type: string;
}

interface RelationalAuditData {
  summary: {
    totalTablesRegistered: number;
    totalRowsAcrossTables: number;
    totalForeignKeysVerified: number;
    postgresCoreTablesCount: number;
    orgUnitsCount: number;
    programsCount: number;
    accountsCount: number;
    studentProfilesCount: number;
    studentRequestsCount: number;
    hrEmployeesCount: number;
    hrContractsCount: number;
    hrAttendanceCount: number;
    hrAdvancesCount: number;
    finAccountsCount: number;
    finEntriesCount: number;
  };
  domainBreakdown: Array<{
    domain: string;
    tablesCount: number;
    totalRows: number;
    totalColumns: number;
    totalForeignKeys: number;
  }>;
  linkedPrograms: Array<{
    id: number;
    name: string;
    faculty: string;
    degree: string;
    years: number;
    orgUnitName: string;
    studentsCount: number;
    accountsCount: number;
  }>;
  linkedStudents: Array<{
    userId: number;
    username: string;
    studentNo: string;
    fullName: string;
    nationalId: string;
    programName: string;
    facultyName: string;
    studyLevel: number;
    status: string;
    hsScore: number;
    requestsCount: number;
  }>;
  linkedEmployees: Array<{
    id: number;
    employeeNo: string;
    name: string;
    departmentName: string;
    position: string;
    orgUnitName: string;
    salaryBase: number;
    totalAllowances: number;
    contractTypeLabel: string;
    empStatusLabel: string;
    contractsCount: number;
    attendanceRecordsCount: number;
    commitmentRate: number;
    activeAdvancesCount: number;
    remainingAdvanceAmount: number;
  }>;
}

interface ErpUserState {
  username: string;
  name: string;
  role: string;
}

const ROLES = [
  { id: "admin", labelKey: "role_admin", username: "admin", subKey: "role_admin_sub" },
  { id: "staff", labelKey: "role_staff", username: "staff1", subKey: "role_staff_sub" },
  { id: "student", labelKey: "role_student", username: "CYB-2026-0001", subKey: "role_student_sub" },
  { id: "auditor", labelKey: "role_auditor", username: "auditor1", subKey: "role_auditor_sub" },
];

const PHASE_MODULES = [
  {
    phaseKey: "phase_enterprise",
    items: [
      { view: "overview", code: "الرئيسية+مكتبي", labelKey: "mod_es_ux", icon: LayoutGrid },
      { view: "overview", tab: "archify", code: "Archify 📐", labelKey: "mod_guidelines", icon: Layers },
      { view: "guidelines", tab: "archify", code: "دليل الإرشادات", labelKey: "mod_guidelines", icon: BookOpen },
      { view: "academics", code: "الأكاديمي+PDF", labelKey: "mod_es_academics", icon: GraduationCap },
      { view: "exchange", code: "استيراد/تصدير", labelKey: "mod_exchange_unified", icon: Layers },
      { view: "audit", code: "المراقبة والتدقيق", labelKey: "mod_es_exec", icon: ShieldCheck },
    ],
  },
  {
    phaseKey: "phase_student_affairs",
    items: [
      { view: "affairs", tab: "admissions", code: "1", labelKey: "mod_sa_admissions", icon: GraduationCap },
      { view: "affairs", tab: "advising", code: "2", labelKey: "mod_sa_advising", icon: BookOpen },
      { view: "affairs", tab: "lifecycle", code: "3", labelKey: "mod_sa_lifecycle", icon: ShieldCheck },
      { view: "affairs", tab: "digital_card", code: "بطاقة+سجل", labelKey: "mod_sa_digital_card", icon: Sparkles },
      { view: "affairs", tab: "disciplinary", code: "تأديبية", labelKey: "mod_sa_disciplinary", icon: ShieldCheck },
      { view: "affairs", tab: "scholarships", code: "5", labelKey: "mod_sa_scholarships", icon: Award },
      { view: "affairs", tab: "desk_queue", code: "6", labelKey: "mod_sa_desk", icon: Sparkles },
    ],
  },
  {
    phaseKey: "phase_rbac",
    items: [
      { view: "access", tab: "users", code: "RBAC-1", labelKey: "mod_rbac_users", icon: ShieldCheck },
      { view: "access", tab: "units", code: "RBAC-2", labelKey: "mod_rbac_units", icon: Layers },
      { view: "access", tab: "roles", code: "RBAC-3", labelKey: "mod_rbac_roles", icon: Briefcase },
      { view: "access", tab: "matrix", code: "RBAC-4", labelKey: "mod_rbac_matrix", icon: Award },
    ],
  },
  {
    phaseKey: "phase_hr",
    items: [
      { view: "payroll", tab: "hub", code: "شؤون الموظفين", labelKey: "mod_hr_hub", icon: Briefcase },
      { view: "payroll", tab: "enterprise_hr", code: "التطوير المؤسسي", labelKey: "mod_hr_hub", icon: Sparkles },
      { view: "payroll", tab: "contract", code: "العقود", labelKey: "mod_hr_contract", icon: Award },
      { view: "payroll", tab: "analytics", code: "تحليلات", labelKey: "mod_hr_analytics", icon: Layers },
      { view: "payroll", tab: "config", code: "برمجة", labelKey: "mod_hr_config", icon: Server },
    ],
  },
  {
    phaseKey: "phase_restructured",
    items: [
      { view: "procurement", code: "5.10", labelKey: "mod_procurement", icon: Layers },
      { view: "finance", code: "5.9", labelKey: "mod_finance", icon: Award },
      { view: "corr", code: "الديوان+الطلبات", labelKey: "mod_corr", icon: BookOpen },
      { view: "admin", code: "الإدارة+الوحدات", labelKey: "mod_admin_unified", icon: Briefcase },
    ],
  },
  {
    phaseKey: "phase_1_4",
    items: [
      { view: "lms", code: "5.12", labelKey: "mod_lms", icon: BookOpen },
      { view: "research", code: "5.13", labelKey: "mod_research", icon: GraduationCap },
      { view: "alumni", code: "5.14", labelKey: "mod_alumni", icon: Briefcase },
      { view: "qa", code: "5.15", labelKey: "mod_qa", icon: Award },
      { view: "expansions", code: "الامتحانات", labelKey: "mod_expansions", icon: Layers },
      { view: "ai", code: "AI", labelKey: "mod_ai", icon: Sparkles },
    ],
  },
];

export default function App() {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const [lang, setLang] = useState<StudioLang>(() => {
    try {
      return normalizeLang(localStorage.getItem(STUDIO_LANG_STORAGE_KEY));
    } catch {
      return "ar";
    }
  });
  const t = (key: string) => translateStudio(lang, key);
  const dir = getDirectionForLang(lang);

  const [erpUser, setErpUser] = useState<ErpUserState | null>(null);
  const [activeView, setActiveView] = useState<string>("overview");
  const [isBarCollapsed, setIsBarCollapsed] = useState<boolean>(false);
  const [isCodeOpen, setIsCodeOpen] = useState(false);
  const [files, setFiles] = useState<StudioFile[]>([]);
  const [selectedFilePath, setSelectedFilePath] = useState<string>("public/payroll.js");
  const [editedContent, setEditedContent] = useState<string>("");
  const [isSaving, setIsSaving] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const autoLoggedRef = useRef(false);

  useEffect(() => {
    // مزامنة حالة اللغة الابتدائية
    syncStudioLang(lang, { dispatchCustomEvent: false });
  }, [lang, dir]);

  // الاستماع لأحداث مزامنة اللغة المخصصة والتخزين المشترك
  useEffect(() => {
    const handleCustomLang = (ev: Event) => {
      const customEv = ev as CustomEvent<{ lang: StudioLang; source?: string }>;
      if (customEv.detail && customEv.detail.lang && customEv.detail.lang !== lang) {
        setLang(customEv.detail.lang);
      }
    };
    const handleStorage = (ev: StorageEvent) => {
      if (ev.key === STUDIO_LANG_STORAGE_KEY && ev.newValue) {
        const next = normalizeLang(ev.newValue);
        if (next !== lang) {
          syncStudioLang(next, { iframeWindow: iframeRef.current?.contentWindow, dispatchCustomEvent: false });
          setLang(next);
        }
      }
    };
    window.addEventListener(UNI_ERP_LANG_EVENT, handleCustomLang);
    window.addEventListener("storage", handleStorage);
    return () => {
      window.removeEventListener(UNI_ERP_LANG_EVENT, handleCustomLang);
      window.removeEventListener("storage", handleStorage);
    };
  }, [lang]);

  const handleToggleLanguage = () => {
    const next = toggleLangValue(lang);
    syncStudioLang(next, {
      iframeWindow: iframeRef.current?.contentWindow,
      source: "studio_toolbar",
    });
    setLang(next);
    setToast(translateStudio(next, "langSwitchedToast"));
    setTimeout(() => setToast(null), 3200);
  };

  const [studioLogs, setStudioLogs] = useState<StudioErrorLog[]>([]);
  const [isLogDrawerOpen, setIsLogDrawerOpen] = useState(false);
  const [selectedLogDetail, setSelectedLogDetail] = useState<StudioErrorLog | null>(null);
  const [isSimulatingError, setIsSimulatingError] = useState(false);
  const [fileSearchQuery, setFileSearchQuery] = useState("");
  const filteredFiles = files.filter(
    (f) =>
      f.path.toLowerCase().includes(fileSearchQuery.toLowerCase()) ||
      f.label.toLowerCase().includes(fileSearchQuery.toLowerCase())
  );

  // لوحة تحليلات DevOps ورسوم Recharts البيانية
  const [isDevOpsAnalyticsOpen, setIsDevOpsAnalyticsOpen] = useState(false);
  const [analyticsTabDefault, setAnalyticsTabDefault] = useState<"devops" | "departments">("devops");
  const [analyticsRefreshKey, setAnalyticsRefreshKey] = useState(0);

  // سجل التغييرات، جرد الملفات الكاملة، وتدقيق العلاقات المرجعية
  const [changelogEntries, setChangelogEntries] = useState<ChangelogEntry[]>([]);
  const [isChangelogOpen, setIsChangelogOpen] = useState(false);
  const [changelogTab, setChangelogTab] = useState<"changelog" | "relations" | "inventory">("relations");
  const [inventoryData, setInventoryData] = useState<{
    totalFiles: number;
    totalBytes: number;
    allItems: InventoryItem[];
  }>({ totalFiles: 317, totalBytes: 9912400, allItems: [] });
  const [inventoryFilter, setInventoryFilter] = useState("");
  const [relationalAudit, setRelationalAudit] = useState<RelationalAuditData | null>(null);
  const [isSyncingRelations, setIsSyncingRelations] = useState(false);

  // مصادقة Firebase Auth (تخزين الرمز في الذاكرة فقط)
  const [firebaseUser, setFirebaseUser] = useState<FirebaseUser | null>(null);
  const [authToken, setAuthToken] = useState<string | null>(null);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      setFirebaseUser(user);
      if (user) {
        try {
          const token = await user.getIdToken();
          setAuthToken(token);
          await fetch("/api/auth/session", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${token}`,
            },
          });
        } catch (err) {
          console.error("Failed to sync Firebase Auth session:", err);
        }
      } else {
        setAuthToken(null);
      }
    });
    return () => unsub();
  }, []);

  const handleGoogleSignIn = async () => {
    try {
      const cred = await signInWithPopup(auth, googleAuthProvider);
      const token = await cred.user.getIdToken();
      setAuthToken(token);
      await fetch("/api/auth/session", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
      });
      showToast(`تم تسجيل الدخول بنجاح (${cred.user.displayName || cred.user.email})`);
    } catch (err: any) {
      console.error("Google Sign-In error:", err);
      showToast("تعذّر إتمام تسجيل الدخول بحساب Google");
    }
  };

  const handleGoogleSignOut = async () => {
    try {
      await signOut(auth);
      setAuthToken(null);
      showToast("تم تسجيل الخروج");
    } catch {}
  };

  const loadRelationalAudit = async () => {
    try {
      const res = await fetch("/api/studio/relational-audit");
      if (res.ok) {
        const data = await res.json();
        if (data?.audit) setRelationalAudit(data.audit);
      }
    } catch {}
  };

  const handleSyncRelations = async () => {
    setIsSyncingRelations(true);
    try {
      const res = await fetch("/api/studio/relational-audit?refresh=1");
      if (res.ok) {
        const data = await res.json();
        if (data?.audit) setRelationalAudit(data.audit);
        showToast("تم تحديث تدقيق الجداول والعلاقات المرجعية من قاعدة PostgreSQL");
      } else {
        showToast("تعذّر تحديث التدقيق");
      }
    } catch {
      showToast("خطأ أثناء تحديث العلاقات المرجعية");
    } finally {
      setIsSyncingRelations(false);
    }
  };

  useEffect(() => {
    const timer = setTimeout(() => {
      fetch("/api/studio/changelog")
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          if (d && Array.isArray(d.entries)) setChangelogEntries(d.entries);
        })
        .catch(() => {});
      fetch("/api/studio/files")
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          if (d?.files) setFiles(d.files);
          if (d?.inventory) setInventoryData(d.inventory);
        })
        .catch(() => {});
      void loadRelationalAudit();
    }, 1500);
    return () => clearTimeout(timer);
  }, []);

  const searchInputRef = useRef<HTMLInputElement | null>(null);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3200);
  };

  // دالة تسجيل الأخطاء المتقدمة والإرسال الفوري لوحدة DevOps
  const logAndReportError = async (
    operation: StudioErrorLog["operation"],
    filePath: string,
    error: any,
    severity: StudioErrorLog["severity"] = "error"
  ) => {
    const opPrefix = operation === "FILE_SAVE" ? "SAVE" : operation === "FILE_LOAD" ? "LOAD" : "ERR";
    const reportCode = `ERR-${opPrefix}-${Date.now().toString().slice(-6)}`;
    const errorMessage =
      error?.message || (typeof error === "string" ? error : "فشل غير محدد في معالجة الملف في استوديو الكود");
    const errorDetails =
      error?.stack || (typeof error === "object" ? JSON.stringify(error, null, 2) : String(error));

    const clientContext = {
      userAgent: navigator.userAgent,
      platform: navigator.platform,
      activeUser: erpUser?.name || "مدير النظام",
      activeRole: erpUser?.role || "admin",
      url: window.location.href,
      selectedFile: filePath,
      timestamp: new Date().toISOString(),
    };

    const newLog: StudioErrorLog = {
      id: `log-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      reportCode,
      timestamp: Date.now(),
      timeFormatted: new Date().toLocaleTimeString("ar-SY", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      }),
      operation,
      severity,
      filePath,
      errorMessage,
      errorDetails,
      sentToDevOps: false,
      statusText: "جارٍ الإرسال إلى وحدة DevOps...",
      clientContext,
    };

    setStudioLogs((prev) => [newLog, ...prev]);

    const payload = {
      report_code: reportCode,
      source: "Argon Code Studio Inspector",
      event_type: `${operation}_FAILURE`,
      severity,
      file_path: filePath,
      error_message: errorMessage,
      error_details: {
        rawMessage: errorMessage,
        stack: error?.stack,
        status: error?.status,
        code: error?.code,
      },
      client_context: clientContext,
    };

    try {
      let delivered = false;
      // 1. محاولة الإرسال إلى مسار DevOps الرسمي
      const devopsRes = await fetch("/api/devops/incidents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (devopsRes.ok) {
        delivered = true;
      } else {
        // 2. المحاولة البديلة عبر موجه الاستوديو
        const res2 = await fetch("/api/studio/log-incident", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        if (res2.ok) delivered = true;
      }

      if (delivered) {
        setStudioLogs((prev) =>
          prev.map((l) =>
            l.id === newLog.id
              ? { ...l, sentToDevOps: true, statusText: "تم تسليم البلاغ إلى وحدة DevOps بنجاح" }
              : l
          )
        );
        showToast(`🚨 تم تسجيل الخطأ وإرسال تقرير تشخيصي إلى وحدة DevOps [${reportCode}]`);
      } else {
        setStudioLogs((prev) =>
          prev.map((l) =>
            l.id === newLog.id
              ? { ...l, sentToDevOps: false, statusText: "تعذّر تسليم البلاغ (خطأ خادم)" }
              : l
          )
        );
      }
    } catch (netErr: any) {
      console.error("Failed to forward incident to DevOps:", netErr);
      setStudioLogs((prev) =>
        prev.map((l) =>
          l.id === newLog.id
            ? { ...l, sentToDevOps: false, statusText: `فشل الاتصال: ${netErr.message}` }
            : l
        )
      );
    }
  };

  // محاكاة خطأ اختباري للتحقق من خط سير الإرسال لوحدة DevOps
  const simulateStudioError = async () => {
    setIsSimulatingError(true);
    try {
      const fakeError = {
        message: "فشل حفظ الملف: تم رفض الوصول أو تلف في تصاريح نظام الملفات (EACCES Permission Denied)",
        code: "EACCES_PERMISSION_DENIED",
        status: 403,
        stack: `Error: EACCES: permission denied, open '/uni-erp/${selectedFilePath}'\n    at handleSaveFile (src/App.tsx:195)\n    at dispatchEvent (react-dom:12)`,
      };
      await logAndReportError("FILE_SAVE", selectedFilePath, fakeError, "critical");
      setIsLogDrawerOpen(true);
    } finally {
      setIsSimulatingError(false);
    }
  };

  useEffect(() => {
    const onMessage = (ev: MessageEvent) => {
      const data = ev.data;
      if (data && data.type === "UNI_ERP_STATE") {
        setErpUser(data.user);
        if (data.view) setActiveView(data.view);
      }
      if (data && data.type === "OPEN_DEV_ANALYTICS") {
        setAnalyticsTabDefault(data.tab === "departments" ? "departments" : "devops");
        setIsDevOpsAnalyticsOpen(true);
      }
      if (data && data.type === "STUDIO_LANG_CHANGED" && data.lang) {
        const next = data.lang === "en" ? "en" : "ar";
        syncStudioLang(next, { source: "erp_iframe", dispatchCustomEvent: true });
        setLang(next);
        setToast(translateStudio(next, "langSwitchedToast"));
        setTimeout(() => setToast(null), 3200);
      }
      if (data && data.type === "STUDIO_TOGGLE_LANG") {
        handleToggleLanguage();
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [lang]);

  // اختصارات لوحة المفاتيح العالمية لاستوديو الكود (Ctrl+S, Ctrl+F, Esc)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!isCodeOpen) return;
      const isMac = navigator.platform.toUpperCase().indexOf("MAC") >= 0;
      const modKey = isMac ? e.metaKey : e.ctrlKey;

      if (modKey && e.key.toLowerCase() === "s") {
        e.preventDefault();
        handleSaveFile();
      } else if (modKey && e.key.toLowerCase() === "f") {
        e.preventDefault();
        searchInputRef.current?.focus();
        searchInputRef.current?.select();
      } else if (e.key === "Escape") {
        e.preventDefault();
        if (selectedLogDetail) {
          setSelectedLogDetail(null);
        } else if (isLogDrawerOpen) {
          setIsLogDrawerOpen(false);
        } else {
          setIsCodeOpen(false);
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isCodeOpen, selectedFilePath, editedContent, isLogDrawerOpen, selectedLogDetail]);

  const handleIframeLoad = () => {
    if (!autoLoggedRef.current && iframeRef.current?.contentWindow) {
      autoLoggedRef.current = true;
      setTimeout(() => {
        iframeRef.current?.contentWindow?.postMessage(
          { type: "UNI_ERP_LOGIN", username: "admin", studioSwitch: true, view: "overview" },
          "*"
        );
      }, 250);
    }
  };

  const switchRole = (username: string, label: string, defaultView?: string) => {
    iframeRef.current?.contentWindow?.postMessage(
      { type: "UNI_ERP_LOGIN", username, studioSwitch: true, view: defaultView },
      "*"
    );
    showToast(`${t("toastSwitchingRole")} ${label}`);
  };

  const navigateModule = (view: string, label: string, tab?: string) => {
    setActiveView(view);
    iframeRef.current?.contentWindow?.postMessage({ type: "UNI_ERP_NAV", view, tab }, "*");
    showToast(`${t("toastOpening")} ${label}`);
  };

  const openCodeInspector = async () => {
    setIsCodeOpen(true);
    try {
      const res = await fetch("/api/studio/files");
      if (!res.ok) {
        throw new Error(`خطأ استجابة الخادم (${res.status} ${res.statusText}) أثناء جلب الملفات المصدرية`);
      }
      const data = await res.json();
      if (data.files && data.files.length) {
        setFiles(data.files);
        if (data.inventory) setInventoryData(data.inventory);
        const found = data.files.find((f: StudioFile) => f.path === selectedFilePath) || data.files[0];
        setSelectedFilePath(found.path);
        setEditedContent(found.content);
      } else {
        throw new Error("قائمة الملفات المصدرية فارغة من الخادم");
      }
    } catch (err: any) {
      showToast("تعذّر تحميل الملفات المصدرية — تم تسجيل البلاغ وإرساله لوحدة DevOps");
      logAndReportError("FILE_LOAD", "all-studio-files", err, "critical");
    }
  };

  const handleSelectFile = (f: StudioFile) => {
    setSelectedFilePath(f.path);
    setEditedContent(f.content);
  };

  const handleSaveFile = async () => {
    setIsSaving(true);
    try {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (authToken) headers.Authorization = `Bearer ${authToken}`;
      const res = await fetch("/api/studio/save", {
        method: "POST",
        headers,
        body: JSON.stringify({
          filePath: selectedFilePath,
          content: editedContent,
          clientContext: {
            user: firebaseUser?.displayName || erpUser?.name || "مدير النظام",
            role: erpUser?.role || "admin",
            time: new Date().toISOString(),
          },
        }),
      });

      const resData = await res.json().catch(() => ({}));

      if (res.ok) {
        setFiles((prev) =>
          prev.map((f) => (f.path === selectedFilePath ? { ...f, content: editedContent } : f))
        );
        if (Array.isArray(resData.entries)) {
          setChangelogEntries(resData.entries);
        } else if (resData.changelogEntry) {
          setChangelogEntries((prev) => [resData.changelogEntry, ...prev]);
        }
        showToast("تم حفظ التعديلات وتحديث سجل التغييرات وإعادة تحميل المعاينة");
        iframeRef.current?.contentWindow?.location.reload();
      } else {
        const errorMsg = resData.error || `فشل حفظ الملف على الخادم (HTTP ${res.status})`;
        showToast(`تعذّر حفظ الملف — تم إرسال تقرير فوري إلى DevOps [${resData.report_code || "INC"}]`);
        logAndReportError(
          "FILE_SAVE",
          selectedFilePath,
          {
            message: errorMsg,
            status: res.status,
            report_code: resData.report_code,
            details: resData,
          },
          "critical"
        );
      }
    } catch (err: any) {
      showToast("خطأ شبكة أثناء حفظ الملف — تم تسجيل البلاغ لوحدة DevOps");
      logAndReportError("FILE_SAVE", selectedFilePath, err, "critical");
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div dir={dir} lang={lang} className="h-screen w-screen flex flex-col bg-[#042f28] text-white overflow-hidden select-none">
      {/* الشريط العلوي الموحد للتحكم السريع واستعراض المراحل الأربعة */}
      {!isBarCollapsed && (
      <header className="bg-[#054239] border-b border-[#0e6655] px-4 py-2 flex flex-col gap-2 shrink-0 shadow-lg z-20">
        <div className="flex flex-wrap items-center justify-between gap-3">
          {/* الهوية */}
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-lg bg-[#D5B65D]/20 border border-[#D5B65D] flex items-center justify-center text-[#D5B65D]">
              <ShieldCheck className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="font-bold text-sm md:text-base text-white tracking-tight">
                  {t("appTitle")}
                </h1>
                <span className="px-2 py-0.5 text-[11px] font-semibold rounded bg-[#D5B65D] text-[#042f28]">
                  {t("unitsBadge")}
                </span>
              </div>
              <p className="text-[11px] text-emerald-200/80">
                {t("appSubtitle")}
              </p>
            </div>
          </div>

          {/* تبديل الأدوار الفوري بنقرة واحدة */}
          <div className="flex flex-wrap items-center gap-1.5 bg-[#032b24] p-1 rounded-lg border border-emerald-800/70">
            <span className="text-[11px] text-emerald-300 px-2 flex items-center gap-1">
              <UserCheck className="w-3.5 h-3.5 text-[#D5B65D]" />
              {t("roleSwitchLabel")}
            </span>
            {ROLES.map((r) => {
              const active = erpUser?.username?.toLowerCase() === r.username.toLowerCase();
              const roleLabel = t(r.labelKey);
              return (
                <button
                  key={r.id}
                  onClick={() => switchRole(r.username, roleLabel)}
                  title={t(r.subKey)}
                  className={`px-2.5 py-1 rounded text-xs font-medium transition-all flex items-center gap-1.5 cursor-pointer ${
                    active
                      ? "bg-[#D5B65D] text-[#042f28] font-bold shadow"
                      : "text-emerald-100 hover:bg-emerald-800/60"
                  }`}
                >
                  {active && <CheckCircle2 className="w-3.5 h-3.5" />}
                  <span>{roleLabel}</span>
                </button>
              );
            })}
          </div>

          {/* أدوات المطور والتنزيل وتبديل اللغة */}
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={handleToggleLanguage}
              title={t("langToggleTitle")}
              aria-label="Toggle Studio Language"
              data-testid="lang-toggle-btn"
              className="px-3 py-1.5 rounded-lg text-xs font-extrabold bg-[#032b24] hover:bg-emerald-900 text-[#D5B65D] border border-[#D5B65D] flex items-center gap-1.5 transition-all cursor-pointer shadow-sm"
            >
              <Globe className="w-3.5 h-3.5 text-[#D5B65D]" />
              <span>{t("langToggleBtn")}</span>
            </button>

            <button
              onClick={() => navigateModule("admin", t("unitsIndexBtn"), "units")}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer border ${
                activeView === "admin"
                  ? "bg-emerald-600 text-white border-emerald-400"
                  : "bg-emerald-900/70 hover:bg-emerald-800 text-emerald-100 border-emerald-700"
              }`}
            >
              <LayoutGrid className="w-3.5 h-3.5 text-[#D5B65D]" />
              <span>{t("unitsIndexBtn")}</span>
            </button>

            <button
              onClick={() => navigateModule("overview", "خرائط المعمارية التفاعلية (Archify)", "archify")}
              data-testid="archify-header-btn"
              className="px-3 py-1.5 rounded-lg text-xs font-extrabold bg-[#D5B65D] hover:bg-[#e3c770] text-[#042f28] border border-amber-300 flex items-center gap-1.5 transition-all cursor-pointer shadow-md"
              title="فتح خرائط المعمارية التفاعلية وبنية النظام (Archify Diagrams)"
            >
              <Layers className="w-3.5 h-3.5 text-[#042f28]" />
              <span>{lang === "en" ? "📐 Archify Diagrams (4)" : "📐 خرائط المعمارية (Archify)"}</span>
            </button>

            <a
              href="/api/studio/download-audit-docx"
              download="التقرير_الشامل_لفحص_المنظومة_الجامعية_Uni_ERP.docx"
              data-testid="download-audit-docx-btn"
              className="px-3 py-1.5 rounded-lg text-xs font-extrabold bg-amber-400 hover:bg-amber-300 text-[#042f28] border border-white/80 flex items-center gap-1.5 transition-all cursor-pointer shadow-md"
              title="تحميل التقرير الشامل لفحص واختبار كافة عمليات وأمن المنظومة بصيغة Word (.docx)"
            >
              <Download className="w-3.5 h-3.5 text-[#042f28]" />
              <span>{lang === "en" ? "📄 Audit Report (.docx)" : "📄 تقرير الفحص الشامل (Word)"}</span>
            </a>

            <button
              onClick={() => {
                setAnalyticsTabDefault(activeView === "devops" ? "devops" : "departments");
                setIsDevOpsAnalyticsOpen(true);
              }}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-emerald-900/90 hover:bg-emerald-800 text-emerald-100 border border-[#D5B65D]/60 flex items-center gap-1.5 transition-all cursor-pointer shadow-sm"
              title={t("rechartsBtnTitle")}
            >
              <BarChart3 className="w-3.5 h-3.5 text-[#D5B65D]" />
              <span>{t("rechartsBtn")}</span>
            </button>

            <button
              onClick={openCodeInspector}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-emerald-900/80 hover:bg-emerald-800 text-emerald-100 border border-emerald-700 flex items-center gap-1.5 transition-all cursor-pointer"
            >
              <Code2 className="w-3.5 h-3.5 text-[#D5B65D]" />
              <span>{t("editCodeBtn")} ({files.length || 220})</span>
            </button>

            <button
              onClick={() => {
                setChangelogTab("relations");
                setIsChangelogOpen(true);
                void loadRelationalAudit();
              }}
              data-testid="relations-audit-btn"
              className="px-3 py-1.5 rounded-lg text-xs font-bold bg-emerald-950/90 hover:bg-emerald-800 text-[#D5B65D] border border-[#D5B65D] flex items-center gap-1.5 transition-all cursor-pointer shadow-sm"
              title="تدقيق الارتباطات المرجعية وتكامل الأنظمة الجامعية"
            >
              <Link2 className="w-3.5 h-3.5 text-[#D5B65D]" />
              <span>
                {lang === "en"
                  ? "Systems & Relations Audit"
                  : `تدقيق الارتباطات والأنظمة (${relationalAudit?.summary.totalTablesRegistered || 184} جدول)`}
              </span>
            </button>

            <button
              onClick={() => {
                setChangelogTab("changelog");
                setIsChangelogOpen(true);
              }}
              data-testid="changelog-btn"
              className="px-3 py-1.5 rounded-lg text-xs font-bold bg-[#032b24] hover:bg-emerald-900 text-[#D5B65D] border border-[#D5B65D]/70 flex items-center gap-1.5 transition-all cursor-pointer shadow-sm"
              title="سجل التغييرات الحية وجرد ملفات المشروع الكاملة"
            >
              <Clock className="w-3.5 h-3.5 text-[#D5B65D]" />
              <span>
                {lang === "en"
                  ? `Changelog & Files (${inventoryData.totalFiles})`
                  : `سجل التغييرات والملفات (${inventoryData.totalFiles} ملف · ${(inventoryData.totalBytes / 1048576).toFixed(1)} MB)`}
              </span>
            </button>

            {firebaseUser ? (
              <button
                onClick={handleGoogleSignOut}
                className="px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-emerald-900/70 hover:bg-emerald-800 text-emerald-100 border border-emerald-700 flex items-center gap-1.5 cursor-pointer"
                title={`مسجل الدخول: ${firebaseUser.email || firebaseUser.displayName}`}
              >
                <LogOut className="w-3.5 h-3.5 text-[#D5B65D]" />
                <span>{firebaseUser.displayName || firebaseUser.email?.split("@")[0]}</span>
              </button>
            ) : (
              <button
                onClick={handleGoogleSignIn}
                className="px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-emerald-900/70 hover:bg-emerald-800 text-emerald-100 border border-emerald-700 flex items-center gap-1.5 cursor-pointer"
                title="تسجيل الدخول بحساب Google المعتمد"
              >
                <LogIn className="w-3.5 h-3.5 text-[#D5B65D]" />
                <span>{lang === "en" ? "Sign In" : "حساب Google"}</span>
              </button>
            )}

            <a
              href="/api/studio/download-demo"
              download="uni-erp-v12-demo.html"
              className="px-3 py-1.5 rounded-lg text-xs font-bold bg-emerald-500 hover:bg-emerald-400 text-[#042f28] flex items-center gap-1.5 transition-all shadow cursor-pointer"
            >
              <Download className="w-3.5 h-3.5" />
              <span>{t("quickDemoBtn")}</span>
            </a>

            <button
              onClick={() => iframeRef.current?.contentWindow?.location.reload()}
              title={t("reloadSystemTitle")}
              className="p-1.5 rounded-lg bg-emerald-900/60 hover:bg-emerald-800 text-emerald-200 border border-emerald-700/60 cursor-pointer"
            >
              <RefreshCw className="w-3.5 h-3.5" />
            </button>

            <button
              onClick={() => setIsBarCollapsed(true)}
              title={t("hideToolbarTitle")}
              className="px-2 py-1.5 rounded-lg text-[11px] bg-emerald-950/80 hover:bg-emerald-900 text-emerald-200 border border-emerald-700/60 cursor-pointer"
            >
              {t("hideToolbarBtn")}
            </button>
          </div>
        </div>

        {/* شريط الانتقال السريع للمراحل الأربعة وشؤون الموظفين */}
        <div className="flex flex-wrap items-center gap-1.5 border-t border-emerald-800/60 pt-1.5">
          {PHASE_MODULES.map((group, idx) => (
            <div
              key={idx}
              className="flex items-center gap-1 bg-[#04332c] px-2 py-1 rounded-md border border-emerald-800/60 shrink-0"
            >
              <span className="text-[10px] font-bold text-[#D5B65D] mx-1">{t(group.phaseKey)}:</span>
              {group.items.map((item, itemIdx) => {
                const Icon = item.icon;
                const itemTab = (item as { tab?: string }).tab;
                const isAct = activeView === item.view && (!itemTab || itemIdx === 0);
                const itemLabel = t(item.labelKey);
                return (
                  <button
                    key={`${item.view}-${itemTab || itemIdx}`}
                    onClick={() => navigateModule(item.view, itemLabel, itemTab)}
                    className={`px-2 py-0.5 rounded text-[11px] font-medium flex items-center gap-1 transition-all cursor-pointer ${
                      isAct
                        ? "bg-[#D5B65D] text-[#042f28] font-bold"
                        : "bg-emerald-950/70 hover:bg-emerald-800/80 text-emerald-100"
                    }`}
                  >
                    <Icon className="w-3 h-3" />
                    <span className="font-mono text-[10px] opacity-85">{item.code}</span>
                    <span>{itemLabel}</span>
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </header>
      )}

      {/* زر عائم صغير لإظهار شريط المطور عند إخفائه */}
      {isBarCollapsed && (
        <button
          onClick={() => setIsBarCollapsed(false)}
          className="fixed top-2 left-3 z-50 px-3 py-1 rounded-full bg-[#054239]/90 hover:bg-[#054239] text-[#D5B65D] border border-[#D5B65D]/60 text-[11px] font-bold shadow-lg cursor-pointer"
        >
          {t("showToolbarBtn")}
        </button>
      )}

      {/* مساحة العمل الحية لمنظومة Uni-ERP v12 */}
      <main className="flex-1 relative bg-[#f5f6f4]">
        <iframe
          ref={iframeRef}
          src={`/erp?lang=${lang}&v=12.9.7`}
          onLoad={handleIframeLoad}
          title="منظومة Uni-ERP v12"
          className="w-full h-full border-0"
        />

        {/* إشعار عائم */}
        {toast && (
          <div className="fixed bottom-5 left-5 z-50 bg-[#054239] text-white border border-[#D5B65D] px-4 py-2.5 rounded-xl shadow-2xl flex items-center gap-2 text-xs font-medium">
            <Sparkles className="w-4 h-4 text-[#D5B65D]" />
            <span>{toast}</span>
          </div>
        )}
      </main>

      {/* نافذة فحص وتعديل الكود المصدري المباشر للمشروع */}
      {isCodeOpen && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-emerald-700/60 rounded-2xl w-full max-w-6xl h-[86vh] flex flex-col overflow-hidden shadow-2xl">
            <div className="bg-[#054239] px-5 py-3.5 border-b border-emerald-800 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <FileCode className="w-5 h-5 text-[#D5B65D]" />
                <div>
                  <h2 className="font-bold text-sm text-white">
                    {t("codeStudioTitle")}
                  </h2>
                  <p className="text-[11px] text-emerald-200">
                    {t("codeStudioSub")}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={simulateStudioError}
                  disabled={isSimulatingError}
                  title={t("simulateErrorTitle")}
                  className="px-2.5 py-1.5 rounded-lg bg-red-950/80 hover:bg-red-900 text-red-200 border border-red-700/70 text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
                >
                  <AlertTriangle className="w-3.5 h-3.5 text-red-400" />
                  <span>{isSimulatingError ? t("simulatingErrorBtn") : t("simulateErrorBtn")}</span>
                </button>

                <button
                  onClick={() => setIsLogDrawerOpen(!isLogDrawerOpen)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer border ${
                    studioLogs.length > 0
                      ? "bg-red-900/60 text-red-100 border-red-500 shadow-sm shadow-red-500/20"
                      : "bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-700"
                  }`}
                  title={t("devopsLogTitle")}
                >
                  <Bug className="w-3.5 h-3.5 text-[#D5B65D]" />
                  <span>{t("devopsLogBtn")}</span>
                  {studioLogs.length > 0 && (
                    <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-red-600 text-white font-bold animate-pulse">
                      {studioLogs.length}
                    </span>
                  )}
                </button>

                <button
                  onClick={handleSaveFile}
                  disabled={isSaving}
                  title={t("saveTitle")}
                  className="px-3.5 py-1.5 rounded-lg bg-[#D5B65D] hover:bg-[#e2c670] text-[#042f28] font-bold text-xs flex items-center gap-1.5 cursor-pointer shadow"
                >
                  <Save className="w-3.5 h-3.5" />
                  <span>{isSaving ? t("savingBtn") : t("saveApplyBtn")}</span>
                  <span className="text-[9px] bg-[#042f28]/20 px-1 py-0.2 rounded font-mono">Ctrl+S</span>
                </button>
                <button
                  onClick={() => setIsCodeOpen(false)}
                  title={t("closeTitle")}
                  className="p-1.5 rounded-lg bg-emerald-950 hover:bg-emerald-800 text-emerald-200 cursor-pointer flex items-center gap-1"
                >
                  <X className="w-4 h-4" />
                  <span className="text-[9px] font-mono text-emerald-400">Esc</span>
                </button>
              </div>
            </div>

            {/* درج سجل الأخطاء والربط التلقائي مع DevOps */}
            {isLogDrawerOpen && (
              <div className="bg-slate-950 border-b border-red-900/50 p-3 max-h-72 overflow-y-auto shrink-0 space-y-2.5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="flex h-2.5 w-2.5 relative">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                      <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500"></span>
                    </span>
                    <strong className="text-xs text-white">
                      {t("incidentBannerTitle")}
                    </strong>
                    <span className="text-[10px] bg-emerald-900/80 text-emerald-300 border border-emerald-700/60 px-2 py-0.5 rounded">
                      {t("incidentStatusActive")}
                    </span>
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => {
                        navigateModule("devops", t("mod_devops"));
                        setIsCodeOpen(false);
                      }}
                      className="px-2.5 py-1 rounded bg-[#D5B65D] hover:bg-[#e2c670] text-[#042f28] text-[11px] font-bold flex items-center gap-1 cursor-pointer"
                    >
                      <ExternalLink className="w-3 h-3" />
                      <span>{t("openDevopsUnitBtn")}</span>
                    </button>
                    {studioLogs.length > 0 && (
                      <button
                        onClick={() => setStudioLogs([])}
                        className="text-[11px] text-slate-400 hover:text-slate-200 px-2 py-1 cursor-pointer"
                      >
                        {t("clearLocalLogBtn")}
                      </button>
                    )}
                  </div>
                </div>

                {studioLogs.length === 0 ? (
                  <div className="py-4 text-center text-xs text-slate-400 bg-slate-900/60 rounded-lg border border-slate-800">
                    {t("noErrorsMsg")}
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    {studioLogs.map((log) => {
                      const isCrit = log.severity === "critical";
                      return (
                        <div
                          key={log.id}
                          className={`p-2.5 rounded-lg border text-xs flex flex-wrap items-center justify-between gap-2 ${
                            isCrit
                              ? "bg-red-950/40 border-red-800/70 text-red-200"
                              : "bg-amber-950/30 border-amber-800/60 text-amber-200"
                          }`}
                        >
                          <div className="flex items-center gap-2">
                            <span className="font-mono font-bold text-[11px] text-[#D5B65D] bg-black/40 px-1.5 py-0.5 rounded">
                              {log.reportCode}
                            </span>
                            <span className="text-[10px] text-slate-400">{log.timeFormatted}</span>
                            <span className="font-semibold text-white">[{log.operation}]</span>
                            <span className="font-mono text-[11px] text-slate-300 dir-ltr">
                              {log.filePath}
                            </span>
                          </div>

                          <div className="flex items-center gap-2">
                            <span className="text-[11px] line-clamp-1 max-w-sm text-slate-300">
                              {log.errorMessage}
                            </span>
                            <span
                              className={`text-[10px] px-2 py-0.5 rounded font-bold ${
                                log.sentToDevOps
                                  ? "bg-emerald-900/90 text-emerald-200 border border-emerald-600/50"
                                  : "bg-red-900/90 text-red-200 border border-red-600/50"
                              }`}
                            >
                              {log.sentToDevOps ? t("sentToDevopsBadge") : t("failedSendBadge")}
                            </span>
                            <button
                              onClick={() => setSelectedLogDetail(log)}
                              className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-white text-[11px] cursor-pointer"
                            >
                              {t("detailsBtn")}
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            <div className="flex-1 flex overflow-hidden">
              {/* قائمة الملفات */}
              <aside className="w-72 bg-slate-950 border-l border-slate-800 p-3 overflow-y-auto space-y-2">
                <div className="text-[11px] font-bold text-emerald-400 px-1 py-0.5 flex items-center justify-between">
                  <span>{t("devFilesHeader")}</span>
                  <span className="text-[10px] text-slate-500 font-mono">{filteredFiles.length}/{files.length}</span>
                </div>

                {/* شريط البحث */}
                <div className="relative">
                  <Search className="w-3.5 h-3.5 text-slate-400 absolute right-2.5 top-2.5 pointer-events-none" />
                  <input
                    ref={searchInputRef}
                    type="text"
                    value={fileSearchQuery}
                    onChange={(e) => setFileSearchQuery(e.target.value)}
                    placeholder={t("searchPlaceholder")}
                    className="w-full bg-slate-900 border border-slate-800 rounded-lg pr-8 pl-12 py-1.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-emerald-500 transition-all"
                  />
                  <span className="absolute left-2 top-2 text-[9px] font-mono font-semibold bg-slate-800 text-slate-400 border border-slate-700 px-1 rounded pointer-events-none">
                    Ctrl+F
                  </span>
                  {fileSearchQuery && (
                    <button
                      onClick={() => setFileSearchQuery("")}
                      className="absolute left-10 top-2 text-slate-400 hover:text-white text-xs cursor-pointer"
                    >
                      ✕
                    </button>
                  )}
                </div>

                {filteredFiles.length === 0 ? (
                  <div className="py-6 text-center text-xs text-slate-500">
                    {t("noMatchingFiles")}
                  </div>
                ) : (
                  filteredFiles.map((f) => (
                    <button
                      key={f.path}
                      onClick={() => handleSelectFile(f)}
                      className={`w-full text-right px-3 py-2.5 rounded-lg text-xs transition-all cursor-pointer flex flex-col gap-0.5 ${
                        selectedFilePath === f.path
                          ? "bg-emerald-900/60 border border-[#D5B65D]/60 text-white"
                          : "hover:bg-slate-900 text-slate-300 border border-transparent"
                      }`}
                    >
                      <span className="font-mono text-[11px] text-[#D5B65D] dir-ltr text-left">
                        {f.path}
                      </span>
                      <span className="text-[11px] text-slate-300 line-clamp-1">{f.label}</span>
                    </button>
                  ))
                )}
              </aside>

              {/* محرر النص البرمجي */}
              <div className="flex-1 flex flex-col bg-[#0b1120]">
                <div className="px-4 py-2 bg-slate-900/90 border-b border-slate-800 flex items-center justify-between text-xs text-slate-400 font-mono" dir="ltr">
                  <span>/uni-erp/{selectedFilePath}</span>
                  <span>{editedContent.split("\n").length} lines</span>
                </div>
                <textarea
                  dir="ltr"
                  value={editedContent}
                  onChange={(e) => setEditedContent(e.target.value)}
                  spellCheck={false}
                  className="flex-1 w-full p-4 bg-[#0b1120] text-emerald-100 font-mono text-xs leading-relaxed focus:outline-none resize-none overflow-auto select-text"
                />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* مودال فحص تفاصيل بلاغ الخطأ التشخيصي المرسل لوحدة DevOps */}
      {selectedLogDetail && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-red-700/70 rounded-2xl w-full max-w-2xl max-h-[85vh] flex flex-col overflow-hidden shadow-2xl">
            <div className="bg-[#054239] px-5 py-3 border-b border-emerald-800 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <AlertCircle className="w-5 h-5 text-red-400" />
                <div>
                  <h3 className="font-bold text-sm text-white">
                    {t("diagReportTitle")} {selectedLogDetail.reportCode}
                  </h3>
                  <span className="text-[10px] text-emerald-300">{selectedLogDetail.timeFormatted}</span>
                </div>
              </div>
              <button
                onClick={() => setSelectedLogDetail(null)}
                className="p-1 rounded bg-emerald-950 hover:bg-emerald-800 text-emerald-200 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-4 space-y-3 overflow-y-auto text-xs text-slate-200" dir={dir}>
              <div className="grid grid-cols-2 gap-2 bg-slate-950 p-3 rounded-lg border border-slate-800">
                <div><b>{t("opTypeLabel")}</b> <code className="text-[#D5B65D] font-mono">{selectedLogDetail.operation}</code></div>
                <div><b>{t("severityLabel")}</b> <span className="text-red-400 font-bold">{selectedLogDetail.severity}</span></div>
                <div><b>{t("affectedFileLabel")}</b> <code className="text-emerald-300 font-mono">{selectedLogDetail.filePath}</code></div>
                <div><b>{t("devopsStatusLabel")}</b> <span className="text-emerald-400 font-bold">{selectedLogDetail.statusText}</span></div>
              </div>

              <div>
                <b className="text-red-400">{t("errorMessageLabel")}</b>
                <div className="p-2.5 mt-1 bg-red-950/60 border border-red-800/60 rounded-lg text-red-100 font-mono text-xs">
                  {selectedLogDetail.errorMessage}
                </div>
              </div>

              {selectedLogDetail.errorDetails && (
                <div>
                  <b>{t("stackTraceLabel")}</b>
                  <pre className="p-3 mt-1 bg-slate-950 border border-slate-800 rounded-lg font-mono text-[11px] text-slate-300 max-h-48 overflow-auto whitespace-pre-wrap" dir="ltr">
                    {selectedLogDetail.errorDetails}
                  </pre>
                </div>
              )}

              {selectedLogDetail.clientContext && (
                <div>
                  <b>{t("clientContextLabel")}</b>
                  <pre className="p-3 mt-1 bg-slate-950 border border-slate-800 rounded-lg font-mono text-[11px] text-slate-400 max-h-32 overflow-auto" dir="ltr">
                    {JSON.stringify(selectedLogDetail.clientContext, null, 2)}
                  </pre>
                </div>
              )}

              <div className="flex items-center justify-between pt-2 border-t border-slate-800">
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(JSON.stringify(selectedLogDetail, null, 2));
                    showToast(t("toastCopiedJson"));
                  }}
                  className="px-3 py-1.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold flex items-center gap-1.5 cursor-pointer"
                >
                  <Copy className="w-3.5 h-3.5" />
                  <span>{t("copyJsonBtn")}</span>
                </button>

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => {
                      setAnalyticsTabDefault("devops");
                      setIsDevOpsAnalyticsOpen(true);
                    }}
                    className="px-3 py-1.5 rounded bg-blue-900/60 hover:bg-blue-800 text-blue-200 text-xs font-semibold flex items-center gap-1.5 cursor-pointer border border-blue-700/60"
                  >
                    <BarChart3 className="w-3.5 h-3.5 text-blue-400" />
                    <span>{t("rechartsChartsBtn")}</span>
                  </button>

                  <button
                    onClick={() => {
                      navigateModule("devops", t("mod_devops"));
                      setSelectedLogDetail(null);
                      setIsCodeOpen(false);
                    }}
                    className="px-3.5 py-1.5 rounded bg-[#D5B65D] hover:bg-[#e2c670] text-[#042f28] text-xs font-bold flex items-center gap-1.5 cursor-pointer"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                    <span>{t("goToDevopsBtn")}</span>
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* لوحة تحليلات Recharts المتطورة لإحصائيات DevOps وكافة الأقسام */}
      {isDevOpsAnalyticsOpen && (
        <DevOpsAnalyticsDashboard
          lang={lang}
          activeRole={erpUser?.role || "admin"}
          activeTabDefault={analyticsTabDefault}
          onSimulateError={simulateStudioError}
          refreshTrigger={analyticsRefreshKey}
          onClose={() => setIsDevOpsAnalyticsOpen(false)}
        />
      )}

      {/* نافذة تدقيق الارتباطات والأنظمة وسجل التغييرات وجرد ملفات المشروع */}
      {isChangelogOpen && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-emerald-700/70 rounded-2xl w-full max-w-6xl h-[86vh] flex flex-col overflow-hidden shadow-2xl">
            <div className="bg-[#054239] px-5 py-3.5 border-b border-emerald-800 flex items-center justify-between flex-wrap gap-2">
              <div className="flex items-center gap-2.5">
                <Link2 className="w-5 h-5 text-[#D5B65D]" />
                <div>
                  <h2 className="font-bold text-sm text-white">
                    {lang === "en"
                      ? "Argon CodeStudio — Relational Systems Audit, Changelog & Project Files"
                      : "مركز تدقيق الارتباطات المرجعية للأنظمة، سجل التغييرات، وجرد الملفات"}
                  </h2>
                  <p className="text-[11px] text-emerald-200">
                    {lang === "en"
                      ? `Audited Tables: ${relationalAudit?.summary.totalTablesRegistered || 184} · Verified Relations: ${relationalAudit?.summary.totalForeignKeysVerified || 140} · Project Files: ${inventoryData.totalFiles}`
                      : `إجمالي الجداول المترابطة: ${relationalAudit?.summary.totalTablesRegistered || 184} جدولاً · الروابط المرجعية المدققة: ${relationalAudit?.summary.totalForeignKeysVerified || 140} ارتباطاً · ملفات المشروع: ${inventoryData.totalFiles} ملفاً`}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    setChangelogTab("relations");
                    void loadRelationalAudit();
                  }}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold cursor-pointer ${
                    changelogTab === "relations"
                      ? "bg-[#D5B65D] text-[#042f28]"
                      : "bg-emerald-950/70 text-emerald-100 hover:bg-emerald-800"
                  }`}
                >
                  {lang === "en"
                    ? "Systems & Relations Audit"
                    : "تدقيق الارتباطات والأنظمة"}
                </button>
                <button
                  onClick={() => setChangelogTab("changelog")}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold cursor-pointer ${
                    changelogTab === "changelog"
                      ? "bg-[#D5B65D] text-[#042f28]"
                      : "bg-emerald-950/70 text-emerald-100 hover:bg-emerald-800"
                  }`}
                >
                  {lang === "en" ? `Changelog (${changelogEntries.length})` : `سجل التغييرات (${changelogEntries.length})`}
                </button>
                <button
                  onClick={() => setChangelogTab("inventory")}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold cursor-pointer ${
                    changelogTab === "inventory"
                      ? "bg-[#D5B65D] text-[#042f28]"
                      : "bg-emerald-950/70 text-emerald-100 hover:bg-emerald-800"
                  }`}
                >
                  {lang === "en"
                    ? `All Project Files (${inventoryData.totalFiles})`
                    : `جرد كافة ملفات المشروع (${inventoryData.totalFiles})`}
                </button>
                <button
                  onClick={() => setIsChangelogOpen(false)}
                  className="p-1.5 rounded-lg bg-emerald-950 hover:bg-emerald-800 text-emerald-200 cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            {changelogTab === "relations" ? (
              <div className="flex-1 overflow-y-auto p-5 space-y-5" dir={dir}>
                {/* شريط الملخص والمزامنة الفورية */}
                <div className="bg-slate-950 border border-emerald-800/70 rounded-xl p-4 flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-bold text-white flex items-center gap-2">
                      <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                      <span>تكامل الارتباطات المرجعية بين الكليات، البرامج الأكاديمية، الطلاب، الموارد البشرية، والمالية</span>
                    </h3>
                    <p className="text-xs text-slate-300 mt-1">
                      جميع الحسابات، الملفات الأكاديمية، طلبات شؤون الطلاب، عقود الموظفين، الحضور، السلف، والقيود المحاسبية مرتبطة بمفاتيح مرجعية مدققة.
                    </p>
                  </div>
                  <button
                    onClick={handleSyncRelations}
                    disabled={isSyncingRelations}
                    data-testid="sync-relations-btn"
                    className="px-4 py-2 rounded-lg bg-[#D5B65D] hover:bg-[#e2c670] text-[#042f28] text-xs font-extrabold flex items-center gap-2 cursor-pointer shadow"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${isSyncingRelations ? "animate-spin" : ""}`} />
                    <span>{isSyncingRelations ? "جارٍ التدقيق والمزامنة..." : "تحديث وتدقيق كافة الارتباطات الآن"}</span>
                  </button>
                </div>

                {/* بطاقات المؤشرات المرجعية */}
                {relationalAudit && (
                  <div className="grid grid-cols-2 md:grid-cols-6 gap-2.5">
                    <div className="bg-slate-950 border border-emerald-900/70 rounded-xl p-3">
                      <div className="text-[11px] text-slate-400">إجمالي جداول المنظومة</div>
                      <div className="text-lg font-extrabold text-[#D5B65D] font-mono mt-0.5">
                        {relationalAudit.summary.totalTablesRegistered}
                      </div>
                      <div className="text-[10px] text-emerald-300">كافة الأنظمة الفرعية</div>
                    </div>
                    <div className="bg-slate-950 border border-emerald-900/70 rounded-xl p-3">
                      <div className="text-[11px] text-slate-400">الروابط المرجعية المدققة</div>
                      <div className="text-lg font-extrabold text-emerald-400 font-mono mt-0.5">
                        {relationalAudit.summary.totalForeignKeysVerified}
                      </div>
                      <div className="text-[10px] text-emerald-300">علاقة مرجعية سليمة 100%</div>
                    </div>
                    <div className="bg-slate-950 border border-emerald-900/70 rounded-xl p-3">
                      <div className="text-[11px] text-slate-400">الوحدات التنظيمية والبرامج</div>
                      <div className="text-lg font-extrabold text-white font-mono mt-0.5">
                        {relationalAudit.summary.orgUnitsCount} / {relationalAudit.summary.programsCount}
                      </div>
                      <div className="text-[10px] text-emerald-300">وحدة تنظيمية / برنامج أكاديمي</div>
                    </div>
                    <div className="bg-slate-950 border border-emerald-900/70 rounded-xl p-3">
                      <div className="text-[11px] text-slate-400">الحسابات وملفات الطلاب</div>
                      <div className="text-lg font-extrabold text-white font-mono mt-0.5">
                        {relationalAudit.summary.accountsCount} / {relationalAudit.summary.studentProfilesCount}
                      </div>
                      <div className="text-[10px] text-emerald-300">حساب موثق / ملف طالب</div>
                    </div>
                    <div className="bg-slate-950 border border-emerald-900/70 rounded-xl p-3">
                      <div className="text-[11px] text-slate-400">الموظفون والعقود والسلف</div>
                      <div className="text-lg font-extrabold text-white font-mono mt-0.5">
                        {relationalAudit.summary.hrEmployeesCount} / {relationalAudit.summary.hrContractsCount}
                      </div>
                      <div className="text-[10px] text-emerald-300">موظف مرتبط / عقد عمل</div>
                    </div>
                    <div className="bg-slate-950 border border-emerald-900/70 rounded-xl p-3">
                      <div className="text-[11px] text-slate-400">دليل الحسابات والقيود</div>
                      <div className="text-lg font-extrabold text-white font-mono mt-0.5">
                        {relationalAudit.summary.finAccountsCount} / {relationalAudit.summary.finEntriesCount}
                      </div>
                      <div className="text-[10px] text-emerald-300">حساب مالي / قيد يومية</div>
                    </div>
                  </div>
                )}

                {/* 1. توزيع الأنظمة الفرعية والروابط المرجعية */}
                {relationalAudit && (
                  <div className="bg-slate-950 border border-slate-800 rounded-xl overflow-hidden">
                    <div className="bg-slate-900 px-4 py-2.5 border-b border-slate-800 font-bold text-xs text-[#D5B65D]">
                      1. توزيع الأنظمة الجامعية الفرعية وتدقيق الروابط المرجعية (Foreign Keys)
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs border-collapse">
                        <thead className="bg-slate-900/60 text-slate-300">
                          <tr>
                            <th className="p-2.5 text-right border-b border-slate-800">النظام الفرعي / النطاق</th>
                            <th className="p-2.5 text-center border-b border-slate-800">عدد الجداول</th>
                            <th className="p-2.5 text-center border-b border-slate-800">إجمالي الحقول</th>
                            <th className="p-2.5 text-center border-b border-slate-800">المفاتيح المرجعية المرتبطة</th>
                            <th className="p-2.5 text-center border-b border-slate-800">السجلات الحية</th>
                          </tr>
                        </thead>
                        <tbody>
                          {relationalAudit.domainBreakdown.map((d) => (
                            <tr key={d.domain} className="border-b border-slate-900 hover:bg-slate-900/50">
                              <td className="p-2.5 font-semibold text-white">{d.domain}</td>
                              <td className="p-2.5 text-center font-mono text-[#D5B65D]">{d.tablesCount}</td>
                              <td className="p-2.5 text-center font-mono text-slate-300">{d.totalColumns}</td>
                              <td className="p-2.5 text-center font-mono text-emerald-400 font-bold">{d.totalForeignKeys}</td>
                              <td className="p-2.5 text-center font-mono text-white">{d.totalRows}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* 2. ارتباطات الكليات والبرامج الأكاديمية والطلاب */}
                {relationalAudit && (
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                    <div className="bg-slate-950 border border-slate-800 rounded-xl overflow-hidden">
                      <div className="bg-slate-900 px-4 py-2.5 border-b border-slate-800 font-bold text-xs text-[#D5B65D]">
                        2. ارتباطات البرامج الأكاديمية بالهيكل التنظيمي وحسابات الطلاب
                      </div>
                      <div className="overflow-x-auto max-h-64">
                        <table className="w-full text-xs border-collapse">
                          <thead className="bg-slate-900/60 text-slate-300 sticky top-0">
                            <tr>
                              <th className="p-2 text-right border-b border-slate-800">البرنامج الأكاديمي</th>
                              <th className="p-2 text-right border-b border-slate-800">الكلية / الوحدة المرتبطة</th>
                              <th className="p-2 text-center border-b border-slate-800">السنوات</th>
                              <th className="p-2 text-center border-b border-slate-800">الطلاب المرتبطون</th>
                            </tr>
                          </thead>
                          <tbody>
                            {relationalAudit.linkedPrograms.map((prog) => (
                              <tr key={prog.id} className="border-b border-slate-900 hover:bg-slate-900/50">
                                <td className="p-2 font-bold text-white">{prog.name}</td>
                                <td className="p-2 text-emerald-300">{prog.faculty}</td>
                                <td className="p-2 text-center font-mono text-slate-300">{prog.years}</td>
                                <td className="p-2 text-center font-mono text-[#D5B65D] font-bold">
                                  {prog.studentsCount} ({prog.accountsCount} حساب)
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>

                    <div className="bg-slate-950 border border-slate-800 rounded-xl overflow-hidden">
                      <div className="bg-slate-900 px-4 py-2.5 border-b border-slate-800 font-bold text-xs text-[#D5B65D]">
                        3. ارتباطات ملفات الطلاب بالبرامج الأكاديمية وطلبات شؤون الطلاب
                      </div>
                      <div className="overflow-x-auto max-h-64">
                        <table className="w-full text-xs border-collapse">
                          <thead className="bg-slate-900/60 text-slate-300 sticky top-0">
                            <tr>
                              <th className="p-2 text-right border-b border-slate-800">الطالب</th>
                              <th className="p-2 text-center border-b border-slate-800">الرقم الجامعي</th>
                              <th className="p-2 text-right border-b border-slate-800">البرنامج والكلية</th>
                              <th className="p-2 text-center border-b border-slate-800">الطلبات المرتبطة</th>
                            </tr>
                          </thead>
                          <tbody>
                            {relationalAudit.linkedStudents.map((stu) => (
                              <tr key={stu.userId} className="border-b border-slate-900 hover:bg-slate-900/50">
                                <td className="p-2 font-bold text-white">{stu.fullName}</td>
                                <td className="p-2 text-center font-mono text-[#D5B65D]">{stu.studentNo}</td>
                                <td className="p-2 text-emerald-300">{stu.programName}</td>
                                <td className="p-2 text-center font-mono text-white">{stu.requestsCount}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>
                )}

                {/* 4. ارتباطات منظومة الموارد البشرية والرواتب بالوحدات التنظيمية والعقود والحضور والسلف */}
                {relationalAudit && (
                  <div className="bg-slate-950 border border-slate-800 rounded-xl overflow-hidden">
                    <div className="bg-slate-900 px-4 py-2.5 border-b border-slate-800 font-bold text-xs text-[#D5B65D]">
                      4. ارتباطات منظومة الموارد البشرية (الموظف ← القسم التنظيمي ← العقد ← سجل الحضور ← السلف)
                    </div>
                    <div className="overflow-x-auto max-h-72">
                      <table className="w-full text-xs border-collapse">
                        <thead className="bg-slate-900/60 text-slate-300 sticky top-0">
                          <tr>
                            <th className="p-2 text-center border-b border-slate-800">#</th>
                            <th className="p-2 text-right border-b border-slate-800">اسم الموظف</th>
                            <th className="p-2 text-right border-b border-slate-800">الوحدة التنظيمية المرتبطة</th>
                            <th className="p-2 text-right border-b border-slate-800">المسمى الوظيفي</th>
                            <th className="p-2 text-center border-b border-slate-800">نوع العقد</th>
                            <th className="p-2 text-center border-b border-slate-800">الراتب + البدلات</th>
                            <th className="p-2 text-center border-b border-slate-800">الالتزام بالحضور</th>
                            <th className="p-2 text-center border-b border-slate-800">رصيد السلف المرتبطة</th>
                          </tr>
                        </thead>
                        <tbody>
                          {relationalAudit.linkedEmployees.map((emp) => (
                            <tr key={emp.id} className="border-b border-slate-900 hover:bg-slate-900/50">
                              <td className="p-2 text-center font-mono text-slate-400">{emp.employeeNo}</td>
                              <td className="p-2 font-bold text-white">{emp.name}</td>
                              <td className="p-2 text-emerald-300">{emp.orgUnitName}</td>
                              <td className="p-2 text-slate-300">{emp.position}</td>
                              <td className="p-2 text-center text-[#D5B65D] font-semibold">{emp.contractTypeLabel}</td>
                              <td className="p-2 text-center font-mono text-white">
                                {(emp.salaryBase + emp.totalAllowances).toLocaleString()}
                              </td>
                              <td className="p-2 text-center font-mono text-emerald-400 font-bold">
                                {emp.commitmentRate}%
                              </td>
                              <td className="p-2 text-center font-mono text-amber-300">
                                {emp.remainingAdvanceAmount > 0
                                  ? `${emp.remainingAdvanceAmount.toLocaleString()} (${emp.activeAdvancesCount} سلفة)`
                                  : "لا يوجد"}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            ) : changelogTab === "changelog" ? (
              <div className="flex-1 overflow-y-auto p-5 space-y-3" dir={dir}>
                {changelogEntries.map((entry) => (
                  <div
                    key={entry.id}
                    className="bg-slate-950/90 border border-emerald-900/60 rounded-xl p-4 flex flex-col gap-2 hover:border-[#D5B65D]/50 transition-all"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="px-2 py-0.5 rounded bg-[#D5B65D] text-[#042f28] font-mono text-xs font-extrabold">
                          {entry.version}
                        </span>
                        <span
                          className={`px-2 py-0.5 rounded text-[11px] font-bold ${
                            entry.category === "code_save"
                              ? "bg-emerald-900/70 text-emerald-300 border border-emerald-700"
                              : entry.category === "feature"
                                ? "bg-blue-900/70 text-blue-300 border border-blue-700"
                                : "bg-amber-900/70 text-amber-300 border border-amber-700"
                          }`}
                        >
                          {entry.category === "code_save"
                            ? "حفظ ملف مصدري"
                            : entry.category === "feature"
                              ? "ميزة جديدة"
                              : "تحسين ومعالجة"}
                        </span>
                        <h3 className="font-bold text-sm text-white">{entry.title}</h3>
                      </div>
                      <span className="text-[11px] text-slate-400 font-mono">
                        {new Date(entry.timestamp).toLocaleString(lang === "en" ? "en-US" : "ar-SY")}
                      </span>
                    </div>
                    <p className="text-xs text-slate-300 leading-relaxed">{entry.description}</p>
                    <div className="flex flex-wrap items-center gap-4 text-[11px] text-emerald-300/90 pt-1">
                      <span>👤 {entry.author}</span>
                      {entry.filePath && (
                        <span className="font-mono bg-slate-900 px-2 py-0.5 rounded border border-slate-800" dir="ltr">
                          📄 {entry.filePath}
                        </span>
                      )}
                      {entry.sizeBytes !== undefined && (
                        <span className="font-mono">💾 {(entry.sizeBytes / 1024).toFixed(1)} KB</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex-1 flex flex-col overflow-hidden p-4 gap-3" dir={dir}>
                <div className="flex flex-wrap items-center justify-between gap-3 bg-slate-950 p-3 rounded-xl border border-emerald-800/60">
                  <div className="text-xs text-emerald-200 space-y-1">
                    <div className="font-bold text-white text-sm">
                      إجمالي الملفات الفعلية في المشروع: {inventoryData.totalFiles} ملفاً · الحجم الإجمالي:{" "}
                      {(inventoryData.totalBytes / 1048576).toFixed(2)} ميغابايت
                    </div>
                    <div>
                      يشمل مخططات ومستودعات قاعدة البيانات <code className="text-[#D5B65D] font-mono">src/db/schema.ts</code> + <code className="text-[#D5B65D] font-mono">uni-erp/data/uni-erp.db</code> + 30 ملف تهجير SQL + 37 واجهة أمامية + 35 خدمة خلفية.
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      type="search"
                      placeholder="ابحث عن أي ملف أو مجلد (مثل: src/db, migrations, payroll)..."
                      value={inventoryFilter}
                      onChange={(e) => setInventoryFilter(e.target.value)}
                      className="px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-xs text-white w-72 focus:outline-none focus:border-[#D5B65D]"
                    />
                  </div>
                </div>

                <div className="flex-1 overflow-y-auto border border-slate-800 rounded-xl bg-slate-950">
                  <table className="w-full text-xs text-left border-collapse" dir="ltr">
                    <thead className="bg-slate-900 text-slate-300 sticky top-0">
                      <tr>
                        <th className="p-2.5 border-b border-slate-800">#</th>
                        <th className="p-2.5 border-b border-slate-800">File Path (المسار الكامل في المشروع)</th>
                        <th className="p-2.5 border-b border-slate-800">Folder (المجلد)</th>
                        <th className="p-2.5 border-b border-slate-800">Size (الحجم)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {inventoryData.allItems
                        .filter(
                          (it) =>
                            !inventoryFilter ||
                            it.path.toLowerCase().includes(inventoryFilter.toLowerCase()) ||
                            it.folder.toLowerCase().includes(inventoryFilter.toLowerCase())
                        )
                        .map((it, i) => (
                          <tr key={it.path} className="border-b border-slate-900 hover:bg-slate-900/60">
                            <td className="p-2 text-slate-500 font-mono">{i + 1}</td>
                            <td className="p-2 text-emerald-300 font-mono font-medium">{it.path}</td>
                            <td className="p-2 text-slate-400 font-mono">{it.folder}</td>
                            <td className="p-2 text-[#D5B65D] font-mono">
                              {it.size >= 1024 * 1024
                                ? `${(it.size / 1048576).toFixed(2)} MB`
                                : `${(it.size / 1024).toFixed(1)} KB`}
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

    </div>
  );
}
