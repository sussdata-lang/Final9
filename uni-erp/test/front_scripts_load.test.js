// كل سكربت في index.html يُحمَّل كاملاً بالترتيب: خطأ وقت التحميل يوقف الملف كله دون أثر ظاهر (كما اختفت شاشة «أعمالي»).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

const pub = path.join(import.meta.dirname, '..', 'public');
const scripts = [...fs.readFileSync(path.join(pub, 'index.html'), 'utf8').matchAll(/<script src="\/([\w.-]+\.js)\?v=[^"]+"/g)].map((m) => m[1]);

// كائن يقبل أي قراءة أو استدعاء، فيكفي لتمثيل المتصفح أثناء التحميل
const stub = () => new Proxy(function () {}, {
  get: (t, k) => (k === Symbol.toPrimitive ? () => '' : k === 'length' ? 0 : k in t ? t[k] : (t[k] = stub())),
  set: (t, k, v) => { t[k] = v; return true; },
  apply: () => stub(),
  construct: () => stub(),
});

test('سكربتات الواجهة تُحمَّل كلها دون خطأ، وشاشة «أعمالي» معرَّفة', () => {
  assert.ok(scripts.includes('workspace.js') && scripts.length > 20);
  const win = stub();
  win.UA = undefined;
  const ctx = vm.createContext(new Proxy({ window: win, console, Object, Array, Map, Set, WeakSet, Date, JSON, Math, Number, String, Boolean, RegExp, Promise, Error, Symbol, Intl, encodeURIComponent, decodeURIComponent, parseInt, parseFloat, isNaN, setTimeout: () => 0, clearTimeout: () => {}, setInterval: () => 0, clearInterval: () => {} }, {
    has: () => true,
    get: (t, k) => { if (k in t) return t[k]; if (k === Symbol.unscopables) return undefined; return k === 'undefined' ? undefined : (win[k] ?? (win[k] = stub())); },
  }));
  ctx.window = win;
  const failed = [];
  for (const f of scripts) {
    try { vm.runInContext(fs.readFileSync(path.join(pub, f), 'utf8'), ctx, { filename: f }); }
    catch (e) { failed.push(`${f}: ${e.message}`); }
  }
  assert.deepEqual(failed, []);
  assert.equal(typeof win.UA.workspaceView, 'function');
});
