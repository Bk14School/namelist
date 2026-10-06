// ============================================================
//  Google Apps Script — ระบบใบรายชื่อนักเรียน
//  - ชีท "config"    : ตั้งค่าระบบ (ชื่อโรงเรียน, รหัสแอดมิน)
//  - ชีท "ข้อมูลดิบ" : ประวัติทุกรอบที่อัปโหลด (ต่อท้าย ไม่ล้างของเก่า)
//  - ชีท "ข้อมูลรวม" : สรุปจำนวนนักเรียนแต่ละชั้น
//  - ชีท อ.2 … ม.3   : รายชื่อนักเรียนแยกชั้น (ประมวลผลแล้ว)
//  - ชีท "เพิ่มเติม"  : นักเรียนที่เพิ่มเองนอกข้อมูลดิบ (ไม่ถูกลบเมื่ออัปโหลดใหม่)
//  - ชีท "รายการที่เลือก" : กิจกรรม มาสาย และผิดระเบียบ
// ============================================================

const SPREADSHEET_ID = '1_VgsJveYFvDHF6B-3G8zmIP1uAfHyOk8-kEyfuxT5i8';

// ── Router ────────────────────────────────────────────────
function doGet(e) {
  const action = (e.parameter.action || 'getAll');
  if (action === 'bridge') return bridgePage(e.parameter.nonce || '');
  if (action === 'getAll')     return getAll();
  if (action === 'getConfig')  return getConfig();
  return response({ success: false, message: 'Unknown action' });
}

// HtmlService uses google.script.run instead of the ContentService redirect.
// The latter can intermittently return a Google Drive 404 after doGet succeeds.
function bridgePage(nonce) {
  const safeNonce = JSON.stringify(String(nonce).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 120));
  const html = `<!doctype html><meta charset="utf-8"><body>กำลังเชื่อมต่อ...<script>
  const nonce = ${safeNonce};
  const siteOrigin = 'https://bk14school.github.io';
  window.addEventListener('message', function(event) {
    if (event.origin !== siteOrigin || !event.data || event.data.namelistBridge !== true || event.data.nonce !== nonce || event.data.kind !== 'request') return;
    const id = event.data.id;
    google.script.run
      .withSuccessHandler(function(result) { window.top.postMessage({namelistBridge:true, nonce:nonce, kind:'response', id:id, result:result}, siteOrigin); })
      .withFailureHandler(function(error) { window.top.postMessage({namelistBridge:true, nonce:nonce, kind:'response', id:id, error:String(error.message || error)}, siteOrigin); })
      .bridgeApi(event.data.payload);
  });
  document.body.textContent = 'เชื่อมต่อพร้อมแล้ว';
  window.top.postMessage({namelistBridge:true, nonce:nonce, kind:'ready'}, siteOrigin);
  </script>`;
  return HtmlService.createHtmlOutput(html).setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function bridgeApi(payload) {
  if (!payload || typeof payload !== 'object') throw new Error('Invalid request');
  const action = payload.action;
  let output;
  if (action === 'getAll') output = getAll();
  else if (action === 'saveStudents') output = saveStudents(payload.students);
  else if (action === 'saveConfig') output = saveConfig(payload.config);
  else if (action === 'addExtraStudent') output = addExtraStudent(payload.student);
  else if (action === 'deleteExtraStudent') output = deleteExtraStudent(payload.rowIndex);
  else if (action === 'checkPickerPin') output = checkPickerPin(payload.pin);
  else if (action === 'saveRecord') output = saveRecord(payload.record, payload.pin);
  else if (action === 'getRecords') output = getRecords(payload.pin);
  else if (action === 'updateRecord') output = updateRecord(payload.id, payload.record, payload.pin);
  else if (action === 'deleteRecord') output = deleteRecord(payload.id, payload.pin);
  else if (action === 'getLeaveSettings') output = getLeaveSettings(payload.pin);
  else if (action === 'saveLeaveSettings') output = saveLeaveSettings(payload.settings, payload.pin);
  else if (action === 'createLeaveBatch') output = createLeaveBatch(payload.requests, payload.pin);
  else if (action === 'getLeaveRequests') output = getLeaveRequests(payload.pin);
  else if (action === 'getLeaveApproval') output = getLeaveApproval(payload.token, payload.deputyPin);
  else if (action === 'decideLeaveApproval') output = decideLeaveApproval(payload.token, payload.decisions, payload.deputyPin);
  else throw new Error('Unknown action');
  return JSON.parse(output.getContent());
}

function doPost(e) {
  try {
    const data   = JSON.parse(e.postData.contents);
    const action = data.action;
    if (action === 'saveStudents')       return saveStudents(data.students);
    if (action === 'saveConfig')         return saveConfig(data.config);
    if (action === 'addExtraStudent')    return addExtraStudent(data.student);
    if (action === 'deleteExtraStudent') return deleteExtraStudent(data.rowIndex);
    if (action === 'checkPickerPin')     return checkPickerPin(data.pin);
    if (action === 'saveRecord')         return saveRecord(data.record, data.pin);
    if (action === 'getRecords')         return getRecords(data.pin);
    if (action === 'updateRecord')       return updateRecord(data.id, data.record, data.pin);
    if (action === 'deleteRecord')       return deleteRecord(data.id, data.pin);
    if (action === 'getLeaveSettings')    return getLeaveSettings(data.pin);
    if (action === 'saveLeaveSettings')   return saveLeaveSettings(data.settings, data.pin);
    if (action === 'createLeaveBatch')    return createLeaveBatch(data.requests, data.pin);
    if (action === 'getLeaveRequests')    return getLeaveRequests(data.pin);
    if (action === 'getLeaveApproval')    return getLeaveApproval(data.token, data.deputyPin);
    if (action === 'decideLeaveApproval') return decideLeaveApproval(data.token, data.decisions, data.deputyPin);
    return response({ success: false, message: 'Unknown action' });
  } catch (err) {
    return response({ success: false, message: err.toString() });
  }
}

// ── ดึงทุกอย่างในครั้งเดียว (config + นักเรียน) ──────────
function getAll() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  return response({
    success:  true,
    config:   readConfig(ss),
    students: readStudents(ss),
    extra:    readExtraStudents(ss)
  });
}

// ── ดึงเฉพาะ config ───────────────────────────────────────
function getConfig() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  return response({ success: true, config: readConfig(ss) });
}

// หนึ่งแถวต่อหนึ่งนักเรียนในรายการ เก็บข้อมูล ณ วันที่เลือกไว้
const RECORD_HEADERS = ['รหัสรายการ','ประเภท','วันที่','ชื่อรายการ','หมายเหตุ','ชั้น','ห้อง','รหัสนักเรียน','คำนำหน้า','ชื่อ','นามสกุล','บันทึกเมื่อ','ครูผู้บันทึก'];

function recordSheet(ss) {
  let sheet = ss.getSheetByName('รายการที่เลือก');
  if (!sheet) {
    sheet = ss.insertSheet('รายการที่เลือก');
    sheet.getRange(1, 1, 1, RECORD_HEADERS.length).setValues([RECORD_HEADERS]);
    sheet.getRange(1, 1, 1, RECORD_HEADERS.length).setBackground('#2563EB').setFontColor('#FFFFFF').setFontWeight('bold');
    sheet.setFrozenRows(1);
    sheet.getRange('H:H').setNumberFormat('@');
  } else {
    const teacherHeader = sheet.getRange(1, 13).getDisplayValue();
    if (teacherHeader && teacherHeader !== RECORD_HEADERS[12]) throw new Error('คอลัมน์ M ของชีท รายการที่เลือก ถูกใช้งานอยู่');
    if (!teacherHeader) {
      // เติมหัวคอลัมน์ใหม่โดยคงข้อมูลรายการเดิมทุกแถวไว้
      sheet.getRange(1, 13).setValue(RECORD_HEADERS[12]).setBackground('#2563EB').setFontColor('#FFFFFF').setFontWeight('bold');
    }
  }
  return sheet;
}

function pickerPinError(pin) {
  const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName('config');
  const rows = sheet ? sheet.getDataRange().getDisplayValues() : [];
  const entry = rows.slice(1).find(r => String(r[0]).trim() === 'picker_pin');
  const expected = entry ? String(entry[1]).trim() : '';
  if (!expected) return 'ยังไม่ได้กำหนดรหัสเลือกนักเรียนในชีท config (key: picker_pin)';
  if (String(pin == null ? '' : pin).trim() !== expected) return 'รหัสเลือกนักเรียนไม่ถูกต้อง';
  return '';
}

function checkPickerPin(pin) {
  const error = pickerPinError(pin);
  return response(error ? { success: false, message: error } : { success: true });
}

function getRecords(pin) {
  const error = pickerPinError(pin);
  if (error) return response({ success: false, message: error });
  const sheet = recordSheet(SpreadsheetApp.openById(SPREADSHEET_ID));
  const rows = sheet.getLastRow() > 1
    ? sheet.getRange(2, 1, sheet.getLastRow() - 1, RECORD_HEADERS.length).getDisplayValues() : [];
  const byId = {};
  rows.forEach(r => {
    if (!r[0]) return;
    if (!byId[r[0]]) byId[r[0]] = { id: r[0], type: r[1], date: r[2], name: r[3], note: r[4], teacher: r[12] || '', students: [] };
    byId[r[0]].students.push({ cls: r[5], room: r[6], code: r[7], prefix: r[8], firstName: r[9], lastName: r[10] });
  });
  return response({ success: true, records: Object.values(byId).reverse() });
}

function validatedRecordRows(record, id, createdAt) {
  if (!record || !['activity','late','conduct'].includes(record.type) ||
      !/^\d{4}-\d{2}-\d{2}$/.test(record.date || '') ||
      (record.type === 'activity' && !String(record.name || '').trim()) ||
      !Array.isArray(record.students) || !record.students.length || record.students.length > 500) {
    return { error: 'กรอกประเภท วันที่ ชื่อกิจกรรม (ถ้ามี) และเลือกนักเรียนอย่างน้อย 1 คน' };
  }
  const name = record.type === 'activity' ? String(record.name).trim().slice(0, 120)
    : (record.type === 'late' ? 'มาสาย' : 'ผิดระเบียบ');
  const text = (value, limit) => String(value == null ? '' : value).trim().slice(0, limit || 120);
  // กันสูตรใน Sheets เมื่อข้อมูลมาจากชื่อที่กรอกเอง
  const cell = (value, limit) => { const s = text(value, limit); return /^[=+\-@]/.test(s) ? "'" + s : s; };
  const rows = record.students.map(s => [
    id, record.type, record.date, cell(name), cell(record.note, 500),
    cell(s.cls), cell(s.room), text(s.code), cell(s.prefix), cell(s.firstName), cell(s.lastName), createdAt,
    cell(record.teacher, 120)
  ]);
  if (rows.some(r => !r[5] || !r[9])) return { error: 'ข้อมูลนักเรียนไม่ครบ' };
  return { rows: rows };
}

function saveRecord(record, pin) {
  const error = pickerPinError(pin);
  if (error) return response({ success: false, message: error });
  const id = Utilities.getUuid();
  const prepared = validatedRecordRows(record, id, new Date().toISOString());
  if (prepared.error) return response({ success: false, message: prepared.error });
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sheet = recordSheet(SpreadsheetApp.openById(SPREADSHEET_ID));
    sheet.getRange(sheet.getLastRow() + 1, 1, prepared.rows.length, RECORD_HEADERS.length).setValues(prepared.rows);
  } finally { lock.releaseLock(); }
  return response({ success: true, id: id, message: 'บันทึกรายการแล้ว' });
}

function recordRowNumbers(sheet, id) {
  if (!id || typeof id !== 'string' || !/^[a-f0-9-]{36}$/i.test(id)) return [];
  const count = sheet.getLastRow() - 1;
  if (count < 1) return [];
  return sheet.getRange(2, 1, count, 1).getDisplayValues()
    .map((r, i) => r[0] === id ? i + 2 : 0).filter(Boolean);
}

function updateRecord(id, record, pin) {
  const error = pickerPinError(pin);
  if (error) return response({ success: false, message: error });
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sheet = recordSheet(SpreadsheetApp.openById(SPREADSHEET_ID));
    const rowNumbers = recordRowNumbers(sheet, id);
    if (!rowNumbers.length) return response({ success: false, message: 'ไม่พบรายการนี้แล้ว กรุณาโหลดประวัติใหม่' });
    const createdAt = sheet.getRange(rowNumbers[0], 12).getValue();
    const prepared = validatedRecordRows(record, id, createdAt);
    if (prepared.error) return response({ success: false, message: prepared.error });
    // เพิ่มส่วนเกินก่อน แล้วค่อยแทนที่หรือลบแถวเก่า เพื่อไม่ให้ข้อมูลเดิมหายหากการเพิ่มล้มเหลว
    if (prepared.rows.length > rowNumbers.length) {
      const extra = prepared.rows.slice(rowNumbers.length);
      sheet.getRange(sheet.getLastRow() + 1, 1, extra.length, RECORD_HEADERS.length).setValues(extra);
    }
    const shared = Math.min(prepared.rows.length, rowNumbers.length);
    for (let i = 0; i < shared; i++) {
      sheet.getRange(rowNumbers[i], 1, 1, RECORD_HEADERS.length).setValues([prepared.rows[i]]);
    }
    for (let i = rowNumbers.length - 1; i >= prepared.rows.length; i--) sheet.deleteRow(rowNumbers[i]);
    return response({ success: true, message: 'แก้ไขรายการแล้ว' });
  } finally { lock.releaseLock(); }
}

function deleteRecord(id, pin) {
  const error = pickerPinError(pin);
  if (error) return response({ success: false, message: error });
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sheet = recordSheet(SpreadsheetApp.openById(SPREADSHEET_ID));
    const rowNumbers = recordRowNumbers(sheet, id);
    if (!rowNumbers.length) return response({ success: false, message: 'ไม่พบรายการนี้แล้ว กรุณาโหลดประวัติใหม่' });
    for (let i = rowNumbers.length - 1; i >= 0; i--) sheet.deleteRow(rowNumbers[i]);
    return response({ success: true, message: 'ลบรายการแล้ว' });
  } finally { lock.releaseLock(); }
}

// ── ใบขออนุญาตออกนอกบริเวณโรงเรียน ──────────────────────
const LEAVE_CLASSES = ['อ.2','อ.3','ป.1','ป.2','ป.3','ป.4','ป.5','ป.6','ม.1','ม.2','ม.3'];
const LEAVE_HEADERS = ['รหัสคำขอ','รหัสชุด','โทเคนอนุมัติ','วันที่','ชั้น','ห้อง','เลขที่','รหัสนักเรียน','คำนำหน้า','ชื่อ','นามสกุล','เวลาออก','เวลากลับ','ธุระ','สถานที่ติดต่อ','ครูฝ่ายกิจการ','ครูประจำชั้น','รองผู้อำนวยการ','ชื่อผู้ปกครอง','ผู้ปกครองมารับ','สถานะ','พิจารณาเมื่อ','ผู้พิจารณา','เหตุผลการพิจารณา','สร้างเมื่อ','ครูผู้กรอก','ความเห็นครูที่ปรึกษา','ความเห็นครูฝ่ายกิจการ','ไม่กลับเข้ามา'];

function leaveSettingsSheet(ss) {
  let sheet = ss.getSheetByName('ตั้งค่าใบอนุญาต');
  if (!sheet) {
    sheet = ss.insertSheet('ตั้งค่าใบอนุญาต');
    sheet.getRange(1, 1, 1, 2).setValues([['key','value']]);
    sheet.getRange(1, 1, 1, 2).setBackground('#2563EB').setFontColor('#FFFFFF').setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function readLeaveSettings(ss) {
  const rows = leaveSettingsSheet(ss).getDataRange().getDisplayValues();
  const values = {};
  rows.slice(1).forEach(r => { if (r[0]) values[String(r[0])] = String(r[1] || ''); });
  let affairsTeachers = [];
  try { affairsTeachers = JSON.parse(values.affairs_teachers || '[]'); } catch (_) {}
  if (!Array.isArray(affairsTeachers)) affairsTeachers = [];
  const homeroom = {};
  LEAVE_CLASSES.forEach(cls => { homeroom[cls] = values['homeroom_' + cls] || ''; });
  return { deputyName: values.deputy_name || '', affairsTeachers, homeroom };
}

function getLeaveSettings(pin) {
  const error = pickerPinError(pin);
  if (error) return response({ success: false, message: error });
  return response({ success: true, settings: readLeaveSettings(SpreadsheetApp.openById(SPREADSHEET_ID)) });
}

function saveLeaveSettings(settings, pin) {
  const error = pickerPinError(pin);
  if (error) return response({ success: false, message: error });
  if (!settings || !Array.isArray(settings.affairsTeachers) || !settings.homeroom || typeof settings.homeroom !== 'object')
    return response({ success: false, message: 'ข้อมูลตั้งค่าไม่ถูกต้อง' });
  const clean = value => String(value == null ? '' : value).trim().slice(0, 120);
  const deputyName = clean(settings.deputyName);
  const affairsTeachers = [...new Set(settings.affairsTeachers.map(clean).filter(Boolean))].slice(0, 20);
  const rows = [['deputy_name', deputyName], ['affairs_teachers', JSON.stringify(affairsTeachers)]];
  LEAVE_CLASSES.forEach(cls => rows.push(['homeroom_' + cls, clean(settings.homeroom[cls])]));
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sheet = leaveSettingsSheet(SpreadsheetApp.openById(SPREADSHEET_ID));
    sheet.getRange(2, 1, rows.length, 2).setValues(rows);
  } finally { lock.releaseLock(); }
  return response({ success: true, message: 'บันทึกตั้งค่าแล้ว' });
}

function deputyPinError(pin) {
  const sheet = SpreadsheetApp.openById(SPREADSHEET_ID).getSheetByName('config');
  const rows = sheet ? sheet.getDataRange().getDisplayValues() : [];
  const entry = rows.slice(1).find(r => String(r[0]).trim() === 'deputy_pin');
  const expected = entry ? String(entry[1]).trim() : '';
  if (!expected) return 'ยังไม่ได้กำหนดรหัสอนุมัติในชีท config (key: deputy_pin)';
  return String(pin == null ? '' : pin).trim() === expected ? '' : 'รหัสอนุมัติไม่ถูกต้อง';
}

function leaveSheet(ss) {
  let sheet = ss.getSheetByName('ใบขอออกนอกบริเวณ');
  if (!sheet) {
    sheet = ss.insertSheet('ใบขอออกนอกบริเวณ');
  }
  if (sheet.getMaxColumns() < LEAVE_HEADERS.length)
    sheet.insertColumnsAfter(sheet.getMaxColumns(), LEAVE_HEADERS.length - sheet.getMaxColumns());
  if (sheet.getLastRow() < 1) {
    sheet.getRange(1, 1, 1, LEAVE_HEADERS.length).setValues([LEAVE_HEADERS]);
    sheet.getRange(1, 1, 1, LEAVE_HEADERS.length).setBackground('#2563EB').setFontColor('#FFFFFF').setFontWeight('bold');
    sheet.setFrozenRows(1);
    sheet.getRange('H:H').setNumberFormat('@');
  } else {
    // เพิ่มคอลัมน์ท้ายชีทโดยคงใบขอเดิมและผลอนุมัติเดิมไว้
    const start = LEAVE_HEADERS.length - 2;
    const range = sheet.getRange(1, start, 1, 3);
    const existing = range.getDisplayValues()[0];
    const expected = LEAVE_HEADERS.slice(start - 1);
    if (existing.some((value, i) => value && value !== expected[i]))
      throw new Error('คอลัมน์ท้ายชีท ใบขอออกนอกบริเวณ ถูกใช้งานอยู่');
    range.setValues([expected]).setBackground('#2563EB').setFontColor('#FFFFFF').setFontWeight('bold');
  }
  return sheet;
}

function readLeaveRows(sheet) {
  return sheet.getLastRow() > 1
    ? sheet.getRange(2, 1, sheet.getLastRow() - 1, LEAVE_HEADERS.length).getDisplayValues() : [];
}

function leaveRowObject(r) {
  return { id:r[0], groupId:r[1], date:r[3], student:{ cls:r[4], room:r[5], number:r[6], code:r[7], prefix:r[8], firstName:r[9], lastName:r[10] },
    outTime:r[11], returnTime:r[12], reason:r[13], destination:r[14], affairsTeacher:r[15], homeroomTeacher:r[16], deputyName:r[17],
    guardianName:r[18], parentPickup:r[19] === 'ใช่', status:r[20], decidedAt:r[21], decidedBy:r[22], decisionNote:r[23], createdAt:r[24], recorder:r[25],
    advisorOpinion:r[26] || '', affairsOpinion:r[27] || '', noReturn:r[28] === 'ใช่' };
}

function validLeaveToken(token) { return typeof token === 'string' && /^[a-f0-9-]{36}$/i.test(token); }

function createLeaveBatch(requests, pin) {
  const error = pickerPinError(pin);
  if (error) return response({ success: false, message: error });
  if (!Array.isArray(requests) || !requests.length || requests.length > 100)
    return response({ success: false, message: 'เลือกนักเรียน 1–100 คน' });
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const settings = readLeaveSettings(ss);
  if (!settings.deputyName || !settings.affairsTeachers.length)
    return response({ success: false, message: 'กรุณาตั้งชื่อรองผู้อำนวยการและครูฝ่ายกิจการก่อน' });
  const text = (value, max) => String(value == null ? '' : value).trim().slice(0, max || 120);
  const cell = (value, max) => { const s = text(value, max); return /^[=+\-@]/.test(s) ? "'" + s : s; };
  const groupId = Utilities.getUuid();
  const token = Utilities.getUuid();
  const now = new Date().toISOString();
  const rows = [];
  const seen = new Set();
  for (const request of requests) {
    const student = request && request.student;
    if (!student || !LEAVE_CLASSES.includes(student.cls) || !text(student.firstName) ||
        !/^\d{4}-\d{2}-\d{2}$/.test(request.date || '') ||
        !/^\d{2}:\d{2}$/.test(request.outTime || '') || (!request.noReturn && !/^\d{2}:\d{2}$/.test(request.returnTime || '')) ||
        !text(request.reason) || !text(request.destination))
      return response({ success: false, message: 'กรอกวันที่ เวลา ธุระ และสถานที่ของนักเรียนทุกคนให้ครบ' });
    if (!['อนุญาต','ไม่อนุญาต'].includes(request.advisorOpinion) || !['อนุญาต','ไม่อนุญาต'].includes(request.affairsOpinion))
      return response({ success: false, message: 'เลือกความเห็นครูที่ปรึกษาและครูฝ่ายกิจการให้ครบทุกคน' });
    if (!settings.affairsTeachers.includes(request.affairsTeacher))
      return response({ success: false, message: 'เลือกครูฝ่ายกิจการจากหน้าตั้งค่า' });
    const identity = [student.cls, student.code, student.firstName, student.lastName].join('|');
    if (seen.has(identity)) return response({ success: false, message: 'มีนักเรียนซ้ำในชุดคำขอ' });
    seen.add(identity);
    rows.push([Utilities.getUuid(), groupId, token, request.date, cell(student.cls), cell(student.room), cell(student.number, 20),
      text(student.code, 30), cell(student.prefix), cell(student.firstName), cell(student.lastName), request.outTime, request.noReturn ? '' : request.returnTime,
      cell(request.reason, 500), cell(request.destination, 300), cell(request.affairsTeacher),
      cell(settings.homeroom[student.cls] || ''), cell(settings.deputyName), cell(request.guardianName), request.parentPickup ? 'ใช่' : 'ไม่ใช่',
      'รอพิจารณา', '', '', '', now, cell(request.affairsTeacher), request.advisorOpinion, request.affairsOpinion, request.noReturn ? 'ใช่' : 'ไม่ใช่']);
  }
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sheet = leaveSheet(ss);
    sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, LEAVE_HEADERS.length).setValues(rows);
  } finally { lock.releaseLock(); }
  return response({ success: true, groupId, token, count: rows.length, message: 'บันทึกคำขอแล้ว' });
}

function getLeaveRequests(pin) {
  const error = pickerPinError(pin);
  if (error) return response({ success: false, message: error });
  const sheet = leaveSheet(SpreadsheetApp.openById(SPREADSHEET_ID));
  const rows = readLeaveRows(sheet);
  return response({ success: true, requests: rows.map(r => ({ ...leaveRowObject(r), token:r[2] })).reverse() });
}

function getLeaveApproval(token, deputyPin) {
  const error = deputyPinError(deputyPin);
  if (error) return response({ success: false, message: error });
  if (!validLeaveToken(token)) return response({ success: false, message: 'ลิงก์คำขอไม่ถูกต้อง' });
  const rows = readLeaveRows(leaveSheet(SpreadsheetApp.openById(SPREADSHEET_ID))).filter(r => r[2] === token);
  if (!rows.length) return response({ success: false, message: 'ไม่พบชุดคำขอนี้' });
  return response({ success: true, requests: rows.map(leaveRowObject) });
}

function decideLeaveApproval(token, decisions, deputyPin) {
  const error = deputyPinError(deputyPin);
  if (error) return response({ success: false, message: error });
  if (!validLeaveToken(token) || !Array.isArray(decisions) || !decisions.length || decisions.length > 100)
    return response({ success: false, message: 'ข้อมูลการพิจารณาไม่ถูกต้อง' });
  const seen = new Set();
  for (const decision of decisions) {
    if (!decision || !validLeaveToken(decision.id) || !['อนุมัติ','ไม่อนุมัติ'].includes(decision.status) || seen.has(decision.id))
      return response({ success: false, message: 'ข้อมูลการพิจารณาไม่ถูกต้อง' });
    seen.add(decision.id);
  }
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const sheet = leaveSheet(SpreadsheetApp.openById(SPREADSHEET_ID));
    const rows = readLeaveRows(sheet);
    const targets = decisions.map(decision => {
      const index = rows.findIndex(r => r[0] === decision.id && r[2] === token);
      if (index < 0) return { error: 'ไม่พบคำขอในลิงก์นี้' };
      if (rows[index][20] !== 'รอพิจารณา') return { error: 'คำขอนี้ถูกพิจารณาแล้ว' };
      return { rowNumber: index + 2, decision, deputyName: rows[index][17] };
    });
    const invalid = targets.find(target => target.error);
    if (invalid) return response({ success: false, message: invalid.error });
    const now = new Date().toISOString();
    targets.forEach(target => {
      const note = String(target.decision.note || '').trim().slice(0, 300);
      const safeNote = /^[=+\-@]/.test(note) ? "'" + note : note;
      sheet.getRange(target.rowNumber, 21, 1, 4).setValues([[target.decision.status, now, target.deputyName, safeNote]]);
    });
    return response({ success: true, message: 'บันทึกผลการพิจารณาแล้ว' });
  } finally { lock.releaseLock(); }
}

// ── อ่าน config จากชีท "config" ──────────────────────────
function readConfig(ss) {
  let sheet = ss.getSheetByName('config');
  if (!sheet) {
    // สร้างชีท config พร้อมค่าเริ่มต้นถ้ายังไม่มี
    sheet = ss.insertSheet('config', 0);
    sheet.getRange('A1:B1').setValues([['key', 'value']]);
    sheet.getRange('A2:B4').setValues([
      ['school_name',  'โรงเรียนบ้านคลอง 14'],
      ['admin_pin',    '9999'],
      ['school_year',  '2569']
    ]);
    // จัดรูปแบบ header
    sheet.getRange('A1:B1').setBackground('#4472C4').setFontColor('#FFFFFF').setFontWeight('bold');
    sheet.setColumnWidth(1, 150);
    sheet.setColumnWidth(2, 250);
    sheet.setFrozenRows(1);
  }
  const rows = sheet.getDataRange().getValues();
  const cfg  = {};
  rows.slice(1).forEach(r => {
    const key = String(r[0] || '').trim();
    if (key && key !== 'picker_pin' && key !== 'deputy_pin') cfg[key] = String(r[1] || '');
  });
  return cfg;
}

// ── บันทึก config ─────────────────────────────────────────
function saveConfig(config) {
  if (!config || typeof config !== 'object') return response({ success: false, message: 'ข้อมูล config ไม่ถูกต้อง' });
  const ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
  let sheet   = ss.getSheetByName('config');
  if (!sheet) { readConfig(ss); sheet = ss.getSheetByName('config'); }
  const rows  = sheet.getDataRange().getValues();
  rows.slice(1).forEach((r, i) => {
    if (!['picker_pin', 'deputy_pin'].includes(String(r[0]).trim()) && Object.prototype.hasOwnProperty.call(config, r[0])) {
      sheet.getRange(i + 2, 2).setValue(config[r[0]]);
    }
  });
  return response({ success: true, message: 'บันทึก config เรียบร้อย' });
}

// ── บันทึกนักเรียนลง Sheets ──────────────────────────────
function saveStudents(students) {
  const ss         = SpreadsheetApp.openById(SPREADSHEET_ID);
  const classOrder = ['อ.2','อ.3','ป.1','ป.2','ป.3','ป.4','ป.5','ป.6','ม.1','ม.2','ม.3'];

  // จัดกลุ่มตามชั้น
  const byClass = {};
  students.forEach(s => {
    const cls = s['ชั้น'] || 'อื่นๆ';
    if (!byClass[cls]) byClass[cls] = [];
    byClass[cls].push(s);
  });

  let totalCount = 0;

  classOrder.forEach(cls => {
    if (!byClass[cls]) return;

    let sheet = ss.getSheetByName(cls);
    if (!sheet) sheet = ss.insertSheet(cls);
    else sheet.clearContents();

    const headers = ['เลขที่','รหัส 4 หลัก','เลขบัตรประชาชน','คำนำหน้า','ชื่อ','นามสกุล','เพศ','วันเกิด','ชั้น','ห้อง'];

    // เรียงชายก่อน → หญิง → ตามตัวอักษรชื่อ
    const sorted = [...byClass[cls]].sort((a, b) => {
      if (a['เพศ'] !== b['เพศ']) return a['เพศ'] === 'ช' ? -1 : 1;
      return (a['ชื่อ'] || '').localeCompare(b['ชื่อ'] || '', 'th');
    });

    // สร้าง rows ทั้งหมดก่อน (ใส่ ' นำหน้า id เพื่อบังคับ text)
    const dataRows = sorted.map((s, i) => {
      const id13 = String(s['บัตรประชาชน'] || '');
      const id4  = String(s['รหัสนักเรียน'] || '').padStart(4, '0');
      return [
        i + 1, id4, id13,
        s['คำนำหน้าชื่อ'] || '',
        s['ชื่อ'] || '',
        s['นามสกุล'] || '',
        s['เพศ'] === 'ช' ? 'ชาย' : 'หญิง',
        s['วันเกิด'] || '',
        s['ชั้น'] || '',
        s['ห้อง'] || ''
      ];
    });

    // กำหนด format ทั้งชีทก่อนเขียนข้อมูล (สำคัญ: ต้องทำก่อน setValues)
    sheet.getRange(1, 2, dataRows.length + 1, 1).setNumberFormat('@');  // col B รหัส 4 หลัก
    sheet.getRange(1, 3, dataRows.length + 1, 1).setNumberFormat('@');  // col C บัตรประชาชน

    // เขียน header + data พร้อมกันทีเดียว
    const allRows = [headers, ...dataRows];
    sheet.getRange(1, 1, allRows.length, headers.length).setValues(allRows);

    totalCount += sorted.length;

    // จัดรูปแบบ header
    const hRange = sheet.getRange(1, 1, 1, headers.length);
    hRange.setBackground('#4472C4').setFontColor('#FFFFFF').setFontWeight('bold');
    sheet.setFrozenRows(1);
    [55, 80, 145, 90, 120, 150, 55, 100, 60, 55].forEach((w, i) => sheet.setColumnWidth(i+1, w));
  });

  // อัปเดตชีท "ข้อมูลรวม"
  let sum = ss.getSheetByName('ข้อมูลรวม');
  if (!sum) sum = ss.insertSheet('ข้อมูลรวม', 1);
  else sum.clearContents();
  sum.appendRow(['ชั้น','จำนวน','ชาย','หญิง','อัปเดตล่าสุด']);
  classOrder.forEach(cls => {
    if (!byClass[cls]) return;
    const all = byClass[cls];
    const m   = all.filter(s => s['เพศ'] === 'ช').length;
    sum.appendRow([cls, all.length, m, all.length - m, new Date().toLocaleString('th-TH')]);
  });
  const sHdr = sum.getRange(1, 1, 1, 5);
  sHdr.setBackground('#4472C4').setFontColor('#FFFFFF').setFontWeight('bold');
  sum.setFrozenRows(1);

  // บันทึกข้อมูลดิบ
  saveRawData(ss, students);

  // สร้างชีท "เพิ่มเติม" ถ้ายังไม่มี (ไม่ยุ่งถ้ามีอยู่แล้ว)
  ensureExtraSheet(ss);

  return response({ success: true, count: totalCount, message: `บันทึกข้อมูล ${totalCount} คน เรียบร้อยแล้ว` });
}

// ── ดึงรายการนักเรียนจากชีท "เพิ่มเติม" (พร้อม rowIndex) ──
function readExtraStudents(ss) {
  const sheet = ss.getSheetByName('เพิ่มเติม');
  if (!sheet) return [];
  const rows = sheet.getDataRange().getValues();
  if (rows.length < 2) return [];
  const headers = rows[0];
  return rows.slice(1).map((row, i) => {
    if (!row[3] && !row[4]) return null; // แถวว่าง
    const obj = { _rowIndex: i + 2 }; // rowIndex จริงใน sheet (1-based, บวก header)
    headers.forEach((h, j) => { obj[h] = String(row[j] || ''); });
    return obj;
  }).filter(Boolean);
}

// ── ลบนักเรียนออกจากชีท "เพิ่มเติม" ──────────────────────
function deleteExtraStudent(rowIndex) {
  const ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
  const sheet = ss.getSheetByName('เพิ่มเติม');
  if (!sheet) return response({ success: false, message: 'ไม่พบชีทเพิ่มเติม' });
  if (!rowIndex || rowIndex < 2) return response({ success: false, message: 'rowIndex ไม่ถูกต้อง' });

  const name = sheet.getRange(rowIndex, 4).getValue() + ' ' + sheet.getRange(rowIndex, 5).getValue();
  sheet.deleteRow(rowIndex);
  return response({ success: true, message: 'ลบ ' + name.trim() + ' สำเร็จ' });
}

// ── เพิ่มนักเรียนลงชีท "เพิ่มเติม" ──────────────────────────
function addExtraStudent(student) {
  const ss    = SpreadsheetApp.openById(SPREADSHEET_ID);
  let sheet   = ss.getSheetByName('เพิ่มเติม');

  if (!sheet) {
    ensureExtraSheet(ss);
    sheet = ss.getSheetByName('เพิ่มเติม');
  }

  // หาเลขที่ถัดไป
  const lastRow = sheet.getLastRow();
  const nextNo  = lastRow > 1 ? lastRow : 1;

  const id13 = String(student['บัตรประชาชน'] || '');
  const id4  = String(student['รหัสนักเรียน'] || '').padStart(4, '0');

  // set format text ก่อนเขียน
  const newRow = lastRow + 1;
  sheet.getRange(newRow, 2).setNumberFormat('@');
  sheet.getRange(newRow, 3).setNumberFormat('@');

  sheet.appendRow([
    nextNo, id4, id13,
    student['คำนำหน้าชื่อ'] || '',
    student['ชื่อ']          || '',
    student['นามสกุล']       || '',
    student['เพศ'] === 'ช' ? 'ชาย' : 'หญิง',
    student['วันเกิด']       || '',
    student['ชั้น']          || '',
    student['ห้อง']          || '1',
    student['หมายเหตุ']      || 'เพิ่มเอง'
  ]);

  const addedRow = sheet.getLastRow(); // rowIndex ที่เพิ่งเพิ่ม
  return response({ success: true, rowIndex: addedRow, message: 'เพิ่มนักเรียน ' + (student['ชื่อ']||'') + ' ' + (student['นามสกุล']||'') + ' สำเร็จ' });
}

// ── บันทึกข้อมูลดิบลงชีท "ข้อมูลดิบ" (ต่อท้าย ไม่ล้างของเก่า) ──
function saveRawData(ss, students) {
  let sheet = ss.getSheetByName('ข้อมูลดิบ');
  const isNew = !sheet;

  if (isNew) {
    sheet = ss.insertSheet('ข้อมูลดิบ');
  }

  const headers = [
    'รอบที่', 'วันที่อัปโหลด', 'บัตรประชาชน', 'ชั้น', 'ห้อง',
    'รหัสนักเรียน', 'เพศ', 'คำนำหน้าชื่อ', 'ชื่อ', 'นามสกุล', 'วันเกิด'
  ];

  // หา "รอบที่" ล่าสุดจากข้อมูลเดิม
  let round = 1;
  if (!isNew) {
    const lastRow = sheet.getLastRow();
    if (lastRow > 1) {
      const lastRound = sheet.getRange(lastRow, 1).getValue();
      round = (parseInt(lastRound) || 0) + 1;
    }
  }

  const uploadTime = new Date().toLocaleString('th-TH');
  const dataRows   = students.map(s => [
    round,
    uploadTime,
    String(s['บัตรประชาชน']  || ''),
    String(s['ชั้น']          || ''),
    String(s['ห้อง']          || ''),
    String(s['รหัสนักเรียน'] || '').padStart(4, '0'),
    s['เพศ'] === 'ช' ? 'ชาย' : 'หญิง',
    String(s['คำนำหน้าชื่อ'] || ''),
    String(s['ชื่อ']          || ''),
    String(s['นามสกุล']      || ''),
    String(s['วันเกิด']      || '')
  ]);

  if (isNew) {
    // ชีทใหม่ — เขียน header + data
    sheet.getRange(1, 3, dataRows.length + 1, 1).setNumberFormat('@');  // col C บัตรประชาชน
    sheet.getRange(1, 6, dataRows.length + 1, 1).setNumberFormat('@');  // col F รหัสนักเรียน
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.getRange(2, 1, dataRows.length, headers.length).setValues(dataRows);

    // จัดรูปแบบ header
    const hRange = sheet.getRange(1, 1, 1, headers.length);
    hRange.setBackground('#1F4E79').setFontColor('#FFFFFF').setFontWeight('bold');
    sheet.setFrozenRows(1);
    [45, 130, 145, 55, 50, 80, 55, 90, 120, 150, 100].forEach((w, i) => {
      sheet.setColumnWidth(i + 1, w);
    });
  } else {
    // ชีทเดิม — ต่อท้ายเท่านั้น ไม่แตะ header
    const startRow = sheet.getLastRow() + 1;

    // กำหนด format text สำหรับ col C และ F ก่อนเขียน
    sheet.getRange(startRow, 3, dataRows.length, 1).setNumberFormat('@');
    sheet.getRange(startRow, 6, dataRows.length, 1).setNumberFormat('@');
    sheet.getRange(startRow, 1, dataRows.length, headers.length).setValues(dataRows);
  }

  // อัปเดต filter ให้ครอบทุกแถว
  try { sheet.getFilter().remove(); } catch(e) {}
  sheet.getRange(1, 1, sheet.getLastRow(), headers.length).createFilter();
}

// ── อ่านนักเรียนจากชีททุกชั้น ────────────────────────────
function readStudents(ss) {
  const classOrder = ['อ.2','อ.3','ป.1','ป.2','ป.3','ป.4','ป.5','ป.6','ม.1','ม.2','ม.3'];
  const result     = {};

  // อ่านข้อมูลจากชีทแต่ละชั้นปกติ
  classOrder.forEach(cls => {
    const sheet = ss.getSheetByName(cls);
    if (!sheet) return;
    const rows = sheet.getDataRange().getValues();
    if (rows.length < 2) return;
    const headers = rows[0];
    result[cls] = rows.slice(1).map(row => {
      const obj = {};
      headers.forEach((h, i) => { obj[h] = String(row[i] || ''); });
      return obj;
    });
  });

  // รวมชีท "เพิ่มเติม" — นักเรียนที่เพิ่มนอกเหนือจากข้อมูลดิบ
  const extraSheet = ss.getSheetByName('เพิ่มเติม');
  if (extraSheet) {
    const rows = extraSheet.getDataRange().getValues();
    if (rows.length >= 2) {
      const headers = rows[0];
      rows.slice(1).forEach(row => {
        // ข้ามแถวว่าง
        if (!row[0] && !row[3] && !row[4]) return;
        const obj = {};
        headers.forEach((h, i) => { obj[h] = String(row[i] || ''); });
        const cls = obj['ชั้น'] || '';
        if (!cls) return;
        if (!result[cls]) result[cls] = [];
        result[cls].push(obj);
      });
    }
  }

  return result;
}

// ── สร้างชีท "เพิ่มเติม" พร้อม template ถ้ายังไม่มี ──────
function ensureExtraSheet(ss) {
  if (ss.getSheetByName('เพิ่มเติม')) return;

  const sheet = ss.insertSheet('เพิ่มเติม');
  const headers = ['เลขที่','รหัส 4 หลัก','เลขบัตรประชาชน','คำนำหน้า','ชื่อ','นามสกุล','เพศ','วันเกิด','ชั้น','ห้อง','หมายเหตุ'];
  sheet.appendRow(headers);

  // ตัวอย่าง 1 แถว (สีอ่อน)
  sheet.appendRow(['','','','เด็กชาย','ชื่อ','นามสกุล','ชาย','','ป.1','1','เพิ่มเอง']);

  // จัดรูปแบบ header
  const hRange = sheet.getRange(1, 1, 1, headers.length);
  hRange.setBackground('#7B3F00').setFontColor('#FFFFFF').setFontWeight('bold');
  sheet.setFrozenRows(1);

  // กำหนด col บัตรประชาชน (C) และ รหัส (B) เป็น text
  sheet.getRange('B:C').setNumberFormat('@');

  // ปรับความกว้าง
  [50, 80, 145, 90, 120, 150, 55, 100, 55, 50, 120].forEach((w, i) => {
    sheet.setColumnWidth(i + 1, w);
  });

  // สีแถวตัวอย่าง
  sheet.getRange(2, 1, 1, headers.length).setBackground('#FFF3E0').setFontColor('#999999');

  // เพิ่ม note อธิบาย
  sheet.getRange('A1').setNote('ชีทนี้ใช้เพิ่มนักเรียนที่ไม่มีในไฟล์ข้อมูลดิบ\nข้อมูลในชีทนี้จะไม่ถูกลบเมื่ออัปโหลดไฟล์ใหม่\nลบแถวตัวอย่าง (แถว 2) ออกก่อนเพิ่มข้อมูลจริง');
}

// ── Helper ────────────────────────────────────────────────
function response(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
