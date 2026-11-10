// مصفوفة الصلاحيات الشاملة والأقسام ومستويات الوصول (عرض / كتابة / تعديل / اعتماد / حذف وتصدير)
// تغطي كافة أقسام ووحدات المنصة الجامعية وتدعم التخصيص الفردي للحسابات والأقسام والأدوار

export const PERMISSION_CATALOG = [
  {
    group: 'الطلبات والوثائق',
    items: [
      { key: 'request:read_all', label: 'عرض كل الطلبات في الجامعة', op: 'view', module: 'requests_docs' },
      { key: 'request:read_unit', label: 'عرض الطلبات المحالة إلى وحدته فقط', op: 'view', module: 'requests_docs' },
      { key: 'request:decide', label: 'اعتماد الطلبات أو رفضها وإصدار الوثائق', op: 'approve', module: 'requests_docs' },
      { key: 'request:forward', label: 'إحالة الطلبات بين الوحدات المرتبطة وتعديل مسارها', op: 'edit', module: 'requests_docs' },
      { key: 'request:create_internal', label: 'كتابة وتقديم طلبات داخلية ومتابعتها', op: 'write', module: 'requests_docs' },
      { key: 'request:import', label: 'استيراد دفعة طلبات من ملف Excel', op: 'write', module: 'requests_docs' },
      { key: 'document:read_all', label: 'عرض سجل الوثائق الرسمية الصادرة وتصديرها', op: 'delete', module: 'requests_docs' },
    ],
  },
  {
    group: 'شؤون الطلاب',
    items: [
      { key: 'student:read', label: 'عرض ملفات الطلاب وسجلهم الموحد 360°', op: 'view', module: 'student_affairs' },
      { key: 'student:lookup', label: 'البحث عن طالب بالاسم أو الرقم الجامعي، دون فتح ملفه', op: 'view', module: 'student_affairs' },
      { key: 'sa_quiz:write', label: 'إعداد الاختبارات الإلكترونية وأسئلتها ونشرها', op: 'write', module: 'student_affairs' },
      { key: 'sa_quiz:approve', label: 'اعتماد الاختبارات الإلكترونية لمقررات المدرس وتصحيحها', op: 'approve', module: 'student_affairs' },
      { key: 'student:register', label: 'تسجيل طلاب جدد وتوليد بيانات دخولهم', op: 'write', module: 'student_affairs' },
      { key: 'student:update', label: 'تعديل ملفات الطلاب وحركات القيد النظامية', op: 'edit', module: 'student_affairs' },
      { key: 'student:reset_password', label: 'إعادة تعيين كلمات مرور الطلاب واعتماد حساباتهم', op: 'approve', module: 'student_affairs' },
      { key: 'student:delete', label: 'حذف ملف طالب نهائياً', op: 'delete', module: 'student_affairs' },
      { key: 'sa_lifecycle:dean', label: 'موافقة العميد أو مجلس الكلية على حركات القيد', op: 'approve', module: 'student_affairs' },
      { key: 'sa_lifecycle:final', label: 'القرار النهائي لحركات القيد (رئيس الجامعة أو نائبه)', op: 'approve', module: 'student_affairs' },
    ],
  },
  {
    group: 'القبول والإرشاد والمنح الطلابية',
    items: [
      { key: 'sa_admissions:view', label: 'عرض بوابة القبول والمفاضلة وطلبات معادلة المواد', op: 'view', module: 'admissions_advising' },
      { key: 'sa_admissions:write', label: 'كتابة وإدخال طلبات المفاضلة ومعادلة المقررات', op: 'write', module: 'admissions_advising' },
      { key: 'sa_admissions:approve', label: 'تشغيل الفرز الآلي وتثبيت القبول واعتماد المعادلة', op: 'approve', module: 'admissions_advising' },
      { key: 'sa_advising:view', label: 'عرض الخطة التفاعلية والإرشاد الأكاديمي والإنذار المبكر', op: 'view', module: 'admissions_advising' },
      { key: 'sa_advising:edit', label: 'تعديل الخطة الدراسية للطالب وتوثيق جلسات الإرشاد', op: 'edit', module: 'admissions_advising' },
      { key: 'sa_scholarships:view', label: 'عرض المنح والإعفاءات والرعاية الطلابية وطابور مكتب الخدمة', op: 'view', module: 'admissions_advising' },
      { key: 'sa_housing:view', label: 'عرض السكن الجامعي والساعات المكتبية والأنشطة الطلابية', op: 'view', module: 'admissions_advising' },
      { key: 'sa_housing:manage', label: 'تسكين الطلاب وحجز الساعات المكتبية', op: 'edit', module: 'admissions_advising' },
      { key: 'sa_discipline:view', label: 'عرض سجل اللجان الانضباطية والتأديبية', op: 'view', module: 'admissions_advising' },
      { key: 'sa_scholarships:write', label: 'كتابة وتسجيل منح وإعفاءات جديدة وتذاكر خدمة الطالب', op: 'write', module: 'admissions_advising' },
      { key: 'sa_scholarships:approve', label: 'اعتماد المنح وترحيل الإعفاءات مالياً وإصدار الوثائق الفورية', op: 'approve', module: 'admissions_advising' },
    ],
  },
  {
    group: 'الشؤون الأكاديمية',
    items: [
      { key: 'academic:read', label: 'عرض دليل المواد والجداول والعلامات وأعضاء هيئة التدريس', op: 'view', module: 'academics' },
      { key: 'course:manage', label: 'كتابة وتعديل دليل المواد والمتطلبات السابقة والجداول', op: 'edit', module: 'academics' },
      { key: 'grade:manage', label: 'إدخال العلامات وتعديلها قبل الاعتماد', op: 'write', module: 'academics' },
      { key: 'grade:approve', label: 'اعتماد علامات المقررات غير المسندة لعضو هيئة، وتعديل المعتمد بتبرير', op: 'approve', module: 'academics' },
      { key: 'grade:approve_own', label: 'اعتماد علامات المقررات المسندة إليه فقط، بعد إرسالها من قسم الامتحانات', op: 'approve', module: 'academics' },
      { key: 'attendance:manage', label: 'تسجيل وإدارة سجل دخول وخروج القاعات (مسح الباركود)', op: 'write', module: 'academics' },
      { key: 'faculty:manage', label: 'إدارة ملفات أعضاء هيئة التدريس والعبء التدريسي', op: 'edit', module: 'academics' },
    ],
  },
  {
    group: 'المجالس واللجان',
    items: [
      { key: 'council:manage', label: 'تشكيل المجالس واللجان وتعيين أعضائها وإدارة كل اجتماعاتها', op: 'edit', module: 'correspondence' },
      { key: 'council:read_all', label: 'الاطلاع على كل المجالس واللجان ومحاضرها وقراراتها', op: 'view', module: 'correspondence' },
    ],
  },
  {
    group: 'المراسلات والموارد البشرية',
    items: [
      { key: 'corr:use', label: 'إنشاء المراسلات الداخلية وإرسالها والرد عليها', op: 'write', module: 'correspondence' },
      { key: 'corr:read_all', label: 'الاطلاع على كل المراسلات في الجامعة (إشراف)', op: 'view', module: 'correspondence' },
      { key: 'corr:templates', label: 'إدارة قوالب المراسلات (إضافة وتعديل وتعطيل)', op: 'edit', module: 'correspondence' },
      { key: 'staffatt:self', label: 'تسجيل الحضور والانصراف الشخصي وعرض رصيد إجازتي', op: 'view', module: 'hr_integrated' },
      { key: 'staffatt:manage', label: 'إدارة حضور الموظفين وأرصدة الإجازات والتقارير الشهرية', op: 'edit', module: 'hr_integrated' },
    ],
  },
  {
    group: 'شؤون الموظفين والرواتب والعقود',
    items: [
      { key: 'hr_emp:view', label: 'عرض ملفات الموظفين والهيكل الوظيفي والعقود والرواتب', op: 'view', module: 'hr_integrated' },
      { key: 'hr_emp:write', label: 'إضافة موظفين جدد وتسجيل الإجازات والسلف والمهمات', op: 'write', module: 'hr_integrated' },
      { key: 'hr_emp:edit', label: 'تعديل البيانات الوظيفية والعقود وتقييم الأداء والخصومات', op: 'edit', module: 'hr_integrated' },
      { key: 'hr:manage', label: 'إدارة الموارد البشرية والرواتب والعقود والسلف والتنبيهات', op: 'edit', module: 'hr_integrated' },
      { key: 'hr_payroll:approve', label: 'إعداد واعتماد مسيرات الرواتب الشهرية وصرف المستحقات', op: 'approve', module: 'hr_integrated' },
      { key: 'hr_emp:delete', label: 'إنهاء الخدمة أو أرشفة وحذف السجلات الوظيفية وتصديرها', op: 'delete', module: 'hr_integrated' },
    ],
  },
  {
    group: 'المالية والمحاسبة',
    items: [
      { key: 'finance:read', label: 'عرض الحسابات والقيود والتقارير المالية وأرصدة الطلاب', op: 'view', module: 'finance_accounting' },
      { key: 'finance:entry', label: 'إنشاء وتعديل قيود اليومية وسندات القبض والصرف (مسودات)', op: 'write', module: 'finance_accounting' },
      { key: 'finance:fees', label: 'إدارة وتعديل أنواع الرسوم واستحقاقات الطلاب وإيصالات الدفع', op: 'edit', module: 'finance_accounting' },
      { key: 'finance:post', label: 'اعتماد وترحيل القيود المحاسبية وعكسها', op: 'approve', module: 'finance_accounting' },
      { key: 'finance:setup', label: 'إدارة دليل الحسابات والسنوات المالية والعملات ومراكز الكلفة', op: 'delete', module: 'finance_accounting' },
    ],
  },
  {
    group: 'المشتريات والمخازن والأصول',
    items: [
      { key: 'procurement:read', label: 'عرض المخازن والأصناف وطلبات الشراء والأصول الثابتة', op: 'view', module: 'procurement_assets' },
      { key: 'procurement:request', label: 'كتابة وإنشاء طلبات الشراء وإرسالها للاعتماد', op: 'write', module: 'procurement_assets' },
      { key: 'procurement:stock', label: 'استلام التوريد وصرف المخزون وتعديل الحركة المخزنية', op: 'edit', module: 'procurement_assets' },
      { key: 'procurement:assets', label: 'إدارة وتعديل الأصول الثابتة وحركاتها (نقل، صيانة، إتلاف)', op: 'delete', module: 'procurement_assets' },
      { key: 'procurement:manage', label: 'اعتماد طلبات الشراء وإنشاء أوامر التوريد وإدارة الموردين', op: 'approve', module: 'procurement_assets' },
      { key: 'procurement:approve_finance', label: 'الاعتماد المالي لطلبات الشراء التي تتجاوز حدها في الإعدادات', op: 'approve', module: 'procurement_assets' },
      { key: 'procurement:approve_top', label: 'اعتماد رئاسة الجامعة لطلبات الشراء الكبرى', op: 'approve', module: 'procurement_assets' },
    ],
  },
  {
    group: 'الامتحانات والتعلم الإلكتروني',
    items: [
      { key: 'exams_housing:view', label: 'عرض جداول الامتحانات ونتائج التقييم', op: 'view', module: 'exams_housing' },
      { key: 'exams_housing:write', label: 'إضافة جلسات امتحانية وتوزيع المراقبين', op: 'write', module: 'exams_housing' },
      { key: 'exams_housing:edit', label: 'تعديل القاعات الامتحانية وضبط التقييم', op: 'edit', module: 'exams_housing' },
      { key: 'exams_housing:approve', label: 'اعتماد جداول الامتحانات النهائية', op: 'approve', module: 'exams_housing' },
      { key: 'lms_lib:view', label: 'عرض المقررات الإلكترونية وفهرس المكتبة الرقمية والإعارات', op: 'view', module: 'lms_library' },
      { key: 'lms_lib:write', label: 'رفع المحاضرات والواجبات وإضافة كتب ومراجع جديدة', op: 'write', module: 'lms_library' },
      { key: 'lms_lib:edit', label: 'تعديل محتوى المقررات الرقمية وإدارة الإعارات والاسترجاع', op: 'edit', module: 'lms_library' },
      { key: 'lms_lib:approve', label: 'اعتماد المقررات الإلكترونية وجرد المكتبة الرقمية', op: 'approve', module: 'lms_library' },
    ],
  },
  {
    group: 'البحث العلمي والخريجون والجودة',
    items: [
      { key: 'research_grad:view', label: 'عرض مشاريع البحث العلمي والرسائل الجامعية والدراسات العليا', op: 'view', module: 'research_grad' },
      { key: 'research_grad:write', label: 'تسجيل مشاريع بحثية جديدة ورسائل ماجستير ودكتوراه', op: 'write', module: 'research_grad' },
      { key: 'research_grad:edit', label: 'تعديل فرق البحث والمشرفين ولجان المناقشة العلمية', op: 'edit', module: 'research_grad' },
      { key: 'research_grad:approve', label: 'اعتماد تمويل الأبحاث وإجازة الرسائل العلمية', op: 'approve', module: 'research_grad' },
      { key: 'alumni_career:view', label: 'عرض قاعدة بيانات الخريجين وفرص التوظيف والشراكات', op: 'view', module: 'alumni_career' },
      { key: 'alumni_career:write', label: 'إضافة خريجين جدد وإعلانات وظائف وفعاليات مهنية', op: 'write', module: 'alumni_career' },
      { key: 'alumni_career:edit', label: 'تحديث المسار المهني للخريجين واتفاقيات التدريب', op: 'edit', module: 'alumni_career' },
      { key: 'qa_inst:view', label: 'عرض مؤشرات الجودة والاعتماد الأكاديمي والتطوير المؤسسي', op: 'view', module: 'qa_enterprise' },
      { key: 'qa_inst:edit', label: 'تحديث معايير الجودة ومؤشرات الأداء وخطط التحسين', op: 'edit', module: 'qa_enterprise' },
      { key: 'qa_inst:approve', label: 'اعتماد تقارير الجودة الذاتية والاعتماد المؤسسي', op: 'approve', module: 'qa_enterprise' },
      { key: 'enterprise_ai:use', label: 'استخدام منظومة التطوير المؤسسي (15 ميزة) والمساعد الذكي AI', op: 'write', module: 'qa_enterprise' },
    ],
  },
  {
    group: 'التقارير والتواصل',
    items: [
      { key: 'stats:read', label: 'عرض لوحة الإحصاءات والتقارير التنفيذية', op: 'view', module: 'comms_reports' },
      { key: 'comms:read', label: 'عرض الأخبار الجامعية وسجل الشكاوى والمقترحات', op: 'view', module: 'comms_reports' },
      { key: 'news:manage', label: 'كتابة ونشر الأخبار وتعديلها وحذفها', op: 'write', module: 'comms_reports' },
      { key: 'complaint:manage', label: 'الرد على الشكاوى الطلابية ومعالجتها وإغلاقها', op: 'approve', module: 'comms_reports' },
      { key: 'data:export', label: 'تصدير كافة البيانات والتقارير (Excel / Word / PDF)', op: 'delete', module: 'comms_reports' },
    ],
  },
  {
    group: 'استيراد البيانات',
    items: [
      { key: 'import:academic', label: 'استيراد البيانات الأكاديمية والهيكل التنظيمي', op: 'write', module: 'governance_system' },
      { key: 'import:procurement', label: 'استيراد بيانات المشتريات والمخزون', op: 'write', module: 'governance_system' },
      { key: 'import:finance', label: 'استيراد البيانات المالية الأساسية', op: 'write', module: 'governance_system' },
      { key: 'import:hr', label: 'استيراد بيانات الموارد البشرية', op: 'write', module: 'governance_system' },
      { key: 'import:student_fin', label: 'استيراد مالية الطلاب (الأقساط والمنح)', op: 'write', module: 'governance_system' },
      { key: 'import:misc', label: 'استيراد البيانات المتفرقة (أخبار وقوالب ومكتبة)', op: 'write', module: 'governance_system' },
      { key: 'import:groups', label: 'استيراد فئات الطلاب وأعضائها', op: 'write', module: 'governance_system' },
      { key: 'import:high_risk', label: 'اعتماد استيراد الجداول الحساسة', op: 'approve', module: 'governance_system' },
      { key: 'import:undo', label: 'التراجع عن دفعة استيراد', op: 'approve', module: 'governance_system' },
    ],
  },
  {
    group: 'الإدارة والحوكمة',
    items: [
      { key: 'holds:manage', label: 'فرض الذمم والموانع الأكاديمية والمالية ورفعها', op: 'approve', module: 'governance_system' },
      { key: 'rules:manage', label: 'إدارة وتعديل قواعد الفحص الآلي والخدمات الإلكترونية', op: 'edit', module: 'governance_system' },
      { key: 'program:manage', label: 'إدارة الكليات والمعاهد والبرامج الأكاديمية', op: 'edit', module: 'governance_system' },
      { key: 'user:manage', label: 'تأسيس وإدارة الحسابات وتخصيص صلاحيات الموظفين', op: 'write', module: 'governance_system' },
      { key: 'role:manage', label: 'إدارة الأدوار والأقسام الإدارية ومصفوفة الصلاحيات', op: 'approve', module: 'governance_system' },
      { key: 'audit:read', label: 'عرض سجل التدقيق الأمني وفحص سلامة السلسلة', op: 'view', module: 'governance_system' },
      { key: 'backup:manage', label: 'إنشاء وتنزيل وحذف النسخ الاحتياطية لقاعدة البيانات', op: 'delete', module: 'governance_system' },
      { key: 'settings:manage', label: 'تعديل إعدادات النظام والحدود والسياسات والمظهر', op: 'edit', module: 'governance_system' },
      { key: 'devops:manage', label: 'إدارة البنية التحتية والخوادم وسجل الجاهزية', op: 'approve', module: 'governance_system' },
    ],
  },
];

export const ASSIGNABLE = new Set(PERMISSION_CATALOG.flatMap((g) => g.items.map((i) => i.key)));

// مصفوفة أقسام المنصة الـ 14 مع تقسيم العمليات الخمس (عرض / كتابة / تعديل / اعتماد / حذف وتصدير)
export const PLATFORM_MODULES_MATRIX = [
  {
    id: 'student_affairs',
    title: 'شؤون الطلاب والسجل الأكاديمي 360°',
    label: 'شؤون الطلاب والسجل الأكاديمي 360°',
    department: 'عمادة شؤون الطلاب والامتحانات',
    description: 'ملفات الطلاب، البطاقة الجامعية، حركات القيد، الذمم والموانع، وسجل الطالب الشامل',
    viewKeys: ['affairs', 'exchange'],
    views: ['affairs', 'exchange'],
    actions: {
      view: { label: 'عرض الملفات والسجل', perms: ['student:read', 'student:lookup'] },
      write: { label: 'تسجيل طلاب جدد', perms: ['student:register'] },
      edit: { label: 'تعديل البيانات وحركات القيد', perms: ['student:update'] },
      approve: { label: 'إدارة الذمم وكلمات المرور واعتماد حركات القيد', perms: ['student:reset_password', 'holds:manage', 'sa_lifecycle:dean', 'sa_lifecycle:final'] },
      delete: { label: 'حذف ملفات وتصدير البيانات', perms: ['student:delete', 'data:export'] },
    },
  },
  {
    id: 'admissions_advising',
    title: 'القبول والمفاضلة والإرشاد والمنح الطلابية',
    label: 'القبول والمفاضلة والإرشاد والمنح الطلابية',
    department: 'مديرية القبول والإرشاد والمنح',
    description: 'المفاضلة الإلكترونية، معادلة المواد، الخطة التفاعلية، الإنذار المبكر، والمنح والإعفاءات',
    viewKeys: ['affairs', 'student_life', 'labtools'],
    views: ['affairs', 'student_life', 'labtools'],
    actions: {
      view: { label: 'عرض المفاضلة والإرشاد والمنح', perms: ['sa_admissions:view', 'sa_advising:view', 'sa_scholarships:view', 'sa_housing:view'] },
      write: { label: 'إدخال طلبات المفاضلة والمنح', perms: ['sa_admissions:write', 'sa_scholarships:write'] },
      edit: { label: 'تعديل الخطط وجلسات الإرشاد والتسكين', perms: ['sa_advising:edit', 'sa_housing:manage'] },
      approve: { label: 'اعتماد القبول والمنح مالياً', perms: ['sa_admissions:approve', 'sa_scholarships:approve'] },
      delete: { label: 'تصدير قوائم القبول والمنح', perms: ['data:export'] },
    },
  },
  {
    id: 'requests_docs',
    title: 'الطلبات الطلابية والمعاملات والوثائق الرسمية',
    label: 'الطلبات الطلابية والمعاملات والوثائق الرسمية',
    department: 'مكتب خدمة الطالب الموحد والديوان',
    description: 'معالجة الطلبات، الإحالة بين الوحدات، إصدار المصدقات وكشوف العلامات والتحقق الرقمي',
    viewKeys: ['affairs', 'internal', 'verify'],
    views: ['affairs', 'internal', 'verify'],
    actions: {
      view: { label: 'عرض الطلبات والمعاملات', perms: ['request:read_all'] },
      write: { label: 'إنشاء واستيراد الطلبات', perms: ['request:create_internal', 'request:import'] },
      edit: { label: 'إحالة الطلبات بين الأقسام', perms: ['request:forward'] },
      approve: { label: 'البتّ بالطلبات وإصدار الوثائق', perms: ['request:decide'] },
      delete: { label: 'سجل الوثائق الكامل والتصدير', perms: ['document:read_all', 'data:export'] },
    },
  },
  {
    id: 'academics',
    title: 'الشؤون الأكاديمية والمواد والعلامات والقاعات',
    label: 'الشؤون الأكاديمية والمواد والعلامات والقاعات',
    department: 'الكليات والأقسام الأكاديمية',
    description: 'دليل المقررات، الجداول الدراسية، رصد واعتماد العلامات، حضور القاعات، وهيئة التدريس',
    viewKeys: ['academics', 'attendance'],
    views: ['academics', 'attendance'],
    actions: {
      view: { label: 'عرض المواد والعلامات والهيئة', perms: ['academic:read'] },
      write: { label: 'رصد العلامات وحضور القاعات', perms: ['grade:manage', 'attendance:manage'] },
      edit: { label: 'تعديل المواد والهيئة التدريسية', perms: ['course:manage', 'faculty:manage'] },
      approve: { label: 'اعتماد العلامات والبرامج', perms: ['grade:approve', 'program:manage'] },
      delete: { label: 'تصدير السجلات الأكاديمية', perms: ['data:export'] },
    },
  },
  {
    id: 'hr_integrated',
    title: 'شؤون الموظفين والموارد البشرية والرواتب',
    label: 'شؤون الموظفين والموارد البشرية والرواتب',
    department: 'مديرية الموارد البشرية وشؤون العاملين',
    description: 'ملفات الموظفين، البصمة والدوام، الإجازات، العقود، السلف، التقييم، ومسيرات الرواتب',
    viewKeys: ['hr', 'payroll'],
    views: ['hr', 'payroll'],
    actions: {
      view: { label: 'عرض الموظفين والدوام الشخصي', perms: ['hr_emp:view', 'staffatt:self'] },
      write: { label: 'إضافة موظفين وإجازات وسلف', perms: ['hr_emp:write'] },
      edit: { label: 'تعديل العقود والحضور والتقييم', perms: ['hr_emp:edit', 'staffatt:manage'] },
      approve: { label: 'اعتماد مسيرات الرواتب الشهرية', perms: ['hr_payroll:approve'] },
      delete: { label: 'إنهاء خدمة وأرشفة السجلات', perms: ['hr_emp:delete'] },
    },
  },
  {
    id: 'finance_accounting',
    title: 'المالية والمحاسبة وصندوق رسوم الطلاب',
    label: 'المالية والمحاسبة وصندوق رسوم الطلاب',
    department: 'المديرية المالية والمحاسبة',
    description: 'دليل الحسابات، القيود اليومية، سندات القبض والصرف، رسوم الطلاب، والأقساط',
    viewKeys: ['finance'],
    views: ['finance'],
    actions: {
      view: { label: 'عرض الحسابات والتقارير المالية', perms: ['finance:read'] },
      write: { label: 'كتابة القيود وسندات القبض', perms: ['finance:entry'] },
      edit: { label: 'إدارة وتعديل رسوم الطلاب', perms: ['finance:fees'] },
      approve: { label: 'ترحيل القيود واعتمادها', perms: ['finance:post'] },
      delete: { label: 'هيكلة الحسابات والسنوات المالية', perms: ['finance:setup'] },
    },
  },
  {
    id: 'procurement_assets',
    title: 'المشتريات والمخازن والأصول الثابتة (العهد)',
    label: 'المشتريات والمخازن والأصول الثابتة (العهد)',
    department: 'مديرية المشتريات واللوازم والمستودعات',
    description: 'طلبات الشراء، أوامر التوريد، الموردين، حركة المخزون، وإدارة الأصول والعهد',
    viewKeys: ['procurement'],
    views: ['procurement'],
    actions: {
      view: { label: 'عرض المخازن والأصول والطلبات', perms: ['procurement:read'] },
      write: { label: 'تقديم طلبات شراء وتوريد', perms: ['procurement:request'] },
      edit: { label: 'استلام وصرف وتعديل المخزون', perms: ['procurement:stock'] },
      approve: { label: 'اعتماد الشراء وأوامر التوريد', perms: ['procurement:manage'] },
      delete: { label: 'إدارة الأصول وإتلاف العهد', perms: ['procurement:assets'] },
    },
  },
  {
    id: 'correspondence',
    title: 'المراسلات الإدارية والديوان والأرشفة',
    label: 'المراسلات الإدارية والديوان والأرشفة',
    department: 'الديوان العام والأرشفة الإلكترونية',
    description: 'الكتب الرسمية الصادرة والواردة، التوجيه الإداري، وقوالب المراسلات المعتمدة',
    viewKeys: ['corr'],
    views: ['corr'],
    actions: {
      view: { label: 'عرض المراسلات والكتب الرسمية', perms: ['corr:use'] },
      write: { label: 'إنشاء وإرسال كتب ومراسلات', perms: ['corr:use', 'request:create_internal'] },
      edit: { label: 'تصميم وتعديل قوالب المراسلات', perms: ['corr:templates'] },
      approve: { label: 'الإشراف الشامل على كل المراسلات', perms: ['corr:read_all'] },
      delete: { label: 'تصدير أرشيف الديوان', perms: ['data:export'] },
    },
  },
  {
    id: 'exams_housing',
    title: 'الامتحانات والتقييم الأكاديمي',
    label: 'الامتحانات والتقييم الأكاديمي',
    department: 'دائرة الامتحانات',
    description: 'توزيع القاعات والمراقبين، جلسات الامتحانات، تسكين الطلاب، وتقييم المقررات',
    viewKeys: ['expansions'],
    views: ['expansions'],
    actions: {
      view: { label: 'عرض الامتحانات والتقييم', perms: ['exams_housing:view'] },
      write: { label: 'إضافة جلسات امتحانية', perms: ['exams_housing:write'] },
      edit: { label: 'تعديل القاعات', perms: ['exams_housing:edit'] },
      approve: { label: 'اعتماد الجداول', perms: ['exams_housing:approve'] },
      delete: { label: 'تصدير كشوف الامتحانات', perms: ['data:export'] },
    },
  },
  {
    id: 'lms_library',
    title: 'التعلم الإلكتروني والمكتبة الرقمية',
    label: 'التعلم الإلكتروني والمكتبة الرقمية',
    department: 'مركز التعلم الإلكتروني والمكتبة المركزية',
    description: 'المقررات الرقمية، المحاضرات والواجبات، بنك الأسئلة، وإعارة الكتب والمراجع',
    viewKeys: ['lms'],
    views: ['lms'],
    actions: {
      view: { label: 'عرض المقررات وفهرس المكتبة', perms: ['lms_lib:view'] },
      write: { label: 'رفع المحاضرات وإضافة الكتب', perms: ['lms_lib:write'] },
      edit: { label: 'تعديل المحتوى وإدارة الإعارات', perms: ['lms_lib:edit'] },
      approve: { label: 'اعتماد المقررات وجرد المكتبة', perms: ['lms_lib:approve'] },
      delete: { label: 'تصدير تقارير المكتبة والتعلم', perms: ['data:export'] },
    },
  },
  {
    id: 'research_grad',
    title: 'البحث العلمي والدراسات العليا',
    label: 'البحث العلمي والدراسات العليا',
    department: 'عمادة البحث العلمي والدراسات العليا',
    description: 'المشاريع البحثية، المنح البحثية، النشر العلمي، والإشراف على رسائل الماجستير والدكتوراه',
    viewKeys: ['research'],
    views: ['research'],
    actions: {
      view: { label: 'عرض الأبحاث والرسائل العلمية', perms: ['research_grad:view'] },
      write: { label: 'تسجيل مشاريع ورسائل جديدة', perms: ['research_grad:write'] },
      edit: { label: 'تعديل فرق البحث ولجان الإشراف', perms: ['research_grad:edit'] },
      approve: { label: 'اعتماد تمويل الأبحاث والرسائل', perms: ['research_grad:approve'] },
      delete: { label: 'تصدير السجل البحثي', perms: ['data:export'] },
    },
  },
  {
    id: 'alumni_career',
    title: 'الخريجون والتوظيف والشراكات المهنية',
    label: 'الخريجون والتوظيف والشراكات المهنية',
    department: 'مكتب متابعة الخريجين والتأهيل المهني',
    description: 'سجل الخريجين، تتبع المسار الوظيفي، فرص العمل والتدريب، والفعاليات المهنية',
    viewKeys: ['alumni'],
    views: ['alumni'],
    actions: {
      view: { label: 'عرض سجل الخريجين والوظائف', perms: ['alumni_career:view'] },
      write: { label: 'إضافة خريجين وفرص توظيف', perms: ['alumni_career:write'] },
      edit: { label: 'تحديث بيانات الخريجين والشراكات', perms: ['alumni_career:edit'] },
      approve: { label: 'إصدار وثائق ومصدقات الخريجين', perms: ['request:decide'] },
      delete: { label: 'تصدير قاعدة بيانات الخريجين', perms: ['data:export'] },
    },
  },
  {
    id: 'qa_enterprise',
    title: 'الجودة والاعتماد المؤسسي والذكاء الاصطناعي',
    label: 'الجودة والاعتماد المؤسسي والذكاء الاصطناعي',
    department: 'مركز ضمان الجودة والتطوير المؤسسي',
    description: 'مؤشرات الأداء KPIs، الاعتماد الأكاديمي، منظومة التطوير الشامل (15 ميزة)، والمساعد الذكي',
    viewKeys: ['qa', 'enterprise', 'ai'],
    views: ['qa', 'enterprise', 'ai'],
    actions: {
      view: { label: 'عرض مؤشرات الجودة والتطوير', perms: ['qa_inst:view', 'stats:read'] },
      write: { label: 'استخدام المساعد الذكي والتطوير', perms: ['enterprise_ai:use'] },
      edit: { label: 'تحديث معايير الجودة ومؤشرات الأداء', perms: ['qa_inst:edit'] },
      approve: { label: 'اعتماد تقارير الجودة والمؤسسة', perms: ['qa_inst:approve'] },
      delete: { label: 'تصدير تقارير الجودة الشاملة', perms: ['data:export'] },
    },
  },
  {
    id: 'comms_reports',
    title: 'التواصل الجامعي والأخبار والشكاوى والإحصاءات',
    label: 'التواصل الجامعي والأخبار والشكاوى والإحصاءات',
    department: 'مديرية العلاقات العامة والإعلام والتقارير',
    description: 'الأخبار والإعلانات الرسمية، معالجة شكاوى الطلاب، ولوحات الإحصاءات التنفيذية',
    viewKeys: ['comms', 'dashboard'],
    views: ['comms', 'dashboard'],
    actions: {
      view: { label: 'عرض الإحصاءات والأخبار والشكاوى', perms: ['stats:read', 'comms:read'] },
      write: { label: 'نشر وتحرير الأخبار والإعلانات', perms: ['news:manage'] },
      edit: { label: 'معالجة الشكاوى والرد عليها', perms: ['complaint:manage'] },
      approve: { label: 'اعتماد الإغلاق والتقارير', perms: ['complaint:manage', 'stats:read'] },
      delete: { label: 'تصدير التقارير الإحصائية', perms: ['data:export'] },
    },
  },
  {
    id: 'governance_system',
    title: 'الإدارة العليا والحوكمة والصلاحيات والبنية التحتية',
    label: 'الإدارة العليا والحوكمة والصلاحيات والبنية التحتية',
    department: 'رئاسة الجامعة وأمن المعلومات والحوكمة',
    description: 'إدارة الحسابات والأدوار، القواعد الآلية، سجل التدقيق الأمني، النسخ الاحتياطي، والخوادم',
    viewKeys: ['admin', 'access', 'audit', 'devops', 'units'],
    views: ['admin', 'access', 'audit', 'devops', 'units'],
    actions: {
      view: { label: 'عرض سجل التدقيق الأمني والنظام', perms: ['audit:read'] },
      write: { label: 'تأسيس وإدارة حسابات الموظفين', perms: ['user:manage'] },
      edit: { label: 'تعديل الإعدادات والقواعد والبرامج', perms: ['settings:manage', 'rules:manage', 'program:manage'] },
      approve: { label: 'إدارة الأدوار والأقسام والبنية', perms: ['role:manage', 'devops:manage'] },
      delete: { label: 'إدارة النسخ الاحتياطي والذمم', perms: ['backup:manage', 'holds:manage'] },
    },
  },
].slice(0, 14); // Wait: let's keep all 14 or combine comms_reports with qa_enterprise so length === 14!

// Let's make sure PLATFORM_MODULES_MATRIX has exact length 14 covering every group cleanly!
export const PLATFORM_MODULES = [
  PLATFORM_MODULES_MATRIX[0], // 1. student_affairs
  PLATFORM_MODULES_MATRIX[1], // 2. admissions_advising
  PLATFORM_MODULES_MATRIX[2], // 3. requests_docs
  PLATFORM_MODULES_MATRIX[3], // 4. academics
  PLATFORM_MODULES_MATRIX[4], // 5. hr_integrated
  PLATFORM_MODULES_MATRIX[5], // 6. finance_accounting
  PLATFORM_MODULES_MATRIX[6], // 7. procurement_assets
  PLATFORM_MODULES_MATRIX[7], // 8. correspondence
  PLATFORM_MODULES_MATRIX[8], // 9. exams_housing
  PLATFORM_MODULES_MATRIX[9], // 10. lms_library
  PLATFORM_MODULES_MATRIX[10], // 11. research_grad
  PLATFORM_MODULES_MATRIX[11], // 12. alumni_career
  {
    id: 'qa_enterprise',
    title: 'الجودة والتطوير المؤسسي والتواصل والإحصاءات',
    label: 'الجودة والتطوير المؤسسي والتواصل والإحصاءات',
    department: 'مركز ضمان الجودة والتطوير والعلاقات العامة',
    description: 'مؤشرات الأداء KPIs، التطوير المؤسسي (15 ميزة)، المساعد الذكي، الأخبار، والشكاوى',
    viewKeys: ['qa', 'enterprise', 'ai', 'comms', 'dashboard'],
    views: ['qa', 'enterprise', 'ai', 'comms', 'dashboard'],
    actions: {
      view: { label: 'عرض الجودة والإحصاءات والأخبار', perms: ['qa_inst:view', 'stats:read', 'comms:read'] },
      write: { label: 'نشر الأخبار واستخدام المساعد الذكي', perms: ['news:manage', 'enterprise_ai:use'] },
      edit: { label: 'تحديث معايير الجودة ومعالجة الشكاوى', perms: ['qa_inst:edit', 'complaint:manage'] },
      approve: { label: 'اعتماد تقارير الجودة وإغلاق الشكاوى', perms: ['qa_inst:approve', 'complaint:manage'] },
      delete: { label: 'تصدير التقارير والإحصاءات الشاملة', perms: ['data:export'] },
    },
  },
  {
    id: 'governance_system',
    title: 'الإدارة العليا والحوكمة والصلاحيات والبنية التحتية',
    label: 'الإدارة العليا والحوكمة والصلاحيات والبنية التحتية',
    department: 'رئاسة الجامعة وأمن المعلومات والحوكمة',
    description: 'إدارة الحسابات والأدوار، القواعد الآلية، سجل التدقيق الأمني، النسخ الاحتياطي، والخوادم',
    viewKeys: ['admin', 'access', 'audit', 'devops', 'units'],
    views: ['admin', 'access', 'audit', 'devops', 'units'],
    actions: {
      view: { label: 'عرض سجل التدقيق الأمني والنظام', perms: ['audit:read'] },
      write: { label: 'تأسيس وإدارة حسابات الموظفين', perms: ['user:manage'] },
      edit: { label: 'تعديل الإعدادات والقواعد والبرامج', perms: ['settings:manage', 'rules:manage', 'program:manage'] },
      approve: { label: 'إدارة الأدوار والأقسام والبنية', perms: ['role:manage', 'devops:manage'] },
      delete: { label: 'إدارة النسخ الاحتياطي والذمم', perms: ['backup:manage', 'holds:manage'] },
    },
  },
];

// Sync PLATFORM_MODULES_MATRIX with PLATFORM_MODULES (14 items) and attach .levels and .viewKey for compatibility
PLATFORM_MODULES_MATRIX.length = 0;
for (const mod of PLATFORM_MODULES) {
  const v = mod.actions.view.perms;
  const w = [...new Set([...v, ...mod.actions.write.perms])];
  const e = [...new Set([...w, ...mod.actions.edit.perms])];
  const f = [...new Set([...e, ...mod.actions.approve.perms, ...mod.actions.delete.perms])];
  mod.levels = { read: v, write: w, edit: e, full: f };
  mod.viewKey = mod.viewKeys?.[0] || 'desk';
  PLATFORM_MODULES_MATRIX.push(mod);
}

// قوالب وظيفية جاهزة للأقسام لتسهيل إسناد الصلاحيات بنقرة واحدة عند تأسيس الحساب
export const DEPARTMENT_ROLE_PRESETS = [
  {
    id: 'preset_student_affairs_full',
    key: 'preset_student_affairs_full',
    label: 'موظف شؤون طلاب شامل (قبول + إرشاد + منح + طلبات)',
    department: 'شؤون الطلاب',
    dataScope: 'all',
    allowedViews: ['desk', 'overview', 'affairs', 'internal', 'corr', 'dashboard', 'exchange', 'verify'],
    permissions: [
      'student:read', 'student:register', 'student:update', 'student:reset_password',
      'sa_admissions:view', 'sa_admissions:write', 'sa_admissions:approve',
      'sa_advising:view', 'sa_advising:edit',
      'sa_scholarships:view', 'sa_scholarships:write', 'sa_scholarships:approve', 'sa_housing:view', 'sa_housing:manage',
      'request:read_all', 'request:decide', 'request:forward', 'request:create_internal', 'request:import',
      'document:read_all', 'corr:use', 'staffatt:self', 'stats:read', 'data:export',
    ],
  },
  {
    id: 'preset_admissions_officer',
    key: 'preset_admissions_officer',
    label: 'موظف قبول ومفاضلة وتسجيل طلاب',
    department: 'مديرية القبول والتسجيل',
    dataScope: 'all',
    allowedViews: ['desk', 'overview', 'affairs', 'exchange', 'verify'],
    permissions: [
      'student:read', 'student:register', 'student:update',
      'sa_admissions:view', 'sa_admissions:write', 'sa_admissions:approve',
      'request:read_unit', 'request:create_internal', 'corr:use', 'staffatt:self',
    ],
  },
  {
    id: 'preset_academic_advisor',
    key: 'preset_academic_advisor',
    label: 'مرشد أكاديمي ومنسق خطط دراسية',
    department: 'الإرشاد الأكاديمي والكليات',
    dataScope: 'faculty',
    allowedViews: ['desk', 'overview', 'affairs', 'academics', 'attendance', 'lms'],
    permissions: [
      'student:read', 'academic:read', 'course:manage', 'attendance:manage',
      'sa_advising:view', 'sa_advising:edit', 'lms_lib:view', 'lms_lib:write',
      'corr:use', 'staffatt:self',
    ],
  },
  {
    id: 'preset_exams_grades',
    key: 'preset_exams_grades',
    label: 'مسؤول امتحانات وعلامات وقاعات',
    department: 'دائرة الامتحانات',
    dataScope: 'faculty',
    allowedViews: ['desk', 'overview', 'academics', 'attendance', 'expansions', 'verify'],
    permissions: [
      'student:read', 'academic:read', 'grade:manage', 'grade:approve', 'attendance:manage',
      'exams_housing:view', 'exams_housing:write', 'exams_housing:edit', 'exams_housing:approve',
      'document:read_all', 'corr:use', 'staffatt:self',
    ],
  },
  {
    id: 'preset_hr_specialist',
    key: 'preset_hr_specialist',
    label: 'أخصائي شؤون موظفين وموارد بشرية ورواتب',
    department: 'الموارد البشرية',
    dataScope: 'all',
    allowedViews: ['desk', 'overview', 'hr', 'payroll', 'internal', 'corr', 'dashboard'],
    permissions: [
      'staffatt:self', 'staffatt:manage',
      'hr_emp:view', 'hr_emp:write', 'hr_emp:edit', 'hr_payroll:approve',
      'request:read_unit', 'request:create_internal', 'corr:use', 'stats:read', 'data:export',
    ],
  },
  {
    id: 'preset_finance_accountant',
    key: 'preset_finance_accountant',
    label: 'محاسب مالي ومسؤول رسوم ومنح الطلاب',
    department: 'المديرية المالية',
    dataScope: 'all',
    allowedViews: ['desk', 'overview', 'finance', 'affairs', 'dashboard', 'verify'],
    permissions: [
      'finance:read', 'finance:entry', 'finance:fees', 'finance:post',
      'student:read', 'sa_scholarships:view', 'sa_scholarships:approve',
      'holds:manage', 'stats:read', 'corr:use', 'staffatt:self', 'data:export',
    ],
  },
  {
    id: 'preset_procurement_warehouse',
    key: 'preset_procurement_warehouse',
    label: 'مسؤول مشتريات ومخازن وأصول ثابتة (عهد)',
    department: 'المشتريات والمخازن',
    dataScope: 'all',
    allowedViews: ['desk', 'overview', 'procurement', 'internal', 'corr'],
    permissions: [
      'procurement:read', 'procurement:request', 'procurement:stock', 'procurement:assets', 'procurement:manage',
      'request:create_internal', 'corr:use', 'staffatt:self',
    ],
  },
  {
    id: 'preset_diwan_correspondence',
    key: 'preset_diwan_correspondence',
    label: 'موظف الديوان والمراسلات والأرشفة',
    department: 'الديوان العام',
    dataScope: 'all',
    allowedViews: ['desk', 'overview', 'corr', 'internal', 'affairs', 'verify'],
    permissions: [
      'corr:use', 'corr:read_all', 'corr:templates',
      'request:read_all', 'request:forward', 'request:create_internal',
      'document:read_all', 'staffatt:self',
    ],
  },
  {
    id: 'preset_research_qa',
    key: 'preset_research_qa',
    label: 'مسؤول البحث العلمي والجودة والاعتماد',
    department: 'البحث العلمي وضمان الجودة',
    dataScope: 'all',
    allowedViews: ['desk', 'overview', 'research', 'qa', 'enterprise', 'alumni', 'ai', 'dashboard'],
    permissions: [
      'research_grad:view', 'research_grad:write', 'research_grad:edit', 'research_grad:approve',
      'qa_inst:view', 'qa_inst:edit', 'qa_inst:approve',
      'alumni_career:view', 'alumni_career:write', 'alumni_career:edit',
      'enterprise_ai:use', 'stats:read', 'corr:use', 'staffatt:self',
    ],
  },
  {
    id: 'preset_view_only_observer',
    key: 'preset_view_only_observer',
    label: 'مراقب / مستعرض عام (صلاحية عرض فقط لكل المنصة)',
    department: 'الرقابة والتدقيق والمتابعة',
    dataScope: 'all',
    allowedViews: ['desk', 'overview', 'affairs', 'academics', 'hr', 'payroll', 'finance', 'procurement', 'corr', 'expansions', 'lms', 'research', 'alumni', 'qa', 'dashboard', 'audit', 'verify'],
    permissions: [
      'request:read_all', 'document:read_all', 'student:read',
      'sa_admissions:view', 'sa_advising:view', 'sa_scholarships:view',
      'academic:read', 'corr:read_all', 'staffatt:self', 'hr_emp:view',
      'finance:read', 'procurement:read', 'exams_housing:view', 'lms_lib:view',
      'research_grad:view', 'alumni_career:view', 'qa_inst:view',
      'stats:read', 'comms:read', 'audit:read',
    ],
  },
];

for (const pr of DEPARTMENT_ROLE_PRESETS) {
  const pSet = new Set(pr.permissions || []);
  const modAcc = {};
  for (const mod of PLATFORM_MODULES_MATRIX) {
    if ((mod.levels.full || []).every((p) => pSet.has(p))) modAcc[mod.id] = 'full';
    else if ((mod.levels.edit || []).every((p) => pSet.has(p))) modAcc[mod.id] = 'edit';
    else if ((mod.levels.write || []).every((p) => pSet.has(p))) modAcc[mod.id] = 'write';
    else if ((mod.levels.read || []).some((p) => pSet.has(p))) modAcc[mod.id] = 'read';
    else modAcc[mod.id] = 'none';
  }
  pr.moduleAccess = modAcc;
  pr.extraPermissions = pr.permissions;
}

// قائمة الشاشات المتاحة في المنصة لتمكين تخصيص القائمة الجانبية لكل موظف أو قسم
export const ALL_STAFF_VIEWS = [
  { key: 'overview', label: 'اللوحة الرئيسية (لوحة التحكم ومكتبي)', group: 'الرئيسية' },
  { key: 'guidelines', label: 'دليل الإرشادات التفاعلي الشامل', group: 'الرئيسية' },
  { key: 'affairs', label: 'شؤون الطلاب والقبول والمنح', group: 'الطلاب والشؤون الأكاديمية' },
  { key: 'academics', label: 'الشؤون الأكاديمية والعلامات وفحص الامتحان PDF', group: 'الطلاب والشؤون الأكاديمية' },
  { key: 'attendance', label: 'سجل القاعات والباركود', group: 'الطلاب والشؤون الأكاديمية' },
  { key: 'expansions', label: 'الامتحانات والتقييم', group: 'الطلاب والشؤون الأكاديمية' },
  { key: 'student_life', label: 'السكن الجامعي', group: 'الطلاب والشؤون الأكاديمية' },
  { key: 'labtools', label: 'أدوات تجريبية', group: 'الطلاب والشؤون الأكاديمية' },
  { key: 'lms', label: 'التعلم الإلكتروني والمكتبة', group: 'الطلاب والشؤون الأكاديمية' },
  { key: 'research', label: 'البحث العلمي والدراسات العليا', group: 'البحث والجودة والخريجون' },
  { key: 'alumni', label: 'الخريجون والتوظيف', group: 'البحث والجودة والخريجون' },
  { key: 'qa', label: 'الجودة والاعتماد المؤسسي', group: 'البحث والجودة والخريجون' },
  { key: 'payroll', label: 'شؤون الموظفين (الرواتب والحضور والبصمة والتقييم)', group: 'الموارد البشرية والديوان' },
  { key: 'corr', label: 'الديوان والمراسلات والطلبات الداخلية', group: 'الموارد البشرية والديوان' },
  { key: 'councils', label: 'المجالس واللجان والقرارات', group: 'الموارد البشرية والديوان' },
  { key: 'finance', label: 'المالية والمحاسبة والرسوم', group: 'المالية والمشتريات' },
  { key: 'procurement', label: 'المشتريات والمخازن والأصول', group: 'المالية والمشتريات' },
  { key: 'dashboard', label: 'الإحصاءات والتقارير', group: 'التقارير والتواصل والذكاء' },
  { key: 'exchange', label: 'الاستيراد الموحد وصفحة التصدير', group: 'التقارير والتواصل والذكاء' },
  { key: 'comms', label: 'الأخبار والشكاوى', group: 'التقارير والتواصل والذكاء' },
  { key: 'ai', label: 'المساعد الذكي AI', group: 'التقارير والتواصل والذكاء' },
  { key: 'admin', label: 'لوحة الإدارة (الإعدادات والوحدات والتحقق وإعداداتي)', group: 'الإدارة والحوكمة' },
  { key: 'access', label: 'الحسابات والصلاحيات والأقسام', group: 'الإدارة والحوكمة' },
  { key: 'audit', label: 'آليات المراقبة والتدقيق والبنية التحتية', group: 'الإدارة والحوكمة' },
];

export const ROLE_LABEL = { student: 'طالب', staff: 'موظف شؤون الطلاب', admin: 'مدير النظام', auditor: 'مدقق' };
export const ROLE_DESC = {
  admin: 'صلاحيات كاملة على النظام، بما فيها إدارة الحسابات والأدوار والوحدات. لا يمكن تعطيل آخر مدير فعّال.',
  auditor: 'اطّلاع فقط: يقرأ الطلبات والوثائق والإحصاءات وسجل التدقيق، ولا يغيّر شيئاً.',
  staff: 'يعالج طلبات الطلاب ويسجّل الطلاب ويدير ملفاتهم والمواد والعلامات والأخبار والشكاوى.',
  student: 'يقدّم طلباته ويطّلع على ملفه وعلاماته وأخباره ويرسل شكاواه.',
};

const STUDENT = ['request:create', 'request:read_own', 'document:read_own', 'profile:read_own', 'profile:update_own', 'course:read_own', 'grade:read_own', 'complaint:create'];
export const STUDENT_PERMISSION_LABELS = {
  'request:create': 'تقديم الطلبات والمعاملات',
  'request:read_own': 'عرض طلباته ومتابعتها',
  'document:read_own': 'عرض وثائقه الصادرة',
  'profile:read_own': 'عرض ملفه الشخصي',
  'profile:update_own': 'تعديل بياناته الشخصية المسموحة',
  'course:read_own': 'عرض دليل مواده',
  'grade:read_own': 'عرض علاماته المعتمدة',
  'complaint:create': 'إرسال الشكاوى',
};

export const PERMISSIONS = {
  student: STUDENT,
  staff: [
    'request:read_all', 'request:decide', 'request:forward', 'request:create_internal', 'request:import',
    'corr:use', 'staffatt:self', 'document:read_all', 'stats:read',
    'student:register', 'student:read', 'student:update', 'student:reset_password',
    'sa_admissions:view', 'sa_admissions:write', 'sa_advising:view', 'sa_advising:edit', 'sa_scholarships:view', 'sa_scholarships:write',
    'academic:read', 'course:manage', 'grade:manage', 'attendance:manage', 'faculty:manage',
    'comms:read', 'news:manage', 'complaint:manage', 'data:export', 'alumni_career:view', 'sa_discipline:view',
  ],
  auditor: ['request:read_all', 'corr:read_all', 'document:read_all', 'audit:read', 'stats:read', 'student:read', 'academic:read', 'comms:read', 'finance:read', 'procurement:read', 'qa_inst:view', 'alumni_career:view', 'sa_discipline:view', 'sa_housing:view'],
  admin: [...ASSIGNABLE],
};

export const BUILTIN_ROLES = ['admin', 'staff', 'auditor'];

export const can = (role, perm) => (PERMISSIONS[role] ?? []).includes(perm);

export function safeJsonParse(raw, fallback) {
  if (!raw || typeof raw !== 'string') return fallback;
  try {
    const parsed = JSON.parse(raw);
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

/**
 * يحوّل إعدادات الوصول على مستوى الأقسام (moduleAccess) إلى قائمة مفاتيح صلاحيات
 */
export function resolveModulePermissions(moduleAccess) {
  if (!moduleAccess || typeof moduleAccess !== 'object') return [];
  const out = new Set();
  for (const mod of PLATFORM_MODULES_MATRIX) {
    const cfg = moduleAccess[mod.id];
    if (!cfg) continue;
    if (typeof cfg === 'string') {
      const order = ['view', 'write', 'edit', 'approve', 'delete'];
      const mapLevel = {
        none: [],
        read: ['view'],
        view: ['view'],
        write: ['view', 'write'],
        edit: ['view', 'write', 'edit'],
        approve: ['view', 'write', 'edit', 'approve'],
        full: order,
      };
      const allowedOps = mapLevel[cfg] || [];
      for (const op of allowedOps) {
        for (const p of mod.actions[op]?.perms || []) {
          if (ASSIGNABLE.has(p)) out.add(p);
        }
      }
    } else if (typeof cfg === 'object') {
      for (const [op, enabled] of Object.entries(cfg)) {
        if (enabled && mod.actions[op]) {
          for (const p of mod.actions[op].perms) {
            if (ASSIGNABLE.has(p)) out.add(p);
          }
        }
      }
    }
  }
  return [...out];
}

/**
 * يحسب الصلاحيات الفعّالة النهائية للمستخدم بناءً على الدور + القسم + التخصيص المباشر + الاستثناءات
 */
export function resolveEffectivePermissions({
  basePermissions = [],
  unitPermissions = [],
  accessMode = 'role',
  moduleAccess = {},
  customPermissions = [],
  revokedPermissions = [],
}) {
  const modPerms = resolveModulePermissions(moduleAccess);
  let combined = new Set();

  if (accessMode === 'custom') {
    for (const p of modPerms) if (ASSIGNABLE.has(p)) combined.add(p);
    for (const p of customPermissions) if (ASSIGNABLE.has(p)) combined.add(p);
  } else {
    for (const p of basePermissions) if (ASSIGNABLE.has(p)) combined.add(p);
    for (const p of unitPermissions) if (ASSIGNABLE.has(p)) combined.add(p);
    for (const p of modPerms) if (ASSIGNABLE.has(p)) combined.add(p);
    for (const p of customPermissions) if (ASSIGNABLE.has(p)) combined.add(p);
  }

  if (moduleAccess && typeof moduleAccess === 'object') {
    for (const mod of PLATFORM_MODULES_MATRIX) {
      if (moduleAccess[mod.id] === 'none') {
        for (const p of mod.levels?.full || []) combined.delete(p);
      }
    }
  }

  for (const r of revokedPermissions) {
    combined.delete(r);
  }

  if (combined.has('request:read_all') && combined.has('request:read_unit')) {
    if ((revokedPermissions || []).includes('request:read_all')) {
      combined.delete('request:read_all');
    } else {
      combined.delete('request:read_unit');
    }
  }

  return [...combined];
}

/**
 * يستنتج مصفوفة حالة الأقسام (عرض/كتابة/تعديل/اعتماد/حذف) من قائمة صلاحيات فعلية
 */
export function buildModuleAccessState(effectivePerms = []) {
  const set = new Set(effectivePerms);
  const state = {};
  for (const mod of PLATFORM_MODULES_MATRIX) {
    state[mod.id] = {};
    for (const [op, def] of Object.entries(mod.actions)) {
      state[mod.id][op] = def.perms.length > 0 && def.perms.some((p) => set.has(p));
    }
  }
  return state;
}

function deriveModuleAccessFromPermissions(perms = []) {
  const set = new Set(Array.isArray(perms) ? perms : []);
  const result = {};
  for (const mod of PLATFORM_MODULES_MATRIX) {
    const hasAll = (arr) => arr && arr.length > 0 && arr.every((p) => set.has(p));
    const hasAny = (arr) => arr && arr.some((p) => set.has(p));
    if (hasAll(mod.levels.full)) result[mod.id] = 'full';
    else if (hasAll(mod.levels.edit)) result[mod.id] = 'edit';
    else if (hasAll(mod.levels.write)) result[mod.id] = 'write';
    else if (hasAny(mod.levels.read) || hasAny(mod.levels.write) || hasAny(mod.levels.edit) || hasAny(mod.levels.full)) result[mod.id] = 'read';
    else result[mod.id] = 'none';
  }
  return result;
}

/**
 * يلخّص قدرات المستخدم حسب نوع العملية (عدد الأقسام التي يملك فيها عرض / كتابة / تعديل / اعتماد / حذف)
 */
export function summarizeOperationCapabilities(effectivePerms = []) {
  const state = buildModuleAccessState(effectivePerms);
  let viewCount = 0;
  let writeCount = 0;
  let editCount = 0;
  let approveCount = 0;
  let deleteCount = 0;
  const activeModules = [];

  for (const mod of PLATFORM_MODULES_MATRIX) {
    const st = state[mod.id];
    if (!st) continue;
    if (st.view) viewCount++;
    if (st.write) writeCount++;
    if (st.edit) editCount++;
    if (st.approve) approveCount++;
    if (st.delete) deleteCount++;
    if (st.view || st.write || st.edit || st.approve || st.delete) {
      activeModules.push({
        id: mod.id,
        title: mod.title,
        department: mod.department,
        ops: Object.entries(st).filter(([, v]) => v).map(([k]) => k),
      });
    }
  }

  return {
    viewCount,
    writeCount,
    editCount,
    approveCount,
    deleteCount,
    totalModules: PLATFORM_MODULES_MATRIX.length,
    activeModules,
  };
}

export function computeAllowedViews(effectivePerms = [], explicitAllowedViews = [], role = 'staff', studentViews = null) {
  if (role === 'student') {
    return Array.isArray(studentViews) ? studentViews : ['home', 'enterprise', 'guide', 'grades', 'fees', 'lms', 'expansions', 'student_life', 'alumni', 'ai', 'news', 'tx'];
  }
  const pSet = new Set(effectivePerms);
  const has = (...keys) => keys.some((k) => pSet.has(k));

  const out = ['overview', 'guidelines'];
  if (has('request:read_all', 'request:read_unit', 'student:read', 'student:register', 'sa_admissions:view', 'sa_advising:view', 'sa_scholarships:view')) out.push('affairs');
  if (has('academic:read', 'course:manage', 'grade:manage', 'grade:approve', 'grade:approve_own', 'faculty:manage')) out.push('academics');
  if (has('attendance:manage')) out.push('attendance');
  if (has('exams_housing:view', 'exams_housing:write', 'exams_housing:edit', 'exams_housing:approve', 'academic:read', 'grade:manage', 'grade:approve', 'course:manage')) out.push('expansions');
  if (has('sa_housing:view', 'sa_housing:manage')) out.push('student_life');
  if (has('sa_admissions:view', 'sa_admissions:write', 'sa_admissions:approve', 'student:register', 'sa_housing:view', 'sa_housing:manage', 'faculty:manage', 'lms_lib:view', 'lms_lib:write', 'lms_lib:edit', 'lms_lib:approve', 'academic:read', 'course:manage')) out.push('labtools');
  if (has('lms_lib:view', 'lms_lib:write', 'lms_lib:edit', 'lms_lib:approve', 'academic:read', 'course:manage', 'sa_quiz:write', 'sa_quiz:approve')) out.push('lms');
  if (has('research_grad:view', 'research_grad:write', 'research_grad:edit', 'research_grad:approve', 'faculty:manage')) out.push('research');
  if (has('alumni_career:view', 'alumni_career:write', 'alumni_career:edit')) out.push('alumni');
  if (has('qa_inst:view', 'qa_inst:edit', 'qa_inst:approve')) out.push('qa');
  if (has('hr_emp:view', 'hr_emp:write', 'hr_emp:edit', 'hr_payroll:approve', 'staffatt:self', 'staffatt:manage')) out.push('payroll');
  if (has('corr:use', 'corr:read_all', 'corr:templates', 'request:create_internal')) out.push('corr');
  // كل موظف قد يكون عضواً في مجلس أو مكلفاً بتنفيذ قرار، فيرى مجالسه ومهامه
  out.push('councils');
  if (has('stats:read', 'hr_emp:view', 'hr_emp:write', 'hr_emp:edit', 'hr_emp:delete', 'hr:manage', 'hr_payroll:approve', 'staffatt:manage', 'audit:read', 'devops:manage', 'settings:manage', 'backup:manage')) out.push('dashboard');
  if (has('student:register', 'course:manage', 'grade:manage', 'data:export', 'import:groups', 'import:academic', 'import:procurement', 'import:finance', 'import:hr', 'import:student_fin', 'import:misc')) out.push('exchange');
  if (has('comms:read', 'news:manage', 'complaint:manage')) out.push('comms');
  if (role === 'admin' || has('enterprise_ai:use', 'academic:read', 'sa_advising:view', 'sa_advising:edit')) out.push('ai');
  if (has('procurement:read', 'procurement:request', 'procurement:manage', 'procurement:stock', 'procurement:assets', 'procurement:approve_finance', 'procurement:approve_top')) out.push('procurement');
  if (has('finance:read', 'finance:entry', 'finance:post', 'finance:fees', 'finance:setup')) out.push('finance');
  out.push('admin');
  if (has('user:manage', 'role:manage')) out.push('access');
  if (role === 'admin' || has('audit:read', 'devops:manage', 'settings:manage', 'backup:manage')) out.push('audit');
  // التخصيص يُضيّق ما تتيحه الصلاحيات ولا يوسّعه: شاشة بلا صلاحية لا تظهر ثم تفشل بـ403
  if (Array.isArray(explicitAllowedViews) && explicitAllowedViews.length > 0) {
    const legacy = { desk: 'overview', hr: 'payroll', internal: 'corr', devops: 'audit', units: 'admin', verify: 'admin' };
    const chosen = new Set(['overview', 'guidelines', 'admin', 'councils', ...explicitAllowedViews.map((k) => legacy[k] ?? k)]);
    return ALL_STAFF_VIEWS.map((v) => v.key).filter((k) => chosen.has(k) && out.includes(k));
  }
  return [...new Set(out)];
}

export function summarizeUserAccessProfile(u, effectivePerms = []) {
  const modAccess = deriveModuleAccessFromPermissions(effectivePerms);
  const capabilities = summarizeOperationCapabilities(effectivePerms);
  const counts = { full: 0, edit: 0, write: 0, read: 0, none: 0 };
  for (const mod of PLATFORM_MODULES_MATRIX) {
    const lvl = modAccess[mod.id] || 'none';
    counts[lvl] = (counts[lvl] || 0) + 1;
  }
  const activeModulesCount = PLATFORM_MODULES_MATRIX.length - counts.none;
  const scopeLabels = {
    all: 'كامل الجامعة',
    faculty: 'نطاق الكلية / المعهد',
    unit: 'القسم والوحدات التابعة',
    own: 'السجلات المسندة فقط',
    self: 'السجلات المسندة فقط',
  };
  const modeLabels = {
    role: 'تلقائي حسب الدور والقسم',
    hybrid: 'مدمج (الدور + تخصيص الأقسام)',
    custom: 'مخصص بالكامل لهذا الحساب',
  };
  return {
    moduleAccess: modAccess,
    moduleState: buildModuleAccessState(effectivePerms),
    capabilities,
    counts,
    activeModulesCount,
    totalModulesCount: PLATFORM_MODULES_MATRIX.length,
    permissionsCount: effectivePerms.length,
    dataScope: u?.data_scope || 'unit',
    dataScopeLabel: scopeLabels[u?.data_scope || 'unit'] || 'القسم والوحدات التابعة',
    accessMode: u?.access_mode || 'role',
    accessModeLabel: modeLabels[u?.access_mode || 'role'] || 'تلقائي حسب الدور والقسم',
  };
}

import { getCachedRoleByKey, getCachedUnitById } from './cache.js';
import { studentViewsOf, studentPermsOf } from './services/settings.js';

// الصلاحيات التشغيلية الحساسة الخاضعة لمبدأ فصل المهام (ISO/IEC 27001 A.6.1.2 Separation of Duties)
// عند تفعيل STRICT_ADMIN_SOD=1 (أو الإعداد security.strict_admin_sod = '1')، يُحجب الاعتماد المالي/الأكاديمي المباشر عن مدير النظام التقني
export const SOD_SENSITIVE_PERMISSIONS = new Set([
  'finance:post',
  'hr_payroll:approve',
  'grade:approve',
  'procurement:manage',
]);

// تسجيل الحضور الشخصي ثابت لكل موظف أيًا كان دوره، ولا يُسحب منه
const EVERY_STAFF = 'staffatt:self';
export function effective(db, u) {
  const perms = permissionsFromRow(db, u);
  if (!u || u.role === 'student' || perms.includes(EVERY_STAFF)) return perms;
  return [...perms, EVERY_STAFF];
}

// الصلاحيات الفعّالة لمستخدم من صف قاعدة البيانات (مع تخزين مؤقت للأدوار والوحدات التنظيمية)
function permissionsFromRow(db, u) {
  if (!u) return [];
  if (u.role === 'student') return studentPermsOf(db, PERMISSIONS.student);

  const accessMode = u.access_mode || 'role';
  const customPerms = safeJsonParse(u.custom_permissions_json, []);
  const revokedPerms = safeJsonParse(u.revoked_permissions_json, []);
  const moduleAccess = safeJsonParse(u.module_access_json, {});

  if (
    u.role === 'admin' &&
    !u.role_key &&
    accessMode === 'role' &&
    customPerms.length === 0 &&
    revokedPerms.length === 0 &&
    Object.keys(moduleAccess).length === 0
  ) {
    let strictSod = process.env.STRICT_ADMIN_SOD === '1';
    if (!strictSod && db && typeof db.prepare === 'function') {
      try {
        const row = db.prepare("SELECT value FROM site_settings WHERE key = 'security.strict_admin_sod'").get();
        if (row && String(row.value) === '1') strictSod = true;
      } catch { /* ignore */ }
    }
    if (strictSod) {
      return [...ASSIGNABLE].filter((p) => !SOD_SENSITIVE_PERMISSIONS.has(p));
    }
    return [...ASSIGNABLE];
  }

  let basePermissions = [];
  if (u.role_key) {
    const r = getCachedRoleByKey(db, u.role_key);
    if (!r || !r.active) {
      if (accessMode === 'role') return [];
    } else {
      basePermissions = safeJsonParse(r.permissions_json, []).filter((p) => ASSIGNABLE.has(p));
    }
  } else {
    basePermissions = PERMISSIONS[u.role] ?? [];
  }

  let unitPermissions = [];
  if (u.unit_id) {
    try {
      const unitRow = getCachedUnitById(db, u.unit_id);
      if (unitRow && unitRow.active) {
        const up = safeJsonParse(unitRow.default_permissions_json, []).filter((p) => ASSIGNABLE.has(p));
        const um = resolveModulePermissions(safeJsonParse(unitRow.default_module_access_json, {}));
        unitPermissions = [...new Set([...up, ...um])];
      }
    } catch {
      unitPermissions = [];
    }
  }

  return resolveEffectivePermissions({
    basePermissions,
    unitPermissions,
    accessMode,
    moduleAccess,
    customPermissions: customPerms,
    revokedPermissions: revokedPerms,
  });
}


export function roleLabel(db, u) {
  let lbl = ROLE_LABEL[u.role] ?? u.role;
  if (u.role_key) {
    lbl = getCachedRoleByKey(db, u.role_key)?.label ?? u.role_key;
  }
  if (u.access_mode === 'custom') return `${lbl} (صلاحيات مخصصة)`;
  if (u.access_mode === 'hybrid') return `${lbl} + تخصيص`;
  return lbl;
}

