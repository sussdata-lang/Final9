import React, { useState, useEffect, useRef } from "react";
import { 
  Monitor, 
  Tablet, 
  Smartphone, 
  RotateCw, 
  Maximize2, 
  ExternalLink, 
  Terminal, 
  AlertCircle, 
  Sparkles,
  Trash2,
  X
} from "lucide-react";
import { ConsoleLogItem, ViewportMode, WebProject } from "../types";
import { buildCompleteHtml } from "../utils/codeParser";

interface LivePreviewProps {
  project: WebProject;
  onFixErrorWithAi: (errorMessage: string) => void;
  isAiGenerating: boolean;
}

export const LivePreview: React.FC<LivePreviewProps> = ({
  project,
  onFixErrorWithAi,
  isAiGenerating,
}) => {
  const [viewport, setViewport] = useState<ViewportMode>("desktop");
  const [iframeKey, setIframeKey] = useState(0);
  const [logs, setLogs] = useState<ConsoleLogItem[]>([]);
  const [showConsole, setShowConsole] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const compiledHtml = buildCompleteHtml(project);

  // Reload iframe
  const handleRefresh = () => {
    setIframeKey((prev) => prev + 1);
  };

  // Open in standalone tab
  const handleOpenNewWindow = () => {
    const blob = new Blob([compiledHtml], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    window.open(url, "_blank");
  };

  // Listen for console logs transmitted from iframe
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.data && event.data.source === "argon-preview-console") {
        const newLog: ConsoleLogItem = {
          id: Math.random().toString(36).substring(7),
          type: event.data.type,
          message: event.data.message,
          timestamp: event.data.timestamp,
        };
        setLogs((prev) => [...prev.slice(-49), newLog]); // Keep last 50 logs
      }
    };

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  }, []);

  const errorLogs = logs.filter((l) => l.type === "error");

  const getViewportWidth = () => {
    switch (viewport) {
      case "mobile":
        return "w-[375px] max-w-full";
      case "tablet":
        return "w-[768px] max-w-full";
      case "desktop":
      default:
        return "w-full";
    }
  };

  return (
    <div
      className={`flex flex-col h-full bg-[#080c16] relative ${
        isFullscreen
          ? "fixed inset-0 z-50 bg-slate-950 p-4"
          : ""
      }`}
    >
      {/* Top Preview Controls Bar */}
      <div className="flex items-center justify-between border-b border-slate-800 bg-[#0c1220] px-4 py-2 select-none">
        {/* Viewport switchers */}
        <div className="flex items-center gap-1 bg-slate-900 border border-slate-800 p-1 rounded-xl">
          <button
            onClick={() => setViewport("desktop")}
            title="سطح المكتب (شاشة كاملة)"
            className={`p-1.5 rounded-lg text-xs transition-colors ${
              viewport === "desktop"
                ? "bg-cyan-500 text-slate-950 shadow"
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            <Monitor className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => setViewport("tablet")}
            title="جهاز لوحي (768px)"
            className={`p-1.5 rounded-lg text-xs transition-colors ${
              viewport === "tablet"
                ? "bg-cyan-500 text-slate-950 shadow"
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            <Tablet className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => setViewport("mobile")}
            title="هاتف ذكي (375px)"
            className={`p-1.5 rounded-lg text-xs transition-colors ${
              viewport === "mobile"
                ? "bg-cyan-500 text-slate-950 shadow"
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            <Smartphone className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* URL Mock Bar */}
        <div className="hidden md:flex items-center gap-2 px-3 py-1 bg-slate-900/80 border border-slate-800 rounded-lg text-[11px] text-slate-400">
          <span className="w-2 h-2 rounded-full bg-emerald-400"></span>
          <span className="font-mono text-slate-300">https://preview.local/argon-site</span>
        </div>

        {/* Right actions */}
        <div className="flex items-center gap-1.5">
          {/* Console Drawer Toggle */}
          <button
            onClick={() => setShowConsole(!showConsole)}
            title="وحدة التحكم (Console)"
            className={`relative px-2.5 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5 transition-colors ${
              showConsole
                ? "bg-slate-800 text-cyan-400 border border-cyan-500/30"
                : "text-slate-400 hover:bg-slate-800 hover:text-slate-200"
            }`}
          >
            <Terminal className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Console</span>
            {errorLogs.length > 0 && (
              <span className="px-1.5 py-0.2 rounded-full bg-rose-500 text-white text-[10px] font-black animate-pulse">
                {errorLogs.length}
              </span>
            )}
          </button>

          {/* Refresh */}
          <button
            onClick={handleRefresh}
            title="إعادة تحميل المعاينة"
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <RotateCw className="w-3.5 h-3.5" />
          </button>

          {/* External Window */}
          <button
            onClick={handleOpenNewWindow}
            title="فتح في نافذة مستقلة"
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <ExternalLink className="w-3.5 h-3.5" />
          </button>

          {/* Fullscreen */}
          <button
            onClick={() => setIsFullscreen(!isFullscreen)}
            title={isFullscreen ? "تصغير" : "ملء الشاشة"}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            {isFullscreen ? (
              <X className="w-3.5 h-3.5" />
            ) : (
              <Maximize2 className="w-3.5 h-3.5" />
            )}
          </button>
        </div>
      </div>

      {/* Main Preview Container */}
      <div className="flex-1 overflow-auto flex items-center justify-center p-2 sm:p-4 bg-[radial-gradient(#1e293b_1px,transparent_1px)] [background-size:16px_16px]">
        <div
          className={`h-full transition-all duration-300 flex flex-col bg-slate-900 rounded-2xl overflow-hidden shadow-2xl border border-slate-800 ${getViewportWidth()}`}
        >
          {/* Mock Browser top bar if tablet or mobile */}
          {viewport !== "desktop" && (
            <div className="h-6 bg-slate-950 px-3 flex items-center justify-between border-b border-slate-800 text-[10px] text-slate-500 select-none">
              <div className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-slate-800"></span>
                <span className="w-2 h-2 rounded-full bg-slate-800"></span>
              </div>
              <span>{viewport === "mobile" ? "Mobile 375×667" : "Tablet 768×1024"}</span>
              <div className="w-2 h-2 rounded-full bg-slate-800"></div>
            </div>
          )}

          {/* Sandbox iframe */}
          <iframe
            key={iframeKey}
            ref={iframeRef}
            srcDoc={compiledHtml}
            title="Argon Live Sandbox Preview"
            sandbox="allow-scripts allow-modals allow-forms allow-same-origin"
            className="w-full flex-1 border-0 bg-slate-900"
          />
        </div>
      </div>

      {/* Bottom Console Drawer */}
      {showConsole && (
        <div className="h-48 border-t border-slate-800 bg-[#090d18] flex flex-col z-20">
          <div className="flex items-center justify-between px-4 py-2 border-b border-slate-800 bg-slate-900/60 text-xs">
            <div className="flex items-center gap-2">
              <Terminal className="w-3.5 h-3.5 text-cyan-400" />
              <span className="font-bold text-slate-300">سجل الأحداث البرمجية (Console)</span>
              <span className="text-[10px] text-slate-500">({logs.length} حدث)</span>
            </div>

            <div className="flex items-center gap-2">
              {errorLogs.length > 0 && (
                <button
                  onClick={() =>
                    onFixErrorWithAi(
                      errorLogs.map((e) => e.message).join("\n")
                    )
                  }
                  disabled={isAiGenerating}
                  className="px-2.5 py-1 rounded-lg bg-rose-500/10 border border-rose-500/30 text-rose-300 hover:bg-rose-500/20 text-xs font-bold flex items-center gap-1 transition-colors"
                >
                  <Sparkles className="w-3 h-3 text-rose-400" />
                  <span>إصلاح الأخطاء تلقائياً</span>
                </button>
              )}

              <button
                onClick={() => setLogs([])}
                title="مسح السجل"
                className="p-1 rounded text-slate-400 hover:text-white transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>

              <button
                onClick={() => setShowConsole(false)}
                className="p-1 rounded text-slate-400 hover:text-white transition-colors"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto p-3 font-mono text-xs space-y-1.5 select-text">
            {logs.length === 0 ? (
              <div className="text-slate-600 text-center py-8">
                لا توجد سجلات بعد. التفاعلات ورسائل console.log ستظهر هنا مباشرة.
              </div>
            ) : (
              logs.map((log) => (
                <div
                  key={log.id}
                  className={`flex items-start gap-2 p-1.5 rounded ${
                    log.type === "error"
                      ? "bg-rose-950/30 text-rose-300 border-r-2 border-rose-500"
                      : log.type === "warn"
                      ? "bg-amber-950/30 text-amber-300 border-r-2 border-amber-500"
                      : "text-slate-300"
                  }`}
                >
                  <span className="text-[10px] text-slate-500 shrink-0 select-none">
                    [{log.timestamp}]
                  </span>
                  {log.type === "error" && (
                    <AlertCircle className="w-3.5 h-3.5 text-rose-400 shrink-0 mt-0.5" />
                  )}
                  <span className="break-all">{log.message}</span>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
};
