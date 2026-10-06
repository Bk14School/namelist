// ใบขออนุญาตออกนอกบริเวณโรงเรียน
let leaveSettings = { deputyName: '', affairsTeachers: [], homeroom: {} };
let leaveSettingsLoaded = false;
let leaveDrafts = new Map();
let leaveRequests = [];
let approvalPin = '';
let approvalRequests = [];
const approvalToken = new URLSearchParams(location.search).get('leaveApproval') || '';
const LEAVE_SCHOOL = 'โรงเรียนบ้านคลอง 14 สพป.นครนายก';

function leaveEscape(value) {
  return String(value == null ? '' : value).replace(/[&<>"']/g, character =>
    ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[character]);
}

function leaveName(student) {
  return `${student.prefix || ''}${student.firstName || ''} ${student.lastName || ''}`.trim();
}

function leaveStudent(index) {
  const s = allData[index];
  return { cls: s['ชั้น'] || '', room: s['ห้อง'] || '', number: s['เลขที่'] || '',
    code: s['รหัสนักเรียน'] || '', prefix: s['คำนำหน้าชื่อ'] || '', firstName: s['ชื่อ'] || '', lastName: s['นามสกุล'] || '' };
}

function leaveOrder(a, b) {
  const rank = cls => { const value = classOrder.indexOf(cls); return value < 0 ? classOrder.length : value; };
  const difference = rank(a.student.cls) - rank(b.student.cls);
  return difference || Number(a.student.number || 0) - Number(b.student.number || 0) || leaveName(a.student).localeCompare(leaveName(b.student), 'th');
}

async function showPickerTab(tab) {
  ['records', 'leave', 'settings'].forEach(name => {
    document.getElementById(name + 'Tab').classList.toggle('active', name === tab);
    document.getElementById(name + 'TabButton').classList.toggle('active', name === tab);
  });
  if (tab === 'leave' || tab === 'settings') {
    if (!leaveSettingsLoaded) await loadLeaveFormSettings();
    if (tab === 'leave') {
      if (!document.getElementById('leaveDefaultDate').value)
        document.getElementById('leaveDefaultDate').value = new Date().toLocaleDateString('sv-SE');
      syncLeaveDrafts();
      renderLeaveDrafts();
    }
  }
}

function renderLeaveSettings() {
  document.getElementById('leaveDeputyName').value = leaveSettings.deputyName || '';
  document.getElementById('leaveAffairsNames').value = (leaveSettings.affairsTeachers || []).join('\n');
  const holder = document.getElementById('leaveHomeroomSettings');
  holder.replaceChildren();
  classOrder.forEach(cls => {
    const label = document.createElement('label');
    label.textContent = 'ครูประจำชั้น ' + cls;
    const input = document.createElement('input');
    input.type = 'text'; input.maxLength = 120; input.dataset.cls = cls;
    input.value = (leaveSettings.homeroom || {})[cls] || '';
    label.append(input); holder.append(label);
  });
  const select = document.getElementById('leaveDefaultAffairs');
  const current = select.value;
  select.replaceChildren(new Option('เลือกครูฝ่ายกิจการ', ''));
  (leaveSettings.affairsTeachers || []).forEach(name => select.add(new Option(name, name)));
  if ((leaveSettings.affairsTeachers || []).includes(current)) select.value = current;
  else if (leaveSettings.affairsTeachers.length === 1) select.value = leaveSettings.affairsTeachers[0];
}

async function loadLeaveFormSettings() {
  if (!pickerPin) return;
  try {
    const result = await bridgeRequest({ action: 'getLeaveSettings', pin: pickerPin });
    if (!result.success) throw new Error(result.message || 'โหลดการตั้งค่าไม่สำเร็จ');
    leaveSettings = result.settings;
    leaveSettingsLoaded = true;
    renderLeaveSettings();
  } catch (error) { toast(error.message || 'โหลดการตั้งค่าไม่สำเร็จ', 'err'); }
}

async function saveLeaveFormSettings() {
  if (!pickerPin) return toast('กรุณาเข้าด้วยรหัสเลือกนักเรียนอีกครั้ง', 'err');
  const settings = {
    deputyName: document.getElementById('leaveDeputyName').value.trim(),
    affairsTeachers: document.getElementById('leaveAffairsNames').value.split(/\r?\n/).map(x => x.trim()).filter(Boolean),
    homeroom: {}
  };
  document.querySelectorAll('#leaveHomeroomSettings input[data-cls]').forEach(input =>
    settings.homeroom[input.dataset.cls] = input.value.trim());
  const button = document.getElementById('leaveSettingsSaveBtn');
  button.disabled = true;
  try {
    const result = await bridgeRequest({ action: 'saveLeaveSettings', settings, pin: pickerPin });
    if (!result.success) throw new Error(result.message || 'บันทึกการตั้งค่าไม่สำเร็จ');
    leaveSettings = settings;
    leaveSettingsLoaded = true;
    renderLeaveSettings();
    toast('บันทึกการตั้งค่าแล้ว');
  } catch (error) { toast(error.message || 'บันทึกการตั้งค่าไม่สำเร็จ', 'err'); }
  finally { button.disabled = false; }
}

function leaveCommon() {
  const noReturn = document.getElementById('leaveDefaultNoReturn').checked;
  return {
    date: document.getElementById('leaveDefaultDate').value,
    affairsTeacher: document.getElementById('leaveDefaultAffairs').value,
    outTime: document.getElementById('leaveDefaultOut').value,
    returnTime: noReturn ? '' : document.getElementById('leaveDefaultReturn').value,
    noReturn,
    advisorOpinion: document.getElementById('leaveDefaultAdvisorOpinion').value,
    affairsOpinion: document.getElementById('leaveDefaultAffairsOpinion').value,
    reason: document.getElementById('leaveDefaultReason').value.trim(),
    destination: document.getElementById('leaveDefaultDestination').value.trim()
  };
}

function toggleLeaveDefaultReturn() {
  const noReturn = document.getElementById('leaveDefaultNoReturn').checked;
  const input = document.getElementById('leaveDefaultReturn');
  input.disabled = noReturn;
  if (noReturn) input.value = '';
}

function syncLeaveDrafts() {
  const selected = new Set(pickedStudents);
  [...leaveDrafts.keys()].forEach(index => { if (!selected.has(index)) leaveDrafts.delete(index); });
  [...selected].forEach(index => {
    if (allData[index] && !leaveDrafts.has(index))
      leaveDrafts.set(index, { student: leaveStudent(index), ...leaveCommon(), guardianName: '', parentPickup: false });
  });
}

function applyLeaveDefaults() {
  syncLeaveDrafts();
  if (!leaveDrafts.size) return toast('กรุณาเลือกนักเรียนก่อน', 'err');
  const common = leaveCommon();
  leaveDrafts.forEach(draft => Object.assign(draft, common));
  renderLeaveDrafts();
  toast('ใส่ข้อมูลร่วมให้ทุกคนแล้ว');
}

function updateLeaveDraft(index, field, element) {
  const draft = leaveDrafts.get(index);
  if (!draft) return;
  draft[field] = field === 'parentPickup' || field === 'noReturn' ? element.checked : element.value;
  if (field === 'noReturn') {
    if (draft.noReturn) draft.returnTime = '';
    renderLeaveDrafts();
  }
}

function renderLeaveDrafts() {
  const holder = document.getElementById('leaveDrafts');
  holder.replaceChildren();
  document.getElementById('leaveSelectedCount').textContent = `เลือก ${leaveDrafts.size} คน · ใบขอ 1 ใบต่อคน`;
  if (!leaveDrafts.size) {
    holder.textContent = 'ยังไม่ได้เลือกนักเรียน กลับไปแท็บเลือกนักเรียนเพื่อเลือกรายชื่อ';
    return;
  }
  const indices = [...leaveDrafts.keys()].sort((a, b) => {
    const x = classOrder.indexOf(leaveDrafts.get(a).student.cls);
    const y = classOrder.indexOf(leaveDrafts.get(b).student.cls);
    return x - y || a - b;
  });
  const fields = [
    ['date', 'วันที่', 'date'], ['affairsTeacher', 'ครูฝ่ายกิจการนักเรียน', 'select'],
    ['outTime', 'เวลาออก', 'time'], ['returnTime', 'เวลากลับ', 'time'],
    ['advisorOpinion', 'ความเห็นครูที่ปรึกษา', 'opinion'], ['affairsOpinion', 'ความเห็นครูฝ่ายกิจการ', 'opinion'],
    ['reason', 'ธุระ', 'textarea'], ['destination', 'สถานที่ติดต่อ', 'text'],
    ['guardianName', 'ชื่อผู้ปกครอง (ถ้ามารับ)', 'text']
  ];
  indices.forEach((index, position) => {
    const draft = leaveDrafts.get(index);
    const card = document.createElement('div'); card.className = 'leave-card';
    const title = document.createElement('h3');
    title.textContent = `${position + 1}. ${leaveName(draft.student)} · ${draft.student.cls}${draft.student.room ? '/' + draft.student.room : ''} เลขที่ ${draft.student.number || '–'}`;
    card.append(title);
    const grid = document.createElement('div'); grid.className = 'leave-grid';
    fields.forEach(([field, labelText, kind]) => {
      const label = document.createElement('label'); label.textContent = labelText;
      if (field === 'reason' || field === 'destination') label.classList.add('wide');
      let input;
      if (kind === 'select') {
        input = document.createElement('select'); input.add(new Option('เลือกครู', ''));
        (leaveSettings.affairsTeachers || []).forEach(name => input.add(new Option(name, name)));
      } else if (kind === 'opinion') {
        input = document.createElement('select');
        input.add(new Option('เลือกผลพิจารณา', ''));
        input.add(new Option('เห็นควรอนุญาต', 'อนุญาต'));
        input.add(new Option('เห็นควรไม่อนุญาต', 'ไม่อนุญาต'));
      } else if (kind === 'textarea') {
        input = document.createElement('textarea'); input.rows = 2; input.maxLength = 500;
      } else {
        input = document.createElement('input'); input.type = kind;
        if (field === 'destination') input.maxLength = 300;
        if (field === 'guardianName') input.maxLength = 120;
      }
      input.value = draft[field] || '';
      if (field === 'returnTime') input.disabled = !!draft.noReturn;
      input.addEventListener('input', () => updateLeaveDraft(index, field, input));
      label.append(input); grid.append(label);
    });
    const noReturn = document.createElement('label');
    noReturn.style.cssText = 'display:flex;align-items:center;gap:7px;margin-top:12px';
    const noReturnBox = document.createElement('input'); noReturnBox.type = 'checkbox'; noReturnBox.checked = !!draft.noReturn;
    noReturnBox.style.width = 'auto';
    noReturnBox.addEventListener('change', () => updateLeaveDraft(index, 'noReturn', noReturnBox));
    noReturn.append(noReturnBox, document.createTextNode('ไม่กลับเข้ามาในโรงเรียนในวันนั้น'));
    const pickup = document.createElement('label');
    pickup.style.cssText = 'display:flex;align-items:center;gap:7px;margin-top:12px';
    const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.checked = !!draft.parentPickup;
    checkbox.style.width = 'auto';
    checkbox.addEventListener('change', () => updateLeaveDraft(index, 'parentPickup', checkbox));
    pickup.append(checkbox, document.createTextNode('ผู้ปกครองมารับนักเรียนด้วยตนเอง'));
    card.append(grid, noReturn, pickup); holder.append(card);
  });
}

async function createLeaveRequests() {
  if (!pickerPin) return toast('กรุณาเข้าด้วยรหัสเลือกนักเรียนอีกครั้ง', 'err');
  syncLeaveDrafts();
  const requests = [...leaveDrafts.values()].sort(leaveOrder);
  if (!requests.length) return toast('กรุณาเลือกนักเรียนก่อน', 'err');
  const missing = requests.find(d => !d.date || !d.outTime || (!d.noReturn && !d.returnTime) || !d.reason.trim() || !d.destination.trim() || !d.affairsTeacher || !d.advisorOpinion || !d.affairsOpinion);
  if (missing) return toast(`กรอกข้อมูลของ ${leaveName(missing.student)} ให้ครบ`, 'err');
  const button = document.getElementById('leaveCreateBtn'); button.disabled = true;
  try {
    const result = await bridgeRequest({ action: 'createLeaveBatch', requests, pin: pickerPin });
    if (!result.success) throw new Error(result.message || 'บันทึกคำขอไม่สำเร็จ');
    toast(`บันทึก ${result.count} ใบแล้ว`);
    pickedStudents.clear();
    leaveDrafts.clear();
    renderPickerStudents();
    renderPicked();
    renderLeaveDrafts();
    await loadLeaveHistory();
    document.getElementById('leaveHistory').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  } catch (error) { toast(error.message || 'บันทึกคำขอไม่สำเร็จ', 'err'); }
  finally { button.disabled = false; }
}

async function loadLeaveHistory() {
  if (!pickerPin) return toast('กรุณาเข้าด้วยรหัสเลือกนักเรียนอีกครั้ง', 'err');
  const holder = document.getElementById('leaveHistory'); holder.textContent = 'กำลังโหลด...';
  try {
    const result = await bridgeRequest({ action: 'getLeaveRequests', pin: pickerPin });
    if (!result.success) throw new Error(result.message || 'โหลดรายการไม่สำเร็จ');
    leaveRequests = result.requests || [];
    renderLeaveHistory();
  } catch (error) { holder.textContent = error.message || 'โหลดรายการไม่สำเร็จ'; }
}

function approvalLink(token) {
  return `${location.origin}${location.pathname}?leaveApproval=${encodeURIComponent(token)}`;
}

function shareLeaveGroup(token, count) {
  const url = approvalLink(token);
  const text = `มีใบขออนุญาตออกนอกบริเวณโรงเรียน ${count} รายการ กรุณาพิจารณาผ่านลิงก์`;
  window.open(`https://social-plugins.line.me/lineit/share?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`, '_blank', 'noopener,noreferrer');
}

async function copyLeaveLink(token) {
  try { await navigator.clipboard.writeText(approvalLink(token)); toast('คัดลอกลิงก์แล้ว'); }
  catch (_) { toast('คัดลอกลิงก์ไม่สำเร็จ', 'err'); }
}

function renderLeaveHistory() {
  const holder = document.getElementById('leaveHistory'); holder.replaceChildren();
  if (!leaveRequests.length) { holder.textContent = 'ยังไม่มีใบขออนุญาต'; return; }
  const groups = new Map();
  leaveRequests.forEach(request => {
    if (!groups.has(request.token)) groups.set(request.token, []);
    groups.get(request.token).push(request);
  });
  groups.forEach((requests, token) => {
    requests.sort(leaveOrder);
    const item = document.createElement('div'); item.className = 'leave-history-item';
    const pending = requests.filter(r => r.status === 'รอพิจารณา').length;
    const heading = document.createElement('strong');
    heading.textContent = `${requests[0].date} · ${requests.length} คน · รอพิจารณา ${pending} คน`;
    const names = document.createElement('div');
    names.textContent = requests.map(r => `${r.student.cls} ${leaveName(r.student)} (${r.status})`).join(' · ');
    const actions = document.createElement('div'); actions.className = 'pick-actions';
    [['พิมพ์ใบขอ', () => printLeaveGroup(token)], ['ส่ง LINE', () => shareLeaveGroup(token, requests.length)],
      ['คัดลอกลิงก์', () => copyLeaveLink(token)]].forEach(([label, handler]) => {
      const button = document.createElement('button'); button.className = 'btn'; button.type = 'button';
      button.textContent = label; button.addEventListener('click', handler); actions.append(button);
    });
    item.append(heading, names, actions); holder.append(item);
  });
}

function thaiLeaveDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) return leaveEscape(value);
  const [year, month, day] = value.split('-').map(Number);
  return `${day} ${['มกราคม','กุมภาพันธ์','มีนาคม','เมษายน','พฤษภาคม','มิถุนายน','กรกฎาคม','สิงหาคม','กันยายน','ตุลาคม','พฤศจิกายน','ธันวาคม'][month - 1] || ''} ${year + 543}`;
}

function thaiLeaveDecisionTime(value) {
  const date = new Date(value);
  if (!value || Number.isNaN(date.getTime())) return leaveEscape(value);
  const options = { timeZone: 'Asia/Bangkok' };
  const day = new Intl.DateTimeFormat('th-TH-u-ca-buddhist-nu-latn', {
    ...options, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric'
  }).format(date);
  const time = new Intl.DateTimeFormat('th-TH-u-nu-latn', {
    ...options, hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).format(date);
  return `${day} เวลา ${time} น.`;
}

function leavePrintCopy(request) {
  const s = request.student;
  const choice = (value, status) => value === status ? '☑' : '☐';
  const returnText = request.noReturn
    ? 'และไม่กลับเข้ามาในโรงเรียนในวันนั้น'
    : `และกลับเข้ามาในโรงเรียนเวลา <b>${leaveEscape(request.returnTime)}</b> น.`;
  return `<section class="copy">
    <h2>แบบบันทึกขออนุญาตออกนอกบริเวณโรงเรียน</h2>
    <p class="school">${LEAVE_SCHOOL}</p>
    <p class="date">วันที่ ${thaiLeaveDate(request.date)}</p>
    <p>เรียน รองผู้อำนวยการ${LEAVE_SCHOOL}</p>
    <p class="indent">ข้าพเจ้า <b>${leaveEscape(leaveName(s))}</b> นักเรียนชั้น <b>${leaveEscape(s.cls)}${s.room ? '/' + leaveEscape(s.room) : ''}</b> เลขที่ <b>${leaveEscape(s.number || '–')}</b></p>
    <p>มีความประสงค์ขออนุญาตออกนอกบริเวณโรงเรียน ตั้งแต่เวลา <b>${leaveEscape(request.outTime)}</b> น. ${returnText}</p>
    <p>ทั้งนี้เพื่อไปทำธุระเรื่อง <b>${leaveEscape(request.reason)}</b></p>
    <p>สถานที่ไปติดต่อ <b>${leaveEscape(request.destination)}</b></p>
    <p class="sign">ลงชื่อ ........................................ นักเรียนผู้ขออนุญาต<br>(${leaveEscape(leaveName(s))})</p>
    <div class="boxes">
      <div>พิจารณาเห็นควรว่า ${choice(request.advisorOpinion, 'อนุญาต')} อนุญาต ${choice(request.advisorOpinion, 'ไม่อนุญาต')} ไม่อนุญาต<br>ลงชื่อ ........................................<br>(${leaveEscape(request.homeroomTeacher || '........................................')})<br>ครูที่ปรึกษา/ครูผู้สอน</div>
      <div>พิจารณาเห็นควรว่า ${choice(request.affairsOpinion, 'อนุญาต')} อนุญาต ${choice(request.affairsOpinion, 'ไม่อนุญาต')} ไม่อนุญาต<br>ลงชื่อ ........................................<br>(${leaveEscape(request.affairsTeacher)})<br>ครูฝ่ายกิจการนักเรียน</div>
      <div>ลงชื่อ ........................................<br>(${leaveEscape(request.guardianName || '........................................')})<br>ผู้ปกครอง${request.parentPickup ? ' (มารับด้วยตนเอง)' : ''}</div>
      <div>ผลการพิจารณา ${choice(request.status, 'อนุมัติ')} อนุญาต ${choice(request.status, 'ไม่อนุมัติ')} ไม่อนุญาต<br>ลงชื่อ ........................................<br>(${leaveEscape(request.deputyName)})<br>รองผู้อำนวยการฝ่ายบุคคลและกิจการนักเรียน${request.decidedAt ? `<br><small>บันทึกผลในระบบ ${thaiLeaveDecisionTime(request.decidedAt)}</small>` : ''}</div>
    </div>
    ${request.decisionNote ? `<p class="note">หมายเหตุการพิจารณา: ${leaveEscape(request.decisionNote)}</p>` : ''}
  </section>`;
}

function printLeaveGroup(token) {
  const requests = leaveRequests.filter(request => request.token === token).sort(leaveOrder);
  if (!requests.length) return toast('กรุณาโหลดรายการใหม่', 'err');
  const popup = window.open('', '_blank');
  if (!popup) return toast('เบราว์เซอร์ปิดกั้นหน้าพิมพ์ กรุณาอนุญาตหน้าต่างใหม่', 'err');
  const pages = requests.map(request => `<article class="page">${leavePrintCopy(request)}${leavePrintCopy(request)}</article>`).join('');
  popup.document.write(`<!doctype html><html lang="th"><head><meta charset="utf-8"><title>ใบขออนุญาตออกนอกบริเวณโรงเรียน</title><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Sarabun:wght@400;600;700&display=swap"><style>
    @page{size:A4;margin:10mm}*{box-sizing:border-box}body{font-family:"Sarabun",sans-serif;color:#111;margin:0;font-size:11pt;line-height:1.35}
    .page{break-after:page}.page:last-child{break-after:auto}.copy{height:138mm;overflow:hidden;padding:3mm 2mm;border-bottom:1px dashed #aaa}.copy:last-child{border-bottom:0}
    h2{text-align:center;font-size:14pt;margin:0}.school{text-align:center;font-size:10pt;margin:0 0 2mm}.date{text-align:right;margin:0 0 2mm}p{margin:1.5mm 0}.indent{text-indent:10mm}.sign{width:max-content;max-width:100%;text-align:center;margin:2mm 4mm 2mm auto}
    .boxes{display:grid;grid-template-columns:1fr 1fr;border:1px solid #222;font-size:9.5pt}.boxes>div{min-height:26mm;padding:2mm 3mm;text-align:center;border-right:1px solid #222;border-bottom:1px solid #222}.boxes>div:nth-child(2n){border-right:0}.boxes>div:nth-child(n+3){border-bottom:0}.note{font-size:9pt}small{font-size:8pt}
    @media screen{body{background:#ddd}.page{width:210mm;min-height:297mm;background:white;margin:12px auto;padding:10mm;box-shadow:0 2px 12px #aaa}}
  </style></head><body>${pages}</body></html>`);
  popup.document.close();
  popup.focus();
  popup.document.fonts.ready.then(() => popup.print(), () => popup.print());
}

async function unlockLeaveApproval(event) {
  event.preventDefault();
  const pin = document.getElementById('approvalPinInput').value.trim();
  const error = document.getElementById('approvalError');
  const button = document.getElementById('approvalUnlockBtn');
  if (!pin) return;
  button.disabled = true; error.textContent = '';
  try {
    const result = await bridgeRequest({ action: 'getLeaveApproval', token: approvalToken, deputyPin: pin });
    if (!result.success) throw new Error(result.message || 'เปิดคำขอไม่สำเร็จ');
    approvalPin = pin;
    approvalRequests = (result.requests || []).sort(leaveOrder);
    document.getElementById('approvalPinInput').value = '';
    document.getElementById('approvalUnlockForm').hidden = true;
    document.getElementById('approvalContent').hidden = false;
    renderLeaveApproval();
  } catch (e) { error.textContent = e.message || 'เปิดคำขอไม่สำเร็จ'; }
  finally { button.disabled = false; }
}

function renderLeaveApproval() {
  const holder = document.getElementById('approvalRequests'); holder.replaceChildren();
  const pending = approvalRequests.filter(r => r.status === 'รอพิจารณา').length;
  document.getElementById('approvalSummary').textContent = `${approvalRequests.length} รายการ · รอพิจารณา ${pending} รายการ`;
  approvalRequests.forEach((request, index) => {
    const card = document.createElement('div');
    card.className = 'approval-request' + (request.status === 'อนุมัติ' ? ' approved' : request.status === 'ไม่อนุมัติ' ? ' denied' : '');
    card.innerHTML = `<h3>${index + 1}. ${leaveEscape(leaveName(request.student))} · ${leaveEscape(request.student.cls)}${request.student.room ? '/' + leaveEscape(request.student.room) : ''}</h3>
      <p>วันที่ ${thaiLeaveDate(request.date)} · ออก ${leaveEscape(request.outTime)} น. · ${request.noReturn ? 'ไม่กลับเข้ามาในวันนั้น' : `กลับ ${leaveEscape(request.returnTime)} น.`}</p>
      <p>ธุระ: ${leaveEscape(request.reason)}<br>สถานที่: ${leaveEscape(request.destination)}</p>
      <p>ครูฝ่ายกิจการ: ${leaveEscape(request.affairsTeacher)} · ครูประจำชั้น: ${leaveEscape(request.homeroomTeacher || 'ยังไม่ได้ตั้งค่า')}</p>
      <p>ครูที่ปรึกษาเห็นควร: ${leaveEscape(request.advisorOpinion || 'ยังไม่ระบุ')} · ครูฝ่ายกิจการเห็นควร: ${leaveEscape(request.affairsOpinion || 'ยังไม่ระบุ')}</p>
      <strong>สถานะ: ${leaveEscape(request.status)}</strong>`;
    if (request.status === 'รอพิจารณา') {
      const note = document.createElement('textarea'); note.rows = 2; note.maxLength = 300;
      note.placeholder = 'หมายเหตุการพิจารณา (ไม่บังคับ)'; note.dataset.requestId = request.id;
      const actions = document.createElement('div'); actions.className = 'pick-actions';
      [['อนุมัติ', 'primary'], ['ไม่อนุมัติ', '']].forEach(([status, style]) => {
        const button = document.createElement('button'); button.className = 'btn ' + style;
        button.textContent = status; button.addEventListener('click', () => decideLeaveRequests([{ id: request.id, status, note: note.value }]));
        actions.append(button);
      });
      card.append(note, actions);
    } else if (request.decisionNote) {
      const note = document.createElement('p'); note.textContent = 'หมายเหตุ: ' + request.decisionNote; card.append(note);
    }
    holder.append(card);
  });
}

async function decideAllLeaveRequests(status) {
  const decisions = approvalRequests.filter(r => r.status === 'รอพิจารณา').map(r => {
    const note = document.querySelector(`#approvalRequests textarea[data-request-id="${r.id}"]`);
    return { id: r.id, status, note: note ? note.value : '' };
  });
  if (!decisions.length) return toast('ไม่มีรายการรอพิจารณา', 'err');
  await decideLeaveRequests(decisions);
}

async function decideLeaveRequests(decisions) {
  if (!approvalPin) return;
  document.querySelectorAll('#approvalContent button').forEach(button => button.disabled = true);
  try {
    const result = await bridgeRequest({ action: 'decideLeaveApproval', token: approvalToken, deputyPin: approvalPin, decisions });
    if (!result.success) throw new Error(result.message || 'บันทึกผลไม่สำเร็จ');
    const updated = await bridgeRequest({ action: 'getLeaveApproval', token: approvalToken, deputyPin: approvalPin });
    if (!updated.success) throw new Error(updated.message || 'โหลดผลไม่สำเร็จ');
    approvalRequests = (updated.requests || []).sort(leaveOrder);
    renderLeaveApproval();
    toast('บันทึกผลการพิจารณาแล้ว');
  } catch (error) { toast(error.message || 'บันทึกผลไม่สำเร็จ', 'err'); }
  finally { document.querySelectorAll('#approvalContent button').forEach(button => button.disabled = false); }
}

if (approvalToken) {
  document.getElementById('approvalOverlay').classList.add('show');
  document.getElementById('approvalPinInput').focus();
}
