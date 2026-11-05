// حسومات الرسوم من تبويب المالية: نسبة من رسوم الطالب في العام، تُسجَّل كمنحة مع قيد خصمها.
import { calculateScholarshipGrant, grantStudentScholarship } from '../student_affairs_suite.js';
import { bad, ready, fromMinor } from './core.js';

const TYPE_OF_KIND = { scholarship: 'merit_top', sibling: 'sibling_discount', social: 'social_aid' };

export function listDiscounts({ db }) {
  ready(db);
  return db.prepare(`SELECT s.id, s.scholarship_type, s.discount_percent, s.amount, s.academic_year, s.note, u.display_name, u.student_no
    FROM sa_scholarships s JOIN users u ON u.id = s.student_id JOIN fin_charges c ON c.id = s.fin_charge_id
    WHERE s.status = 'active' AND c.status = 'open' ORDER BY s.id DESC LIMIT 200`).all().map((r) => ({
    id: r.id, studentName: r.display_name, studentNo: r.student_no, academicYear: r.academic_year,
    kindLabel: calculateScholarshipGrant({ scholarshipType: r.scholarship_type }).label,
    percent: Number(r.discount_percent), amount: Number(r.amount), reason: r.note,
  }));
}

export function createDiscount(deps, actor, b, ip) {
  const { db } = deps; ready(db);
  const studentNo = String(b?.studentNo ?? '').trim();
  const student = studentNo && db.prepare("SELECT id FROM users WHERE role = 'student' AND student_no = ?").get(studentNo);
  if (!student) throw bad('الرقم الجامعي غير موجود.', 404, 'not_found');
  const year = String(b?.academicYear ?? '').trim();
  if (!year) throw bad('العام الدراسي مطلوب.');
  const scholarshipType = TYPE_OF_KIND[b?.kind];
  if (!scholarshipType) throw bad('نوع الحسم غير صالح.');
  const percent = Number(b?.percent);
  if (!(percent > 0 && percent <= 100)) throw bad('نسبة الحسم يجب أن تكون بين 1 و100.');
  const reason = String(b?.reason ?? '').trim();
  if (!reason) throw bad('سبب الحسم ورقم القرار مطلوبان.');

  const sum = (kind) => Number(db.prepare(`SELECT COALESCE(SUM(c.amount), 0) AS n FROM fin_charges c JOIN fin_fee_types ft ON ft.id = c.fee_type_id
    WHERE c.student_id = ? AND c.academic_year = ? AND c.status = 'open' AND ft.kind = ?`).get(student.id, year, kind).n);
  const fees = sum('fee');
  if (!fees) throw bad(`لا توجد رسوم مستحقة على الطالب في العام ${year}؛ سجّل الرسوم أولاً.`, 409, 'conflict');
  const amount = Math.round((fees * percent) / 100);
  if (sum('discount') + amount > fees) throw bad('مجموع الحسومات يتجاوز رسوم الطالب في هذا العام.', 409, 'conflict');

  return grantStudentScholarship(deps, actor, { studentId: student.id, scholarshipType, baseTuition: fromMinor(fees), discountPercent: percent, amount: fromMinor(amount), note: reason, academicYear: year }, ip);
}
