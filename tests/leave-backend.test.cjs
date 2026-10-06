const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { randomUUID } = require('node:crypto');

class Sheet {
  constructor(rows = []) { this.rows = rows; this.columns = 26; }
  getLastRow() { return this.rows.length; }
  getMaxColumns() { return this.columns; }
  insertColumnsAfter(_after, amount) { this.columns += amount; }
  getDataRange() { return this.getRange(1, 1, this.rows.length, Math.max(...this.rows.map(r => r.length), 1)); }
  getRange(row, column, height = 1, width = 1) {
    if (typeof row === 'string') return this.getRange(1, 1);
    const sheet = this;
    return {
      getValues() { return Array.from({ length: height }, (_, i) => Array.from({ length: width }, (_, j) => sheet.rows[row + i - 1]?.[column + j - 1] ?? '')); },
      getDisplayValues() { return this.getValues().map(r => r.map(String)); },
      setValues(values) { values.forEach((r, i) => {
        const target = sheet.rows[row + i - 1] || (sheet.rows[row + i - 1] = []);
        r.forEach((value, j) => target[column + j - 1] = value);
      }); return this; },
      setBackground() { return this; }, setFontColor() { return this; }, setFontWeight() { return this; },
      setNumberFormat() { return this; }, setValue(value) { return this.setValues([[value]]); }
    };
  }
  setFrozenRows() {} setColumnWidth() {}
}

const sheets = new Map([['config', new Sheet([
  ['key', 'value'], ['picker_pin', 'staff-secret'], ['deputy_pin', 'deputy-secret'], ['school_name', 'Example School']
])]]);
const spreadsheet = {
  getSheetByName(name) { return sheets.get(name); },
  insertSheet(name) { const sheet = new Sheet(); sheets.set(name, sheet); return sheet; }
};
const context = {
  SpreadsheetApp: { openById() { return spreadsheet; } },
  ContentService: { MimeType: { JSON: 'json' }, createTextOutput(content) { return { getContent() { return content; }, setMimeType() { return this; } }; } },
  LockService: { getScriptLock() { return { waitLock() {}, releaseLock() {} }; } },
  Utilities: { getUuid: randomUUID },
  console, Date, JSON, Set
};
vm.createContext(context);
vm.runInContext(fs.readFileSync(require('node:path').join(__dirname, '..', 'Code.gs'), 'utf8'), context);
const oldHeaders = vm.runInContext('LEAVE_HEADERS.slice(0, 26)', context);
const oldRow = Array(26).fill('');
oldRow[0] = randomUUID(); oldRow[2] = randomUUID(); oldRow[20] = 'อนุมัติ';
sheets.set('ใบขอออกนอกบริเวณ', new Sheet([Array.from(oldHeaders), oldRow]));

const call = (action, values) => context.bridgeApi({ action, ...values });
assert.equal(context.readConfig(spreadsheet).deputy_pin, undefined);
assert.equal(context.readConfig(spreadsheet).picker_pin, undefined);
assert.equal(call('getLeaveSettings', { pin: 'wrong' }).success, false);
assert.equal(call('saveLeaveSettings', { pin: 'staff-secret', settings: {
  deputyName: 'รองผู้อำนวยการ ทดสอบ', affairsTeachers: ['ครูฝ่ายกิจการ ก', 'ครูฝ่ายกิจการ ข'],
  homeroom: { 'ป.3': 'ครูประจำชั้น ป.3', 'ป.5': 'ครูประจำชั้น ป.5' }
} }).success, true);

const requests = [
  { student: { cls: 'ป.5', room: '1', number: '4', code: '5004', firstName: 'นักเรียนห้า', lastName: 'ตัวอย่าง' }, date: '2026-10-06', outTime: '09:00', returnTime: '11:00', reason: 'ธุระ ก', destination: 'สถานที่ ก', affairsTeacher: 'ครูฝ่ายกิจการ ก', advisorOpinion: 'อนุญาต', affairsOpinion: 'อนุญาต', noReturn: false },
  { student: { cls: 'ป.3', room: '2', number: '7', code: '3007', firstName: 'นักเรียนสาม', lastName: 'ตัวอย่าง' }, date: '2026-10-06', outTime: '10:00', returnTime: '', reason: 'ธุระ ข', destination: 'สถานที่ ข', affairsTeacher: 'ครูฝ่ายกิจการ ข', advisorOpinion: 'ไม่อนุญาต', affairsOpinion: 'อนุญาต', noReturn: true }
];
assert.equal(call('createLeaveBatch', { pin: 'wrong', requests }).success, false);
const created = call('createLeaveBatch', { pin: 'staff-secret', requests });
assert.equal(created.success, true);
assert.equal(created.count, 2);
assert.equal(sheets.get('ใบขอออกนอกบริเวณ').rows[0].length, 29);
assert.equal(sheets.get('ใบขอออกนอกบริเวณ').rows[1][20], 'อนุมัติ');
assert.equal(call('getLeaveApproval', { token: created.token, deputyPin: 'wrong' }).success, false);
const view = call('getLeaveApproval', { token: created.token, deputyPin: 'deputy-secret' });
assert.equal(view.success, true);
assert.equal(view.requests.length, 2);
assert.deepEqual(Array.from(view.requests, r => r.reason), ['ธุระ ก', 'ธุระ ข']);
assert.deepEqual(Array.from(view.requests, r => r.noReturn), [false, true]);
assert.deepEqual(Array.from(view.requests, r => r.advisorOpinion), ['อนุญาต', 'ไม่อนุญาต']);
assert.equal(call('decideLeaveApproval', { token: created.token, deputyPin: 'wrong', decisions: [{ id: view.requests[0].id, status: 'อนุมัติ' }] }).success, false);
assert.equal(call('decideLeaveApproval', { token: created.token, deputyPin: 'deputy-secret', decisions: [
  { id: view.requests[0].id, status: 'อนุมัติ' }, { id: view.requests[1].id, status: 'ไม่อนุมัติ', note: 'ให้ติดต่อผู้ปกครอง' }
] }).success, true);
const after = call('getLeaveApproval', { token: created.token, deputyPin: 'deputy-secret' });
assert.deepEqual(Array.from(after.requests, r => r.status), ['อนุมัติ', 'ไม่อนุมัติ']);
assert.equal(call('decideLeaveApproval', { token: created.token, deputyPin: 'deputy-secret', decisions: [{ id: view.requests[0].id, status: 'ไม่อนุมัติ' }] }).success, false);
console.log('Leave request backend flow OK');
