/* قاموس الإنجليزية كبير، فلا يُحمَّل إلا لمن يستخدم الإنجليزية. يجب أن يسبق i18n.js. */
(function () {
  let lang = 'ar';
  try {
    const q = new URLSearchParams(location.search).get('lang');
    lang = q === 'en' || q === 'ar' ? q : localStorage.getItem('uni_erp_studio_lang') === 'en' ? 'en' : 'ar';
  } catch { /* العربية */ }
  if (lang !== 'en') return;
  const v = (document.currentScript && document.currentScript.src.split('?')[1]) || '';
  document.write('<script src="/i18n_en.js?' + v + '"><\/script>');
})();
