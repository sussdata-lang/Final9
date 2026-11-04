/* حالة الوحدات الموحدة المشتركة بين ملفات ux_* (مفصول من ux_restructure.js) */
(function () {
  'use strict';
  const UA = window.UA;
  if (!UA) return;
  const { S, api, esc, fmt, toast, can } = UA;

  /* ---------- حالة الوحدات الموحدة ---------- */
  const U = {
    mainTab: 'unified', // unified | work | myprofile
    hrSection: 'payroll', // payroll | att_leaves | biometrics | appraisals | enterprise_hr
    auditSection: 'chain', // chain | logs | devops | exec_offline
    acadExtraTab: '', // '' | 'exam_master' | 'enterprise_acad'
    guideMode: 'depts', // depts | hierarchy | lifecycle | corr_rules | governance
    guideSection: 'all',
    guideDeptFilter: 'all',
    guideNode: 'node_president',
    guideReqSim: 'req_enrollment',
    guideReqStep: 1,
    guideQuery: '',
    corrUnifiedTab: 'in', // in | out | internal_requests | internal_new | pending_all | new_corr | tpl | notifs
    corrReqFilter: 'all',
    examSchedule: {
      examType: 'امتحان فصلي نهائي (Final)',
      academicYear: '2025/2026',
      semester: 'الفصل الأول',
      startDate: new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10),
      defaultTime: '09:00',
      defaultDuration: 120,
      filterProgram: '',
      filterQuery: '',
      rows: {}, // courseId -> { included, date, time, duration, hall, proctor, notes }
      loaded: false,
      courses: [],
    },
    // تُحمَّل من الخادم عند فتح التبويب
    biometrics: { devices: [] },
    appraisals: [],
    cardActivity: {
      filterEvent: 'all', // all | check_in | check_out | denied
      filterMethod: 'all', // all | nfc | barcode
      filterLocation: 'all',
      searchQuery: '',
      selectedLocation: 'GATE-MAIN-01',
      selectedMethod: 'nfc',
    },
  };

  UA.uxState = U;
})();
