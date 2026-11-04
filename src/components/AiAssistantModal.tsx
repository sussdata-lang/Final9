import React, { useState } from "react";
import { 
  Sparkles, 
  X, 
  Send, 
  Cpu, 
  Check, 
  Layers, 
  Wand2, 
  ArrowRight,
  Code2
} from "lucide-react";
import { WebProject } from "../types";

interface AiAssistantModalProps {
  isOpen: boolean;
  onClose: () => void;
  onGenerate: (prompt: string, action: "create" | "update") => void;
  isGenerating: boolean;
  streamText: string;
  currentProject: WebProject;
}

const INSPIRATION_PROMPTS = [
  {
    title: "متجر هواتف ذكية فخم",
    prompt: "أنشئ متجراً إلكترونياً عصرياً للهواتف الذكية مع سلة مشتريات تفاعلية، بطاقات منتجات مع تقييمات، وفلترة حسب السعر، باللغة العربية مع تصميم داكن.",
  },
  {
    title: "صفحة هبوط لمشروع SaaS",
    prompt: "أنشئ صفحة هبوط احترافية عالية التحويل لمنتج برمجيات ذكاء اصطناعي، تحتوي على قسم بطل مع تدرجات لونية، جدول مقارنة أسعار، وأسئلة شائعة تفاعلية.",
  },
  {
    title: "لوحة تحكم إحصائيات (Dashboard)",
    prompt: "صمم لوحة تحكم تفاعلية لموقع تجارة إلكترونية تعرض إجمالي المبيعات، الزوار، الرسوم البيانية، وقائمة بأحدث الطلبات مع شريط جانبي متجاوب.",
  },
  {
    title: "موقع حجز مطعم وكافيه",
    prompt: "ابنِ موقعاً لمطعم راقٍ يحتوي على قائمة طعام مصنفة (مقبلات، أطباق رئيسية، حلويات) ونموذج حجز طاولة تفاعلي مع تأكيد فوري.",
  },
  {
    title: "معرض أعمال مصمم / مبرمج",
    prompt: "أنشئ موقع بورتفوليو شخصي احترافي بنمط نيومورفيك وداكن، مع شريط مهارات تفاعلي، معرض أعمال، ونموذج تواصل بالبريد.",
  },
];

export const AiAssistantModal: React.FC<AiAssistantModalProps> = ({
  isOpen,
  onClose,
  onGenerate,
  isGenerating,
  streamText,
  currentProject,
}) => {
  const [prompt, setPrompt] = useState("");
  const [mode, setMode] = useState<"create" | "update">("create");

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!prompt.trim() || isGenerating) return;
    onGenerate(prompt.trim(), mode);
  };

  const handleSelectPrompt = (p: string) => {
    setPrompt(p);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-fade-in">
      <div className="w-full max-w-2xl bg-[#0d1424] border border-slate-800 rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-800 bg-[#090d18]">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-cyan-500 to-blue-600 flex items-center justify-center text-slate-950 shadow-md shadow-cyan-500/20">
              <Sparkles className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <span>المساعد البرمجي الذكي</span>
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 font-mono">
                  Gemini Flash / Argon
                </span>
              </h3>
              <p className="text-xs text-slate-400">
                صف موقعك أو التعديل الذي تريده، وسيقوم الذكاء الاصطناعي بكتابة وتطوير الكود فورياً.
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="w-8 h-8 rounded-xl bg-slate-800/80 hover:bg-slate-800 text-slate-400 hover:text-white flex items-center justify-center transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body Content */}
        <div className="p-6 overflow-y-auto space-y-6">
          {/* Mode Switcher */}
          <div className="flex p-1 rounded-xl bg-slate-900 border border-slate-800">
            <button
              type="button"
              onClick={() => setMode("create")}
              className={`flex-1 py-2 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-2 ${
                mode === "create"
                  ? "bg-cyan-500 text-slate-950 shadow"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              <Wand2 className="w-3.5 h-3.5" />
              <span>إنشاء موقع جديد بالكامل</span>
            </button>
            <button
              type="button"
              onClick={() => setMode("update")}
              className={`flex-1 py-2 rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-2 ${
                mode === "update"
                  ? "bg-cyan-500 text-slate-950 shadow"
                  : "text-slate-400 hover:text-slate-200"
              }`}
            >
              <Layers className="w-3.5 h-3.5" />
              <span>تطوير وإضافة ميزات للموقع الحالي</span>
            </button>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-bold text-slate-300 mb-1.5">
                {mode === "create"
                  ? "ما الموقع الذي ترغب في بنائه وتكويده؟"
                  : "ما التعديل أو الميزة التي ترغب في إضافتها؟"}
              </label>
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                rows={4}
                disabled={isGenerating}
                placeholder={
                  mode === "create"
                    ? "مثال: أريد موقع صفحة هبوط لشركة استشارات قانونية، بألوان كحلية وذهبية فاخرة، مع نموذج حجز استشارة، وقسم آراء العملاء..."
                    : "مثال: أضف معرض صور تفاعلي مع نافذة منبثقة، واجعل الأزرار بألوان متدرجة حديثة..."
                }
                className="w-full bg-[#12192a] border border-slate-700 rounded-2xl p-4 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-cyan-400 transition-all resize-none"
              />
            </div>

            {/* Inspiration prompts */}
            <div>
              <div className="text-xs font-bold text-slate-400 mb-2 flex items-center gap-1.5">
                <Sparkles className="w-3 h-3 text-cyan-400" />
                <span>أفكار جاهزة للتوليد السريع:</span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {INSPIRATION_PROMPTS.map((item, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => handleSelectPrompt(item.prompt)}
                    className="p-3 rounded-xl bg-slate-900/60 hover:bg-slate-800 border border-slate-800 text-right transition-all group"
                  >
                    <div className="text-xs font-bold text-white group-hover:text-cyan-400 transition-colors">
                      {item.title}
                    </div>
                    <div className="text-[11px] text-slate-500 line-clamp-1 mt-0.5">
                      {item.prompt}
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {/* Live Streaming Code Preview if Generating */}
            {isGenerating && (
              <div className="p-4 rounded-2xl bg-[#080d1a] border border-cyan-500/30 font-mono text-xs text-slate-300">
                <div className="flex items-center justify-between pb-2 mb-2 border-b border-slate-800">
                  <span className="flex items-center gap-2 text-cyan-400 font-bold">
                    <span className="w-2 h-2 rounded-full bg-cyan-400 animate-ping"></span>
                    جارٍ كتابة وتوليد الكود البرمجي بواسطة Gemini AI...
                  </span>
                  <span className="text-[10px] text-slate-500">Live Stream</span>
                </div>
                <div className="max-h-40 overflow-y-auto whitespace-pre-wrap font-mono text-[11px] text-slate-400">
                  {streamText || "جارٍ تجهيز التعليمات البرمجية..."}
                </div>
              </div>
            )}

            {/* Action Buttons */}
            <div className="flex items-center justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={onClose}
                disabled={isGenerating}
                className="px-5 py-2.5 rounded-xl border border-slate-800 text-slate-400 hover:text-white text-xs font-semibold transition-colors"
              >
                إلغاء
              </button>
              <button
                type="submit"
                disabled={!prompt.trim() || isGenerating}
                className="px-6 py-2.5 rounded-xl bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-slate-950 font-bold text-xs flex items-center gap-2 shadow-lg shadow-cyan-500/25 transition-all disabled:opacity-50"
              >
                {isGenerating ? (
                  <>
                    <span className="w-4 h-4 border-2 border-slate-950 border-t-transparent rounded-full animate-spin"></span>
                    <span>جارٍ التوليد...</span>
                  </>
                ) : (
                  <>
                    <Sparkles className="w-4 h-4" />
                    <span>ابدأ التكويد والتوليد</span>
                  </>
                )}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
};
