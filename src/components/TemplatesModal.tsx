import React from "react";
import { X, Check, LayoutTemplate, ArrowRight } from "lucide-react";
import { WebsiteTemplate } from "../types";
import { STARTER_TEMPLATES } from "../data/templates";

interface TemplatesModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectTemplate: (template: WebsiteTemplate) => void;
  currentTemplateId?: string;
}

export const TemplatesModal: React.FC<TemplatesModalProps> = ({
  isOpen,
  onClose,
  onSelectTemplate,
  currentTemplateId,
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-fade-in">
      <div className="w-full max-w-4xl bg-[#0d1424] border border-slate-800 rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-5 border-b border-slate-800 bg-[#090d18]">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-teal-500/10 text-teal-400 border border-teal-500/20 flex items-center justify-center">
              <LayoutTemplate className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white">معرض القوالب الجاهزة</h3>
              <p className="text-xs text-slate-400">
                اختر قالباً لبدء التكويد والتطوير الفوري والتعديل عليه حسب رغبتك.
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

        {/* Templates Grid */}
        <div className="p-6 overflow-y-auto grid grid-cols-1 md:grid-cols-3 gap-6">
          {STARTER_TEMPLATES.map((tmpl) => {
            const isCurrent = currentTemplateId === tmpl.id;
            return (
              <div
                key={tmpl.id}
                className={`flex flex-col justify-between p-5 rounded-2xl border transition-all ${
                  isCurrent
                    ? "bg-cyan-950/20 border-cyan-500/50 shadow-lg shadow-cyan-500/10"
                    : "bg-slate-900/60 border-slate-800 hover:border-slate-700 hover:bg-slate-900"
                }`}
              >
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-slate-800 text-slate-300 border border-slate-700">
                      {tmpl.category}
                    </span>
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
                      {tmpl.badge}
                    </span>
                  </div>

                  <h4 className="text-base font-bold text-white mb-2">{tmpl.title}</h4>
                  <p className="text-xs text-slate-400 leading-relaxed mb-6">
                    {tmpl.description}
                  </p>
                </div>

                <div>
                  <button
                    onClick={() => {
                      onSelectTemplate(tmpl);
                      onClose();
                    }}
                    className={`w-full py-2.5 rounded-xl text-xs font-bold flex items-center justify-center gap-2 transition-all ${
                      isCurrent
                        ? "bg-slate-800 text-cyan-400 border border-cyan-500/30"
                        : "bg-cyan-500 hover:bg-cyan-400 text-slate-950 shadow-md shadow-cyan-500/20"
                    }`}
                  >
                    {isCurrent ? (
                      <>
                        <Check className="w-3.5 h-3.5" />
                        <span>القالب الحالي</span>
                      </>
                    ) : (
                      <>
                        <span>تحميل هذا القالب والتكويد عليه</span>
                        <ArrowRight className="w-3.5 h-3.5" />
                      </>
                    )}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
