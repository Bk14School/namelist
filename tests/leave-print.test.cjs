const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');

const context = { location: { search: '' }, URLSearchParams, classOrder: ['ป.3', 'ป.5'] };
vm.createContext(context);
vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'leave.js'), 'utf8'), context);

const request = {
  student: { cls: 'ป.3', room: '1', number: '7', prefix: 'เด็กชาย', firstName: 'ตัวอย่าง', lastName: 'ทดสอบ' },
  date: '2026-10-07', outTime: '09:00', returnTime: '', noReturn: true,
  reason: 'ไปติดต่อราชการ', destination: 'อำเภอ',
  advisorOpinion: 'อนุญาต', affairsOpinion: 'ไม่อนุญาต',
  affairsTeacher: 'ครูฝ่ายกิจการ', homeroomTeacher: 'ครูประจำชั้น', deputyName: 'รองผู้อำนวยการ',
  status: 'รอพิจารณา'
};
const html = context.leavePrintCopy(request);
assert.match(html, /โรงเรียนบ้านคลอง 14 สพป\.นครนายก/);
assert.match(html, /ไม่กลับเข้ามาในโรงเรียนในวันนั้น/);
assert.doesNotMatch(html, /กลับเข้ามาในโรงเรียนเวลา/);
assert.match(html, /พิจารณาเห็นควรว่า ☑ อนุญาต ☐ ไม่อนุญาต/);
assert.match(html, /พิจารณาเห็นควรว่า ☐ อนุญาต ☑ ไม่อนุญาต/);
assert.match(html, /ผลการพิจารณา ☐ อนุญาต ☐ ไม่อนุญาต/);
request.noReturn = false;
request.returnTime = '11:00';
assert.match(context.leavePrintCopy(request), /กลับเข้ามาในโรงเรียนเวลา <b>11:00<\/b> น\./);
console.log('Leave print content OK');
