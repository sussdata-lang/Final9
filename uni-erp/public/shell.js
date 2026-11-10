/* الهيكل الجديد للعاملين: شريط جانبي أخضر داكن، شريط علوي (مسار، بحث، إشعارات، ملف المستخدم)،
   ولوحة التحكم الرئيسية ببطاقات إحصائية ومخططات وجدول أحدث الطلبات وإجراءات سريعة.
   التصميم مستمد من ملف Figma «تعديل تصميم الموقع»؛ والبيانات حقيقية من الخادم (لا أرقام ثابتة). */
(function () {
  const UA = window.UA, { S, api, esc, can } = UA;
  const X = { data: null };
  const prevReset = UA.reset;
  UA.reset = () => { if (prevReset) prevReset(); X.data = null; };

  /* ---------- أيقونات التصميم ---------- */
  const ICO = {
    grid: '<rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/>',
    users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
    chart: '<path d="M3 3v18h18"/><path d="m7 16 4-5 4 3 5-7"/>',
    book: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2Z"/>',
    news: '<path d="M4 22h16a2 2 0 0 0 2-2V4H8v16a2 2 0 0 1-4 0V6H2v14a2 2 0 0 0 2 2Z"/><path d="M12 8h6M12 12h6M12 16h6M8 8v8"/>',
    upload: '<path d="M12 16V4M7 9l5-5 5 5"/><path d="M20 15v5H4v-5"/>',
    download: '<path d="M12 4v12M7 11l5 5 5-5"/><path d="M20 15v5H4v-5"/>',
    settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06-2.83 2.83-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21h-4v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06-2.83-2.83.06-.06A1.65 1.65 0 0 0 4.6 15a1.65 1.65 0 0 0-1.51-1H3v-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06 2.83-2.83.06.06A1.65 1.65 0 0 0 9 4.6a1.65 1.65 0 0 0 1-1.51V3h4v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06 2.83 2.83-.06.06A1.65 1.65 0 0 0 19.4 9c.12.6.65 1.03 1.26 1.03H21v4h-.34c-.61 0-1.14.43-1.26 1Z"/>',
    shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z"/><path d="m9 12 2 2 4-4"/>',
    bell: '<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>',
    chevron: '<path d="m9 18 6-6-6-6"/>',
    arrow: '<path d="M19 12H5M12 19l-7-7 7-7"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    check: '<path d="m5 12 4 4L19 6"/>',
    cap: '<path d="m2 9 10-5 10 5-10 5Z"/><path d="M6 11.5V16c0 1.5 3 3 6 3s6-1.5 6-3v-4.5"/>',
    file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6M8 13h8M8 17h5"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    scan: '<path d="M4 8V5.5A1.5 1.5 0 0 1 5.5 4H8M16 4h2.5A1.5 1.5 0 0 1 20 5.5V8M20 16v2.5a1.5 1.5 0 0 1-1.5 1.5H16M8 20H5.5A1.5 1.5 0 0 1 4 18.5V16"/><path d="M8 9v6M11 9v6M14 9v6M17 9v6"/>',
    menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
    close: '<path d="m6 6 12 12M18 6 6 18"/>',
    layers: '<path d="M12 3 3 7.5 12 12l9-4.5L12 3Z"/><path d="m3 12 9 4.5 9-4.5"/><path d="m3 16.5 9 4.5 9-4.5"/>',
    out: '<path d="M15 4.5h4.5v15H15"/><path d="M10.5 8l-4 4 4 4M6.5 12h10"/>',
    home: '<path d="m3 10 9-7 9 7"/><path d="M5 9v11h14V9"/><path d="M9 20v-6h6v6"/>',
    calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/>',
    clipboard: '<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4V2h6v2M9 11h6M9 15h6"/>',
    library: '<path d="M4 19V5M9 19V5M14 19V5M19 19V5M2 21h20M2 3h20"/>',
    research: '<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4M11 8v6M8 11h6"/>',
    graduation: '<path d="m2 10 10-5 10 5-10 5L2 10Z"/><path d="M6 12v5c3 2 9 2 12 0v-5M22 10v6"/>',
    quality: '<path d="M12 2 9.5 8H3l5 4-2 7 6-4 6 4-2-7 5-4h-6.5L12 2Z"/>',
    briefcase: '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M3 12h18"/>',
    mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>',
    wallet: '<path d="M20 7V5a2 2 0 0 0-2-2H5a3 3 0 0 0 0 6h15v10a2 2 0 0 1-2 2H5a3 3 0 0 1-3-3V6"/><path d="M16 13h4"/>',
    box: '<path d="m21 8-9 5-9-5 9-5 9 5Z"/><path d="M3 8v8l9 5 9-5V8M12 13v8"/>',
    bars: '<path d="M4 20V10M10 20V4M16 20v-7M21 20H3"/>',
    exchange: '<path d="M7 7h11l-3-3M17 17H6l3 3"/>',
    spark: '<path d="m12 3 1.5 4.5L18 9l-4.500 1.500L12 15l-1.500-4.500L6 9l4.500-1.500L12 3Z"/>',
    audit: '<path d="M4 4h16v16H4z"/><path d="M8 9h8M8 13h5M8 17h7"/>',
    guide: '<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20V3H6.5A2.5 2.5 0 0 0 4 5.5v14Z"/><path d="M8 7h8M8 11h6"/>',
    film: '<rect x="2" y="2" width="20" height="20" rx="2.18" ry="2.18"/><line x1="7" y1="2" x2="7" y2="22"/><line x1="17" y1="2" x2="17" y2="22"/><line x1="2" y1="12" x2="22" y2="12"/><line x1="2" y1="7" x2="7" y2="7"/><line x1="2" y1="17" x2="7" y2="17"/><line x1="17" y1="17" x2="22" y2="17"/><line x1="17" y1="7" x2="22" y2="7"/>',
  };
  /* أيقونات الشاشات والأقسام: مسطحة مصمتة بلونين كرسوم العرض التعريفي. الألوان من متغيرات CSS:
     a أخضر الهوية، b ذهبي، d نعناعي، c لون ما خلف الأيقونة. أدوات الواجهة العامة (سهم، بحث، إغلاق) تبقى خطية. */
  const FILL = {"home":"<path class=\"a\" d=\"M12 3 2.8 10.7l1.3 1.5.9-.8V21h14v-9.6l.9.8 1.3-1.5z\"/><path class=\"b\" d=\"M10 21v-5.2a2 2 0 0 1 4 0V21z\"/>","housing":"<path class=\"a\" d=\"M5 11.2 12 5.8l7 5.4V21H5z\"/><path class=\"d\" d=\"M12 2.8 22 10.6l-1.2 1.6L12 5.3l-8.8 6.9L2 10.6z\"/><path class=\"b\" d=\"M10.2 21v-5h3.6v5z\"/><rect class=\"c\" x=\"6.8\" y=\"12.4\" width=\"2.4\" height=\"2.2\" rx=\"0.4\"/><rect class=\"c\" x=\"14.8\" y=\"12.4\" width=\"2.4\" height=\"2.2\" rx=\"0.4\"/>","guide":"<path class=\"a\" d=\"M3 5.2c3.2-.9 6.1-.5 8.3 1.1V20c-2.2-1.5-5.1-1.9-8.3-1z\"/><path class=\"d\" d=\"M21 5.2c-3.2-.9-6.1-.5-8.3 1.1V20c2.2-1.5 5.1-1.9 8.3-1z\"/><rect class=\"c\" x=\"5.1\" y=\"9\" width=\"4\" height=\"1.4\" rx=\"0.7\"/><rect class=\"c\" x=\"5.1\" y=\"12\" width=\"4\" height=\"1.4\" rx=\"0.7\"/><rect class=\"b\" x=\"14.9\" y=\"9\" width=\"4\" height=\"1.4\" rx=\"0.7\"/>","bars":"<rect class=\"a\" x=\"3\" y=\"12\" width=\"4.2\" height=\"9\" rx=\"1.2\"/><rect class=\"b\" x=\"9.9\" y=\"7\" width=\"4.2\" height=\"14\" rx=\"1.2\"/><rect class=\"d\" x=\"16.8\" y=\"3\" width=\"4.2\" height=\"18\" rx=\"1.2\"/>","wallet":"<rect class=\"a\" x=\"2.5\" y=\"6.5\" width=\"19\" height=\"14\" rx=\"2.6\"/><path class=\"d\" d=\"M4.5 6.5 15.6 3.2l1.3 3.3z\"/><rect class=\"b\" x=\"14\" y=\"11\" width=\"7.5\" height=\"5\" rx=\"1.6\"/><circle class=\"c\" cx=\"17\" cy=\"13.5\" r=\"1\"/>","file":"<path class=\"a\" d=\"M6 2.5h8.5L19 7v14.5H6z\"/><path class=\"d\" d=\"M14.5 2.5V7H19z\"/><rect class=\"b\" x=\"8.5\" y=\"11\" width=\"7\" height=\"1.5\" rx=\"0.75\"/><rect class=\"c\" x=\"8.5\" y=\"14.5\" width=\"7\" height=\"1.5\" rx=\"0.75\"/><rect class=\"c\" x=\"8.5\" y=\"18\" width=\"4.5\" height=\"1.5\" rx=\"0.75\"/>","users":"<circle class=\"d\" cx=\"16.5\" cy=\"7.6\" r=\"3\"/><path class=\"d\" d=\"M11 20.5c.3-4 2.6-6.3 5.5-6.3s5.2 2.3 5.5 6.3z\"/><circle class=\"b\" cx=\"9\" cy=\"8.4\" r=\"3.6\"/><path class=\"a\" d=\"M2 21.5c.3-4.7 3.1-7.4 7-7.4s6.7 2.7 7 7.4z\"/>","book":"<path class=\"a\" d=\"M5 3.5h12.5A1.5 1.5 0 0 1 19 5v15.5H7a2 2 0 0 1-2-2z\"/><rect class=\"c\" x=\"7\" y=\"17.4\" width=\"12\" height=\"1.5\" rx=\"0.4\"/><path class=\"b\" d=\"M12.5 3.5H16v7l-1.75-1.4-1.75 1.4z\"/>","news":"<path class=\"a\" d=\"M3 9.3h4l8.5-5v15.4L7 14.7H3z\"/><path class=\"d\" d=\"M4.6 14.7h3.2l1 5.3H6z\"/><path class=\"b\" d=\"M18 9a4 4 0 0 1 0 6l-1.1-1.1a2.5 2.5 0 0 0 0-3.8z\"/><path class=\"b\" d=\"M20.3 6.7a7.3 7.3 0 0 1 0 10.6l-1.1-1.1a5.8 5.8 0 0 0 0-8.4z\"/>","exchange":"<path class=\"a\" d=\"M3 6.2h12.2V3.4l5.3 4.4-5.3 4.4V9.4H3z\"/><path class=\"b\" d=\"M21 17.8H8.8v2.8l-5.3-4.4 5.3-4.4v2.8H21z\"/>","mail":"<rect class=\"a\" x=\"2.5\" y=\"5.5\" width=\"19\" height=\"14.5\" rx=\"2.6\"/><path class=\"c\" d=\"M3.6 7.6 12 13.3l8.4-5.7v2.1L12 15.4 3.6 9.7z\"/><circle class=\"b\" cx=\"19.2\" cy=\"5.6\" r=\"3.3\"/>","briefcase":"<path class=\"d\" d=\"M8.5 7.2V5a2 2 0 0 1 2-2h3a2 2 0 0 1 2 2v2.2h-2V5h-3v2.2z\"/><rect class=\"a\" x=\"2.5\" y=\"7.2\" width=\"19\" height=\"13.3\" rx=\"2.6\"/><rect class=\"c\" x=\"2.5\" y=\"12.3\" width=\"19\" height=\"1.6\" rx=\"0\"/><rect class=\"b\" x=\"10.3\" y=\"11\" width=\"3.4\" height=\"4.2\" rx=\"0.9\"/>","box":"<path class=\"b\" d=\"M12 2.8 21 7.3 12 11.8 3 7.3z\"/><path class=\"a\" d=\"M3 8.7l8.3 4.2v8.7L3 17.3z\"/><path class=\"d\" d=\"M21 8.7l-8.3 4.2v8.7l8.3-4.3z\"/>","settings":"<rect class=\"a\" x=\"8.5\" y=\"2.8499999999999996\" width=\"3\" height=\"3.9000000000000004\" rx=\"0.75\" transform=\"rotate(0 10 10.5)\"/><rect class=\"a\" x=\"8.5\" y=\"2.8499999999999996\" width=\"3\" height=\"3.9000000000000004\" rx=\"0.75\" transform=\"rotate(45 10 10.5)\"/><rect class=\"a\" x=\"8.5\" y=\"2.8499999999999996\" width=\"3\" height=\"3.9000000000000004\" rx=\"0.75\" transform=\"rotate(90 10 10.5)\"/><rect class=\"a\" x=\"8.5\" y=\"2.8499999999999996\" width=\"3\" height=\"3.9000000000000004\" rx=\"0.75\" transform=\"rotate(135 10 10.5)\"/><rect class=\"a\" x=\"8.5\" y=\"2.8499999999999996\" width=\"3\" height=\"3.9000000000000004\" rx=\"0.75\" transform=\"rotate(180 10 10.5)\"/><rect class=\"a\" x=\"8.5\" y=\"2.8499999999999996\" width=\"3\" height=\"3.9000000000000004\" rx=\"0.75\" transform=\"rotate(225 10 10.5)\"/><rect class=\"a\" x=\"8.5\" y=\"2.8499999999999996\" width=\"3\" height=\"3.9000000000000004\" rx=\"0.75\" transform=\"rotate(270 10 10.5)\"/><rect class=\"a\" x=\"8.5\" y=\"2.8499999999999996\" width=\"3\" height=\"3.9000000000000004\" rx=\"0.75\" transform=\"rotate(315 10 10.5)\"/><circle class=\"a\" cx=\"10\" cy=\"10.5\" r=\"6\"/><circle class=\"c\" cx=\"10\" cy=\"10.5\" r=\"2.4\"/><rect class=\"b\" x=\"17\" y=\"13.7\" width=\"2\" height=\"2.6\" rx=\"0.5\" transform=\"rotate(0 18 18.2)\"/><rect class=\"b\" x=\"17\" y=\"13.7\" width=\"2\" height=\"2.6\" rx=\"0.5\" transform=\"rotate(45 18 18.2)\"/><rect class=\"b\" x=\"17\" y=\"13.7\" width=\"2\" height=\"2.6\" rx=\"0.5\" transform=\"rotate(90 18 18.2)\"/><rect class=\"b\" x=\"17\" y=\"13.7\" width=\"2\" height=\"2.6\" rx=\"0.5\" transform=\"rotate(135 18 18.2)\"/><rect class=\"b\" x=\"17\" y=\"13.7\" width=\"2\" height=\"2.6\" rx=\"0.5\" transform=\"rotate(180 18 18.2)\"/><rect class=\"b\" x=\"17\" y=\"13.7\" width=\"2\" height=\"2.6\" rx=\"0.5\" transform=\"rotate(225 18 18.2)\"/><rect class=\"b\" x=\"17\" y=\"13.7\" width=\"2\" height=\"2.6\" rx=\"0.5\" transform=\"rotate(270 18 18.2)\"/><rect class=\"b\" x=\"17\" y=\"13.7\" width=\"2\" height=\"2.6\" rx=\"0.5\" transform=\"rotate(315 18 18.2)\"/><circle class=\"b\" cx=\"18\" cy=\"18.2\" r=\"3.4\"/><circle class=\"c\" cx=\"18\" cy=\"18.2\" r=\"1.3\"/>","upload":"<path class=\"a\" d=\"M3 14h3.6v3.6h10.8V14H21v7H3z\"/><path class=\"b\" d=\"M12 2.4l5.3 5.6h-3.4v6.4h-3.8V8H6.7z\"/>","download":"<path class=\"a\" d=\"M3 14h3.6v3.6h10.8V14H21v7H3z\"/><path class=\"b\" d=\"M12 15.5 6.7 9.9h3.4V3.4h3.8v6.5h3.4z\"/>","calendar":"<rect class=\"a\" x=\"3\" y=\"4.8\" width=\"18\" height=\"16.7\" rx=\"2.6\"/><rect class=\"c\" x=\"5\" y=\"9.8\" width=\"14\" height=\"9.7\" rx=\"1.2\"/><rect class=\"b\" x=\"7\" y=\"2.6\" width=\"2.2\" height=\"5\" rx=\"1.1\"/><rect class=\"b\" x=\"14.8\" y=\"2.6\" width=\"2.2\" height=\"5\" rx=\"1.1\"/><rect class=\"d\" x=\"7\" y=\"11.8\" width=\"2.6\" height=\"2.4\" rx=\"0.5\"/><rect class=\"d\" x=\"10.7\" y=\"11.8\" width=\"2.6\" height=\"2.4\" rx=\"0.5\"/><rect class=\"b\" x=\"14.4\" y=\"11.8\" width=\"2.6\" height=\"2.4\" rx=\"0.5\"/><rect class=\"d\" x=\"7\" y=\"15.4\" width=\"2.6\" height=\"2.4\" rx=\"0.5\"/><rect class=\"d\" x=\"10.7\" y=\"15.4\" width=\"2.6\" height=\"2.4\" rx=\"0.5\"/>","shield":"<path class=\"a\" d=\"M12 2.5 20 5.6v6c0 4.9-3.3 8.4-8 10.4-4.7-2-8-5.5-8-10.4v-6z\"/><rect class=\"b\" x=\"9\" y=\"11\" width=\"6\" height=\"5.2\" rx=\"1.1\"/><path class=\"b\" d=\"M9.9 11.2V9.6a2.1 2.1 0 0 1 4.2 0v1.6h-1.4V9.6a.7.7 0 0 0-1.4 0v1.6z\"/>","audit":"<path class=\"a\" d=\"M4 2.5h9l3.5 3.5v5.3a6.2 6.2 0 0 0-6.6 10.2H4z\"/><rect class=\"c\" x=\"6.2\" y=\"7.5\" width=\"6\" height=\"1.4\" rx=\"0.7\"/><rect class=\"c\" x=\"6.2\" y=\"10.6\" width=\"4.4\" height=\"1.4\" rx=\"0.7\"/><circle class=\"b\" cx=\"16.2\" cy=\"16.2\" r=\"4.7\"/><circle class=\"c\" cx=\"16.2\" cy=\"16.2\" r=\"2.8\"/><path class=\"b\" d=\"M19.3 18.4l3 3-1.4 1.4-3-3z\"/>","check":"<circle class=\"a\" cx=\"12\" cy=\"12\" r=\"9.5\"/><path class=\"c\" d=\"M7.4 12.4l1.4-1.4 2.3 2.3 4.9-4.9 1.4 1.4-6.3 6.3z\"/>","clock":"<circle class=\"a\" cx=\"12\" cy=\"12\" r=\"9.5\"/><path class=\"c\" d=\"M11.2 6.3h1.6v5.4l3.6 2.2-.8 1.4-4.4-2.7z\"/><circle class=\"b\" cx=\"12\" cy=\"12\" r=\"1.3\"/>","library":"<rect class=\"a\" x=\"2.6\" y=\"4.2\" width=\"3.6\" height=\"16.3\" rx=\"0.8\"/><rect class=\"b\" x=\"7.2\" y=\"2.6\" width=\"3.6\" height=\"17.9\" rx=\"0.8\"/><rect class=\"d\" x=\"11.8\" y=\"5.4\" width=\"3.6\" height=\"15.1\" rx=\"0.8\"/><path class=\"a\" d=\"M16.4 6.6l3.1-.8 2.7 13.9-3.1.8z\"/><rect class=\"a\" x=\"1.8\" y=\"20.5\" width=\"20.4\" height=\"1.6\" rx=\"0.6\"/>","research":"<path class=\"a\" d=\"M8.8 2.5h6.4v1.8h-1.1v4.6l5.6 9.6A2.3 2.3 0 0 1 17.7 22H6.3a2.3 2.3 0 0 1-2-3.5l5.6-9.6V4.3H8.8z\"/><path class=\"d\" d=\"M6.6 15.9h10.8l1.7 3c.4.7-.1 1.4-.9 1.4H5.8c-.8 0-1.3-.7-.9-1.4z\"/><circle class=\"c\" cx=\"10.2\" cy=\"18.2\" r=\"0.9\"/><circle class=\"c\" cx=\"13.6\" cy=\"17.4\" r=\"0.7\"/>","graduation":"<path class=\"d\" d=\"M6 11.4v4.5c0 1.8 2.7 3.6 6 3.6s6-1.8 6-3.6v-4.5L12 14.4z\"/><path class=\"a\" d=\"M12 3 1.5 8.2 12 13.4l10.5-5.2z\"/><rect class=\"b\" x=\"19.3\" y=\"9.2\" width=\"1.3\" height=\"5.6\" rx=\"0.6\"/><circle class=\"b\" cx=\"19.95\" cy=\"15.6\" r=\"1.4\"/>","quality":"<path class=\"a\" d=\"M7.2 12.6 4.6 21.2l3.2-1.2 2 2.6 1.8-6.2z\"/><path class=\"d\" d=\"M16.8 12.6l2.6 8.6-3.2-1.2-2 2.6-1.8-6.2z\"/><circle class=\"b\" cx=\"12\" cy=\"9\" r=\"6.8\"/><path class=\"c\" d=\"M12 5.3l1.1 2.3 2.5.3-1.8 1.7.5 2.5-2.3-1.2-2.3 1.2.5-2.5-1.8-1.7 2.5-.3z\"/>","clipboard":"<rect class=\"a\" x=\"4\" y=\"4\" width=\"16\" height=\"18\" rx=\"2.6\"/><rect class=\"b\" x=\"8.5\" y=\"2\" width=\"7\" height=\"4.2\" rx=\"1.3\"/><rect class=\"c\" x=\"7.3\" y=\"10\" width=\"9.4\" height=\"1.5\" rx=\"0.75\"/><rect class=\"c\" x=\"7.3\" y=\"13.5\" width=\"9.4\" height=\"1.5\" rx=\"0.75\"/><rect class=\"c\" x=\"7.3\" y=\"17\" width=\"5.6\" height=\"1.5\" rx=\"0.75\"/>","spark":"<rect class=\"b\" x=\"8.6\" y=\"2.4\" width=\"1.5\" height=\"3.4\" rx=\"0.7\"/><rect class=\"b\" x=\"8.6\" y=\"18.2\" width=\"1.5\" height=\"3.4\" rx=\"0.7\"/><rect class=\"b\" x=\"11.3\" y=\"2.4\" width=\"1.5\" height=\"3.4\" rx=\"0.7\"/><rect class=\"b\" x=\"11.3\" y=\"18.2\" width=\"1.5\" height=\"3.4\" rx=\"0.7\"/><rect class=\"b\" x=\"14\" y=\"2.4\" width=\"1.5\" height=\"3.4\" rx=\"0.7\"/><rect class=\"b\" x=\"14\" y=\"18.2\" width=\"1.5\" height=\"3.4\" rx=\"0.7\"/><rect class=\"b\" x=\"2.4\" y=\"8.6\" width=\"3.4\" height=\"1.5\" rx=\"0.7\"/><rect class=\"b\" x=\"18.2\" y=\"8.6\" width=\"3.4\" height=\"1.5\" rx=\"0.7\"/><rect class=\"b\" x=\"2.4\" y=\"11.3\" width=\"3.4\" height=\"1.5\" rx=\"0.7\"/><rect class=\"b\" x=\"18.2\" y=\"11.3\" width=\"3.4\" height=\"1.5\" rx=\"0.7\"/><rect class=\"b\" x=\"2.4\" y=\"14\" width=\"3.4\" height=\"1.5\" rx=\"0.7\"/><rect class=\"b\" x=\"18.2\" y=\"14\" width=\"3.4\" height=\"1.5\" rx=\"0.7\"/><rect class=\"a\" x=\"5.8\" y=\"5.8\" width=\"12.4\" height=\"12.4\" rx=\"2.6\"/><rect class=\"d\" x=\"9\" y=\"9\" width=\"6\" height=\"6\" rx=\"1.3\"/>","lms":"<rect class=\"a\" x=\"3.5\" y=\"3.8\" width=\"17\" height=\"12.4\" rx=\"1.9\"/><rect class=\"c\" x=\"5.2\" y=\"5.5\" width=\"13.6\" height=\"9\" rx=\"0.8\"/><path class=\"b\" d=\"M10.4 7.5v5l4.2-2.5z\"/><path class=\"d\" d=\"M1.5 17.3h21l-1.4 2.4H2.9z\"/>","key":"<circle class=\"b\" cx=\"7.4\" cy=\"12\" r=\"5.1\"/><circle class=\"c\" cx=\"7.4\" cy=\"12\" r=\"2\"/><rect class=\"b\" x=\"11.4\" y=\"10.6\" width=\"10.6\" height=\"2.8\" rx=\"1\"/><rect class=\"b\" x=\"17.3\" y=\"13\" width=\"2.2\" height=\"3\" rx=\"0.5\"/><rect class=\"b\" x=\"20\" y=\"13\" width=\"2\" height=\"2.4\" rx=\"0.5\"/><circle class=\"a\" cx=\"7.4\" cy=\"12\" r=\"0.8\"/>","hall":"<rect class=\"a\" x=\"3.2\" y=\"2.8\" width=\"10.2\" height=\"18.7\" rx=\"1.3\"/><rect class=\"c\" x=\"5\" y=\"4.6\" width=\"6.6\" height=\"16.9\" rx=\"0.4\"/><circle class=\"b\" cx=\"9.9\" cy=\"13\" r=\"0.95\"/><rect class=\"d\" x=\"15.2\" y=\"8.6\" width=\"6\" height=\"8.6\" rx=\"1.6\"/><rect class=\"c\" x=\"16.4\" y=\"10\" width=\"3.6\" height=\"2.6\" rx=\"0.5\"/><rect class=\"b\" x=\"16.6\" y=\"14\" width=\"3.2\" height=\"1.4\" rx=\"0.7\"/>","compass":"<circle class=\"a\" cx=\"12\" cy=\"12\" r=\"9.5\"/><circle class=\"c\" cx=\"12\" cy=\"12\" r=\"7.2\"/><path class=\"b\" d=\"M12 5.2l2.3 6.8H9.7z\"/><path class=\"d\" d=\"M12 18.8l-2.3-6.8h4.6z\"/>","layers":"<path class=\"b\" d=\"M3.7 15.2 12 19.6l8.3-4.4 1.2.7L12 21.4 2.5 15.9z\"/><path class=\"d\" d=\"M3.7 11.4 12 15.8l8.3-4.4 1.2.7L12 17.6 2.5 12.1z\"/><path class=\"a\" d=\"M12 3 21.5 8 12 13 2.5 8z\"/>","idcard":"<rect class=\"a\" x=\"2.5\" y=\"5\" width=\"19\" height=\"14\" rx=\"2.6\"/><circle class=\"b\" cx=\"8\" cy=\"10.4\" r=\"2.2\"/><path class=\"b\" d=\"M4.8 16.4c.5-1.9 1.8-2.9 3.2-2.9s2.7 1 3.2 2.9z\"/><rect class=\"c\" x=\"13\" y=\"9.4\" width=\"6\" height=\"1.4\" rx=\"0.7\"/><rect class=\"c\" x=\"13\" y=\"12.4\" width=\"4.4\" height=\"1.4\" rx=\"0.7\"/>","grid":"<rect class=\"a\" x=\"3\" y=\"3\" width=\"8\" height=\"8\" rx=\"2\"/><rect class=\"b\" x=\"13\" y=\"3\" width=\"8\" height=\"8\" rx=\"2\"/><rect class=\"d\" x=\"3\" y=\"13\" width=\"8\" height=\"8\" rx=\"2\"/><rect class=\"a\" x=\"13\" y=\"13\" width=\"8\" height=\"8\" rx=\"2\"/>","chart":"<rect class=\"a\" x=\"3\" y=\"12\" width=\"4.2\" height=\"9\" rx=\"1.2\"/><rect class=\"b\" x=\"9.9\" y=\"7\" width=\"4.2\" height=\"14\" rx=\"1.2\"/><rect class=\"d\" x=\"16.8\" y=\"3\" width=\"4.2\" height=\"18\" rx=\"1.2\"/>","cap":"<path class=\"d\" d=\"M6 11.4v4.5c0 1.8 2.7 3.6 6 3.6s6-1.8 6-3.6v-4.5L12 14.4z\"/><path class=\"a\" d=\"M12 3 1.5 8.2 12 13.4l10.5-5.2z\"/><rect class=\"b\" x=\"19.3\" y=\"9.2\" width=\"1.3\" height=\"5.6\" rx=\"0.6\"/><circle class=\"b\" cx=\"19.95\" cy=\"15.6\" r=\"1.4\"/>"};
  const ico = (n, s = 20) => FILL[n]
    ? `<svg class="fi" width="${s}" height="${s}" viewBox="0 0 24 24" aria-hidden="true">${FILL[n]}</svg>`
    : `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICO[n] || ''}</svg>`;
  const NAV_ICON = { councils: 'users', desk: 'home', overview: 'home', enterprise: 'layers', home: 'home', guide: 'guide', grades: 'bars', fees: 'wallet', tx: 'file', affairs: 'users', student_life: 'housing', labtools: 'library', dashboard: 'bars', academics: 'book', comms: 'news', exchange: 'exchange', internal: 'file', corr: 'mail', hr: 'briefcase', payroll: 'briefcase', procurement: 'box', finance: 'wallet', settings: 'settings', units: 'layers', import: 'upload', export: 'download', attendance: 'hall', admin: 'settings', access: 'key', audit: 'audit', verify: 'check', lms: 'lms', research: 'research', alumni: 'graduation', qa: 'quality', expansions: 'clipboard', devops: 'settings', ai: 'spark', guidelines: 'compass' };
  /* أيقونات التبويبات الفرعية في القائمة الجانبية: بمفتاح التبويب أولاً، ثم بكلمات عنوانه، وإلا أيقونة ملف.
     تُزال الرموز التعبيرية من أول العنوان كي تتوحد التبويبات كلها على أيقونات الهوية. */
  const SUB_ICON = {
    unified: 'home', work: 'briefcase', myprofile: 'idcard', admissions: 'graduation', renewal: 'calendar', promotion: 'chart', appeals: 'shield', exhaustion: 'clock',
    requests: 'clipboard', list: 'users', new: 'cap', groups: 'layers', digital_card: 'idcard', advising: 'compass', lifecycle: 'exchange', scholarships: 'wallet', desk_queue: 'clock',
    my_grades: 'chart', courses: 'book', grades: 'bars', gpa_sim: 'graduation', members: 'users',
    scan: 'idcard', log: 'audit', smart_schedule: 'calendar',
    payroll: 'wallet', att_leaves: 'clock', biometrics: 'key', appraisals: 'quality', enterprise_hr: 'briefcase',
    in: 'download', out: 'upload', internal_requests: 'clipboard', internal_new: 'file', pending_all: 'check', new_corr: 'mail', tpl: 'layers', notifs: 'spark',
    stats: 'chart', departments: 'hall', devops: 'settings', import: 'upload', export: 'download', news: 'news', complaints: 'mail',
    general: 'settings', mysettings: 'idcard', rules: 'check', programs: 'graduation', units: 'grid', verify: 'shield', backup: 'box', identity: 'spark', services: 'briefcase', waf: 'shield',
    users: 'users', roles: 'idcard', matrix: 'layers',
    chain: 'audit', hc_perf: 'chart', archify: 'layers', logs: 'file', exec_offline: 'quality',
    depts: 'hall', hierarchy: 'layers', corr_rules: 'mail', governance: 'shield',
  };
  const SUB_WORD = [
    [/امتحان|اختبار|تظلم/, 'calendar'], [/ترقي/, 'research'], [/مبان|غرف|سكن/, 'housing'], [/احتياج|مستودع|مخز|أصناف|جرد/, 'box'],
    [/محاضر|محتوى رقمي|تعلم/, 'lms'], [/بنك الأسئلة|أسئلة/, 'clipboard'], [/قبول|مفاضلة|معادلة/, 'graduation'], [/ساعات مكتبية|حجوز|موعد|دوام|حضور/, 'clock'],
    [/مكتبة|إعارة/, 'library'], [/أندية|نشاط|أنشطة/, 'spark'], [/أبحاث|بحث|مشاريع/, 'research'], [/ماجستير|دكتوراه|رسائل/, 'book'],
    [/خريج/, 'cap'], [/وظائف|تدريب|موردون|مورد/, 'briefcase'], [/مؤشر|KPI|إحصاء|المركز المالي/, 'chart'], [/تقييم|جودة/, 'quality'],
    [/اعتماد|حماية|أمن|رقابة/, 'shield'], [/إنذار/, 'bars'], [/مرشد|إرشاد|خطة/, 'compass'], [/تصنيف|ذكي|ذكاء/, 'spark'],
    [/لوحة|منظومة/, 'grid'], [/شراء|توريد|حركة|حركات/, 'exchange'], [/أصول|عهد|مفات/, 'key'], [/شجرة|هيكل|قوالب/, 'layers'],
    [/قيود|يومية|دليل/, 'book'], [/تكامل|ربط/, 'exchange'], [/تقارير|قوائم|سجل/, 'file'], [/رسوم|أقساط/, 'cap'], [/خزينة|سندات|ذمم|رواتب|منح|مالي/, 'wallet'],
    [/طلاب|طالب|موظف|أعضاء|حسابات|مستخدم/, 'users'], [/مراسل|بريد|كتاب|شكاو/, 'mail'], [/أخبار|تعميم/, 'news'], [/إعداد/, 'settings'],
    [/جدول/, 'calendar'], [/قسم|أقسام|كلي|وحد/, 'hall'],
  ];
  const subLabel = (t) => String(t || '').replace(/^[\s‍️\p{Extended_Pictographic}]+/u, '').trim();
  const subIcon = (key, label) => {
    const l = subLabel(label);
    const n = SUB_ICON[key] || (SUB_WORD.find(([re]) => re.test(l)) || [])[1] || 'file';
    return ico(n, 16);
  };
  const PARENT = { site: 'admin', services: 'admin' };
  /* مجموعات القائمة الجانبية وترتيبها */
  const NAV_GROUP = {
    overview: 'الرئيسية', desk: 'الرئيسية',
    affairs: 'الشؤون الطلابية', student_life: 'الشؤون الطلابية',
    academics: 'الشؤون الأكاديمية', attendance: 'الشؤون الأكاديمية', expansions: 'الشؤون الأكاديمية', lms: 'الشؤون الأكاديمية', research: 'الشؤون الأكاديمية', alumni: 'الشؤون الأكاديمية', qa: 'الشؤون الأكاديمية',
    payroll: 'الإدارة والموارد', hr: 'الإدارة والموارد', corr: 'الإدارة والموارد', councils: 'الإدارة والموارد', internal: 'الإدارة والموارد', finance: 'الإدارة والموارد', procurement: 'الإدارة والموارد',
    dashboard: 'البيانات والتقارير', exchange: 'البيانات والتقارير', ai: 'البيانات والتقارير', comms: 'البيانات والتقارير',
    admin: 'الإدارة والحوكمة', access: 'الإدارة والحوكمة', audit: 'الإدارة والحوكمة', units: 'الإدارة والحوكمة', verify: 'الإدارة والحوكمة', guidelines: 'الإدارة والحوكمة',
    labtools: 'أدوات تجريبية',
  };
  const NAV_ORDER = ['overview', 'desk', 'affairs', 'student_life', 'academics', 'attendance', 'expansions', 'lms', 'research', 'alumni', 'qa', 'payroll', 'hr', 'corr', 'councils', 'internal', 'finance', 'procurement', 'dashboard', 'exchange', 'ai', 'comms', 'admin', 'access', 'audit', 'units', 'verify', 'guidelines', 'labtools'];
  const SIDE_LABEL = { corr: 'الديوان والمراسلات', guidelines: 'دليل الإرشادات التفاعلي' };
  const EXTRA_LABEL = { site: 'إعدادات الموقع', services: 'الخدمات' };

  /* ---------- أدوات ---------- */
  const nf = new Intl.NumberFormat('en-US');
  const initials = (n) => String(n || '').trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join(' ') || '؟';
  const ago = (t) => {
    const m = Math.max(1, Math.round((Date.now() - t) / 60000));
    if (m < 60) return `منذ ${m} دقيقة`;
    const h = Math.round(m / 60); if (h < 24) return `منذ ${h} ساعة`;
    return `منذ ${Math.round(h / 24)} يوماً`;
  };
  const dateLong = () => { try { return new Date().toLocaleDateString('ar-SY-u-nu-latn', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }); } catch { return new Date().toLocaleDateString(); } };
  const pending = () => {
    if (S.stats && S.stats.review !== undefined) return S.stats.review;
    if (X.data && X.data.stats) return X.data.stats.review;
    const list = (X.data && X.data.requests) || S.requests || [];
    return list.filter((r) => r.status === 'review').length;
  };

  /* ---------- تحميل بيانات لوحة التحكم ---------- */
  UA.loaders.overview = async () => {
    const D = { analytics: null, stats: null, requests: null };
    const jobs = [];
    if (can('stats:read')) {
      jobs.push(api('GET', '/api/analytics').then((r) => { D.analytics = r; }).catch(() => {}));
      jobs.push(api('GET', '/api/stats').then((r) => { D.stats = r.stats; S.stats = r.stats; }).catch(() => {}));
    }
    if (can('request:read_all') || can('request:read_unit')) jobs.push(api('GET', '/api/requests').then((r) => { D.requests = r.requests; }).catch(() => {}));
    await Promise.all(jobs);
    X.data = D;
  };

  /* ---------- لوحة التحكم ---------- */
  const statCard = (label, value, meta, icon, color, progress) => `<article class="sx-stat"><div class="sx-ic sx-${color}">${ico(icon, 22)}</div><div class="cp"><span>${label}</span><strong>${value}</strong></div>
    <div class="mt"><span>${meta}</span>${progress === undefined ? '' : `<div><i style="width:${Math.max(0, Math.min(100, progress))}%"></i></div>`}</div></article>`;

  function weekChart(reqs) {
    const now = new Date(); now.setHours(0, 0, 0, 0);
    const days = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now); d.setDate(now.getDate() - i);
      let label = ''; try { label = d.toLocaleDateString('ar-SY-u-nu-latn', { weekday: 'long' }); } catch { label = String(d.getDay()); }
      days.push({ from: d.getTime(), to: d.getTime() + 864e5, label, n: 0 });
    }
    reqs.forEach((r) => { const d = days.find((x) => r.createdAt >= x.from && r.createdAt < x.to); if (d) d.n++; });
    const top = Math.max(4, Math.ceil(Math.max(...days.map((d) => d.n)) / 4) * 4);
    const ys = [top, top * 0.75, top * 0.5, top * 0.25, 0].map((v) => `<span>${nf.format(Math.round(v * 10) / 10)}</span>`).join('');
    const cols = days.map((d) => `<div class="sx-col" title="${esc(d.label)}: ${d.n}"><div class="sx-track"><i style="height:${(d.n / top) * 100}%"><b>${d.n}</b></i></div><span>${esc(d.label)}</span></div>`).join('');
    return `<div class="sx-bars" role="img" aria-label="عدد الطلبات خلال آخر 7 أيام"><div class="sx-y">${ys}</div><div class="sx-plot">${cols}</div></div>`;
  }

  function donut(D, reqs, cnt) {
    const PAL = ['#054239', '#C9A24B', '#4DB6A0', '#0A5A4D', '#8A6A1B', '#1B7F4B'];
    const fac = D.analytics && D.analytics.tables.find((t) => t.id === 'byFaculty');
    let rows, total, center, title, sub;
    if (fac && fac.rows.some((r) => r[1] > 0)) {
      const all = fac.rows.filter((r) => r[1] > 0).sort((a, b) => b[1] - a[1]);
      rows = all.slice(0, 5).map((r, i) => [r[0], r[1], PAL[i]]);
      const rest = all.slice(5).reduce((s, r) => s + r[1], 0); if (rest) rows.push(['أخرى', rest, PAL[5]]);
      total = rows.reduce((s, r) => s + r[1], 0); center = 'إجمالي الطلاب'; title = 'توزيع الطلاب'; sub = 'حسب الكلية أو المعهد';
    } else {
      rows = [['قيد المراجعة', cnt.review, '#D5B65D'], ['معتمدة', cnt.approved, '#0E6655'], ['مرفوضة', cnt.rejected, '#B3261E']].filter((r) => r[1] > 0);
      total = rows.reduce((s, r) => s + r[1], 0); center = 'إجمالي الطلبات'; title = 'حالة الطلبات'; sub = 'توزيع الطلبات الظاهرة لك';
    }
    if (!total) return `<article class="sx-panel"><div class="sx-ph"><div><h2>${title}</h2><p>${sub}</p></div></div><div class="sx-empty">لا بيانات لعرضها بعد.</div></article>`;
    let acc = 0;
    const stops = rows.map((r) => { const a = acc, b = acc + (r[1] / total) * 100; acc = b; return `${r[2]} ${a}% ${b}%`; }).join(', ');
    const legend = rows.map((r) => `<div><i style="background:${r[2]}"></i><span>${esc(r[0])}</span><b>${Math.round((r[1] / total) * 100)}%</b></div>`).join('');
    return `<article class="sx-panel"><div class="sx-ph"><div><h2>${title}</h2><p>${sub}</p></div></div>
      <div class="sx-donut-w"><div class="sx-donut" style="background:conic-gradient(${stops})" role="img" aria-label="${title}"><div><strong>${nf.format(total)}</strong><span>${center}</span></div></div><div class="sx-legend">${legend}</div></div></article>`;
  }

  // أجزاء مؤشرات الجامعة؛ تركّبها اللوحة الرئيسية في ux_restructure.js مع أجزاء «مكتبي»
  UA.homeParts = function () {
    const D = X.data || { analytics: null, stats: null, requests: null };
    const reqs = (D.requests || []).slice().sort((a, b) => b.createdAt - a.createdAt);
    const cnt = { review: 0, approved: 0, rejected: 0 };
    reqs.forEach((r) => { if (cnt[r.status] !== undefined) cnt[r.status]++; });
    const st = D.stats;
    const total = st ? st.review + st.approved + st.rejected : reqs.length;
    const review = st ? st.review : cnt.review, approved = st ? st.approved : cnt.approved, rejected = st ? st.rejected : cnt.rejected;
    const decided = approved + rejected;
    const kpi = (id) => D.analytics && D.analytics.kpis.find((k) => k.id === id);
    const cards = [];
    const hasReqData = !!(st || D.requests);
    if (kpi('students')) cards.push(statCard('الطلاب المقيَّدون', nf.format(kpi('students').value), esc(kpi('students').hint || ''), 'users', 'mint'));
    if (hasReqData) cards.push(statCard('إجمالي الطلبات', nf.format(total), `${nf.format(approved)} معتمدة · ${nf.format(rejected)} مرفوضة`, 'file', 'sand'));
    if (hasReqData) cards.push(statCard('طلبات قيد المراجعة', nf.format(review), st && st.slaBreaches ? `${nf.format(st.slaBreaches)} متأخرة عن مدة الخدمة` : 'لا طلبات متأخرة عن المدة', 'clock', 'blue', total ? (review / total) * 100 : 0));
    if (hasReqData) cards.push(statCard('نسبة الاعتماد', decided ? `${Math.round((approved / decided) * 1000) / 10}%` : '—', st && st.avgApprovalMs ? `متوسط زمن الاعتماد ${UA.dur(st.avgApprovalMs)}` : 'من الطلبات المبتوت فيها', 'check', 'lav', decided ? (approved / decided) * 100 : 0));

    const rows = reqs.slice(0, 6).map((r) => {
      const m = { review: ['amber', 'قيد المراجعة'], approved: ['green', 'معتمد'], rejected: ['red', 'مرفوض'] }[r.status] || ['amber', r.status];
      return `<tr><td><div class="sx-sc"><span>${esc(initials(r.student.name))}</span><div><strong>${esc(r.student.name)}</strong><small>${esc(r.student.studentNo || r.no)}</small></div></div></td>
        <td data-l="نوع الطلب">${esc(r.service.label)}</td><td class="sx-muted" data-l="وقت التقديم">${ago(r.createdAt)}</td><td data-l="الحالة"><span class="sx-st ${m[0]}"><i></i>${m[1]}</span></td>
        <td><button class="sx-go" data-sx="openreq" data-id="${r.id}" aria-label="عرض طلب ${esc(r.student.name)}">${ico('chevron', 17)}</button></td></tr>`;
    }).join('');
    const reqPanel = D.requests ? `<article class="sx-panel"><div class="sx-ph"><div><h2>أحدث الطلبات</h2><p>آخر المعاملات الواردة إلى النظام</p></div>
        <button class="sx-link" data-sx="go" data-v="affairs">عرض جميع الطلبات ${ico('arrow', 16)}</button></div>
      <div class="sx-tscroll">${rows ? `<table class="sx-table rsp"><thead><tr><th>الطالب</th><th>نوع الطلب</th><th>وقت التقديم</th><th>الحالة</th><th></th></tr></thead><tbody>${rows}</tbody></table>` : '<div class="sx-empty">لا توجد طلبات حتى الآن.</div>'}</div></article>`
      : '';

    const views = new Set(UA.viewsFor(S.me.role).map((v) => v[0]));
    const qa = [];
    if (views.has('payroll')) qa.push(['mint', 'users', 'شؤون الموظفين والرواتب', 'ملفات العاملين، العقود، الإجازات، والرواتب', 'go', 'payroll']);
    if (views.has('finance')) qa.push(['blue', 'layers', 'المالية والمحاسبة', 'شجرة الحسابات، اليومية المزدوجة، والقوائم الختامية', 'go', 'finance']);
    if (views.has('procurement')) qa.push(['sand', 'layers', 'المشتريات والمخازن والأصول', 'طلبات الشراء، التوريد، الجرد، والأصول الثابتة', 'go', 'procurement']);
    if (views.has('corr') || views.has('internal')) qa.push(['lav', 'news', 'الديوان والمراسلات والطلبات الداخلية', 'الكتب الرسمية ومذكرات التوقيع والطلبات الداخلية الموحدة', 'go', 'corr']);
    if (can('student:register')) qa.push(['blue', 'users', 'تسجيل طالب جديد', 'إدراج طالب في السجل الأكاديمي الموحد', 'newstudent', '']);
    const quick = `<article class="sx-panel"><div class="sx-ph"><div><h2>المنظومات والوحدات الرئيسية</h2><p>انتقال سريع إلى الأنظمة المؤسسية المتكاملة</p></div><button class="sx-link" data-act="maindashtab" data-t="work">كل أقسامي ${ico('arrow', 16)}</button></div><div class="sx-quick">${qa.length ? qa.map((q) => `<button data-sx="${q[4]}" data-v="${q[5]}"><span class="sx-${q[0]}">${ico(q[1])}</span><div><strong>${q[2]}</strong><small>${q[3]}</small></div>${ico('chevron', 17)}</button>`).join('') : '<div class="sx-empty">لا إجراءات متاحة لحسابك.</div>'}</div></article>`;

    const activity = `<article class="sx-panel"><div class="sx-ph"><div><h2>نشاط الطلبات</h2><p>عدد الطلبات المستلمة خلال آخر 7 أيام</p></div></div>${weekChart(reqs)}</article>`;
    return {
      stats: cards.length ? `<section class="sx-stats" aria-label="مؤشرات الجامعة">${cards.join('')}</section>` : '',
      panels: D.requests
        ? `<section class="sx-grid-b">${reqPanel}${quick}</section><section class="sx-grid-a">${activity}${donut(D, reqs, cnt)}</section>`
        : (D.analytics ? `<section class="sx-grid-a">${donut(D, reqs, cnt)}${quick}</section>` : `<section class="sx-grid-b">${quick}</section>`),
    };
  };

  /* ---------- الهيكل ----------
     o (اختياري، تستعمله واجهة الطالب): views, act, active, label, root, search, notif {count,text,btn}, badges, help, menu */
  UA.shell = function shell(body, o = {}) {
    const tr = (s) => (window.UA && window.UA.i18n ? window.UA.i18n.tr(s) : s);
    const curLang = (window.UA && window.UA.i18n ? window.UA.i18n.getLang() : 'ar');
    const isEn = curLang === 'en';
    const curDir = isEn ? 'ltr' : 'rtl';
    const otherLangLabel = isEn ? 'العربية' : 'English';
    document.body.classList.add('sx-on');
    const views = o.views || UA.viewsFor(S.me.role);
    const act = o.act || 'view';
    const activeKey = o.active || PARENT[S.view] || S.view;
    const label = o.label || (views.find((v) => v[0] === S.view) || [])[1] || EXTRA_LABEL[S.view] || '';
    const review = o.notif ? o.notif.count : pending();
    const comp = X.data && X.data.analytics && X.data.analytics.kpis.find((k) => k.id === 'complaints');
    const badge = (k) => {
      if (o.badges) return o.badges[k] ? `<small>${o.badges[k]}</small>` : '';
      return k === 'affairs' && review ? `<small>${review}</small>` : (k === 'comms' && comp && comp.value ? `<small>${comp.value}</small>` : '');
    };
    const hasGroup = !o.views && views.some((v) => v[0] === 'affairs');
    const inGroup = hasGroup && S.view === 'affairs';
    document.body.classList.toggle('sx-grouped', !!inGroup);

    // قائمة الصفحات الرئيسية التي تمتلك تبويبات فرعية
    const HAS_SUB = { affairs: true, academics: true, attendance: true, payroll: true, export: true, admin: true, audit: true, corr: true, comms: true, access: true };
    const hasSubs = (v) => HAS_SUB[v] || (UA.gate && (UA.gate.TABS[v] || []).length > 1);

    const okTab = (act, tab) => !UA.gate || UA.gate.allowed(act, tab, S.me);
    const subs = () => {
      const t = S.stTab === 'edit' ? 'list' : S.stTab;
      const SECTIONS = [
        ['القبول', [['admissions', 'القبول والمفاضلة']]],
        ['السجل الطلابي', [can('student:read') && ['list', 'سجل الطلاب'], can('student:register') && ['new', 'تسجيل طالب جديد'], ['groups', 'فئات الطلاب'], ['renewal', 'تجديد القيد السنوي']]],
        ['الحركات والقرارات', [['lifecycle', 'حركات القيد والانضباط'], ['promotion', 'الترفيع السنوي'], ['appeals', 'التظلمات الانضباطية']]],
        ['الإرشاد', [['advising', 'الخطة والإرشاد والإنذار'], ['exhaustion', 'استنفاد سنوات الدراسة']]],
        ['الرعاية والمنح', [['scholarships', 'المنح والإعفاءات']]],
        ['الخدمات والوثائق', [['requests', can('request:decide') ? 'سجل الطلبات' : 'الطلبات'], ['digital_card', 'البطاقة الجامعية'], ['desk_queue', 'مكتب خدمة الطالب والدور']]],
      ];
      const btn = (x) => `<button data-sx="sub" data-v="affairs" data-t="${x[0]}"${S.view === 'affairs' && t === x[0] ? ' aria-current="true"' : ''}>${subIcon(x[0], x[1])}<span>${esc(x[1])}</span></button>`;
      // القسم بلا تبويب مسموح لا يظهر عنوانه
      const html = SECTIONS.map(([title, items]) => { const ok = items.filter(Boolean).filter((x) => okTab('sttab', x[0])); return ok.length ? `<div class="sx-sub-h" role="presentation">${esc(tr(title))}</div>${ok.map(btn).join('')}` : ''; }).join('');
      return `<div class="sx-sub-list" role="group" aria-label="شؤون الطلاب">${html}</div>`;
    };

    // تبويبات الصفحة الداخلية تظهر في القائمة الجانبية تحت عنوان الصفحة لسهولة التنقل الفوري
    let sideSub = '';
    if (!o.views && !inGroup) {
      const m = /<div class="sub-tabs[^"]*"[^>]*>([\s\S]*?)<\/div>/.exec(body);
      if (m) {
        const items = [...m[1].matchAll(/<button[^>]*data-act="([^"]+)"[^>]*data-(?:t|s)="([^"]*)"[^>]*aria-pressed="(true|false)"[^>]*>([\s\S]*?)<\/button>/g)];
        if (items.length) {
          sideSub = `<div class="sx-sub-list" role="group" aria-label="${esc(tr(label))}">${items.filter((x) => okTab(x[1], x[2])).map((x) => {
            const rawInner = x[4] || '';
            const bdgMatch = rawInner.match(/<span[^>]*class="[^"]*badge[^"]*"[^>]*>\s*([^<]+?)\s*<\/span>/i);
            const cleanTxt = rawInner
              .replace(/<kbd[^>]*>[\s\S]*?<\/kbd>/gi, '')
              .replace(/<span[^>]*class="[^"]*badge[^"]*"[^>]*>[\s\S]*?<\/span>/gi, '')
              .replace(/<[^>]+>/g, ' ')
              .replace(/\s+/g, ' ')
              .trim();
            const bdgVal = bdgMatch ? bdgMatch[1].trim() : '';
            const bdgHtml = bdgVal && bdgVal !== '0'
              ? `<small style="margin-inline-start:auto;background:rgba(213,182,93,.22);color:#C9A24B;padding:1px 7px;border-radius:99px;font-size:11px;font-weight:700">${esc(bdgVal)}</small>`
              : '';
            return `<button data-act="${x[1]}" data-t="${x[2]}" data-s="${x[2]}"${x[3] === 'true' ? ' aria-current="true"' : ''}>${subIcon(x[2], cleanTxt)}<span>${esc(subLabel(tr(cleanTxt)))}</span>${bdgHtml}</button>`;
          }).join('')}</div>`;
        }
      }
    }

    // الشريط الداخلي صار قائمة فرعية جانبية: نزيله من الصفحة كي لا يتكرّر ولا يلتصق أعلاها فيغطي الأزرار تحته.
    // لا نزيله إلا إن ظهرت القائمة الجانبية فعلاً (الصفحة الحالية ضمن عناصر القائمة)، وإلا اختفت التبويبات دون بديل.
    const pageBody = (sideSub && views.some((v) => v[0] === activeKey)) ? body.replace(/<div class="sub-tabs[^"]*"[^>]*>[\s\S]*?<\/div>/, '') : body;

    // عناوين المجموعات تُدرج بين الأزرار داخل الشبكة نفسها
    let gLast = '';
    const orderOf = (v) => { const i = NAV_ORDER.indexOf(v); return i < 0 ? NAV_ORDER.length : i; };
    const navViews = o.views ? views : [...views].sort((a, b) => orderOf(a[0]) - orderOf(b[0]));
    const nav = navViews.map((v) => {
      // من لا يخدم الطلاب مباشرة تصله الطلبات المحالة لقسمه فقط، فلا تُعرض تحت «الشؤون الطلابية»
      const inboxOnly = v[0] === 'affairs' && !['student:read', 'student:register', 'request:read_all', 'sa_admissions:view', 'sa_advising:view', 'sa_scholarships:view'].some((p) => S.me?.permissions?.includes(p));
      const g = o.views ? '' : (NAV_GROUP[inboxOnly ? 'overview' : v[0]] || '');
      const head = g && g !== gLast ? `<div class="sx-gh" role="presentation">${esc(tr(g))}</div>` : '';
      if (g) gLast = g;
      const itemLabel = esc(tr(!o.views && SIDE_LABEL[v[0]] ? SIDE_LABEL[v[0]] : v[1]));
      const isCur = activeKey === v[0] || (hasGroup && v[0] === 'affairs' && inGroup);
      const withSub = hasSubs(v[0]);
      const caretHtml = withSub ? `<em class="sx-caret${isCur ? ' open' : ''}">${ico('chevron', 15)}</em>` : '';
      return head + `<button data-act="${act}" data-v="${v[0]}" title="${itemLabel}"${isCur ? ' aria-current="page"' : ''}>${ico(NAV_ICON[v[0]] || 'file')}<span>${itemLabel}</span>${badge(v[0])}${caretHtml}</button>${v[0] === 'affairs' && inGroup ? subs() : ''}${sideSub && activeKey === v[0] ? sideSub : ''}`;
    }).join('');
    const uni = String(S.uni || ''), cut = uni.indexOf(' للعلوم');
    const brand1 = tr(cut > 0 ? uni.slice(0, cut) : uni), brand2 = tr(cut > 0 ? uni.slice(cut + 1) : 'نظام إدارة الجامعة');
    const role = tr(S.me.roleLabel || UA.ROLE_LABEL[S.me.role] || '');
    const help = o.help || `<div class="sx-help"><i>${ico('shield', 22)}</i><strong>${tr('دليل الإرشادات التفاعلي')}</strong><p>${tr('دليل تفاعلي لكامل الأقسام والطلبات وهيكلية العمل.')}</p><button data-act="view" data-v="guidelines">${tr('فتح الدليل التفاعلي')} ${ico('arrow', 15)}</button></div>`;
    const langBtnHtml = `<button class="sx-ib" data-sx="lang" title="تبديل اللغة / Switch Language (${otherLangLabel})" aria-label="تبديل اللغة" style="width:auto;padding:0 12px;height:38px;border:1.5px solid #054239;border-radius:8px;font-size:12px;font-weight:700;display:inline-flex;align-items:center;gap:6px;background:#fff;color:#054239;cursor:pointer;box-shadow:0 1px 2px rgba(0,0,0,0.06)">
      <span style="font-size:15px">🌐</span>
      <span>${otherLangLabel}</span>
    </button>`;
    const isCollapsed = document.body.classList.contains('sx-collapsed');
    const a11yBarHtml = `<div class="sx-a11y-bar no-print" role="toolbar" aria-label="${tr('أدوات العرض وسهولة الوصول')}">
      <button type="button" class="sx-a11y-btn" data-act="sxtoggleside" aria-pressed="${isCollapsed}" title="${tr('طي أو توسيع القائمة الجانبية (Ctrl+B)')}">⇄ <span class="sx-a11y-hide-sm">${isCollapsed ? tr('توسيع القائمة') : tr('طي القائمة')}</span></button>
    </div>`;
    const notifBody = o.notif ? `<p>${o.notif.text}</p>${o.notif.btn || ''}` : `<p>${review ? `${tr('لديك طلبات قيد المراجعة')}: ${review}` : tr('لا توجد إشعارات جديدة.')}</p>${review ? `<button data-sx="go" data-v="affairs">${tr('عرض الطلبات')}</button>` : ''}`;
    const menu = o.menu || `<button class="sx-menu-item" data-sx="lang"><span style="font-size:16px">🌐</span> ${tr('تبديل اللغة')} (${otherLangLabel})</button><button class="sx-menu-item" data-act="logout">${ico('out', 18)} ${tr('تسجيل الخروج')}</button>`;
    const search = o.search === false ? '<div class="sx-sp"></div>' : `<label class="sx-search">${ico('search', 19)}<input id="sx-q" type="search" placeholder="${can('student:read') ? tr('ابحث عن قسم أو طالب، أو اضغط Ctrl+` للبحث الشامل...') : tr('ابحث عن قسم، أو اضغط Ctrl+`...')}" autocomplete="off"><kbd data-act="sxcmdopen" style="cursor:pointer" title="${tr('فتح نافذة البحث الشامل والأوامر السريعة (Ctrl+`)')}">Ctrl K</kbd></label>`;
    const wsTabsHtml = UA.renderWorkspaceTabsBar ? UA.renderWorkspaceTabsBar(activeKey, label) : '';
    return `<div class="sx-shell" dir="${curDir}">
      <button class="sx-backdrop" data-sx="close" aria-label="${tr('إغلاق القائمة')}"></button>
      <aside class="sx-side" aria-label="${tr('القائمة الجانبية')}">
        <div class="sx-brand"><img src="/brand/crest.svg" alt="" width="42" height="48"><div><strong>${esc(brand1)}</strong><span>${esc(brand2)}</span></div><button class="sx-ib sx-close" data-sx="close" aria-label="${tr('إغلاق')}" style="color:#fff">${ico('close')}</button></div>
        ${o.views ? `<div class="sx-navlabel">${tr('القائمة الرئيسية')}</div>` : ''}
        <nav class="sx-nav" aria-label="${tr('القائمة الرئيسية')}">${nav}</nav>
        ${help}
        <div class="sx-state"><i></i> ${tr('النظام يعمل بشكل طبيعي')}</div>
      </aside>
      <div class="sx-content">
        <header class="sx-top">
          <button class="sx-ib sx-burger" data-sx="open" aria-label="${tr('فتح القائمة')}">${ico('menu')}</button>
          <div class="sx-crumbs"><span>${esc(tr(o.root || 'نظام إدارة الجامعة'))}</span>${ico('chevron', 15)}<strong>${esc(tr(label))}</strong></div>
          ${search}
          <div class="sx-actions">
            ${a11yBarHtml}
            ${langBtnHtml}
            ${window.UAtheme ? window.UAtheme.button() : ''}
            <div class="sx-wrap"><button class="sx-ib" data-sx="notif" aria-label="${tr('الإشعارات')}">${ico('bell')}${review ? '<i class="sx-dot"></i>' : ''}</button>
              <div class="sx-pop" id="sx-notif" hidden><strong>${tr('الإشعارات')}</strong>${notifBody}${UA.push ? UA.push.panel() : ''}</div></div>
            <div class="sx-sep"></div>
            <div class="sx-wrap"><button class="sx-profile" data-sx="profile" aria-label="${tr('قائمة المستخدم')}"><span class="sx-av">${esc(initials(tr(S.me.name)))}</span><span><strong>${esc(tr(S.me.name))}</strong><small>${esc(tr(role))}</small></span>${ico('chevron', 15)}</button>
              <div class="sx-pop" id="sx-menu" hidden>${menu}</div></div>
          </div>
        </header>
        ${wsTabsHtml}
        <main class="sx-main"><div class="sx-page">${pageBody}</div></main>
        <footer class="sx-foot"><span>© 2026 ${esc(tr(S.uni))}</span><span>${tr('جميع الحقوق محفوظة')}</span></footer>
      </div></div>`;
  };
  UA.sx = { ico, subIcon, subLabel, initials, ago, dateLong, nf, statCard, navIcon: NAV_ICON, navGroup: NAV_GROUP };

  /* ---------- الأحداث ---------- */
  const pops = () => [document.getElementById('sx-notif'), document.getElementById('sx-menu')].filter(Boolean);
  document.addEventListener('click', async (e) => {
    const t = e.target.closest && e.target.closest('[data-sx]');
    if (!t) { if (!(e.target.closest && e.target.closest('.sx-pop') && !e.target.closest('[data-act]'))) pops().forEach((p) => { p.hidden = true; }); return; }
    const a = t.dataset.sx;
    if (a === 'lang') {
      const cur = (window.UA && window.UA.i18n ? window.UA.i18n.getLang() : 'ar');
      const next = cur === 'en' ? 'ar' : 'en';
      if (window.UA && window.UA.i18n && window.UA.i18n.syncLang) {
        window.UA.i18n.syncLang(next, { source: 'erp_header_button' });
      } else if (window.UA && window.UA.i18n) {
        window.UA.i18n.setLang(next);
      }
      UA.render();
    }
    else if (a === 'open') document.body.classList.add('sx-drawer');
    else if (a === 'close') document.body.classList.remove('sx-drawer');
    else if (a === 'notif' || a === 'profile') { const mine = document.getElementById(a === 'notif' ? 'sx-notif' : 'sx-menu'); const was = mine && !mine.hidden; pops().forEach((p) => { p.hidden = true; }); if (mine) mine.hidden = was; }
    else if (a === 'sub') {
      const v = t.dataset.v, tab = t.dataset.t;
      if (v === 'affairs') { S.stTab = tab; S.err = ''; S.fieldErr = null; S.stEdit = null; if (tab === 'new') { S.cred = null; S.stSel = null; } await UA.guard(() => UA.go('affairs')); }
      else { await UA.guard(() => UA.go('academics')); if (UA.actions.actab) await UA.actions.actab(null, { t: tab }); }
      document.body.classList.remove('sx-drawer');
    }
    else if (a === 'go') { await UA.guard(() => UA.go(t.dataset.v)); }
    else if (a === 'newstudent') { S.stTab = 'new'; S.stSel = null; await UA.guard(() => UA.go('affairs')); }
    else if (a === 'openreq') { S.stTab = 'requests'; S.sel = Number(t.dataset.id); S.rej = null; S.view = 'affairs'; await UA.guard(async () => { await UA.loadFor('affairs'); UA.render(); }); }
  });
  document.addEventListener('click', (e) => { if (e.target.closest && e.target.closest('.sx-nav [data-act], .sx-sub-list [data-act], .sx-help [data-act]')) document.body.classList.remove('sx-drawer'); });
  document.addEventListener('keydown', async (e) => {
    // الانتقال السريع: Ctrl+` (مفتاح يسار الرقم 1، وهو حرف ذ في اللوحة العربية؛ لذلك نقرأ code لا key) وCtrl+K بديل احتياطي
    if (e.ctrlKey && e.code === 'Backquote' || (e.ctrlKey || e.metaKey) && e.code === 'KeyK') {
      e.preventDefault();
      if (UA.openCommandPalette) { await UA.openCommandPalette(); return; }
      const q = document.getElementById('sx-q');
      if (q) q.focus();
    }
    if (e.key === 'Escape') { pops().forEach((p) => { p.hidden = true; }); document.body.classList.remove('sx-drawer'); }
    if (e.key === 'Enter' && e.target && e.target.id === 'sx-q') {
      e.preventDefault();
      if (UA.openCommandPalette) await UA.openCommandPalette(e.target.value);
    }
  });
  // البحث العلوي عام: الكتابة فيه تفتح نافذة البحث الشامل بالنص نفسه، ومنها الانتقال للقسم المطلوب
  document.addEventListener('input', (e) => {
    const t = e.target;
    if (t && t.id === 'sx-q' && t.value.trim() && UA.openCommandPalette) { const v = t.value; t.value = ''; UA.openCommandPalette(v); }
  });
})();
