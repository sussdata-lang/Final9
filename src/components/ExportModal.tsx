import React, { useState } from "react";
import { 
  X, 
  FolderArchive, 
  FileCode, 
  Copy, 
  Check, 
  Globe, 
  Download,
  Terminal
} from "lucide-react";
import { WebProject } from "../types";
import { downloadProjectZip, downloadStandaloneHtml } from "../utils/exportProject";
import { buildCompleteHtml } from "../utils/codeParser";

interface ExportModalProps {
  isOpen: boolean;
  onClose: () => void;
  project: WebProject;
}

export const ExportModal: React.FC<ExportModalProps> = ({
  isOpen,
  onClose,
  project,
}) => {
  const [copied, setCopied] = useState(false);
  const [isZipping, setIsZipping] = useState(false);

  if (!isOpen) return null;

  const handleDownloadZip = async () => {
    try {
      setIsZipping(true);
      await downloadProjectZip(project, `${project.title || "website"}.zip`);
    } catch (e) {
      console.error(e);
      alert("حدث خطأ أثناء إنشاء ملف ZIP");
    } finally {
      setIsZipping(false);
    }
  };

  const handleDownloadHtml = () => {
    downloadStandaloneHtml(project, `${project.title || "website"}.html`);
  };

  const handleCopyCombined = () => {
    const full = buildCompleteHtml(project);
    navigator.clipboard.writeText(full);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-fade-in">
      <div className="w-full max-w-xl bg-[#0d1424] border border-slate-800 rounded-3xl shadow-2xl overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-5 border-b border-slate-800 bg-[#090d18]">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 flex items-center justify-center">
              <Download className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white">تصدير وتحميل الموقع</h3>
              <p className="text-xs text-slate-400">
                حمل مشروعك بصيغة جاهزة للنشر على أي منصة استضافة أو تشغيله محلياً.
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="w-8 h-8 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white flex items-center justify-center transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Options */}
        <div className="p-6 space-y-4">
          {/* Download ZIP */}
          <div className="p-4 rounded-2xl bg-slate-900/60 border border-slate-800 hover:border-cyan-500/40 transition-all flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-xl bg-cyan-500/10 text-cyan-400 flex items-center justify-center text-xl">
                <FolderArchive className="w-6 h-6" />
              </div>
              <div>
                <h4 className="text-sm font-bold text-white mb-0.5">
                  حزمة برمجية متكاملة (ZIP)
                </h4>
                <p className="text-xs text-slate-400">
                  تحتوي على ملفات <code className="text-cyan-400">index.html</code> و <code className="text-cyan-400">styles.css</code> و <code className="text-cyan-400">script.js</code> منظمة.
                </p>
              </div>
            </div>

            <button
              onClick={handleDownloadZip}
              disabled={isZipping}
              className="px-4 py-2.5 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold text-xs shrink-0 flex items-center gap-1.5 shadow-md shadow-cyan-500/20 transition-all disabled:opacity-50"
            >
              <Download className="w-3.5 h-3.5" />
              <span>{isZipping ? "جارٍ الضغط..." : "تحميل ZIP"}</span>
            </button>
          </div>

          {/* Download Single HTML */}
          <div className="p-4 rounded-2xl bg-slate-900/60 border border-slate-800 hover:border-teal-500/40 transition-all flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-xl bg-teal-500/10 text-teal-400 flex items-center justify-center text-xl">
                <FileCode className="w-6 h-6" />
              </div>
              <div>
                <h4 className="text-sm font-bold text-white mb-0.5">
                  ملف مستقل واحد (Standalone HTML)
                </h4>
                <p className="text-xs text-slate-400">
                  ملف HTML مدمج به كامل التنسيقات والسكربتات، يمكن فتحه في أي متصفح بنقرة واحدة.
                </p>
              </div>
            </div>

            <button
              onClick={handleDownloadHtml}
              className="px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-white font-bold text-xs shrink-0 flex items-center gap-1.5 transition-colors"
            >
              <Download className="w-3.5 h-3.5" />
              <span>تحميل HTML</span>
            </button>
          </div>

          {/* Copy to Clipboard */}
          <div className="p-4 rounded-2xl bg-slate-900/60 border border-slate-800 hover:border-blue-500/40 transition-all flex items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="w-12 h-12 rounded-xl bg-blue-500/10 text-blue-400 flex items-center justify-center text-xl">
                <Copy className="w-6 h-6" />
              </div>
              <div>
                <h4 className="text-sm font-bold text-white mb-0.5">
                  نسخ الكود الكامل إلى الحافظة
                </h4>
                <p className="text-xs text-slate-400">
                  انسخ الكود بالكامل للصقه في محرر الأكواد الخاص بك (VS Code) أو أي منصة.
                </p>
              </div>
            </div>

            <button
              onClick={handleCopyCombined}
              className="px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-white font-bold text-xs shrink-0 flex items-center gap-1.5 transition-colors"
            >
              {copied ? (
                <>
                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                  <span className="text-emerald-400">تم النسخ!</span>
                </>
              ) : (
                <>
                  <Copy className="w-3.5 h-3.5" />
                  <span>نسخ الكود</span>
                </>
              )}
            </button>
          </div>

          {/* Deployment Tip */}
          <div className="p-4 rounded-2xl bg-cyan-950/20 border border-cyan-500/20 text-xs text-slate-300 flex items-start gap-3">
            <Globe className="w-5 h-5 text-cyan-400 shrink-0 mt-0.5" />
            <div>
              <div className="font-bold text-white mb-1">أين يمكنك نشر موقعك مجاناً؟</div>
              <p className="text-slate-400 leading-relaxed">
                يمكنك رفع الملفات مباشرة إلى <span className="text-cyan-300 font-semibold">GitHub Pages</span>، أو السحب والإفلات على <span className="text-cyan-300 font-semibold">Netlify Drop</span> أو <span className="text-cyan-300 font-semibold">Vercel</span> لتشغيل موقعك أونلاين برابط خاص في دقيقة واحدة!
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
