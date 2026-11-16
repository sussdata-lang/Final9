// سجل تصنيف البيانات الشخصية التي يحفظها النظام: مرجع ثابت لمستوى حساسية كل فئة بياناتٍ وأين تُحفظ
// وما الحماية المطبَّقة عليها فعلياً في الكود، ليراجعه مسؤول الأمن أو حماية البيانات دون البحث في الكود.
// عدِّل هذه القائمة عند إضافة فئة بيانات شخصية جديدة أو تغيير حمايتها.
export const SENSITIVITY = { public: 'عام', internal: 'داخلي', confidential: 'سري', secret: 'سري للغاية' };

export const DATA_CLASSIFICATION = [
  { category: 'الهوية الأساسية', examples: 'الاسم، الرقم الوطني، تاريخ الميلاد، العنوان وأرقام التواصل', sensitivity: 'secret', tables: 'student_profiles، hr_employees', protection: 'صلاحيات محدودة (student:read، hr_emp:view)، وكل وصول يُسجَّل في سجل التدقيق.' },
  { category: 'بيانات الدخول والأمان', examples: 'كلمات المرور، رموز التحقق بخطوتين، الجلسات', sensitivity: 'secret', tables: 'users، sessions', protection: 'كلمات المرور مجزَّأة (scrypt) لا تُحفظ صريحة؛ أسرار التحقق بخطوتين مشفَّرة؛ الجلسات بمعرّف عشوائي لا يُستدل منه على التوكن.' },
  { category: 'ملفات الانضباط والتأديب', examples: 'أسباب التظلم من قرار انضباطي ومسوغات البت فيه، ملاحظة المانع الانضباطي', sensitivity: 'secret', tables: 'sa_disciplinary_appeals، student_holds', protection: 'تُحفظ مشفَّرة (AES-256-GCM بمفتاح DATA_KEY مستقل)، ولا تُفَكّ إلا لمن يملك صلاحية الانضباط أو البت النهائي.' },
  { category: 'البيانات المالية', examples: 'الرسوم والدفعات، السندات والفواتير، الرواتب والسلف', sensitivity: 'confidential', tables: 'fin_*، student_fee_installments، hr_salaries', protection: 'صلاحيات مالية مفصَّلة (قراءة/إدخال/ترحيل منفصلة)، وفصل المهام في الاعتماد.' },
  { category: 'البيانات الأكاديمية', examples: 'العلامات، الشهادات والوثائق الموقَّعة', sensitivity: 'confidential', tables: 'grades، student_certs، document_pdfs', protection: 'فصل المهام بين إدخال العلامة واعتمادها، وتوقيع رقمي للوثائق الصادرة (CMS + X.509) يُبطَّل بأي تعديل.' },
  { category: 'الحضور والمراقبة الأمنية', examples: 'سجل دخول القاعات والبوابات، نشاط البطاقة الجامعية', sensitivity: 'internal', tables: 'hall_logs، sa_card_activity_logs', protection: 'صلاحيات محدودة لعرضه، ومدة احتفاظ تُضبط من الإعدادات.' },
  { category: 'أحداث الأمن السيبراني', examples: 'محاولات الدخول الفاشلة، حجب جدار الحماية، تنبيهات مركز الأمان', sensitivity: 'internal', tables: 'audit_log، security_events، security_alerts', protection: 'سجل تدقيق بسلسلة بصمات لا تُعدَّل، وصلاحية security:monitor أو audit:read لرؤيتها.' },
  { category: 'بيانات عامة', examples: 'الأخبار والتعميمات، أسماء الكليات والبرامج والمقررات', sensitivity: 'public', tables: 'news، faculties، programs، courses', protection: 'لا قيود خاصة؛ بعضها يظهر علناً على الموقع.' },
];
