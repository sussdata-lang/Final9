// أساس الشاشات المبنية بمكونات Preact. لا يحتاج خطوة بناء، ويعمل مع الشاشات القديمة في الصفحة نفسها.
// شاشة جديدة: UA.views.x = () => mountPoint('x', Screen) حيث Screen مكون يعيد html`...`.
// الأزرار تستعمل data-act كالمعتاد، فيعالجها موزع الأحداث العام نفسه.
import { html, render, useState, useEffect, useRef, useMemo } from '../vendor/preact-htm.js';

export { html, render, useState, useEffect, useRef, useMemo };

const mounted = new Map();

// الرسم القديم يستبدل #app كله، فيُعاد تركيب المكونات بعده. حالتها الدائمة تبقى خارجها.
function remount() {
  for (const [id, make] of mounted) {
    const el = document.getElementById(id);
    if (el) render(make(), el);
  }
}
function hook() {
  const UA = window.UA;
  const prev = UA.afterRenderEnhance;
  if (prev && prev.__ui) return;
  const wrapped = function (...args) { if (prev) prev.apply(this, args); remount(); };
  wrapped.__ui = true;
  UA.afterRenderEnhance = wrapped;
}

export function mountPoint(name, make) {
  hook();
  const id = `ui-${name}`;
  mounted.set(id, make);
  return `<div id="${id}"></div>`;
}

// نص من دالة قديمة تعيد HTML موثوقًا (الأيقونات وبطاقات الإحصاء)
export const Raw = ({ markup, as = 'span' }) => html`<${as} dangerouslySetInnerHTML=${{ __html: markup }} />`;
