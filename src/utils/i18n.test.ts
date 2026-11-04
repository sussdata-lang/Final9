import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeLang,
  getDirectionForLang,
  toggleLangValue,
  translateStudio,
  STUDIO_I18N,
  UNI_ERP_LANG_EVENT,
  syncStudioLang,
  STUDIO_LANG_STORAGE_KEY,
} from "./i18n.ts";

test("normalizeLang returns 'en' only for English values and defaults to 'ar'", () => {
  assert.equal(normalizeLang("en"), "en");
  assert.equal(normalizeLang("ar"), "ar");
  assert.equal(normalizeLang(null), "ar");
  assert.equal(normalizeLang(undefined), "ar");
  assert.equal(normalizeLang("fr"), "ar");
});

test("getDirectionForLang returns 'ltr' for English and 'rtl' for Arabic", () => {
  assert.equal(getDirectionForLang("en"), "ltr");
  assert.equal(getDirectionForLang("ar"), "rtl");
});

test("toggleLangValue flips between 'ar' and 'en'", () => {
  assert.equal(toggleLangValue("ar"), "en");
  assert.equal(toggleLangValue("en"), "ar");
});

test("translateStudio resolves keys in both Arabic and English and falls back gracefully", () => {
  assert.equal(translateStudio("ar", "langToggleBtn"), "English");
  assert.equal(translateStudio("en", "langToggleBtn"), "العربية");
  assert.ok(translateStudio("ar", "appTitle").includes("Uni-ERP"));
  assert.ok(translateStudio("en", "appTitle").includes("Enterprise Edition"));
  assert.equal(translateStudio("en", "non_existent_key"), "non_existent_key");
});

test("STUDIO_I18N has matching keys for both Arabic and English dictionaries", () => {
  const arKeys = Object.keys(STUDIO_I18N.ar).sort();
  const enKeys = Object.keys(STUDIO_I18N.en).sort();
  assert.deepEqual(arKeys, enKeys);
  assert.ok(arKeys.length > 50);
});

test("syncStudioLang updates storage, dispatches event, and sends postMessage to iframe", () => {
  const mockStorage: Record<string, string> = {};
  (globalThis as any).localStorage = {
    setItem(k: string, v: string) { mockStorage[k] = v; },
    getItem(k: string) { return mockStorage[k] ?? null; },
  };

  let dispatchedEvent: any = null;
  (globalThis as any).window = {
    dispatchEvent(ev: any) { dispatchedEvent = ev; return true; },
  };
  (globalThis as any).CustomEvent = class CustomEvent {
    type: string;
    detail: any;
    constructor(type: string, opts?: any) {
      this.type = type;
      this.detail = opts?.detail;
    }
  };

  const sentMessages: any[] = [];
  const fakeIframeWindow = {
    postMessage(data: any) {
      sentMessages.push(data);
    },
  } as unknown as Window;

  const result = syncStudioLang("en", { iframeWindow: fakeIframeWindow, source: "test" });
  assert.equal(result, "en");
  assert.equal(mockStorage[STUDIO_LANG_STORAGE_KEY], "en");
  assert.ok(dispatchedEvent);
  assert.equal(dispatchedEvent.type, UNI_ERP_LANG_EVENT);
  assert.equal(dispatchedEvent.detail.lang, "en");
  assert.equal(dispatchedEvent.detail.dir, "ltr");
  assert.equal(sentMessages.length, 1);
  assert.equal(sentMessages[0].type, "UNI_ERP_LANG");
  assert.equal(sentMessages[0].lang, "en");
});
