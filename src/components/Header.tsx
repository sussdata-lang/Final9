import React from "react";
import { 
  Sparkles, 
  FolderDown, 
  LayoutTemplate, 
  Columns, 
  Code2, 
  Eye, 
  RotateCcw,
  Cpu
} from "lucide-react";

interface HeaderProps {
  viewMode: "split" | "code" | "preview";
  setViewMode: (mode: "split" | "code" | "preview") => void;
  onOpenAiModal: () => void;
  onOpenTemplates: () => void;
  onOpenExport: () => void;
  onResetProject: () => void;
  isAiGenerating: boolean;
}

export const Header: React.FC<HeaderProps> = ({
  viewMode,
  setViewMode,
  onOpenAiModal,
  onOpenTemplates,
  onOpenExport,
  onResetProject,
  isAiGenerating,
}) => {
  return (
    <header className="h-16 border-b border-slate-800 bg-[#0d1322]/95 backdrop-blur-md px-4 sm:px-6 flex items-center justify-between z-30 select-none">
      {/* Brand & Active Engine */}
      <div className="flex items-center gap-3">
        <div className="relative flex items-center justify-center w-10 h-10 rounded-xl bg-gradient-to-tr from-cyan-500 via-teal-400 to-blue-600 shadow-md shadow-cyan-500/20 text-slate-950 font-black text-xl">
          <Code2 className="w-5 h-5 text-slate-950" />
          <span className="absolute -top-1 -right-1 flex h-2.5 w-2.5">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-cyan-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-cyan-500"></span>
          </span>
        </div>

        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-base font-extrabold text-white tracking-tight flex items-center gap-1.5">
              Argon <span className="bg-gradient-to-r from-cyan-400 to-teal-300 bg-clip-text text-transparent">CodeStudio</span>
            </h1>
            <span className="hidden sm:inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
              <Cpu className="w-2.5 h-2.5" />
              Gemini AI
            </span>
          </div>
          <p className="text-[11px] text-slate-400 hidden sm:block">استوديو التكويد والتطوير المباشر للمواقع</p>
        </div>
      </div>

      {/* Middle: View Mode Switcher */}
      <div className="flex items-center p-1 rounded-xl bg-slate-900 border border-slate-800">
        <button
          onClick={() => setViewMode("split")}
          title="عرض منقسم (محرر + معاينة)"
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
            viewMode === "split"
              ? "bg-cyan-500 text-slate-950 shadow-sm"
              : "text-slate-400 hover:text-slate-200"
          }`}
        >
          <Columns className="w-3.5 h-3.5" />
          <span className="hidden md:inline">منقسم</span>
        </button>

        <button
          onClick={() => setViewMode("code")}
          title="محرر الكود فقط"
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
            viewMode === "code"
              ? "bg-cyan-500 text-slate-950 shadow-sm"
              : "text-slate-400 hover:text-slate-200"
          }`}
        >
          <Code2 className="w-3.5 h-3.5" />
          <span className="hidden md:inline">الكود</span>
        </button>

        <button
          onClick={() => setViewMode("preview")}
          title="المعاينة المباشرة فقط"
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
            viewMode === "preview"
              ? "bg-cyan-500 text-slate-950 shadow-sm"
              : "text-slate-400 hover:text-slate-200"
          }`}
        >
          <Eye className="w-3.5 h-3.5" />
          <span className="hidden md:inline">المعاينة</span>
        </button>
      </div>

      {/* Action Buttons */}
      <div className="flex items-center gap-2 sm:gap-3">
        {/* Reset */}
        <button
          onClick={onResetProject}
          title="مشروع جديد / إعادة ضبط"
          className="p-2 sm:px-3 sm:py-2 rounded-xl border border-slate-800 hover:bg-slate-800 text-slate-400 hover:text-white text-xs font-medium transition-colors flex items-center gap-1.5"
        >
          <RotateCcw className="w-3.5 h-3.5" />
          <span className="hidden lg:inline">مشروع جديد</span>
        </button>

        {/* Templates */}
        <button
          onClick={onOpenTemplates}
          className="p-2 sm:px-3 sm:py-2 rounded-xl border border-slate-800 hover:bg-slate-800 text-slate-300 hover:text-white text-xs font-semibold transition-colors flex items-center gap-1.5"
        >
          <LayoutTemplate className="w-3.5 h-3.5 text-teal-400" />
          <span className="hidden sm:inline">القوالب</span>
        </button>

        {/* Export */}
        <button
          onClick={onOpenExport}
          className="p-2 sm:px-3 sm:py-2 rounded-xl border border-slate-800 hover:bg-slate-800 text-slate-300 hover:text-white text-xs font-semibold transition-colors flex items-center gap-1.5"
        >
          <FolderDown className="w-3.5 h-3.5 text-cyan-400" />
          <span className="hidden sm:inline">تصدير</span>
        </button>

        {/* AI Generator CTA */}
        <button
          onClick={onOpenAiModal}
          disabled={isAiGenerating}
          className="relative px-3.5 py-2 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-slate-950 font-bold text-xs flex items-center gap-1.5 shadow-lg shadow-cyan-500/25 transition-all transform hover:-translate-y-0.5 active:translate-y-0 disabled:opacity-50"
        >
          <Sparkles className="w-3.5 h-3.5" />
          <span>توليد بالذكاء الاصطناعي</span>
        </button>
      </div>
    </header>
  );
};
