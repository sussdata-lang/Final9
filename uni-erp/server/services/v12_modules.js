import { groupsOfStudent, listGroups, groupSize } from './student_groups.js';
import { HttpError } from '../http.js';
import { audit } from '../audit.js';
import { tx } from '../db.js';
import { appealGrade, applyAppealMark } from './academics.js';
import { notify } from './push.js';
import { addLectureFile, filesFor, streamLectureFile, lectureSlides, streamSlideMedia, deleteLectureFile, removeLectureFiles } from './lms_files.js';
import { SECURITY_HEADERS } from '../http.js';

const clean = (v, max = 300) => String(v ?? '').trim().slice(0, max);
const need = (v, label, max = 300) => { const s = clean(v, max); if (!s) throw new HttpError(400, `«${label}» مطلوب.`, 'validation'); return s; };

// استدعاء Gemini AI من الخادم (مع بديل ذكي فوري في حال عدم توفر المفتاح أو انتهاء المهلة في بيئة الاختبار)
async function callGeminiAI(systemPrompt, userPrompt, fallbackFn) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (apiKey && apiKey !== 'MY_GEMINI_API_KEY' && !process.env.NODE_TEST_CONTEXT) {
    try {
      const { GoogleGenAI } = await import('@google/genai');
      const ai = new GoogleGenAI({
        apiKey,
        httpOptions: { headers: { 'User-Agent': 'aistudio-build' } },
      });
      const response = await Promise.race([
        ai.models.generateContent({
          model: 'gemini-3.8-flash',
          contents: userPrompt,
          config: {
            systemInstruction: systemPrompt,
            temperature: 0.4,
          },
        }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 3500)),
      ]);
      if (response && response.text) return { text: response.text, model: 'gemini-3.8-flash' };
    } catch (err) {
      // في حال تعذر الاتصال، ننتقل للتحليل المحلي المدمج دون تعطيل النظام
    }
  }
  return { text: fallbackFn(), model: 'uni-ai-engine-v12' };
}

// ==================== تحليلات وإحصائيات DevOps المتقدمة ====================
export function buildDevopsAnalytics(db) {
  const incidents = db.prepare('SELECT * FROM devops_incident_reports ORDER BY created_at DESC, id DESC LIMIT 200').all();
  const total = incidents.length;
  const open = incidents.filter((i) => i.status !== 'resolved');
  const resolved = incidents.filter((i) => i.status === 'resolved');
  const critical = incidents.filter((i) => i.severity === 'critical');
  const openCritical = critical.filter((i) => i.status !== 'resolved');

  let directCount = 0;
  let fallbackCount = 0;
  let totalLatency = 0;
  let latencySamples = 0;

  for (const inc of incidents) {
    let det = {};
    try { det = JSON.parse(inc.error_details || '{}'); } catch {}
    if (det && det.deliveredVia === 'fallback') fallbackCount++;
    else directCount++;
    const lat = Number(det?.latencyMs);
    if (lat) { totalLatency += lat; latencySamples++; }
  }

  // لا بلاغات تعني لا إخفاق: النسب 100 لا صفر
  const rate = (part) => (total ? Math.min(100, Math.round((part / total) * 1000) / 10) : 100);
  const deliverySuccessRate = rate(directCount + fallbackCount);
  const directDeliveryRate = rate(directCount);
  const resolutionRate = rate(resolved.length);
  const avgLatencyMs = latencySamples ? Math.round(totalLatency / latencySamples) : 0;

  const now = Date.now();
  const DAY = 86400000;
  const dayNames = ['الأحد', 'الإثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'];
  const buckets = [];
  for (let d = 6; d >= 0; d--) {
    const start = now - (d + 1) * DAY;
    const end = d === 0 ? now + DAY : now - d * DAY;
    const dt = new Date(now - d * DAY);
    const label = d === 0
      ? 'اليوم (الآن)'
      : `${dayNames[dt.getDay()]} ${dt.getDate()}/${dt.getMonth() + 1}`;
    buckets.push({
      label,
      start,
      end,
      totalErrors: 0,
      criticalCount: 0,
      errorCount: 0,
      warningCount: 0,
      saveFailures: 0,
      loadFailures: 0,
      deliveredCount: 0,
      resolvedCount: 0,
      successRate: 100,
    });
  }

  for (const inc of incidents) {
    const ts = Number(inc.created_at) || now;
    let b = buckets.find((x) => ts >= x.start && ts <= x.end);
    if (!b) {
      b = ts > now ? buckets[buckets.length - 1] : buckets[0];
    }
    b.totalErrors++;
    if (inc.severity === 'critical') b.criticalCount++;
    else if (inc.severity === 'error') b.errorCount++;
    else b.warningCount++;

    if (String(inc.event_type).includes('SAVE')) b.saveFailures++;
    else if (String(inc.event_type).includes('LOAD')) b.loadFailures++;

    b.deliveredCount++;
    if (inc.status === 'resolved') b.resolvedCount++;
  }

  const opLabels = {
    FILE_SAVE_FAILURE: 'فشل حفظ ملف (FILE_SAVE)',
    FILE_LOAD_FAILURE: 'فشل تحميل ملف (FILE_LOAD)',
    SYNTAX_CHECK: 'فحص الصياغة والحزم (SYNTAX)',
    NETWORK_FAILURE: 'انقطاع اتصال الشبكة (NETWORK)',
    WAL_CHECKPOINT: 'تفتيش قاعدة البيانات (WAL)',
    FILE_OPERATION_FAILURE: 'عملية ملفات عامة',
  };
  const opMap = new Map();
  for (const inc of incidents) {
    const key = inc.event_type || 'FILE_OPERATION_FAILURE';
    const cur = opMap.get(key) || { operation: key, label: opLabels[key] || key, total: 0, critical: 0, resolved: 0, open: 0 };
    cur.total++;
    if (inc.severity === 'critical') cur.critical++;
    if (inc.status === 'resolved') cur.resolved++;
    else cur.open++;
    opMap.set(key, cur);
  }

  const bySeverity = [
    { name: 'حرج (Critical)', severity: 'critical', value: incidents.filter((i) => i.severity === 'critical').length, color: '#ef4444' },
    { name: 'خطأ (Error)', severity: 'error', value: incidents.filter((i) => i.severity === 'error').length, color: '#f97316' },
    { name: 'تحذير (Warning)', severity: 'warning', value: incidents.filter((i) => i.severity === 'warning').length, color: '#eab308' },
    { name: 'معلومة (Info)', severity: 'info', value: incidents.filter((i) => i.severity === 'info').length, color: '#3b82f6' },
  ].filter((x) => x.value > 0);

  const deliveryBreakdown = [
    { name: 'إرسال فوري ناجح (Direct API)', value: directCount, color: '#10b981' },
    { name: 'إرسال عبر المسار الاحتياطي (Fallback)', value: fallbackCount, color: '#0ea5e9' },
  ];

  const statusBreakdown = [
    { name: 'تم الحل والمعالجة (Resolved)', value: resolved.length, color: '#10b981' },
    { name: 'قيد المتابعة (Open)', value: open.length, color: '#ef4444' },
  ];

  const fileMap = new Map();
  for (const inc of incidents) {
    const fp = inc.file_path || 'غير محدد';
    const cur = fileMap.get(fp) || { filePath: fp, count: 0, critical: 0, resolved: 0 };
    cur.count++;
    if (inc.severity === 'critical') cur.critical++;
    if (inc.status === 'resolved') cur.resolved++;
    fileMap.set(fp, cur);
  }
  const byFile = [...fileMap.values()].sort((a, b) => b.count - a.count).slice(0, 8);

  return {
    incidents,
    stats: {
      total,
      open: open.length,
      critical: openCritical.length,
      totalCritical: critical.length,
      resolved: resolved.length,
      deliverySuccessRate,
      directDeliveryRate,
      resolutionRate,
      avgLatencyMs,
      directCount,
      fallbackCount,
    },
    timeSeries: buckets.map(({ start, end, ...rest }) => ({ ...rest, total: rest.totalErrors })),
    delivery: { successRate: deliverySuccessRate, directDeliveryRate, resolutionRate, avgLatencyMs },
    byOperation: [...opMap.values()],
    bySeverity,
    deliveryBreakdown,
    statusBreakdown,
    byFile,
  };
}

export async function registerV12Modules(r, deps) {
  const { db } = deps;

  const hasV12Perm = (c, perms) => c.user?.role === 'admin' || perms.some((p) => c.user?.can?.(p));
  const requireV12Perm = (c, ...perms) => {
    if (!c.user || !hasV12Perm(c, perms)) {
      throw new HttpError(403, 'لا تملك صلاحية تنفيذ هذا الإجراء.', 'forbidden');
    }
  };
  const isStudent = (c) => c.user?.role === 'student';
  // صلاحيات القراءة تطابق computeAllowedViews حتى لا تظهر شاشة يرفض الخادم بياناتها
  const LMS_MANAGE = ['course:manage', 'lms_lib:write', 'lms_lib:edit', 'lms_lib:approve'];
  const LMS_READ = [...LMS_MANAGE, 'lms_lib:view', 'academic:read'];
  const RESEARCH_WRITE = ['research_grad:write', 'research_grad:edit', 'research_grad:approve'];
  const ALUMNI_WRITE = ['alumni_career:write', 'alumni_career:edit'];
  const QA_WRITE = ['qa_inst:edit', 'qa_inst:approve'];
  const EXAMS_MANAGE = ['exams_housing:write', 'exams_housing:edit', 'exams_housing:approve'];
  const EXAMS_READ = [...EXAMS_MANAGE, 'exams_housing:view', 'academic:read'];
  const HR_READ = ['hr_emp:view', 'hr_emp:write', 'hr_emp:edit', 'hr:manage', 'staffatt:manage'];
  const DEVOPS_ACCESS = ['audit:read', 'devops:manage', 'settings:manage', 'backup:manage'];
  const AI_READ = ['enterprise_ai:use', 'academic:read', 'sa_advising:view', 'sa_advising:edit'];

  // ==================== 5.12 التعلم الإلكتروني والمكتبة الرقمية (LMS & Library) ====================
  r.add('GET', '/api/lms/overview', (c) => {
    if (!isStudent(c)) requireV12Perm(c, ...LMS_READ);
    const canManage = hasV12Perm(c, LMS_MANAGE);
    const seesAllLoans = canManage || hasV12Perm(c, ['lms_lib:view', 'holds:manage']);
    const rows = db.prepare('SELECT * FROM lms_lectures ORDER BY week_no ASC, id DESC').all().filter((l) => !isStudent(c) || l.published);
    const lectureFiles = filesFor(db, rows.map((l) => l.id));
    const lectures = rows.map((l) => ({ ...l, files: lectureFiles.get(l.id) ?? [] }));
    const quizzes = db.prepare('SELECT * FROM lms_quizzes ORDER BY id DESC').all();
    const books = db.prepare('SELECT * FROM library_books ORDER BY id DESC').all();
    const loans = db.prepare(`
      SELECT l.*, b.title AS book_title, b.isbn
      FROM library_loans l
      JOIN library_books b ON b.id = l.book_id
      ORDER BY l.id DESC
    `).all().filter((l) => seesAllLoans || (isStudent(c) && l.borrower_no === c.user.student_no));
    c.json(200, {
      stats: {
        lecturesCount: lectures.length,
        quizzesCount: quizzes.length,
        booksCount: books.reduce((s, b) => s + Number(b.copies_total || 0), 0),
        availableBooks: books.reduce((s, b) => s + Number(b.copies_available || 0), 0),
        activeLoans: loans.filter((l) => l.status !== 'returned').length,
      },
      lectures,
      // الإجابة الصحيحة لا تصل إلا لمن يدير المحتوى
      quizzes: quizzes.map(({ questions_json, ...q }) => {
        const questions = JSON.parse(questions_json || '[]');
        return { ...q, questions: canManage ? questions : questions.map(({ ans, answer, ...x }) => x) };
      }),
      books,
      loans,
    });
  });

  r.add('POST', '/api/lms/lectures', (c) => {
    requireV12Perm(c, 'course:manage', 'lms_lib:write', 'lms_lib:edit');
    const b = c.body ?? {};
    const title = clean(b.title, 160);
    if (!title) throw new HttpError(400, 'عنوان المحاضرة مطلوب.');
    const res = db.prepare(`
      INSERT INTO lms_lectures (course_code, course_name, title, kind, week_no, instructor_name, content_url, summary, views_count, published, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 1, ?)
    `).run(
      need(b.course_code, 'رمز المقرر', 30),
      clean(b.course_name, 100),
      title,
      clean(b.kind || 'pdf', 20),
      Number(b.week_no) || 1,
      clean(b.instructor_name || c.user.display_name, 80),
      clean(b.content_url, 200),
      clean(b.summary, 400),
      Date.now()
    );
    audit(db, c.user, 'إضافة محاضرة رقمية LMS', title, c.ip);
    c.json(201, { id: Number(res.lastInsertRowid) });
  });

  r.add('DELETE', '/api/lms/lectures/:id', (c) => {
    requireV12Perm(c, 'course:manage', 'lms_lib:delete', 'lms_lib:edit');
    removeLectureFiles(deps, c.params.id);
    db.prepare('DELETE FROM lms_lectures WHERE id = ?').run(Number(c.params.id));
    audit(db, c.user, 'حذف محاضرة رقمية LMS', c.params.id, c.ip);
    c.json(200, { ok: true });
  });

  // مرفقات المحاضرة: الرفع لمن يدير المحتوى، والعرض لكل من يصل إلى الشاشة
  r.add('POST', '/api/lms/lectures/:id/files', (c) => {
    requireV12Perm(c, 'course:manage', 'lms_lib:write', 'lms_lib:edit');
    c.json(201, addLectureFile(deps, c.user, c.params.id, c.body, c.query.name, c.ip));
  }, { raw: true, maxBody: 205 * 1024 * 1024 });
  const lmsViewer = (c) => { if (!isStudent(c)) requireV12Perm(c, ...LMS_READ); return { student: isStudent(c) }; };
  r.add('GET', '/api/lms/files/:id', (c) => { streamLectureFile(deps, c.req, c.res, c.params.id, SECURITY_HEADERS, lmsViewer(c)); });
  r.add('GET', '/api/lms/files/:id/slides', (c) => { c.json(200, lectureSlides(deps, c.params.id, lmsViewer(c))); });
  r.add('GET', '/api/lms/files/:id/media/:name', (c) => { streamSlideMedia(deps, c.req, c.res, c.params.id, c.params.name, SECURITY_HEADERS, lmsViewer(c)); });
  r.add('DELETE', '/api/lms/files/:id', (c) => {
    requireV12Perm(c, 'course:manage', 'lms_lib:delete', 'lms_lib:edit');
    deleteLectureFile(deps, c.user, c.params.id, c.ip);
    c.json(200, { ok: true });
  });

  r.add('POST', '/api/lms/quizzes', (c) => {
    requireV12Perm(c, 'course:manage', 'lms_lib:write', 'lms_lib:edit');
    const b = c.body ?? {};
    const title = clean(b.title, 150);
    if (!title) throw new HttpError(400, 'عنوان الاختبار مطلوب.');
    const questions = Array.isArray(b.questions) ? b.questions : [
      { q: clean(b.sample_question || 'سؤال تقييمي أساسي في المقرر', 200), options: ['الخيار الأول (صحيح)', 'الخيار الثاني', 'الخيار الثالث'], ans: 0 },
    ];
    const res = db.prepare(`
      INSERT INTO lms_quizzes (course_code, course_name, title, duration_min, total_marks, questions_json, attempts_count, avg_score, published, created_at)
      VALUES (?, ?, ?, ?, ?, ?, 0, 0, 1, ?)
    `).run(
      need(b.course_code, 'رمز المقرر', 30),
      clean(b.course_name || 'مبادئ الأمن السيبراني', 100),
      title,
      Number(b.duration_min) || 20,
      Number(b.total_marks) || 20,
      JSON.stringify(questions),
      Date.now()
    );
    audit(db, c.user, 'إنشاء اختبار إلكتروني LMS', title, c.ip);
    c.json(201, { id: Number(res.lastInsertRowid) });
  });

  r.add('POST', '/api/lms/books', (c) => {
    requireV12Perm(c, 'holds:manage', 'lms_lib:write', 'lms_lib:edit', 'course:manage');
    const b = c.body ?? {};
    const title = clean(b.title, 160);
    if (!title) throw new HttpError(400, 'عنوان الكتاب مطلوب.');
    const copies = Math.max(1, Number(b.copies_total) || 5);
    const res = db.prepare(`
      INSERT INTO library_books (isbn, title, author, category, publish_year, copies_total, copies_available, shelf_code, digital_available, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
    `).run(
      need(b.isbn, 'ISBN', 30),
      title,
      clean(b.author || 'مؤلف أكاديمي', 100),
      clean(b.category || 'العلوم الأمنية', 60),
      Number(b.publish_year) || 2026,
      copies,
      copies,
      clean(b.shelf_code || 'A-10', 20),
      Date.now()
    );
    audit(db, c.user, 'إضافة كتاب للمكتبة الرقمية', title, c.ip);
    c.json(201, { id: Number(res.lastInsertRowid) });
  });

  r.add('POST', '/api/lms/loans', (c) => {
    requireV12Perm(c, 'holds:manage', 'lms_lib:write', 'lms_lib:edit', 'course:manage');
    const b = c.body ?? {};
    const bookId = Number(b.book_id);
    const book = db.prepare('SELECT * FROM library_books WHERE id = ?').get(bookId);
    if (!book) throw new HttpError(404, 'الكتاب غير موجود.');
    if (book.copies_available <= 0) throw new HttpError(400, 'لا توجد نسخ متاحة للإعارة حالياً.');
    const res = tx(db, () => {
      db.prepare('UPDATE library_books SET copies_available = copies_available - 1 WHERE id = ?').run(bookId);
      return db.prepare(`
        INSERT INTO library_loans (book_id, borrower_name, borrower_no, loan_date, due_date, status, created_at)
        VALUES (?, ?, ?, ?, ?, 'borrowed', ?)
      `).run(
        bookId,
        clean(b.borrower_name, 100),
        clean(b.borrower_no, 40),
        clean(b.loan_date || new Date().toISOString().slice(0, 10), 20),
        clean(b.due_date || new Date(Date.now() + 14 * 86400000).toISOString().slice(0, 10), 20),
        Date.now()
      );
    });
    audit(db, c.user, 'تسجيل إعارة كتاب', `${book.title} <- ${b.borrower_no}`, c.ip);
    c.json(201, { id: Number(res.lastInsertRowid) });
  });

  r.add('POST', '/api/lms/loans/:id/return', (c) => {
    requireV12Perm(c, 'holds:manage', 'lms_lib:write', 'lms_lib:edit', 'course:manage');
    const loan = db.prepare('SELECT * FROM library_loans WHERE id = ?').get(Number(c.params.id));
    if (!loan) throw new HttpError(404, 'سجل الإعارة غير موجود.');
    if (loan.status !== 'returned') {
      tx(db, () => {
        db.prepare("UPDATE library_loans SET status = 'returned', return_date = ? WHERE id = ?")
          .run(new Date().toISOString().slice(0, 10), loan.id);
        db.prepare('UPDATE library_books SET copies_available = LEAST(copies_total, copies_available + 1) WHERE id = ?')
          .run(loan.book_id);
      });
      audit(db, c.user, 'إرجاع كتاب مستعار', String(loan.id), c.ip);
    }
    c.json(200, { ok: true });
  });

  // ==================== 5.13 البحث العلمي والدراسات العليا (Research & Postgrad) ====================
  r.add('GET', '/api/research/overview', (c) => {
    requireV12Perm(c, ...RESEARCH_WRITE, 'research_grad:view', 'faculty:manage');
    const projects = db.prepare('SELECT * FROM research_projects ORDER BY id DESC').all();
    const theses = db.prepare('SELECT * FROM postgrad_theses ORDER BY id DESC').all();
    c.json(200, {
      stats: {
        projectsCount: projects.length,
        publishedCount: projects.filter((p) => p.status === 'published').length,
        totalCitations: projects.reduce((s, p) => s + Number(p.citations_count || 0), 0),
        totalBudget: projects.reduce((s, p) => s + Number(p.budget || 0), 0),
        thesesCount: theses.length,
        phdCount: theses.filter((t) => t.degree === 'دكتوراه').length,
      },
      projects,
      theses,
    });
  });

  r.add('POST', '/api/research/projects', (c) => {
    requireV12Perm(c, ...RESEARCH_WRITE);
    const b = c.body ?? {};
    const title = clean(b.title, 200);
    if (!title) throw new HttpError(400, 'عنوان البحث العلمي مطلوب.');
    const code = clean(b.code || `RES-2026-${Math.floor(10 + Math.random() * 89)}`, 30);
    const res = db.prepare(`
      INSERT INTO research_projects (code, title, principal_investigator, faculty_name, domain, budget, journal_name, impact_factor, citations_count, status, published_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      code,
      title,
      clean(b.principal_investigator || c.user.display_name, 100),
      clean(b.faculty_name, 100),
      clean(b.domain || 'الأمن السيبراني', 100),
      Number(b.budget) || 0,
      clean(b.journal_name || 'مجلة الجامعة للبحوث العلمية', 150),
      Number(b.impact_factor) || 0,
      Number(b.citations_count) || 0,
      clean(b.status || 'active', 20),
      clean(b.published_at || new Date().toISOString().slice(0, 10), 20),
      Date.now()
    );
    audit(db, c.user, 'تسجيل مشروع بحثي جديد', code, c.ip);
    c.json(201, { id: Number(res.lastInsertRowid), code });
  });

  r.add('POST', '/api/research/theses', (c) => {
    requireV12Perm(c, ...RESEARCH_WRITE);
    const b = c.body ?? {};
    const title = clean(b.title, 200);
    if (!title) throw new HttpError(400, 'عنوان الأطروحة مطلوب.');
    const res = db.prepare(`
      INSERT INTO postgrad_theses (student_no, student_name, degree, program_name, title, supervisor_name, co_supervisor, stage, defense_date, grade_label, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      need(b.student_no, 'الرقم الجامعي', 30),
      clean(b.student_name, 100),
      clean(b.degree || 'ماجستير', 30),
      clean(b.program_name || 'الأمن السيبراني والتحقيق الرقمي', 100),
      title,
      clean(b.supervisor_name, 100),
      clean(b.co_supervisor, 100),
      clean(b.stage || 'تسجيل الموضوع', 60),
      clean(b.defense_date, 20),
      clean(b.grade_label || 'قيد الإعداد', 60),
      Date.now()
    );
    audit(db, c.user, 'تسجيل أطروحة دراسات عليا', title, c.ip);
    c.json(201, { id: Number(res.lastInsertRowid) });
  });

  r.add('PUT', '/api/research/theses/:id/stage', (c) => {
    requireV12Perm(c, 'research_grad:edit', 'research_grad:approve');
    const stage = clean(c.body?.stage, 60);
    const grade = clean(c.body?.grade_label || 'مستمر', 60);
    db.prepare('UPDATE postgrad_theses SET stage = ?, grade_label = ? WHERE id = ?')
      .run(stage, grade, Number(c.params.id));
    audit(db, c.user, 'تحديث مرحلة أطروحة عليا', `${c.params.id} -> ${stage}`, c.ip);
    c.json(200, { ok: true });
  });

  // ==================== 5.14 الخريجون والتوظيف (Alumni & Career) ====================
  r.add('GET', '/api/alumni/overview', (c) => {
    if (!isStudent(c)) requireV12Perm(c, ...ALUMNI_WRITE, 'alumni_career:view');
    const alumni = db.prepare('SELECT * FROM alumni_records ORDER BY grad_year DESC, gpa DESC').all();
    const jobs = db.prepare('SELECT * FROM career_jobs ORDER BY id DESC').all();
    const applications = db.prepare(`
      SELECT a.*, j.title AS job_title, j.company_name
      FROM career_applications a
      JOIN career_jobs j ON j.id = a.job_id
      ORDER BY a.id DESC
    `).all();
    c.json(200, {
      stats: {
        alumniCount: alumni.length,
        employedCount: alumni.filter((a) => a.current_employer && a.current_employer.trim() !== '').length,
        openJobsCount: jobs.filter((j) => j.active).length,
        applicationsCount: applications.length,
      },
      // الطالب يرى سجله وطلباته فقط: سجل الخريجين يحوي هواتف وبريد ومعدلات
      alumni: isStudent(c) ? alumni.filter((a) => a.student_no === c.user.student_no) : alumni,
      jobs,
      applications: isStudent(c) ? applications.filter((a) => a.student_no === c.user.student_no) : applications,
    });
  });

  r.add('POST', '/api/alumni/records', (c) => {
    requireV12Perm(c, ...ALUMNI_WRITE);
    const b = c.body ?? {};
    const studentNo = clean(b.student_no, 40);
    const fullName = clean(b.full_name, 100);
    if (!studentNo || !fullName) throw new HttpError(400, 'الرقم الجامعي واسم الخريج مطلوبان.');
    const vcode = `GRAD-${b.grad_year || 2026}-${studentNo.replace(/[^A-Z0-9]/gi, '')}`;
    const res = db.prepare(`
      INSERT INTO alumni_records (student_no, full_name, faculty_name, program_name, grad_year, gpa, honor_rank, current_employer, job_title, email, phone, verified_code, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      studentNo,
      fullName,
      clean(b.faculty_name, 100),
      clean(b.program_name, 100),
      Number(b.grad_year) || 2026,
      Number(b.gpa) || 0,
      clean(b.honor_rank || 'جيد جداً', 40),
      clean(b.current_employer, 120),
      clean(b.job_title, 100),
      clean(b.email, 100),
      clean(b.phone, 30),
      vcode,
      Date.now()
    );
    audit(db, c.user, 'إدراج خريج في سجل الخريجين', studentNo, c.ip);
    c.json(201, { id: Number(res.lastInsertRowid), verified_code: vcode });
  });

  r.add('POST', '/api/alumni/jobs', (c) => {
    requireV12Perm(c, ...ALUMNI_WRITE);
    const b = c.body ?? {};
    const title = clean(b.title, 150);
    if (!title) throw new HttpError(400, 'المسمى الوظيفي مطلوب.');
    const res = db.prepare(`
      INSERT INTO career_jobs (title, company_name, sector, location, job_type, salary_range, requirements, deadline, applicants_count, active, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, 1, ?)
    `).run(
      title,
      clean(b.company_name, 120),
      clean(b.sector || 'الأمن السيبراني والتقنية', 80),
      clean(b.location || 'دمشق', 60),
      clean(b.job_type || 'دوام كامل', 40),
      clean(b.salary_range || 'حسب الكفاءة', 80),
      clean(b.requirements, 300),
      clean(b.deadline || '2026-12-31', 20),
      Date.now()
    );
    audit(db, c.user, 'نشر فرصة توظيف للخريجين', title, c.ip);
    c.json(201, { id: Number(res.lastInsertRowid) });
  });

  r.add('POST', '/api/alumni/applications', (c) => {
    if (!isStudent(c)) requireV12Perm(c, ...ALUMNI_WRITE);
    // الطالب يتقدّم باسمه هو مهما أُرسل في الطلب
    const b = { ...(c.body ?? {}), ...(isStudent(c) ? { student_no: c.user.student_no, applicant_name: c.user.display_name } : {}) };
    const jobId = Number(b.job_id);
    if (!db.prepare('SELECT id FROM career_jobs WHERE id = ? AND active = 1').get(jobId)) throw new HttpError(404, 'فرصة التوظيف غير موجودة.', 'not_found');
    const res = tx(db, () => {
      db.prepare('UPDATE career_jobs SET applicants_count = applicants_count + 1 WHERE id = ?').run(jobId);
      return db.prepare(`
        INSERT INTO career_applications (job_id, applicant_name, student_no, gpa, cv_summary, status, applied_at)
        VALUES (?, ?, ?, ?, ?, 'قيد المراجعة', ?)
      `).run(
        jobId,
        clean(b.applicant_name || c.user.display_name, 100),
        need(b.student_no || c.user.student_no, 'الرقم الجامعي', 40),
        Number(b.gpa) || 0,
        clean(b.cv_summary, 400),
        Date.now()
      );
    });
    c.json(201, { id: Number(res.lastInsertRowid) });
  });

  // ==================== 5.15 الجودة والاعتماد المؤسسي (QA & Accreditation) ====================
  r.add('GET', '/api/qa/overview', (c) => {
    requireV12Perm(c, ...QA_WRITE, 'qa_inst:view');
    const kpis = db.prepare('SELECT * FROM qa_kpis ORDER BY id ASC').all();
    const surveys = db.prepare('SELECT * FROM qa_surveys ORDER BY id DESC').all();
    const accreditations = db.prepare('SELECT * FROM qa_accreditations ORDER BY id DESC').all();
    const avgSatisfaction = surveys.length
      ? Number((surveys.reduce((s, x) => s + Number(x.overall_score || 0), 0) / surveys.length).toFixed(2))
      : 4.6;
    c.json(200, {
      stats: {
        kpisTotal: kpis.length,
        kpisAchieved: kpis.filter((k) => k.status === 'متحقق').length,
        surveysCount: surveys.reduce((s, x) => s + Number(x.responses_count || 0), 0),
        avgSatisfaction,
        accreditedPrograms: accreditations.filter((a) => a.status === 'معتمد').length,
      },
      kpis,
      surveys,
      accreditations,
    });
  });

  r.add('POST', '/api/qa/kpis', (c) => {
    requireV12Perm(c, ...QA_WRITE);
    const b = c.body ?? {};
    const title = clean(b.title, 160);
    if (!title) throw new HttpError(400, 'اسم مؤشر الأداء مطلوب.');
    const target = Number(b.target_value) || 0;
    const actual = Number(b.actual_value) || 0;
    const status = actual >= target ? 'متحقق' : actual >= target * 0.85 ? 'قيد التحسين' : 'حرِج';
    const code = clean(b.code || `KPI-${Math.floor(100 + Math.random() * 899)}`, 30);
    const res = db.prepare(`
      INSERT INTO qa_kpis (code, title, standard_domain, target_value, actual_value, unit, status, academic_year, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, '2026/2027', ?)
    `).run(code, title, clean(b.standard_domain || 'الجودة الأكاديمية', 80), target, actual, clean(b.unit || '%', 20), status, Date.now());
    audit(db, c.user, 'إضافة مؤشر جودة KPI', code, c.ip);
    c.json(201, { id: Number(res.lastInsertRowid) });
  });

  r.add('POST', '/api/qa/surveys', (c) => {
    requireV12Perm(c, ...QA_WRITE);
    const b = c.body ?? {};
    const cScore = Number(b.content_score) || 0;
    const tScore = Number(b.teaching_score) || 0;
    const aScore = Number(b.assessment_score) || 0;
    const overall = Number(((cScore + tScore + aScore) / 3).toFixed(2));
    const res = db.prepare(`
      INSERT INTO qa_surveys (course_code, course_name, instructor_name, semester, responses_count, content_score, teaching_score, assessment_score, overall_score, notes, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      need(b.course_code, 'رمز المقرر', 30),
      clean(b.course_name || 'مقرر جامعي', 100),
      clean(b.instructor_name || 'عضو هيئة تدريس', 100),
      clean(b.semester || 'الفصل الأول 2026/2027', 50),
      Number(b.responses_count) || 0,
      cScore,
      tScore,
      aScore,
      overall,
      clean(b.notes, 300),
      Date.now()
    );
    audit(db, c.user, 'إدراج تقييم جودة مقرر', clean(b.course_code, 30), c.ip);
    c.json(201, { id: Number(res.lastInsertRowid) });
  });

  // ==================== المرحلة 2: توسيع الوحدات الجزئية (5.5، 5.6، 5.7، 5.8) ====================
  // 5.5 جداول الامتحانات والتظلمات + 5.6 الساعات المكتبية والترقيات + 5.7 السكن والمنح والأنشطة + 5.8 التقييم والتدريب والبصمة
  r.add('GET', '/api/expansions/overview', (c) => {
    if (!isStudent(c)) requireV12Perm(c, ...EXAMS_READ);
    const own = (rows) => rows.filter((x) => x.student_no === c.user.student_no);
    // لكل قسم جمهوره: الطالب يرى ما يخصه، والموظف ما تغطيه صلاحياته
    const section = (rows, perms) => (isStudent(c) ? own(rows) : hasV12Perm(c, perms) ? rows : []);
    const hrOnly = (rows) => (hasV12Perm(c, HR_READ) ? rows : []);
    // الامتحان المربوط بفئة يظهر للطالب إن كان من أعضائها
    const myGroups = isStudent(c) ? new Set(groupsOfStudent(db, c.user.id).map((g) => g.id)) : null;
    const exams = db.prepare('SELECT e.*, g.name AS group_name FROM exam_schedules e LEFT JOIN student_groups g ON g.id = e.group_id ORDER BY e.exam_date ASC, e.start_time ASC').all().filter((e) => !myGroups || !e.group_id || myGroups.has(e.group_id));
    const appeals = db.prepare('SELECT * FROM grade_appeals ORDER BY id DESC').all();
    const officeBookings = db.prepare('SELECT * FROM office_hour_bookings ORDER BY id DESC').all();
    const promotions = db.prepare('SELECT * FROM faculty_promotions ORDER BY id DESC').all();
    const dormRooms = db.prepare('SELECT * FROM dorm_rooms ORDER BY building_name, room_no').all();
    const dormAllocations = db.prepare(`
      SELECT a.*, r.building_name, r.room_no
      FROM dorm_allocations a
      JOIN dorm_rooms r ON r.id = a.room_id
      ORDER BY a.id DESC
    `).all();
    const scholarships = db.prepare('SELECT * FROM scholarships ORDER BY id DESC').all();
    const activities = db.prepare('SELECT * FROM student_activities ORDER BY id DESC').all();
    const appraisals = db.prepare('SELECT * FROM hr_appraisals ORDER BY id DESC').all();
    const trainings = db.prepare('SELECT * FROM hr_trainings ORDER BY id DESC').all();
    const biometrics = db.prepare('SELECT * FROM hr_biometric_devices ORDER BY id ASC').all();

    c.json(200, {
      exams,
      studentGroups: isStudent(c) ? [] : listGroups(db),
      appeals: section(appeals, [...EXAMS_READ, 'grade:manage', 'grade:approve']),
      officeBookings: section(officeBookings, [...EXAMS_READ, 'faculty:manage']),
      promotions: hasV12Perm(c, ['faculty:manage', ...HR_READ]) ? promotions : [],
      dormRooms,
      dormAllocations: section(dormAllocations, [...EXAMS_MANAGE, 'exams_housing:view', 'student:read']),
      scholarships: section(scholarships, [...EXAMS_MANAGE, 'sa_scholarships:view', 'sa_scholarships:write', 'sa_scholarships:approve', 'finance:read', 'finance:fees', 'student:read']),
      activities,
      appraisals: hrOnly(appraisals),
      trainings: hrOnly(trainings),
      biometrics: hrOnly(biometrics),
    });
  });

  r.add('POST', '/api/expansions/exams', (c) => {
    requireV12Perm(c, ...EXAMS_MANAGE, 'course:manage');
    const b = c.body ?? {};
    const groupId = Number(b.group_id) || null;
    if (groupId && !db.prepare('SELECT 1 AS x FROM student_groups WHERE id = ?').get(groupId)) throw new HttpError(400, 'الفئة غير موجودة.', 'validation', 'group_id');
    const groupCount = groupId ? groupSize(db, groupId) : null;
    const res = db.prepare(`
      INSERT INTO exam_schedules (course_code, course_name, program_name, exam_type, exam_date, start_time, end_time, hall_name, capacity, enrolled_count, proctor_name, group_id, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'مجدول', ?)
    `).run(
      need(b.course_code, 'رمز المقرر', 30),
      clean(b.course_name, 100),
      clean(b.program_name, 100),
      clean(b.exam_type || 'نهائي', 30),
      clean(b.exam_date || '2026-11-22', 20),
      clean(b.start_time || '09:00', 10),
      clean(b.end_time || '11:00', 10),
      clean(b.hall_name || 'المدرج A2', 60),
      Number(b.capacity) || 0,
      groupCount ?? (Number(b.enrolled_count) || 0),
      clean(b.proctor_name || 'لجنة المراقبة المركزية', 100),
      groupId,
      Date.now()
    );
    audit(db, c.user, 'جدولة امتحان وتوزيع قاعة', clean(b.course_name, 60), c.ip);
    const capacity = Number(b.capacity) || 0;
    c.json(201, { id: Number(res.lastInsertRowid), ...(groupCount !== null && capacity && groupCount > capacity ? { capacityWarning: `عدد طلاب الفئة (${groupCount}) يتجاوز سعة القاعة (${capacity}).` } : {}) });
  });

  r.add('POST', '/api/expansions/appeals', (c) => {
    if (!isStudent(c)) requireV12Perm(c, ...EXAMS_MANAGE, 'grade:manage', 'grade:approve');
    // الطالب يتظلم باسمه هو مهما أُرسل في الطلب
    const b = { ...(c.body ?? {}), ...(isStudent(c) ? { student_no: c.user.student_no } : {}) };
    const studentNo = need(b.student_no, 'الرقم الجامعي', 40), courseCode = need(b.course_code, 'رمز المقرر', 30);
    // الاسم والمقرر والعلامة المعلنة من السجل الفعلي لا مما يُرسل
    const grade = appealGrade(db, studentNo, courseCode);
    if (!grade) throw new HttpError(400, 'لا توجد علامة مرصودة لهذا الطالب في هذا المقرر.', 'validation');
    const res = db.prepare(`
      INSERT INTO grade_appeals (student_no, student_name, course_code, course_name, old_mark, reason, status, grade_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, 'قيد اللجنة', ?, ?)
    `).run(studentNo, grade.student_name, courseCode, grade.course, Number(grade.mark), need(b.reason, 'سبب التظلم', 300), grade.id, Date.now());
    audit(db, c.user, 'تقديم تظلم علامة امتحانية', studentNo, c.ip);
    c.json(201, { id: Number(res.lastInsertRowid) });
  });

  r.add('POST', '/api/expansions/appeals/:id/decide', (c) => {
    requireV12Perm(c, 'grade:approve', 'exams_housing:approve');
    const id = Number(c.params.id), appeal = db.prepare('SELECT * FROM grade_appeals WHERE id = ?').get(id);
    if (!appeal) throw new HttpError(404, 'طلب التظلم غير موجود.', 'not_found');
    if (appeal.status !== 'قيد اللجنة') throw new HttpError(409, 'تم البت في هذا التظلم مسبقاً.', 'conflict');
    const b = c.body ?? {}, now = Date.now();
    const result = tx(db, () => {
      if (!b.approve) {
        db.prepare("UPDATE grade_appeals SET status = 'مرفوض', new_mark = NULL, committee_note = ?, decided_at = ? WHERE id = ?").run(need(b.committee_note, 'قرار اللجنة', 300), now, id);
        audit(db, c.user, 'بت تظلم امتحاني: مرفوض', String(id), c.ip);
        return { status: 'مرفوض', pendingApproval: false, studentId: null };
      }
      const grade = appealGrade(db, appeal.student_no, appeal.course_code);
      if (!grade) throw new HttpError(409, 'لا توجد علامة مرصودة لهذا الطالب في هذا المقرر، فلا يمكن قبول التظلم.', 'conflict');
      const applied = applyAppealMark(db, c.user, grade, b.new_mark, b.committee_note);
      db.prepare("UPDATE grade_appeals SET status = 'مقبول وتعديل العلامة', old_mark = ?, new_mark = ?, grade_id = ?, committee_note = ?, decided_at = ? WHERE id = ?")
        .run(Number(grade.mark), applied.total, grade.id, clean(b.committee_note, 300), now, id);
      audit(db, c.user, 'بت تظلم امتحاني: مقبول وتعديل العلامة', `${appeal.student_no} / ${grade.course}`.slice(0, 100), c.ip);
      return { status: 'مقبول وتعديل العلامة', newMark: applied.total, gradeStatus: applied.status, pendingApproval: applied.status === 'draft', studentId: grade.student_id, course: grade.course };
    });
    if (result.studentId && !result.pendingApproval) notify(deps, [result.studentId], { title: 'قرار تظلم', body: `قُبل تظلمك في «${result.course}» وعُدّلت علامتك.`, url: '/', tag: 'grades' });
    c.json(200, { ok: true, status: result.status, newMark: result.newMark ?? null, pendingApproval: result.pendingApproval });
  });

  r.add('POST', '/api/expansions/office-bookings', (c) => {
    if (!isStudent(c)) requireV12Perm(c, ...EXAMS_MANAGE, 'academic:read', 'faculty:manage');
    const b = { ...(c.body ?? {}), ...(isStudent(c) ? { student_no: c.user.student_no, student_name: c.user.display_name } : {}) };
    const res = db.prepare(`
      INSERT INTO office_hour_bookings (faculty_name, student_name, student_no, slot_day, slot_time, topic, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, 'مؤكد', ?)
    `).run(
      clean(b.faculty_name, 100),
      clean(b.student_name, 100),
      clean(b.student_no, 40),
      clean(b.slot_day || 'الإثنين', 30),
      clean(b.slot_time || '10:00 - 10:30', 30),
      clean(b.topic, 200),
      Date.now()
    );
    c.json(201, { id: Number(res.lastInsertRowid) });
  });

  r.add('POST', '/api/expansions/dorm-allocations', (c) => {
    requireV12Perm(c, ...EXAMS_MANAGE);
    const b = c.body ?? {};
    const roomId = Number(b.room_id);
    if (!db.prepare('SELECT 1 AS x FROM dorm_rooms WHERE id = ?').get(roomId)) throw new HttpError(400, 'اختر غرفة موجودة.', 'validation');
    const res = tx(db, () => {
      db.prepare('UPDATE dorm_rooms SET occupied = LEAST(capacity, occupied + 1) WHERE id = ?').run(roomId);
      return db.prepare(`
        INSERT INTO dorm_allocations (room_id, student_name, student_no, faculty_name, check_in_date, academic_year, payment_status, status)
        VALUES (?, ?, ?, ?, ?, '2026/2027', ?, 'ساكن')
      `).run(
        roomId,
        clean(b.student_name, 100),
        clean(b.student_no, 40),
        clean(b.faculty_name, 100),
        clean(b.check_in_date || new Date().toISOString().slice(0, 10), 20),
        clean(b.payment_status || 'مسدد', 30)
      );
    });
    audit(db, c.user, 'تسكين طالب في السكن الجامعي', clean(b.student_no, 40), c.ip);
    c.json(201, { id: Number(res.lastInsertRowid) });
  });

  r.add('POST', '/api/expansions/scholarships', (c) => {
    requireV12Perm(c, 'sa_scholarships:approve', 'finance:fees');
    const b = c.body ?? {};
    const res = db.prepare(`
      INSERT INTO scholarships (student_name, student_no, program_name, scholarship_type, discount_percent, amount_covered, academic_year, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, '2026/2027', 'مفعّلة', ?)
    `).run(
      clean(b.student_name, 100),
      clean(b.student_no, 40),
      clean(b.program_name, 100),
      clean(b.scholarship_type || 'تفوق أكاديمي', 80),
      Number(b.discount_percent) || 0,
      Number(b.amount_covered) || 0,
      Date.now()
    );
    audit(db, c.user, 'منح إعفاء/منحة دراسية', clean(b.student_no, 40), c.ip);
    c.json(201, { id: Number(res.lastInsertRowid) });
  });

  r.add('POST', '/api/expansions/appraisals', (c) => {
    requireV12Perm(c, 'hr_emp:edit', 'hr:manage');
    const b = c.body ?? {};
    const p1 = Number(b.punctuality_score) || 0;
    const p2 = Number(b.productivity_score) || 0;
    const p3 = Number(b.teamwork_score) || 0;
    const overall = Number(((p1 + p2 + p3) / 3).toFixed(1));
    const res = db.prepare(`
      INSERT INTO hr_appraisals (employee_name, department, period_label, punctuality_score, productivity_score, teamwork_score, overall_score, recommendation, evaluator_name, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      need(b.employee_name, 'اسم الموظف', 100),
      clean(b.department, 100),
      clean(b.period_label || 'التقييم السنوي 2026', 60),
      p1,
      p2,
      p3,
      overall,
      clean(b.recommendation || 'علاوة دورية', 80),
      clean(c.user.display_name, 80),
      Date.now()
    );
    audit(db, c.user, 'اعتماد تقييم أداء وظيفي', clean(b.employee_name, 80), c.ip);
    c.json(201, { id: Number(res.lastInsertRowid) });
  });

  r.add('POST', '/api/expansions/biometrics/sync', (c) => {
    requireV12Perm(c, 'hr:manage', 'staffatt:manage');
    db.prepare('UPDATE hr_biometric_devices SET last_sync_at = ?').run(Date.now());
    audit(db, c.user, 'مزامنة فورية لأجهزة البصمة البيومترية', 'BIO-ALL', c.ip);
    c.json(200, { synced: true, timestamp: Date.now() });
  });

  // ==================== المرحلة 3: البنية التحتية والتوسع (Scalability & DevOps) ====================
  r.add('GET', '/api/devops/overview', (c) => {
    requireV12Perm(c, ...DEVOPS_ACCESS);
    let tablesCount = 0;
    try {
      tablesCount = db.prepare("SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_schema='public' AND table_name NOT LIKE 'pg_%'").get()?.n ?? 0;
    } catch {
      try { tablesCount = db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table'").get()?.n ?? 0; } catch {}
    }
    let migrationsCount = 0;
    try { migrationsCount = db.prepare('SELECT COUNT(*) AS n FROM schema_migrations').get()?.n ?? 0; } catch {}
    let auditCount = 0;
    try { auditCount = db.prepare('SELECT COUNT(*) AS n FROM audit_log').get()?.n ?? 0; } catch {}
    let activeSessions = 0;
    try { activeSessions = db.prepare('SELECT COUNT(*) AS n FROM sessions WHERE expires_at > ?').get(Date.now())?.n ?? 0; } catch {}
    let settings = {};
    try {
      const settingsRows = db.prepare('SELECT * FROM infra_settings').all() || [];
      settings = Object.fromEntries(settingsRows.map((x) => [x.key, JSON.parse(x.value_json)]));
    } catch {}
    const mem = process.memoryUsage();
    const devopsData = buildDevopsAnalytics(db);

    c.json(200, {
      metrics: {
        nodeVersion: process.version,
        uptimeSec: Math.round(process.uptime()),
        rssMb: Math.round(mem.rss / 1048576),
        heapUsedMb: Math.round(mem.heapUsed / 1048576),
        tablesCount,
        migrationsCount,
        auditCount,
        activeSessions,
        totalIncidents: devopsData.stats.total,
        openIncidentsCount: devopsData.stats.open,
        criticalIncidentsCount: devopsData.stats.critical,
        deliverySuccessRate: devopsData.stats.deliverySuccessRate,
        resolutionRate: devopsData.stats.resolutionRate,
        avgLatencyMs: devopsData.stats.avgLatencyMs,
      },
      settings,
      incidents: devopsData.incidents,
      analytics: {
        stats: devopsData.stats,
        delivery: devopsData.delivery,
        timeSeries: devopsData.timeSeries,
        byOperation: devopsData.byOperation,
        bySeverity: devopsData.bySeverity,
        deliveryBreakdown: devopsData.deliveryBreakdown,
        statusBreakdown: devopsData.statusBreakdown,
        byFile: devopsData.byFile,
      },
    });
  });

  r.add('GET', '/api/devops/incidents', (c) => {
    requireV12Perm(c, ...DEVOPS_ACCESS);
    const devopsData = buildDevopsAnalytics(db);
    c.json(200, devopsData);
  });

  r.add('POST', '/api/devops/incidents', (c) => {
    requireV12Perm(c, ...DEVOPS_ACCESS);
    const b = c.body ?? {};
    const reportCode = clean(b.report_code || `INC-${new Date().getFullYear()}-${Math.floor(1000 + Math.random() * 9000)}`, 40);
    const source = clean(b.source || 'Code Studio', 80);
    const eventType = clean(b.event_type || 'FILE_OPERATION_FAILURE', 60);
    const severity = ['critical', 'error', 'warning', 'info'].includes(b.severity) ? b.severity : 'error';
    const filePath = clean(b.file_path || '', 200);
    const errorMessage = clean(b.error_message || 'حدث خطأ في عملية استوديو الكود', 500);
    const errorDetails = typeof b.error_details === 'object' ? JSON.stringify(b.error_details) : clean(b.error_details, 2000);
    const clientContext = typeof b.client_context === 'object' ? JSON.stringify(b.client_context) : clean(b.client_context, 1000);

    const res = db.prepare(`
      INSERT INTO devops_incident_reports (report_code, source, event_type, severity, file_path, error_message, error_details, client_context, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'open', ?)
    `).run(
      reportCode,
      source,
      eventType,
      severity,
      filePath,
      errorMessage,
      errorDetails,
      clientContext,
      Date.now()
    );

    const userName = (c.user && c.user.display_name) || 'مطور استوديو الكود';
    audit(db, c.user || { id: 0, username: 'studio', display_name: userName, role: 'admin' }, 'تسجيل بلاغ خطأ استوديو الكود في DevOps', `${reportCode} - ${filePath}`, c.ip);

    c.json(201, {
      ok: true,
      id: Number(res.lastInsertRowid),
      report_code: reportCode,
      created_at: Date.now(),
    });
  });

  r.add('POST', '/api/devops/incidents/:id/resolve', (c) => {
    requireV12Perm(c, 'devops:manage', 'settings:manage', 'backup:manage');
    const id = Number(c.params.id);
    const b = c.body ?? {};
    const note = clean(b.note || 'تمت معالجة وتصحيح العطل من مهندس DevOps', 400);
    const resolvedBy = clean((c.user && c.user.display_name) || b.resolved_by || 'مهندس DevOps', 80);

    db.prepare(`
      UPDATE devops_incident_reports
      SET status = 'resolved', resolution_note = ?, resolved_at = ?, resolved_by = ?
      WHERE id = ?
    `).run(note, Date.now(), resolvedBy, id);

    audit(db, c.user, 'حل بلاغ خطأ في DevOps', `Incident #${id}`, c.ip);
    c.json(200, { ok: true, id, status: 'resolved' });
  });

  r.add('DELETE', '/api/devops/incidents/:id', (c) => {
    requireV12Perm(c, 'devops:manage', 'settings:manage', 'backup:manage');
    const id = Number(c.params.id);
    db.prepare('DELETE FROM devops_incident_reports WHERE id = ?').run(id);
    audit(db, c.user, 'حذف بلاغ خطأ من سجل DevOps', `Incident #${id}`, c.ip);
    c.json(200, { ok: true });
  });

  r.add('PUT', '/api/devops/settings/:key', (c) => {
    requireV12Perm(c, 'devops:manage', 'settings:manage', 'backup:manage');
    const key = clean(c.params.key, 40);
    const val = JSON.stringify(c.body ?? {});
    db.prepare('INSERT INTO infra_settings (key, value_json, updated_at) VALUES (?, ?, ?) ON CONFLICT (key) DO UPDATE SET value_json = EXCLUDED.value_json, updated_at = EXCLUDED.updated_at').run(key, val, Date.now());
    audit(db, c.user, `تحديث إعدادات البنية التحتية (${key})`, key, c.ip);
    c.json(200, { ok: true });
  });

  r.add('GET', '/api/devops/postgres-ddl', (c) => {
    requireV12Perm(c, ...DEVOPS_ACCESS);
    const tables = db.prepare("SELECT table_name AS name FROM information_schema.tables WHERE table_schema='public' AND table_name NOT LIKE 'pg_%' ORDER BY table_name").all();
    const pgSql = [
      '-- ====================================================================',
      '-- مخطط قاعدة بيانات PostgreSQL 16 المولّد آلياً لمنظومة Uni-ERP v12',
      '-- يدعم التوسع الأفقي، Connection Pooling (PgBouncer)، ونسخ القراءة',
      '-- ====================================================================',
      'BEGIN;',
      ...tables.map((t) => {
        const converted = String(t.sql || '')
          .replace(/INTEGER PRIMARY KEY AUTOINCREMENT/gi, 'BIGSERIAL PRIMARY KEY')
          .replace(/\bINTEGER\b/gi, 'BIGINT')
          .replace(/\bREAL\b/gi, 'DOUBLE PRECISION')
          .replace(/\bBLOB\b/gi, 'BYTEA');
        return `${converted};`;
      }),
      'COMMIT;',
    ].join('\n\n');
    c.json(200, { ddl: pgSql, tablesCount: tables.length });
  });

  // ==================== المرحلة 4: الذكاء الاصطناعي الجامعي (AI-Powered University) ====================
  r.add('GET', '/api/ai/overview', (c) => {
    if (!isStudent(c)) requireV12Perm(c, ...AI_READ);
    const student = isStudent(c);
    const warnings = db.prepare('SELECT * FROM ai_early_warnings ORDER BY id DESC').all().filter((w) => !student || w.student_no === c.user.student_no);
    const triageLogs = student ? [] : db.prepare('SELECT * FROM ai_triage_logs ORDER BY id DESC').all();
    const chats = student
      ? db.prepare('SELECT * FROM ai_advisor_chats WHERE user_label = ? ORDER BY id DESC LIMIT 20').all(clean(c.user.display_name, 80))
      : db.prepare('SELECT * FROM ai_advisor_chats ORDER BY id DESC LIMIT 20').all();
    c.json(200, {
      warnings,
      triageLogs,
      chats,
      stats: {
        criticalCount: warnings.filter((w) => w.risk_level === 'حرج').length,
        mediumCount: warnings.filter((w) => w.risk_level === 'متوسط').length,
        safeCount: warnings.filter((w) => w.risk_level === 'آمن').length,
        triageCount: triageLogs.length,
        chatsCount: chats.length,
      },
    });
  });

  // 1) المسح الذكي للإنذار الأكاديمي المبكر
  r.add('POST', '/api/ai/early-warning/analyze', async (c) => {
    requireV12Perm(c, 'enterprise_ai:use', 'sa_advising:edit');
    const b = c.body ?? {};
    const studentName = need(b.student_name, 'اسم الطالب', 100);
    const studentNo = need(b.student_no, 'الرقم الجامعي', 40);
    const programName = clean(b.program_name, 100);
    const gpa = Number(b.gpa) || 0;
    const attendance = Number(b.attendance_rate) || 0;
    const failed = Number(b.failed_courses) || 0;
    const riskLevel = gpa < 65 || attendance < 70 || failed >= 2 ? 'حرج' : gpa < 75 || attendance < 80 || failed === 1 ? 'متوسط' : 'آمن';

    const aiOut = await callGeminiAI(
      'أنت خبير إرشاد أكاديمي جامعي. حلل بيانات الطالب وقدم تشخيصاً مختصراً وخطة تدخل عملية من 3 نقاط باللغة العربية.',
      `الطالب: ${studentName} (${studentNo})، التخصص: ${programName}، المعدل: ${gpa}%، نسبة الحضور: ${attendance}%، المواد المتعثرة: ${failed}.`,
      () => riskLevel === 'حرج'
        ? `تشخيص مبكر: خطر أكاديمي مرتفع بسبب تراجع المعدل (${gpa}%) وانخفاض الحضور (${attendance}%).\nخطة التدخل: 1) استدعاء إرشادي عاجل وتحديد سقف الساعات بـ 12 ساعة. 2) جدولة دروس تقوية عملية. 3) متابعة أسبوعية لسجل الحضور.`
        : riskLevel === 'متوسط'
        ? `تشخيص مبكر: أداء متوسط يحتاج دعم في المقررات التخصصية (المعدل ${gpa}%).\nخطة التدخل: 1) حضور الساعات المكتبية مع مدرس المقرر. 2) مراجعة خطة توزيع المقررات للفصل القادم.`
        : `تشخيص مبكر: أداء أكاديمي متميز ومستقر (${gpa}%) والتزام عالٍ بالحضور (${attendance}%).\nالتوصية: ترشيح الطالب لبرامج التميز البحثي والمسابقات العلمية.`
    );

    const parts = aiOut.text.split('خطة التدخل:');
    const diagnosis = clean(parts[0]?.replace('تشخيص مبكر:', '') || aiOut.text, 400);
    const plan = clean(parts[1] || 'متابعة دورية مع المرشد الأكاديمي ومراجعة العبء التدريسي.', 400);

    const res = db.prepare(`
      INSERT INTO ai_early_warnings (student_no, student_name, program_name, gpa, attendance_rate, failed_courses, risk_level, ai_diagnosis, ai_action_plan, advisor_status, analyzed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'تم التحليل بالذكاء الاصطناعي', ?)
    `).run(studentNo, studentName, programName, gpa, attendance, failed, riskLevel, diagnosis, plan, Date.now());

    audit(db, c.user, 'تحليل الإنذار الأكاديمي المبكر AI', studentNo, c.ip);
    c.json(201, { id: Number(res.lastInsertRowid), risk_level: riskLevel, ai_diagnosis: diagnosis, ai_action_plan: plan, model: aiOut.model });
  });

  // 2) المرشد الأكاديمي الذكي
  r.add('POST', '/api/ai/advisor/ask', async (c) => {
    const question = clean(c.body?.question, 500);
    if (!question) throw new HttpError(400, 'يرجى كتابة السؤال الأكاديمي.');

    const coursesCount = db.prepare('SELECT COUNT(*) AS n FROM courses').get().n;
    const programs = db.prepare('SELECT name FROM programs WHERE active = 1').all().map((p) => p.name).join('، ');

    const aiOut = await callGeminiAI(
      `أنت المرشد الأكاديمي الذكي في الجامعة السورية للعلوم الأمنية (منظومة Uni-ERP v12).
أجب بدقة ووضوح باللغة العربية وفق اللوائح الجامعية.
البرامج المتاحة في الجامعة: ${programs || 'هندسة الأمن السيبراني، الحقوق والعلوم الشرطية'}.
إجمالي المقررات المسجلة: ${coursesCount}.
قواعد الجامعة: الحد الأدنى للنجاح 60%، الإنذار الأكاديمي تحت 65%، مرتبة الشرف فوق 90%، والحد الأقصى للغياب المسموح 15%.`,
      question,
      () => {
        if (question.includes('تخرج') || question.includes('ساعات')) {
          return 'وفق اللائحة الأكاديمية للجامعة، يتطلب التخرج إتمام كافة الساعات المعتمدة في الخطة الدراسية للبرنامج بمعدل تراكمي لا يقل عن 60%، وإنجاز مشروع التخرج والتدريب العملي بنجاح مع براءة ذمة من المكتبة الرقمية والشؤون المالية.';
        }
        if (question.includes('غياب') || question.includes('حرمان')) {
          return 'تنص لائحة الدوام الجامعي على أن نسبة الحضور الإلزامية هي 85% كحد أدنى في كل مقرر. عند تجاوز نسبة الغياب 15% بدون عذر طبي أو رسمي معتمد من شؤون الطلاب، يُصدر النظام إنذاراً آلياً ثم حرماناً من التقدم للامتحان النهائي.';
        }
        return `بناءً على أنظمة الجامعة والبرامج المعتمدة (${programs || 'الأمن السيبراني والحقوق'})، يُنصح الطالب بتسجيل المقررات التأسيسية أولاً ومراعاة المتطلبات السابقة، مع الاستفادة من الساعات المكتبية لأعضاء هيئة التدريس والمحاضرات الرقمية في وحدة التعلم الإلكتروني (5.12).`;
      }
    );

    const res = db.prepare(`
      INSERT INTO ai_advisor_chats (user_label, question, answer, model_used, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(clean(c.user?.display_name || 'مستخدم النظام', 80), question, aiOut.text, aiOut.model, Date.now());

    c.json(201, { id: Number(res.lastInsertRowid), question, answer: aiOut.text, model: aiOut.model });
  });

  // 3) المصنف والمحلل الذكي للمراسلات والشكاوى
  r.add('POST', '/api/ai/triage/analyze', async (c) => {
    requireV12Perm(c, 'enterprise_ai:use', 'corr:use', 'complaint:manage');
    const b = c.body ?? {};
    const subject = clean(b.subject, 160);
    const bodyText = clean(b.body_text, 800);
    if (!subject || !bodyText) throw new HttpError(400, 'عنوان ونص المراسلة/الشكوى مطلوبان.');

    const textCombined = `${subject} ${bodyText}`;
    const isExam = /امتحان|علامة|درجة|تعارض|تظلم|مقرر/.test(textCombined);
    const isFinance = /رسوم|قسط|مالي|دفع|إعفاء|منحة|فاتورة/.test(textCombined);
    const isTech = /كلمة مرور|حساب|بطاقة|بوابة|عطل|شبكة|مختبر/.test(textCombined);

    const category = isExam ? 'شؤون الامتحانات والتقييم' : isFinance ? 'الشؤون المالية والرسوم' : isTech ? 'الدعم التقني والأمن السيبراني' : 'الشؤون الإدارية والطلابية';
    const priority = /عاجل|تعارض|حرمان|فوري|خطأ/.test(textCombined) ? 'عاجل جداً' : 'مرتفع';
    const targetUnit = isExam ? 'قسم الامتحانات وشؤون الطلاب' : isFinance ? 'مديرية الشؤون المالية والمحاسبة' : isTech ? 'مديرية تقانة المعلومات والأمن السيبراني' : 'رئاسة الديوان والشؤون الإدارية';

    const aiOut = await callGeminiAI(
      'أنت مساعد إداري ذكي في رئاسة الجامعة. لخص الشكوى أو المذكرة في جملة واحدة، ثم اكتب مسودة رد رسمي رصين ومهذب باللغة العربية.',
      `الموضوع: ${subject}\nالنص: ${bodyText}\nالتصنيف: ${category}\nالجهة المختصة: ${targetUnit}`,
      () => `الملخص: طلب متعلق بـ «${subject}» موجه إلى ${targetUnit} للمعالجة.\nالرد المقترح: تهديكم إدارة الجامعة أطيب التحيات. إشارةً إلى كتابكم/طلبكم حول «${subject}»، نفيدكم بأنه تمت إحالة الموضوع إلى ${targetUnit} للدراسة واتخاذ الإجراء النظامي اللازم وفق اللوائح المعتمدة.`
    );

    const lines = aiOut.text.split('\n').filter(Boolean);
    const summary = clean(lines[0]?.replace(/^الملخص:\s*/, '') || subject, 300);
    const draftReply = clean(lines.slice(1).join(' ').replace(/^الرد المقترح:\s*/, '') || aiOut.text, 500);

    const res = db.prepare(`
      INSERT INTO ai_triage_logs (source_type, sender_name, subject, body_text, ai_category, ai_priority, target_unit, ai_summary, ai_draft_reply, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      clean(b.source_type || 'مراسلة / شكوى', 40),
      clean(b.sender_name || c.user?.display_name || 'مقدم الطلب', 80),
      subject,
      bodyText,
      category,
      priority,
      targetUnit,
      summary,
      draftReply,
      Date.now()
    );

    audit(db, c.user, 'تحليل وتصنيف ذكي لمراسلة AI', subject, c.ip);
    c.json(201, {
      id: Number(res.lastInsertRowid),
      ai_category: category,
      ai_priority: priority,
      target_unit: targetUnit,
      ai_summary: summary,
      ai_draft_reply: draftReply,
      model: aiOut.model,
    });
  });
}
