import React, { useState, useEffect, useCallback } from "react";
import {
  ResponsiveContainer,
  ComposedChart,
  AreaChart,
  Area,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from "recharts";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  RefreshCw,
  ShieldCheck,
  Zap,
  Building2,
  Lock,
  Crown,
  BarChart3,
  PieChart as PieChartIcon,
  TrendingUp,
  Server,
  FileWarning,
  ChevronUp,
} from "lucide-react";

import { StudioLang, getDirectionForLang, translateStudio } from "../utils/i18n";

interface DevOpsAnalyticsProps {
  lang?: StudioLang;
  activeRole: string;
  activeTabDefault?: "devops" | "departments";
  onSimulateError?: () => Promise<void>;
  refreshTrigger?: number;
  onClose?: () => void;
}

export const DevOpsAnalyticsDashboard: React.FC<DevOpsAnalyticsProps> = ({
  lang = "ar",
  activeRole,
  activeTabDefault = "devops",
  onSimulateError,
  refreshTrigger = 0,
  onClose,
}) => {
  const t = (key: string) => translateStudio(lang, key);
  const dir = getDirectionForLang(lang);
  const [activeTab, setActiveTab] = useState<"devops" | "departments">(activeTabDefault);
  const [devopsData, setDevopsData] = useState<any>(null);
  const [hrData, setHrData] = useState<any>(null);
  const [selectedDept, setSelectedDept] = useState<string>("all");
  const [simulatedMyDept, setSimulatedMyDept] = useState<string>("");
  const [loading, setLoading] = useState<boolean>(true);
  const [simulating, setSimulating] = useState<boolean>(false);

  useEffect(() => {
    setActiveTab(activeTabDefault);
  }, [activeTabDefault]);

  const fetchDashboardData = useCallback(async () => {
    setLoading(true);
    try {
      const qs = new URLSearchParams();
      if (selectedDept && selectedDept !== "all") qs.set("dept", selectedDept);
      if (simulatedMyDept) qs.set("myDept", simulatedMyDept);

      const [devRes, hrRes] = await Promise.all([
        fetch("/api/devops/incidents", { credentials: "include" }),
        fetch(`/api/hr-pro/overview?${qs.toString()}`, { credentials: "include" }),
      ]);

      if (devRes.ok) {
        const dJson = await devRes.json();
        setDevopsData(dJson);
      }
      if (hrRes.ok) {
        const hJson = await hrRes.json();
        setHrData(hJson);
      }
    } catch {
      // ignore transient errors
    } finally {
      setLoading(false);
    }
  }, [selectedDept, simulatedMyDept]);

  useEffect(() => {
    fetchDashboardData();
  }, [fetchDashboardData, refreshTrigger, activeRole]);

  const handleSimulateClick = async () => {
    if (!onSimulateError) return;
    setSimulating(true);
    try {
      await onSimulateError();
      await fetchDashboardData();
    } finally {
      setSimulating(false);
    }
  };

  const stats = devopsData?.stats || {
    total: 8,
    open: 1,
    critical: 1,
    totalCritical: 2,
    resolved: 7,
    deliverySuccessRate: 100,
    directDeliveryRate: 87.5,
    resolutionRate: 87.5,
    avgLatencyMs: 41,
    directCount: 7,
    fallbackCount: 1,
  };

  const timeSeries = devopsData?.timeSeries || [];
  const byOperation = devopsData?.byOperation || [];
  const bySeverity = devopsData?.bySeverity || [];
  const byFile = devopsData?.byFile || [];

  const deliveryPieData = [
    {
      name: lang === "en" ? "Direct API Delivery" : "إرسال فوري ناجح (Direct API)",
      value: stats.directCount || 7,
      color: "#10b981",
    },
    {
      name: lang === "en" ? "Fallback Delivery" : "إرسال عبر المسار الاحتياطي (Fallback)",
      value: stats.fallbackCount || 1,
      color: "#0ea5e9",
    },
    {
      name: lang === "en" ? "Failed Delivery" : "فشل إرسال نهائي",
      value: 0,
      color: "#ef4444",
    },
  ].filter((d) => d.value > 0);

  const statusPieData = [
    {
      name: lang === "en" ? "Resolved" : "تم الحل والمعالجة (Resolved)",
      value: stats.resolved || 7,
      color: "#10b981",
    },
    {
      name: lang === "en" ? "Open" : "قيد المعالجة (Open)",
      value: stats.open || 1,
      color: "#f43f5e",
    },
  ].filter((d) => d.value > 0);

  const accessScope = hrData?.accessScope || {
    isAdmin: activeRole === "admin",
    canViewAllDepartments: activeRole === "admin",
    role: activeRole,
    userName: activeRole === "admin" ? "مدير النظام" : "موظف القسم",
    assignedDepartment: activeRole === "admin" ? "كافة الأقسام والوحدات" : "خدمة العملاء",
    activeDepartmentFilter: activeRole === "admin" ? selectedDept : "خدمة العملاء",
    allDepartmentNames: [
      "الموارد البشرية",
      "الحسابات",
      "تقنية المعلومات",
      "الإدارة",
      "خدمة العملاء",
      "المشتريات",
      "التسويق",
      "المخازن",
      "التشغيل والإنتاج",
    ],
  };

  const deptBreakdown = hrData?.analytics?.departmentBreakdown || [];
  const leaveDist = hrData?.analytics?.leaveDistribution || [];
  const enterpriseModules = hrData?.analytics?.enterpriseModules || [];
  const hrKpis = hrData?.kpis || {};
  const PIE_COLORS = ["#10b981", "#3b82f6", "#f59e0b", "#ef4444", "#8b5cf6", "#ec4899"];

  return (
    <div
      dir={dir}
      className="bg-slate-950 text-slate-100 border-b border-emerald-800/60 shadow-2xl overflow-y-auto max-h-[540px]"
    >
      {/* الشريط العلوي للوحة Recharts */}
      <div className="sticky top-0 z-20 bg-[#042f28]/95 backdrop-blur border-b border-emerald-800/60 px-4 py-2.5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-[#D5B65D]/20 border border-[#D5B65D]/50 flex items-center justify-center text-[#D5B65D]">
            <BarChart3 className="w-4 h-4" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-sm font-extrabold text-white">
                {t("rcTitle")}
              </h2>
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-900/90 text-emerald-300 border border-emerald-700 font-bold">
                {t("rcBadge")}
              </span>
            </div>
            <p className="text-[11px] text-emerald-200/80">
              {t("rcSubtitle")}
            </p>
          </div>
        </div>

        {/* أزرار التبويب والتحكم */}
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => setActiveTab("devops")}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer ${
              activeTab === "devops"
                ? "bg-[#D5B65D] text-[#042f28] shadow"
                : "bg-emerald-950/90 text-emerald-200 hover:bg-emerald-900 border border-emerald-800"
            }`}
          >
            <Activity className="w-3.5 h-3.5" />
            <span>{t("rcTabDevops")}</span>
          </button>

          <button
            onClick={() => setActiveTab("departments")}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition-all cursor-pointer ${
              activeTab === "departments"
                ? "bg-[#D5B65D] text-[#042f28] shadow"
                : "bg-emerald-950/90 text-emerald-200 hover:bg-emerald-900 border border-emerald-800"
            }`}
          >
            <Building2 className="w-3.5 h-3.5" />
            <span>{t("rcTabDepts")}</span>
          </button>

          {onSimulateError && (
            <button
              onClick={handleSimulateClick}
              disabled={simulating}
              className="px-3 py-1.5 rounded-lg text-xs font-bold bg-amber-600/30 hover:bg-amber-600/50 text-amber-200 border border-amber-500/40 flex items-center gap-1.5 cursor-pointer transition-all"
            >
              <Zap className="w-3.5 h-3.5 text-amber-400" />
              <span>{simulating ? t("rcSimulatingBtn") : t("rcSimulateBtn")}</span>
            </button>
          )}

          <button
            onClick={fetchDashboardData}
            className="p-1.5 rounded-lg bg-emerald-900/70 hover:bg-emerald-800 text-emerald-200 border border-emerald-700 cursor-pointer"
            title={t("rcRefreshTitle")}
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} />
          </button>

          {onClose && (
            <button
              onClick={onClose}
              className="px-2.5 py-1 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-700 text-xs flex items-center gap-1 cursor-pointer"
            >
              <ChevronUp className="w-3.5 h-3.5" />
              <span>{t("rcCollapseBtn")}</span>
            </button>
          )}
        </div>
      </div>

      {/* محتوى التبويب الأول: لوحة بيانات أخطاء DevOps باستخدام Recharts */}
      {activeTab === "devops" && (
        <div className="p-4 space-y-4">
          {/* مؤشرات الأداء الأربعة (KPIs) */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-3 flex items-center justify-between">
              <div>
                <span className="text-[11px] text-slate-400 block">
                  {lang === "en" ? "Total Detected Errors" : "إجمالي الأخطاء المكتشفة"}
                </span>
                <strong className="text-2xl font-black text-white">{stats.total}</strong>
                <span className="text-[10px] text-red-400 block mt-0.5">
                  {lang === "en"
                    ? `Including ${stats.totalCritical || stats.critical} critical incidents`
                    : `منها ${stats.totalCritical || stats.critical} بلاغات حرجة`}
                </span>
              </div>
              <div className="w-10 h-10 rounded-xl bg-red-500/10 border border-red-500/30 flex items-center justify-center text-red-400">
                <FileWarning className="w-5 h-5" />
              </div>
            </div>

            <div className="bg-slate-900/90 border border-emerald-800/50 rounded-xl p-3 flex items-center justify-between">
              <div>
                <span className="text-[11px] text-slate-400 block">
                  {lang === "en" ? "Report Delivery Success Rate" : "نسبة النجاح في إرسال البلاغات"}
                </span>
                <strong className="text-2xl font-black text-emerald-400">
                  {stats.deliverySuccessRate}%
                </strong>
                <span className="text-[10px] text-emerald-300/80 block mt-0.5">
                  {lang === "en"
                    ? `${stats.directCount} direct · ${stats.fallbackCount} fallback`
                    : `${stats.directCount} مباشر · ${stats.fallbackCount} مسار احتياطي`}
                </span>
              </div>
              <div className="w-10 h-10 rounded-xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
                <ShieldCheck className="w-5 h-5" />
              </div>
            </div>

            <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-3 flex items-center justify-between">
              <div>
                <span className="text-[11px] text-slate-400 block">
                  {lang === "en" ? "Incident Resolution Rate" : "نسبة معالجة وحل الأخطاء"}
                </span>
                <strong className="text-2xl font-black text-sky-400">{stats.resolutionRate}%</strong>
                <span className="text-[10px] text-slate-400 block mt-0.5">
                  {lang === "en"
                    ? `Resolved ${stats.resolved} of ${stats.total} incidents`
                    : `تم حل ${stats.resolved} من أصل ${stats.total} بلاغاً`}
                </span>
              </div>
              <div className="w-10 h-10 rounded-xl bg-sky-500/10 border border-sky-500/30 flex items-center justify-center text-sky-400">
                <CheckCircle2 className="w-5 h-5" />
              </div>
            </div>

            <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-3 flex items-center justify-between">
              <div>
                <span className="text-[11px] text-slate-400 block">
                  {lang === "en" ? "Avg Report Latency" : "متوسط زمن إرسال البلاغ"}
                </span>
                <strong className="text-2xl font-black text-amber-400">
                  {stats.avgLatencyMs} <span className="text-xs font-normal">ms</span>
                </strong>
                <span className="text-[10px] text-amber-300/80 block mt-0.5">
                  {lang === "en" ? "Real-time DevOps link" : "اتصال لحظي مع وحدة DevOps"}
                </span>
              </div>
              <div className="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400">
                <Server className="w-5 h-5" />
              </div>
            </div>
          </div>

          {/* صف المخططات الرئيسي (Recharts) */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            {/* المخطط 1: تواتر الأخطاء بمرور الوقت (Recharts Composed / AreaChart) */}
            <div className="lg:col-span-2 bg-slate-900/90 border border-slate-800 rounded-xl p-3.5">
              <div className="flex items-center justify-between mb-2">
                <div>
                  <h3 className="text-xs font-bold text-white flex items-center gap-1.5">
                    <TrendingUp className="w-4 h-4 text-[#D5B65D]" />
                    <span>
                      {lang === "en"
                        ? "Error Frequency & Delivery Success Over Time"
                        : "تواتر الأخطاء المكتشفة ونسبة النجاح في إرسال البلاغات بمرور الوقت"}
                    </span>
                  </h3>
                  <p className="text-[11px] text-slate-400">
                    {lang === "en"
                      ? "Time-series chart showing total errors, critical incidents, and file save/load operations reported to DevOps"
                      : "رسم بياني زمني يوضح إجمالي الأخطاء، الأخطاء الحرجة، وعمليات الحفظ/التحميل المرسلة إلى DevOps"}
                  </p>
                </div>
                <span className="text-[10px] px-2 py-0.5 rounded bg-slate-800 text-slate-300 font-mono">
                  Recharts ComposedChart
                </span>
              </div>

              <div className="h-56 w-full" dir="ltr">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={timeSeries} margin={{ top: 10, right: 15, left: 0, bottom: 5 }}>
                    <defs>
                      <linearGradient id="colorTotalErr" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#10b981" stopOpacity={0.35} />
                        <stop offset="95%" stopColor="#10b981" stopOpacity={0.02} />
                      </linearGradient>
                      <linearGradient id="colorCritErr" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#ef4444" stopOpacity={0.45} />
                        <stop offset="95%" stopColor="#ef4444" stopOpacity={0.05} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                    <XAxis dataKey="label" stroke="#94a3b8" tick={{ fontSize: 11 }} />
                    <YAxis stroke="#94a3b8" tick={{ fontSize: 11 }} allowDecimals={false} />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: "#0f172a",
                        borderColor: "#334155",
                        borderRadius: "8px",
                        fontSize: "12px",
                        direction: lang === "en" ? "ltr" : "rtl",
                        textAlign: lang === "en" ? "left" : "right",
                      }}
                    />
                    <Legend wrapperStyle={{ fontSize: "11px", paddingTop: "6px" }} />
                    <Area
                      type="monotone"
                      dataKey="totalErrors"
                      name={lang === "en" ? "Total Detected Errors" : "إجمالي الأخطاء المكتشفة"}
                      stroke="#10b981"
                      strokeWidth={2}
                      fillOpacity={1}
                      fill="url(#colorTotalErr)"
                    />
                    <Area
                      type="monotone"
                      dataKey="criticalCount"
                      name={lang === "en" ? "Critical Errors" : "أخطاء حرجة (Critical)"}
                      stroke="#ef4444"
                      strokeWidth={2}
                      fillOpacity={1}
                      fill="url(#colorCritErr)"
                    />
                    <Bar
                      dataKey="saveFailures"
                      name={lang === "en" ? "File Save Failure (FILE_SAVE)" : "فشل حفظ ملف (FILE_SAVE)"}
                      fill="#f59e0b"
                      barSize={16}
                      radius={[4, 4, 0, 0]}
                    />
                    <Line
                      type="monotone"
                      dataKey="deliveredCount"
                      name={lang === "en" ? "Successfully Delivered Reports" : "البلاغات المرسلة بنجاح"}
                      stroke="#38bdf8"
                      strokeWidth={2}
                      dot={{ r: 3 }}
                    />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* المخطط 2: نسبة النجاح في إرسال البلاغات وحالة المعالجة (Recharts PieChart) */}
            <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-3.5 flex flex-col justify-between">
              <div>
                <h3 className="text-xs font-bold text-white flex items-center gap-1.5">
                  <PieChartIcon className="w-4 h-4 text-emerald-400" />
                  <span>
                    {lang === "en"
                      ? "Delivery Success & Resolution Status"
                      : "نسبة النجاح في إرسال البلاغات وحالة المعالجة"}
                  </span>
                </h3>
                <p className="text-[11px] text-slate-400">
                  {lang === "en"
                    ? `DevOps incident report delivery rate (${stats.deliverySuccessRate}%)`
                    : `معدل تسليم تقارير الأخطاء لوحدة DevOps (${stats.deliverySuccessRate}%)`}
                </p>
              </div>

              <div className="h-44 w-full" dir="ltr">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={deliveryPieData}
                      dataKey="value"
                      nameKey="name"
                      cx="50%"
                      cy="50%"
                      innerRadius={42}
                      outerRadius={68}
                      paddingAngle={4}
                    >
                      {deliveryPieData.map((entry, index) => (
                        <Cell key={`cell-${index}`} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip
                      contentStyle={{
                        backgroundColor: "#0f172a",
                        borderColor: "#334155",
                        borderRadius: "8px",
                        fontSize: "12px",
                      }}
                    />
                    <Legend wrapperStyle={{ fontSize: "10px" }} />
                  </PieChart>
                </ResponsiveContainer>
              </div>

              <div className="grid grid-cols-2 gap-2 pt-2 border-t border-slate-800 text-[11px]">
                <div className="bg-slate-950/70 p-2 rounded-lg border border-slate-800/80 flex items-center justify-between">
                  <span className="text-slate-400">
                    {lang === "en" ? "Direct Delivery:" : "إرسال مباشر:"}
                  </span>
                  <strong className="text-emerald-400 font-mono">{stats.directDeliveryRate}%</strong>
                </div>
                <div className="bg-slate-950/70 p-2 rounded-lg border border-slate-800/80 flex items-center justify-between">
                  <span className="text-slate-400">
                    {lang === "en" ? "Resolved:" : "تم الحل بنجاح:"}
                  </span>
                  <strong className="text-sky-400 font-mono">{stats.resolutionRate}%</strong>
                </div>
              </div>
            </div>
          </div>

          {/* الصف الثاني: توزيع الأخطاء حسب نوع العملية والملفات المتأثرة */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* المخطط 3: الأخطاء حسب نوع العملية البرمجية */}
            <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-3.5">
              <h3 className="text-xs font-bold text-white mb-1">
                {lang === "en"
                  ? "Detected Errors by Operation Type (Operation Breakdown)"
                  : "توزيع الأخطاء المكتشفة حسب نوع العملية البرمجية (Operation Breakdown)"}
              </h3>
              <p className="text-[11px] text-slate-400 mb-2">
                {lang === "en"
                  ? "Comparison of file save errors, file load errors, syntax checks, and database operations"
                  : "مقارنة بين أخطاء حفظ الملفات، تحميل الملفات، وفحوصات الصياغة وقاعدة البيانات"}
              </p>
              <div className="h-44 w-full" dir="ltr">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={byOperation} margin={{ top: 5, right: 15, left: 0, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                    <XAxis dataKey="label" stroke="#94a3b8" tick={{ fontSize: 10 }} />
                    <YAxis stroke="#94a3b8" tick={{ fontSize: 11 }} allowDecimals={false} />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: "#0f172a",
                        borderColor: "#334155",
                        borderRadius: "8px",
                        fontSize: "12px",
                      }}
                    />
                    <Legend wrapperStyle={{ fontSize: "11px" }} />
                    <Bar
                      dataKey="total"
                      name={lang === "en" ? "Total Reports" : "إجمالي البلاغات"}
                      fill="#3b82f6"
                      radius={[4, 4, 0, 0]}
                    />
                    <Bar
                      dataKey="critical"
                      name={lang === "en" ? "Critical" : "بلاغات حرجة"}
                      fill="#ef4444"
                      radius={[4, 4, 0, 0]}
                    />
                    <Bar
                      dataKey="resolved"
                      name={lang === "en" ? "Resolved" : "تم حلها"}
                      fill="#10b981"
                      radius={[4, 4, 0, 0]}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* المخطط 4: توزيع الأخطاء حسب الملفات المتأثرة */}
            <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-3.5">
              <h3 className="text-xs font-bold text-white mb-1">
                {lang === "en"
                  ? "Error Distribution by Affected Source Files"
                  : "توزيع الأخطاء حسب الملفات المصدرية المتأثرة (Affected Source Files)"}
              </h3>
              <p className="text-[11px] text-slate-400 mb-2">
                {lang === "en"
                  ? "Source files with the highest number of failed save or load attempts in Code Studio"
                  : "رصد الملفات الأكثر تسجيلاً لمحاولات الحفظ أو التحميل الفاشلة في استوديو الكود"}
              </p>
              <div className="h-44 w-full" dir="ltr">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={byFile}
                    layout="vertical"
                    margin={{ top: 5, right: 20, left: 30, bottom: 5 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                    <XAxis type="number" stroke="#94a3b8" tick={{ fontSize: 11 }} allowDecimals={false} />
                    <YAxis
                      type="category"
                      dataKey="filePath"
                      stroke="#94a3b8"
                      tick={{ fontSize: 10 }}
                      width={130}
                    />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: "#0f172a",
                        borderColor: "#334155",
                        borderRadius: "8px",
                        fontSize: "12px",
                      }}
                    />
                    <Legend wrapperStyle={{ fontSize: "11px" }} />
                    <Bar
                      dataKey="count"
                      name={lang === "en" ? "Recorded Errors" : "عدد الأخطاء المسجلة"}
                      fill="#D5B65D"
                      radius={[0, 4, 4, 0]}
                    />
                    <Bar
                      dataKey="resolved"
                      name={lang === "en" ? "Resolved" : "تمت معالجتها"}
                      fill="#10b981"
                      radius={[0, 4, 4, 0]}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* محتوى التبويب الثاني: إحصائيات كافة الأقسام والبيانات مع صلاحية القسم / الأدمن */}
      {activeTab === "departments" && (
        <div className="p-4 space-y-4">
          {/* شريط الصلاحية ونطاق القسم */}
          <div
            className={`p-3 rounded-xl border flex flex-wrap items-center justify-between gap-3 ${
              accessScope.isAdmin
                ? "bg-emerald-950/60 border-[#D5B65D]/50"
                : "bg-amber-950/40 border-amber-500/40"
            }`}
          >
            <div className="flex items-center gap-2.5">
              {accessScope.isAdmin ? (
                <div className="w-9 h-9 rounded-lg bg-[#D5B65D]/20 border border-[#D5B65D] flex items-center justify-center text-[#D5B65D]">
                  <Crown className="w-5 h-5" />
                </div>
              ) : (
                <div className="w-9 h-9 rounded-lg bg-amber-500/20 border border-amber-500 flex items-center justify-center text-amber-400">
                  <Lock className="w-5 h-5" />
                </div>
              )}
              <div>
                <div className="flex items-center gap-2">
                  <strong className="text-xs text-white">
                    {accessScope.isAdmin
                      ? lang === "en"
                        ? "👑 System Admin Access: Full visibility across all university departments & units"
                        : "👑 صلاحية مدير النظام (Admin): وصول كامل لكافة إحصائيات الأقسام والوحدات"
                      : lang === "en"
                      ? `🔒 Restricted Department View: «${accessScope.assignedDepartment}»`
                      : `🔒 عرض مقيد حسب القسم المنتمي إليه: قسم «${accessScope.assignedDepartment}»`}
                  </strong>
                  <span className="text-[10px] px-2 py-0.5 rounded bg-slate-900 text-slate-300 border border-slate-700">
                    {lang === "en" ? "User:" : "المستخدم:"} {accessScope.userName} ({accessScope.role})
                  </span>
                </div>
                <p className="text-[11px] text-slate-300 mt-0.5">
                  {accessScope.isAdmin
                    ? lang === "en"
                      ? "Admin can inspect and compare all departments in the ERP or filter by any specific department."
                      : "يمتلك الأدمن صلاحية استعراض ومقارنة كافة الأقسام والبيانات في المنظومة أو التصفية حسب أي قسم."
                    : lang === "en"
                    ? "Only statistics for your assigned department are displayed; full cross-department metrics are restricted to Admin."
                    : "يتم عرض الإحصائيات الخاصة بالقسم الذي تنتمي إليه فقط، بينما يمتلك الأدمن وحده كافة الإحصائيات الشاملة."}
                </p>
              </div>
            </div>

            {/* مرشح الأقسام للأدمن أو محاكاة القسم لغير الأدمن */}
            {accessScope.isAdmin ? (
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-[11px] text-emerald-200 font-bold">
                  {lang === "en" ? "Department Filter (Admin):" : "تصفية القسم (للأدمن):"}
                </span>
                <select
                  value={selectedDept}
                  onChange={(e) => setSelectedDept(e.target.value)}
                  className="bg-slate-900 border border-emerald-700 text-white text-xs rounded-lg px-2.5 py-1.5 font-semibold"
                >
                  <option value="all">
                    {lang === "en"
                      ? `🌐 All Departments & Units (${accessScope.allDepartmentNames?.length || 9} Depts)`
                      : `🌐 كافة الأقسام والوحدات (شامل - ${accessScope.allDepartmentNames?.length || 9} أقسام)`}
                  </option>
                  {(accessScope.allDepartmentNames || []).map((d: string) => (
                    <option key={d} value={d}>
                      🏢 {lang === "en" ? `Dept: ${d}` : `قسم ${d}`}
                    </option>
                  ))}
                </select>
              </div>
            ) : (
              <div className="flex items-center gap-1.5">
                <span className="text-[11px] text-amber-200 font-bold">
                  {lang === "en" ? "Assigned Department:" : "القسم المرتبط بالموظف:"}
                </span>
                <select
                  value={simulatedMyDept || accessScope.assignedDepartment}
                  onChange={(e) => setSimulatedMyDept(e.target.value)}
                  className="bg-slate-900 border border-amber-600/60 text-amber-200 text-xs rounded-lg px-2.5 py-1.5 font-semibold"
                >
                  {(accessScope.allDepartmentNames || []).map((d: string) => (
                    <option key={d} value={d}>
                      {lang === "en" ? `${d} (Department-only view)` : `قسم ${d} (عرض إحصائيات هذا القسم فقط)`}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>

          {/* مخططات Recharts لإحصائيات الأقسام */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div className="lg:col-span-2 bg-slate-900/90 border border-slate-800 rounded-xl p-3.5">
              <h3 className="text-xs font-bold text-white mb-1">
                {lang === "en"
                  ? "Staff Headcount, Payroll & Commitment Rate by Department (Recharts)"
                  : "توزيع الموظفين، الاستحقاقات المالية، ونسبة الالتزام حسب القسم (Recharts)"}
              </h3>
              <p className="text-[11px] text-slate-400 mb-2">
                {accessScope.isAdmin && selectedDept === "all"
                  ? lang === "en"
                    ? "Comprehensive comparison across all accredited university departments"
                    : "مقارنة شاملة لجميع الأقسام المعتمدة في المنظومة"
                  : lang === "en"
                  ? `Dedicated metrics for department: ${accessScope.activeDepartmentFilter}`
                  : `إحصائيات مخصصة لقسم: ${accessScope.activeDepartmentFilter}`}
              </p>
              <div className="h-52 w-full" dir="ltr">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={deptBreakdown} margin={{ top: 10, right: 15, left: 0, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#1e293b" />
                    <XAxis dataKey="department" stroke="#94a3b8" tick={{ fontSize: 10 }} />
                    <YAxis yAxisId="left" stroke="#94a3b8" tick={{ fontSize: 11 }} />
                    <YAxis yAxisId="right" orientation="right" stroke="#D5B65D" tick={{ fontSize: 11 }} />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: "#0f172a",
                        borderColor: "#334155",
                        borderRadius: "8px",
                        fontSize: "12px",
                      }}
                    />
                    <Legend wrapperStyle={{ fontSize: "11px" }} />
                    <Bar
                      yAxisId="left"
                      dataKey="count"
                      name={lang === "en" ? "Staff Count" : "عدد الموظفين"}
                      fill="#10b981"
                      barSize={22}
                      radius={[4, 4, 0, 0]}
                    />
                    <Bar
                      yAxisId="left"
                      dataKey="avgCommitment"
                      name={lang === "en" ? "Avg Commitment %" : "متوسط الالتزام %"}
                      fill="#3b82f6"
                      barSize={22}
                      radius={[4, 4, 0, 0]}
                    />
                    <Line
                      yAxisId="right"
                      type="monotone"
                      dataKey="totalSalaries"
                      name={lang === "en" ? "Total Payroll & Benefits" : "إجمالي الرواتب والاستحقاقات"}
                      stroke="#D5B65D"
                      strokeWidth={2.5}
                      dot={{ r: 4 }}
                    />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-3.5">
              <h3 className="text-xs font-bold text-white mb-1">
                {lang === "en"
                  ? `Leave Distribution by Type (${hrKpis.totalLeaveDays || 0} Days)`
                  : `توزيع الإجازات حسب النوع (${hrKpis.totalLeaveDays || 0} يوم)`}
              </h3>
              <p className="text-[11px] text-slate-400 mb-2">
                {lang === "en"
                  ? "Breakdown of leave categories within the active department scope"
                  : "تحليل أنواع الإجازات المسجلة ضمن نطاق القسم الحالي"}
              </p>
              <div className="h-52 w-full" dir="ltr">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={leaveDist.filter((x: any) => x.days > 0)}
                      dataKey="days"
                      nameKey="type"
                      cx="50%"
                      cy="50%"
                      innerRadius={38}
                      outerRadius={66}
                      paddingAngle={3}
                    >
                      {leaveDist.map((_: any, idx: number) => (
                        <Cell key={`lv-${idx}`} fill={PIE_COLORS[idx % PIE_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip
                      contentStyle={{
                        backgroundColor: "#0f172a",
                        borderColor: "#334155",
                        borderRadius: "8px",
                        fontSize: "12px",
                      }}
                    />
                    <Legend wrapperStyle={{ fontSize: "10px" }} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>

          {/* بطاقات إحصائيات كافة الأقسام والوحدات في المنظومة */}
          <div>
            <h3 className="text-xs font-bold text-[#D5B65D] mb-2">
              {lang === "en"
                ? `Comprehensive Operational Metrics Across Departments & Units (${enterpriseModules.length} sectors in scope):`
                : `البيانات التشغيلية الشاملة لكافة الأقسام والوحدات (${enterpriseModules.length} قطاعاً متاحاً ضمن صلاحيتك):`}
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              {enterpriseModules.map((mod: any) => (
                <div
                  key={mod.id}
                  className="bg-slate-900/90 border border-slate-800 rounded-xl p-3 space-y-2"
                >
                  <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                    <div className="flex items-center gap-2">
                      <span className="text-base">{mod.icon}</span>
                      <div>
                        <strong className="text-xs text-white block">{mod.title}</strong>
                        <span className="text-[10px] text-emerald-400">
                          {lang === "en" ? "Dept:" : "قسم:"} {mod.department}
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-1.5 text-[11px]">
                    {(mod.metrics || []).map((m: any, i: number) => (
                      <div key={i} className="bg-slate-950/70 p-1.5 rounded border border-slate-800/70">
                        <span className="text-slate-400 block text-[10px]">{m.label}</span>
                        <strong className="text-white font-mono">
                          {m.value} <span className="text-[10px] font-normal text-slate-400">{m.unit}</span>
                        </strong>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
