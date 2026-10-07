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
  status: 'รอพิจารณา', guardianPhone: '081-234-5678', token: 'test-token'
};
const html = context.leavePrintCopy(request);
assert.match(html, /โรงเรียนบ้านคลอง 14 สพป\.นครนายก/);
assert.match(html, /ไม่กลับเข้ามาในโรงเรียนในวันนั้น/);
assert.match(html, /เบอร์โทรติดต่อผู้ปกครอง <b>081-234-5678<\/b>/);
assert.doesNotMatch(html, /กลับเข้ามาในโรงเรียนเวลา/);
assert.match(html, /พิจารณาเห็นควรว่า ☑ อนุญาต ☐ ไม่อนุญาต/);
assert.match(html, /พิจารณาเห็นควรว่า ☐ อนุญาต ☑ ไม่อนุญาต/);
assert.match(html, /ผลการพิจารณา ☐ อนุญาต ☐ ไม่อนุญาต/);
assert.match(html, /<p class="sign"><span>ลงชื่อ<\/span><span class="sign-line">\.+<br>\(เด็กชายตัวอย่าง ทดสอบ\)<\/span><span>นักเรียนผู้ขออนุญาต<\/span><\/p>/);
assert.match(html, /พิจารณาเห็นควรว่า ☑ อนุญาต ☐ ไม่อนุญาต<div class="box-signature">ลงชื่อ/);
assert.match(html, /ผลการพิจารณา ☐ อนุญาต ☐ ไม่อนุญาต<div class="box-signature">ลงชื่อ/);
assert.match(html, /<div class="guardian-signature"><div class="guardian-sign-line">ลงชื่อ \.{68}<\/div><div class="guardian-name-line">\(\.{68}\)<\/div><div class="guardian-role">ผู้ปกครอง/);
assert.match(html, /<small class="guardian-note">\*ลงชื่อในกรณีที่ผู้ปกครองมารับนักเรียนด้วยตนเอง<\/small>/);
request.decidedAt = '2026-10-06T23:40:20.209Z';
assert.match(context.leavePrintCopy(request), /บันทึกผลในระบบ วันพุธที่ 7 ตุลาคม 2569 เวลา 06:40 น\./);
assert.doesNotMatch(context.leavePrintCopy(request), /2026-10-06T23:40:20\.209Z/);
request.noReturn = false;
request.returnTime = '11:00';
assert.match(context.leavePrintCopy(request), /กลับเข้ามาในโรงเรียนเวลา <b>11:00<\/b> น\./);
let printed = '';
const popup = { document: { write(value) { printed = value; }, close() {}, fonts: { ready: Promise.resolve() } }, focus() {}, print() {} };
context.window = { open() { return popup; } };
context.printRequest = request;
vm.runInContext('leaveRequests = [printRequest]', context);
context.printLeaveGroup('test-token');
assert.equal((printed.match(/<section class="copy">/g) || []).length, 2);
assert.match(printed, /@page\{size:A4/);
assert.match(printed, /\.copy\{height:138mm;overflow:hidden;padding:3mm 2mm;border-bottom:1px dashed/);
assert.match(printed, /\.guardian-signature\{margin-top:7mm\}\.guardian-name-line\{margin-top:5mm\}\.guardian-role\{margin-top:1mm\}/);
assert.equal((context.leavePrintDocument([request]).match(/<section class="copy">/g) || []).length, 2);

let imageCount = 0;
let openedPdf = '';
let pageCount = 1;
const pdfPopup = {
  document: {
    write() {}, close() {},
    documentElement: { scrollWidth: 800 },
    fonts: { ready: Promise.resolve(), load: () => Promise.resolve() },
    querySelectorAll: () => [{}, {}]
  },
  focus() {}, location: { replace(value) { openedPdf = value; } }
};
context.window = {
  open: () => pdfPopup,
  html2canvas: async () => ({ toDataURL: () => 'data:image/jpeg;base64,dGVzdA==' }),
  jspdf: { jsPDF: class {
    addPage() { pageCount++; }
    addImage() { imageCount++; }
    output(type) { assert.equal(type, 'blob'); return 'pdf-blob'; }
  } }
};
context.URL = { createObjectURL: () => 'blob:leave-pdf', revokeObjectURL() {} };
context.setTimeout = () => 1;
context.openLeavePdf('test-token').then(() => {
  assert.equal(imageCount, 2);
  assert.equal(pageCount, 2);
  assert.equal(openedPdf, 'blob:leave-pdf');
  console.log('Leave print and PDF content OK');
}).catch(error => { console.error(error); process.exitCode = 1; });
