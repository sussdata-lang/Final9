import React, { useRef, useState } from "react";
import { 
  FileCode, 
  FileSpreadsheet, 
  FileTerminal, 
  Copy, 
  Check, 
  Trash2, 
  Sparkles, 
  Send, 
  Library, 
  Code
} from "lucide-react";
import { ActiveTab, WebProject } from "../types";

interface CodeEditorProps {
  project: WebProject;
  activeTab: ActiveTab;
  setActiveTab: (tab: ActiveTab) => void;
  onCodeChange: (tab: ActiveTab, newCode: string) => void;
  onQuickAiUpdate: (instruction: string) => void;
  isAiGenerating: boolean;
}

export const CodeEditor: React.FC<CodeEditorProps> = ({
  project,
  activeTab,
  setActiveTab,
  onCodeChange,
  onQuickAiUpdate,
  isAiGenerating,
}) => {
  const [copied, setCopied] = useState(false);
  const [aiInstruction, setAiInstruction] = useState("");
  const [showLibraryMenu, setShowLibraryMenu] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const currentCode = project[activeTab];
  const linesCount = currentCode.split("\n").length;

  const handleCopy = () => {
    navigator.clipboard.writeText(currentCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleClear = () => {
    if (window.confirm("هل أنت متأكد من مسح محتوى هذا الملف؟")) {
      onCodeChange(activeTab, "");
    }
  };

  // Support Tab key indentation inside textarea
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Tab") {
      e.preventDefault();
      const textarea = textareaRef.current;
      if (!textarea) return;

      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;

      const newCode =
        currentCode.substring(0, start) + "  " + currentCode.substring(end);
      onCodeChange(activeTab, newCode);

      setTimeout(() => {
        textarea.selectionStart = textarea.selectionEnd = start + 2;
      }, 0);
    }
  };

  const handleInsertLibrary = (snippet: string) => {
    if (activeTab === "html") {
      onCodeChange("html", `${snippet}\n${project.html}`);
    } else if (activeTab === "css") {
      onCodeChange("css", `${snippet}\n${project.css}`);
    } else {
      onCodeChange("js", `${snippet}\n${project.js}`);
    }
    setShowLibraryMenu(false);
  };

  const handleAiSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!aiInstruction.trim() || isAiGenerating) return;
    onQuickAiUpdate(aiInstruction.trim());
    setAiInstruction("");
  };

  return (
    <div className="flex flex-col h-full bg-[#0e1422] border-r border-slate-800 text-slate-200 select-none">
      {/* File Tabs & Actions Toolbar */}
      <div className="flex items-center justify-between border-b border-slate-800 bg-[#090d18] px-3 py-1.5 overflow-x-auto">
        <div className="flex items-center gap-1">
          {/* HTML Tab */}
          <button
            onClick={() => setActiveTab("html")}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-mono font-semibold transition-colors ${
              activeTab === "html"
                ? "bg-[#182238] text-orange-400 border border-orange-500/30"
                : "text-slate-400 hover:bg-slate-800/60 hover:text-slate-200"
            }`}
          >
            <FileCode className="w-3.5 h-3.5 text-orange-400" />
            <span>index.html</span>
          </button>

          {/* CSS Tab */}
          <button
            onClick={() => setActiveTab("css")}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-mono font-semibold transition-colors ${
              activeTab === "css"
                ? "bg-[#182238] text-cyan-400 border border-cyan-500/30"
                : "text-slate-400 hover:bg-slate-800/60 hover:text-slate-200"
            }`}
          >
            <FileSpreadsheet className="w-3.5 h-3.5 text-cyan-400" />
            <span>styles.css</span>
          </button>

          {/* JS Tab */}
          <button
            onClick={() => setActiveTab("js")}
            className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-mono font-semibold transition-colors ${
              activeTab === "js"
                ? "bg-[#182238] text-amber-400 border border-amber-500/30"
                : "text-slate-400 hover:bg-slate-800/60 hover:text-slate-200"
            }`}
          >
            <FileTerminal className="w-3.5 h-3.5 text-amber-400" />
            <span>script.js</span>
          </button>
        </div>

        {/* Toolbar buttons */}
        <div className="flex items-center gap-1.5">
          {/* Library Injector */}
          <div className="relative">
            <button
              onClick={() => setShowLibraryMenu(!showLibraryMenu)}
              title="إضافة مكتبات خارجية (CDN)"
              className="px-2.5 py-1 rounded-md text-[11px] font-medium text-slate-300 hover:bg-slate-800 flex items-center gap-1 transition-colors"
            >
              <Library className="w-3 h-3 text-cyan-400" />
              <span className="hidden sm:inline">المكتبات</span>
            </button>

            {showLibraryMenu && (
              <div className="absolute left-0 mt-1 w-52 rounded-xl bg-slate-900 border border-slate-700 shadow-2xl py-1 z-50 text-xs text-slate-200">
                <div className="px-3 py-1 text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                  إدراج مكتبات CDN
                </div>
                <button
                  onClick={() =>
                    handleInsertLibrary(
                      '<script src="https://cdn.tailwindcss.com"></script>'
                    )
                  }
                  className="w-full text-right px-3 py-2 hover:bg-slate-800 flex items-center justify-between"
                >
                  <span>Tailwind CSS</span>
                  <span className="text-[10px] text-cyan-400">HTML</span>
                </button>
                <button
                  onClick={() =>
                    handleInsertLibrary(
                      '<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.1/css/all.min.css">'
                    )
                  }
                  className="w-full text-right px-3 py-2 hover:bg-slate-800 flex items-center justify-between"
                >
                  <span>FontAwesome Icons</span>
                  <span className="text-[10px] text-cyan-400">HTML</span>
                </button>
                <button
                  onClick={() =>
                    handleInsertLibrary(
                      '<script src="https://cdn.jsdelivr.net/npm/chart.js"></script>'
                    )
                  }
                  className="w-full text-right px-3 py-2 hover:bg-slate-800 flex items-center justify-between"
                >
                  <span>Chart.js للرسوم البيانية</span>
                  <span className="text-[10px] text-cyan-400">HTML</span>
                </button>
                <button
                  onClick={() =>
                    handleInsertLibrary(
                      '<script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"></script>'
                    )
                  }
                  className="w-full text-right px-3 py-2 hover:bg-slate-800 flex items-center justify-between"
                >
                  <span>Three.js للرسوم ثلاثية الأبعاد</span>
                  <span className="text-[10px] text-cyan-400">HTML</span>
                </button>
              </div>
            )}
          </div>

          {/* Copy Button */}
          <button
            onClick={handleCopy}
            title="نسخ الكود"
            className="p-1.5 rounded-md text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            {copied ? (
              <Check className="w-3.5 h-3.5 text-emerald-400" />
            ) : (
              <Copy className="w-3.5 h-3.5" />
            )}
          </button>

          {/* Clear Button */}
          <button
            onClick={handleClear}
            title="مسح الكود"
            className="p-1.5 rounded-md text-slate-400 hover:text-rose-400 hover:bg-slate-800 transition-colors"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Editor Main Content: Line Numbers & Textarea (LTR for standard IDE feel) */}
      <div className="relative flex-1 flex overflow-hidden" dir="ltr">
        {/* Line Numbers Gutter */}
        <div className="w-12 py-3 bg-[#090d18] border-r border-slate-800/80 text-right pr-3 pl-1 font-mono text-[11px] text-slate-600 select-none overflow-hidden leading-[1.6rem]">
          {Array.from({ length: linesCount }, (_, i) => (
            <div key={i + 1}>{i + 1}</div>
          ))}
        </div>

        {/* Textarea Code Input */}
        <textarea
          ref={textareaRef}
          value={currentCode}
          onChange={(e) => onCodeChange(activeTab, e.target.value)}
          onKeyDown={handleKeyDown}
          dir="ltr"
          spellCheck={false}
          style={{ fontFamily: "'JetBrains Mono', 'Cairo', monospace" }}
          placeholder={`Write ${activeTab.toUpperCase()} code here...`}
          className="flex-1 w-full h-full p-3 bg-transparent text-slate-200 text-[12px] sm:text-[13px] leading-[1.6rem] resize-none outline-none focus:ring-0 selection:bg-cyan-500/30 selection:text-cyan-200 overflow-y-auto"
        />
      </div>

      {/* Bottom AI Quick Inline Copilot */}
      <div className="border-t border-slate-800 bg-[#090d18] p-2.5">
        <form onSubmit={handleAiSubmit} className="flex items-center gap-2">
          <div className="relative flex-1 flex items-center">
            <Sparkles className="w-4 h-4 text-cyan-400 absolute right-3 pointer-events-none" />
            <input
              type="text"
              value={aiInstruction}
              onChange={(e) => setAiInstruction(e.target.value)}
              placeholder="اطلب تعديل الكود بالذكاء الاصطناعي (مثال: أضف نموذج اتصال، غير الألوان، اجعل الخط أكبر)..."
              disabled={isAiGenerating}
              className="w-full bg-[#12192a] border border-slate-700/80 rounded-xl pr-9 pl-4 py-2 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-cyan-400 transition-all disabled:opacity-50"
            />
          </div>

          <button
            type="submit"
            disabled={!aiInstruction.trim() || isAiGenerating}
            className="px-3.5 py-2 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold text-xs flex items-center gap-1.5 transition-all shadow-md shadow-cyan-500/20 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {isAiGenerating ? (
              <span className="flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-slate-950 animate-bounce"></span>
                <span className="w-1.5 h-1.5 rounded-full bg-slate-950 animate-bounce [animation-delay:0.2s]"></span>
                <span className="w-1.5 h-1.5 rounded-full bg-slate-950 animate-bounce [animation-delay:0.4s]"></span>
              </span>
            ) : (
              <>
                <Send className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">تطبيق</span>
              </>
            )}
          </button>
        </form>

        {/* Quick Suggestions Pills */}
        <div className="flex items-center gap-2 mt-2 overflow-x-auto py-0.5 text-[11px] text-slate-400">
          <span className="text-[10px] text-slate-500 shrink-0">اقتراحات:</span>
          <button
            type="button"
            onClick={() => onQuickAiUpdate("أضف وضع ليلي تفاعلي مع زر تبديل")}
            className="shrink-0 px-2.5 py-0.5 rounded-full bg-slate-800/80 hover:bg-slate-700 hover:text-white border border-slate-700/50 transition-colors"
          >
            + وضع ليلي تفاعلي
          </button>
          <button
            type="button"
            onClick={() => onQuickAiUpdate("اجعل التصميم متجاوباً تماماً مع الهواتف الذكية")}
            className="shrink-0 px-2.5 py-0.5 rounded-full bg-slate-800/80 hover:bg-slate-700 hover:text-white border border-slate-700/50 transition-colors"
          >
            + تجاوب تام مع الموبايل
          </button>
          <button
            type="button"
            onClick={() => onQuickAiUpdate("أضف تأثيرات حركية عصرية عند التمرير")}
            className="shrink-0 px-2.5 py-0.5 rounded-full bg-slate-800/80 hover:bg-slate-700 hover:text-white border border-slate-700/50 transition-colors"
          >
            + تأثيرات حركية (Animations)
          </button>
        </div>
      </div>
    </div>
  );
};
