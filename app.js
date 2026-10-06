const GAS_URL_OLD = 'https://script.google.com/macros/s/AKfycbx7lwjrqXeo8IAcra6AfZXzndYaReqi94PkM1OjHokYs_1mde8XzmZB9xCIQQEhdXSC/exec';
const GAS_URL_DEFAULT = 'https://script.google.com/macros/s/AKfycbxP_gO-U_sdFIJzIz5LTXtGOgnNkcELdPwfVzxiayNWNfypk3c9p8bNWDMDBhjCp42J/exec';
let GAS_URL = localStorage.getItem('gasUrl') || GAS_URL_DEFAULT;
if (GAS_URL === GAS_URL_OLD) { GAS_URL = GAS_URL_DEFAULT; localStorage.setItem('gasUrl', GAS_URL); }
let allData      = [], curClass = '', curView = 1;
let adminPin     = '9999', schoolName = '', pinVal = '';
let extraStudents = []; // นักเรียนจากชีท "เพิ่มเติม" พร้อม rowIndex
const isMobile = () => window.innerWidth < 768;
const classOrder = ['อ.2','อ.3','ป.1','ป.2','ป.3','ป.4','ป.5','ป.6','ม.1','ม.2','ม.3'];

let bridgeFrame = null, bridgeReady = null, bridgeSource = null, bridgeOrigin = '';
let bridgeNonce = '', bridgeNextId = 0;
const bridgePending = new Map();

function resetBridge() {
  if (bridgeFrame) bridgeFrame.remove();
  bridgeFrame = null; bridgeReady = null; bridgeSource = null; bridgeOrigin = '';
  bridgePending.forEach(({ reject }) => reject(new Error('การเชื่อมต่อถูกเปลี่ยน')));
  bridgePending.clear();
}

function startBridge() {
  if (bridgeReady) return bridgeReady;
  bridgeNonce = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  bridgeReady = new Promise((resolve, reject) => {
    const timer = setTimeout(() => { resetBridge(); reject(new Error('บริการไม่ตอบสนอง')); }, 20000);
    const onMessage = event => {
      if (!event.data || event.data.namelistBridge !== true || event.data.nonce !== bridgeNonce) return;
      const host = new URL(event.origin).hostname;
      if (host !== 'script.google.com' && host !== 'script.googleusercontent.com' && !host.endsWith('.googleusercontent.com')) return;
      if (event.data.kind === 'ready') {
        bridgeSource = event.source;
        bridgeOrigin = event.origin;
        clearTimeout(timer);
        resolve();
      } else if (event.data.kind === 'response' && event.source === bridgeSource) {
        const pending = bridgePending.get(event.data.id);
        if (!pending) return;
        bridgePending.delete(event.data.id);
        clearTimeout(pending.timer);
        if (event.data.error) pending.reject(new Error(event.data.error));
        else pending.resolve(event.data.result);
      }
    };
    window.addEventListener('message', onMessage);
    const separator = GAS_URL.includes('?') ? '&' : '?';
    bridgeFrame = document.createElement('iframe');
    bridgeFrame.style.display = 'none';
    bridgeFrame.src = `${GAS_URL}${separator}action=bridge&nonce=${encodeURIComponent(bridgeNonce)}`;
    document.body.appendChild(bridgeFrame);
  });
  return bridgeReady;
}

async function bridgeRequest(payload) {
  await startBridge();
  return new Promise((resolve, reject) => {
    const id = ++bridgeNextId;
    const timer = setTimeout(() => {
      bridgePending.delete(id);
      reject(new Error('บริการตอบกลับช้าเกินไป'));
    }, 60000);
    bridgePending.set(id, { resolve, reject, timer });
    bridgeSource.postMessage({ namelistBridge: true, kind: 'request', nonce: bridgeNonce, id, payload }, bridgeOrigin);
  });
}

window.onload = () => {
  // รอ XLSX library โหลดเสร็จก่อน (fallback CDN อาจใช้เวลา)
  var wait = 0;
  var checkXLSX = setInterval(() => {
    wait += 100;
    if (typeof XLSX !== 'undefined') {
      clearInterval(checkXLSX);
      initApp();
    } else if (wait > 10000) {
      clearInterval(checkXLSX);
      console.error('XLSX timeout');
      initApp(); // ลองต่อไปแม้ไม่มี XLSX
    }
  }, 100);
};

async function initApp() {
  document.getElementById('gasInput').value = GAS_URL;
  setupViewBtns();
  setupDrop();
  await loadAll();
}

// ── Load all ──────────────────────────────────────────────
async function fetchAllData() {
  try { return await bridgeRequest({ action: 'getAll' }); }
  catch (bridgeError) { console.warn('Bridge unavailable:', bridgeError); }
  let lastError;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const separator = GAS_URL.includes('?') ? '&' : '?';
      const res = await fetch(`${GAS_URL}${separator}action=getAll&_=${Date.now()}-${attempt}`, {
        cache: 'no-store', credentials: 'omit'
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const contentType = res.headers.get('content-type') || '';
      if (!contentType.includes('application/json')) throw new Error('บริการตอบกลับไม่ใช่ JSON');
      return await res.json();
    } catch (error) {
      lastError = error;
      if (attempt < 2) await new Promise(resolve => setTimeout(resolve, 500 * (attempt + 1)));
    }
  }
  throw lastError;
}

async function loadAll() {
  showV('loading');
  setStatus('', 'กำลังโหลด...');
  try {
    const json = await fetchAllData();
    if (!json.success) throw new Error(json.message);
    const cfg = json.config || {};
    adminPin   = cfg.admin_pin   || '9999';
    schoolName = cfg.school_name || '';
    if (schoolName) document.getElementById('tbSchool').textContent = schoolName;
    renderCfgLive(cfg);
    pickedStudents.clear();
    allData = [];
    Object.entries(json.students || {}).forEach(([cls, rows]) => {
      rows.forEach(r => allData.push({
        'ชั้น': r['ชั้น'] || cls, 'ห้อง': r['ห้อง'] || '1',
        'เพศ':  r['เพศ'] === 'ชาย' ? 'ช' : 'ญ',
        'คำนำหน้าชื่อ': r['คำนำหน้า'] || '',
        'ชื่อ': r['ชื่อ'] || '', 'นามสกุล': r['นามสกุล'] || '',
        'วันเกิด': r['วันเกิด'] || '',
        'บัตรประชาชน':  r['เลขบัตรประชาชน'] || '',
        'รหัสนักเรียน': r['รหัส 4 หลัก'] || ''
      }));
    });
    // โหลด extra students
    extraStudents = json.extra || [];
    renderExtraList();

    if (allData.length) { initViewer(); setStatus('ok', 'เชื่อมต่อแล้ว'); }
    else { showV('noData'); setStatus('err', 'ยังไม่มีข้อมูล'); }
  } catch(e) {
    showV('noData'); setStatus('err', 'เชื่อมต่อไม่ได้');
    document.getElementById('cfgLive').textContent = 'โหลด config ไม่ได้: ' + e.message;
  }
}

function renderCfgLive(cfg) {
  document.getElementById('cfgLive').innerHTML =
    `<table style="width:100%;border-collapse:collapse">` +
    Object.entries(cfg).map(([k,v]) =>
      `<tr><td style="padding:2px 0;color:var(--gray-500);width:45%;font-size:12px">${k}</td>` +
      `<td style="padding:2px 0;font-size:13px"><strong>${k==='admin_pin'?'••••':v}</strong></td></tr>`
    ).join('') + `</table>` +
    `<p style="margin-top:8px;font-size:11px;color:var(--gray-400)">แก้ไขโดยตรงใน Google Sheets → ชีท config</p>`;
}

// ── Viewer ────────────────────────────────────────────────
function showV(name) {
  document.getElementById('loadingScreen').classList.toggle('active', name==='loading');
  document.getElementById('appScreen').classList.toggle('active',    name==='app');
  document.getElementById('noDataScreen').classList.toggle('active', name==='noData');
}

// ── อัปเดต sidebar count และ stats (เรียกได้ทุกเวลา) ─────────
function updateCounts() {
  var classes = classOrder.filter(function(c) { return allData.some(function(d) { return d['ชั้น']===c; }); });
  var tot = allData.length;
  var m   = allData.filter(function(d) { return d['เพศ']==='ช'; }).length;

  // Stats row
  var sr = document.getElementById('statsRow');
  if (sr) {
    sr.innerHTML =
      '<div class="stat-card"><div class="stat-label">ทั้งหมด</div><div class="stat-val">' + tot + '</div></div>' +
      '<div class="stat-card"><div class="stat-label">ชาย</div><div class="stat-val blue">' + m + '</div></div>' +
      '<div class="stat-card"><div class="stat-label">หญิง</div><div class="stat-val pink">' + (tot-m) + '</div></div>' +
      '<div class="stat-card"><div class="stat-label">ชั้น</div><div class="stat-val green">' + classes.length + '</div></div>';
  }

  // Sidebar cls-btn counts
  document.querySelectorAll('.cls-btn').forEach(function(btn) {
    var cls = btn.dataset.cls;
    var n   = allData.filter(function(d) { return d['ชั้น']===cls; }).length;
    var cb  = btn.querySelector('.cb');
    if (cb) cb.textContent = n;
  });

  // Mobile bar counts
  document.querySelectorAll('.mcls-btn').forEach(function(btn) {
    var cls  = btn.dataset.cls;
    var n    = allData.filter(function(d) { return d['ชั้น']===cls; }).length;
    var span = btn.querySelector('span');
    if (span) span.textContent = n;
  });

  // tCard header count (ชั้นที่กำลังดู)
  if (curClass) {
    var data    = allData.filter(function(d) { return d['ชั้น']===curClass; });
    var males   = data.filter(function(d) { return d['เพศ']==='ช'; }).length;
    var females = data.filter(function(d) { return d['เพศ']==='ญ'; }).length;
    var cnt = document.getElementById('tCnt');
    if (cnt) cnt.innerHTML = '<span class="cnt-m">ชาย ' + males + ' คน</span><span class="cnt-f">หญิง ' + females + ' คน</span>';
  }
}

function initViewer() {
  var classes = classOrder.filter(function(c) { return allData.some(function(d) { return d['ชั้น']===c; }); });

  // Desktop sidebar
  document.getElementById('clsButtons').innerHTML = classes.map(function(cls) {
    var n = allData.filter(function(d) { return d['ชั้น']===cls; }).length;
    return '<button class="cls-btn" data-cls="' + cls + '" onclick="selClass(\'' + cls + '\')">' + cls + '<span class="cb">' + n + '</span></button>';
  }).join('');
  document.getElementById('sidebar').style.display = 'block';

  // Mobile class scroll bar
  var mb = document.getElementById('mobileClsBar');
  mb.innerHTML = classes.map(function(cls) {
    var n = allData.filter(function(d) { return d['ชั้น']===cls; }).length;
    return '<button class="mcls-btn" data-cls="' + cls + '" onclick="selClass(\'' + cls + '\')">' + cls + ' <span style="opacity:.6;font-size:11px">' + n + '</span></button>';
  }).join('');
  mb.classList.add('show');

  updateCounts();
  showV('app');
  if (classes.length) selClass(classes[0]);
}

function selClass(cls) {
  curClass = cls;
  document.querySelectorAll('.cls-btn').forEach(b  => b.classList.toggle('active', b.dataset.cls===cls));
  document.querySelectorAll('.mcls-btn').forEach(b => b.classList.toggle('active', b.dataset.cls===cls));
  // Scroll mobile bar to show active
  const active = document.querySelector('.mcls-btn.active');
  if (active) active.scrollIntoView({inline:'center',behavior:'smooth'});
  render();
}

function setupViewBtns() {
  document.querySelectorAll('.vbtn').forEach(b => b.addEventListener('click', () => {
    document.querySelectorAll('.vbtn').forEach(x=>x.classList.remove('active'));
    b.classList.add('active'); curView = parseInt(b.dataset.v); render();
  }));
}

function render() {
  const data    = allData.filter(d => d['ชั้น']===curClass);
  const males   = data.filter(d=>d['เพศ']==='ช').sort((a,b)=>(a['ชื่อ']||'').localeCompare(b['ชื่อ']||'','th'));
  const females = data.filter(d=>d['เพศ']==='ญ').sort((a,b)=>(a['ชื่อ']||'').localeCompare(b['ชื่อ']||'','th'));
  const rows    = [...males, ...females];
  // จำนวนช่องคะแนน (แบบ 4) — ปรับได้
  const SCORE_COLS = 8;
  const scoreCols  = Array.from({length:SCORE_COLS}, () => '');
  const hMap = {
    1:['เลขที่','รหัส','ชื่อ-นามสกุล'],
    2:['เลขที่','รหัส','ชื่อ-นามสกุล','วันเกิด'],
    3:['เลขที่','รหัส','บัตรประชาชน','ชื่อ-นามสกุล','วันเกิด'],
    4:['เลขที่','รหัส','ชื่อ-นามสกุล',...scoreCols]
  };
  const vt = {1:'รายชื่อนักเรียน',2:'รายชื่อพร้อมวันเกิด',3:'รายชื่อพร้อมรหัสบัตร',4:'รายชื่อพร้อมช่องคะแนน'};
  document.getElementById('tTitle').textContent = `${vt[curView]} — ชั้น ${curClass}`;
  document.getElementById('tCnt').innerHTML = `<span class="cnt-m">ชาย ${males.length}</span><span class="cnt-f">หญิง ${females.length}</span>`;
  document.getElementById('thead').innerHTML = `<tr>${hMap[curView].map(h=>`<th>${h}</th>`).join('')}</tr>`;
  if (!rows.length) {
    document.getElementById('tbody').innerHTML = `<tr><td colspan="${hMap[curView].length}" style="text-align:center;padding:32px;color:var(--gray-400)">ไม่พบข้อมูล</td></tr>`;
    return;
  }
  document.getElementById('tbody').innerHTML = rows.map((s,i) => {
    const m   = s['เพศ']==='ช';
    const id4 = String(s['รหัสนักเรียน']||'').padStart(4,'0');
    const id13= s['บัตรประชาชน']||'';
    const nm  = `<span class="gpill ${m?'m':'f'}">${m?'ช':'ญ'}</span> ${(s['คำนำหน้าชื่อ']||'').trim()}${s['ชื่อ']||''} ${s['นามสกุล']||''}`;
    const dob = formatDob(s['วันเกิด']||'');
    let c = '';
    if(curView===1) c=`<td class="td-num" style="color:var(--gray-500)">${i+1}</td><td class="td-num">${id4}</td><td class="td-name">${nm}</td>`;
    if(curView===2) c=`<td class="td-num" style="color:var(--gray-500)">${i+1}</td><td class="td-num">${id4}</td><td class="td-name">${nm}</td><td class="td-dob">${dob}</td>`;
    if(curView===3) c=`<td class="td-num" style="color:var(--gray-500)">${i+1}</td><td class="td-num">${id4}</td><td class="td-id">${id13}</td><td class="td-name">${nm}</td><td class="td-dob">${dob}</td>`;
    if(curView===4) c=`<td class="td-num" style="color:var(--gray-500)">${i+1}</td><td class="td-num">${id4}</td><td class="td-name">${nm}</td>${Array.from({length:SCORE_COLS}).map(()=>'<td class="td-score"></td>').join('')}`;
    return `<tr class="${m?'male':'female'}">${c}</tr>`;
  }).join('');
}

// ── Print ─────────────────────────────────────────────────
function doPrint() {
  const sName = schoolName || document.getElementById('tbSchool').textContent || 'โรงเรียนบ้านคลอง 14';
  const viewNames = {
    1:'รายชื่อนักเรียน',
    2:'รายชื่อนักเรียนพร้อมวันเกิด',
    3:'รายชื่อนักเรียนพร้อมรหัสบัตรประชาชน',
    4:'รายชื่อนักเรียนพร้อมช่องบันทึกคะแนน'
  };

  const data    = allData.filter(d => d['ชั้น'] === curClass);
  const males   = data.filter(d=>d['เพศ']==='ช').sort((a,b)=>(a['ชื่อ']||'').localeCompare(b['ชื่อ']||'','th'));
  const females = data.filter(d=>d['เพศ']==='ญ').sort((a,b)=>(a['ชื่อ']||'').localeCompare(b['ชื่อ']||'','th'));
  const rows    = [...males,...females];
  const nRows   = rows.length;

  // คำนวณ font-size ให้พอดี 1 หน้า A4 portrait
  const perRow = 650 / Math.max(nRows, 1);
  const fs = Math.min(10, Math.max(6.5, (perRow - 5) / 1.6));

  const hMap = {
    1:['เลขที่','รหัส','ชื่อ-นามสกุล'],
    2:['เลขที่','รหัส','ชื่อ-นามสกุล','วันเกิด'],
    3:['เลขที่','รหัส','รหัสบัตรประชาชน','ชื่อ-นามสกุล','วันเกิด'],
    4:['เลขที่','รหัส','ชื่อ-นามสกุล',...Array.from({length:8},()=>'')]
  };

  // col widths
  const noW=22, codeW=32;
  let colStyle = '';
  if(curView===4){
    const nW=185, sW=Math.floor((539-noW-codeW-185)/8);
    colStyle=`table{table-layout:fixed}th:nth-child(1),td:nth-child(1){width:${noW}pt}th:nth-child(2),td:nth-child(2){width:${codeW}pt}th:nth-child(3),td:nth-child(3){width:${nW}pt}th:nth-child(n+4),td:nth-child(n+4){width:${sW}pt}`;
  } else if(curView===3){
    colStyle=`table{table-layout:fixed}th:nth-child(1),td:nth-child(1){width:${noW}pt}th:nth-child(2),td:nth-child(2){width:${codeW}pt}th:nth-child(3),td:nth-child(3){width:110pt}th:nth-child(4),td:nth-child(4){width:250pt}th:nth-child(5),td:nth-child(5){width:65pt}`;
  } else if(curView===2){
    colStyle=`table{table-layout:fixed}th:nth-child(1),td:nth-child(1){width:${noW}pt}th:nth-child(2),td:nth-child(2){width:${codeW}pt}th:nth-child(3),td:nth-child(3){width:420pt}th:nth-child(4),td:nth-child(4){width:65pt}`;
  } else {
    colStyle=`table{table-layout:auto}`;
  }

  // build rows
  const tbody = rows.map((s,i) => {
    const id4  = String(s['รหัสนักเรียน']||'').padStart(4,'0');
    const id13 = s['บัตรประชาชน']||'';
    const nm   = `${(s['คำนำหน้าชื่อ']||'').trim()}${s['ชื่อ']||''} ${s['นามสกุล']||''}`;
    const dob  = formatDob(s['วันเกิด']||'');
    const bg   = i%2===1 ? '#f5f5f5' : '#fff';
    const td = (t,st='') => `<td style="border:.6pt solid #000;padding:2.5pt 4pt;white-space:nowrap;background:${bg};${st}">${t}</td>`;
    const c  = 'text-align:center';
    let cells='';
    if(curView===1) cells=`${td(i+1,c)}${td(id4,c)}${td(nm)}`;
    if(curView===2) cells=`${td(i+1,c)}${td(id4,c)}${td(nm)}${td(dob,c)}`;
    if(curView===3) cells=`${td(i+1,c)}${td(id4,c)}${td(id13,'font-family:monospace;font-size:9pt')}${td(nm)}${td(dob,c)}`;
    if(curView===4) cells=`${td(i+1,c)}${td(id4,c)}${td(nm)}`+Array.from({length:8}).map(()=>td('')).join('');
    return `<tr>${cells}</tr>`;
  }).join('');

  const ths = hMap[curView].map(h =>
    `<th style="border:.75pt solid #000;padding:3pt 4pt;font-weight:700;text-align:center;background:#fff">${h}</th>`
  ).join('');

  // แยก colStyle ออกมาเป็น tableInline และ colRules ก่อน (ไม่ซ้อน template literal)
  const tableInline = colStyle.indexOf('table-layout:fixed') >= 0
    ? 'table-layout:fixed' : 'table-layout:auto';
  const colRules = colStyle.replace(/^table[{][^}]*[}]/, '').trim();

  // สร้าง HTML เอกสารพิมพ์จริง (ใช้ string concat หลีกเลี่ยง escape ซ้อน)
  var fsStr  = fs.toFixed(1);
  var fs3    = (fs + 3).toFixed(1);
  var fs2    = (fs + 2).toFixed(1);
  var fs1    = (fs + 1).toFixed(1);

  var printDoc = '';
  printDoc += '<!DOCTYPE html><html><head><meta charset="UTF-8">';
  printDoc += '<link href="https://fonts.googleapis.com/css2?family=Sarabun:wght@400;600;700&display=swap" rel="stylesheet">';
  printDoc += '<style>';
  printDoc += '*{box-sizing:border-box;margin:0;padding:0}';
  printDoc += 'body{font-family:Sarabun,sans-serif;font-size:' + fsStr + 'pt;background:#fff;color:#000}';
  printDoc += '@page{size:A4 portrait;margin:12mm 10mm 12mm 12mm}';
  printDoc += '.hdr{text-align:center;margin-bottom:8pt;padding-bottom:6pt;border-bottom:1.5pt solid #000}';
  printDoc += '.hdr .h1{font-size:' + fs3 + 'pt;font-weight:700;margin-bottom:2pt}';
  printDoc += '.hdr .h2{font-size:' + fs2 + 'pt;font-weight:600;margin-bottom:1pt}';
  printDoc += '.hdr .h3{font-size:' + fs1 + 'pt;color:#333}';
  printDoc += 'table{width:100%;border-collapse:collapse;font-size:' + fsStr + 'pt;font-family:Sarabun,sans-serif;' + tableInline + '}';
  printDoc += colRules;
  printDoc += '</style></head><body>';
  printDoc += '<div class="hdr">';
  printDoc += '<div class="h1">' + sName + '</div>';
  printDoc += '<div class="h2">' + viewNames[curView] + ' ชั้น ' + curClass + '</div>';
  printDoc += '<div class="h3">ภาคเรียนที่ 1/2569</div>';
  printDoc += '</div>';
  printDoc += '<table><thead><tr>' + ths + '</tr></thead><tbody>' + tbody + '</tbody></table>';
  printDoc += '</body></html>';

  // เปิด popup window แล้วพิมพ์
  var w = window.open('', '_blank');
  if (!w) { toast('กรุณาอนุญาต Pop-up ใน browser ก่อนพิมพ์', 'err'); return; }
  w.document.open();
  w.document.write(printDoc);
  w.document.close();
  // รอ font โหลดแล้วค่อย print
  setTimeout(function() { w.focus(); w.print(); w.close(); }, 1000);
}

// ── Print Preview ─────────────────────────────────────────
function openPrintPreview() {
  const sName = schoolName || document.getElementById('tbSchool').textContent || 'โรงเรียนบ้านคลอง 14';
  const viewNames = {
    1:'รายชื่อนักเรียน',
    2:'รายชื่อนักเรียนพร้อมวันเกิด',
    3:'รายชื่อนักเรียนพร้อมรหัสบัตรประชาชน',
    4:'รายชื่อนักเรียนพร้อมช่องบันทึกคะแนน'
  };

  const data    = allData.filter(d => d['ชั้น'] === curClass);
  const males   = data.filter(d=>d['เพศ']==='ช').sort((a,b)=>(a['ชื่อ']||'').localeCompare(b['ชื่อ']||'','th'));
  const females = data.filter(d=>d['เพศ']==='ญ').sort((a,b)=>(a['ชื่อ']||'').localeCompare(b['ชื่อ']||'','th'));
  const rows    = [...males, ...females];
  const nRows   = rows.length;

  // คำนวณ font-size เหมือน doPrint
  const perRow = 650 / Math.max(nRows, 1);
  const fs = Math.min(10, Math.max(6.5, (perRow - 5) / 1.6));

  // header
  const hMap = {
    1:['เลขที่','รหัส','ชื่อ-นามสกุล'],
    2:['เลขที่','รหัส','ชื่อ-นามสกุล','วันเกิด'],
    3:['เลขที่','รหัส','รหัสบัตรประชาชน','ชื่อ-นามสกุล','วันเกิด'],
    4:['เลขที่','รหัส','ชื่อ-นามสกุล',...Array.from({length:8},()=>'')]
  };

  // col widths (pt → mm ÷ 2.835)
  const noW=22, codeW=32;
  let colStyles = '';
  if (curView===4) {
    const nW=185, sW=Math.floor((539-noW-codeW-185)/8);
    colStyles = `th:nth-child(1),td:nth-child(1){width:${noW}pt}th:nth-child(2),td:nth-child(2){width:${codeW}pt}th:nth-child(3),td:nth-child(3){width:${nW}pt}th:nth-child(n+4),td:nth-child(n+4){width:${sW}pt}`;
  } else if (curView===3) {
    colStyles = `th:nth-child(1),td:nth-child(1){width:${noW}pt}th:nth-child(2),td:nth-child(2){width:${codeW}pt}th:nth-child(3),td:nth-child(3){width:110pt}th:nth-child(4),td:nth-child(4){width:250pt}th:nth-child(5),td:nth-child(5){width:65pt}`;
  } else if (curView===2) {
    colStyles = `th:nth-child(1),td:nth-child(1){width:${noW}pt}th:nth-child(2),td:nth-child(2){width:${codeW}pt}th:nth-child(3),td:nth-child(3){width:420pt}th:nth-child(4),td:nth-child(4){width:65pt}`;
  }

  // build rows HTML
  const tbody = rows.map((s,i) => {
    const id4  = String(s['รหัสนักเรียน']||'').padStart(4,'0');
    const id13 = s['บัตรประชาชน']||'';
    const nm   = `${(s['คำนำหน้าชื่อ']||'').trim()}${s['ชื่อ']||''} ${s['นามสกุล']||''}`;
    const dob  = formatDob(s['วันเกิด']||'');
    const bg   = i%2===1 ? 'background:#f7f7f7' : '';
    let cells = '';
    const td = (txt,st='') => `<td style="border:.75pt solid #000;padding:2.5pt 4pt;white-space:nowrap;font-size:${fs.toFixed(1)}pt;${bg};${st}">${txt}</td>`;
    const ctr = `text-align:center`;
    if(curView===1) cells=`${td(i+1,ctr)}${td(id4,ctr)}${td(nm)}`;
    if(curView===2) cells=`${td(i+1,ctr)}${td(id4,ctr)}${td(nm)}${td(dob,ctr)}`;
    if(curView===3) cells=`${td(i+1,ctr)}${td(id4,ctr)}${td(id13,'font-family:monospace;font-size:9pt')}${td(nm)}${td(dob,ctr)}`;
    if(curView===4) cells=`${td(i+1,ctr)}${td(id4,ctr)}${td(nm)}`+Array.from({length:8}).map(()=>td('')).join('');
    return `<tr>${cells}</tr>`;
  }).join('');

  const ths = hMap[curView].map(h =>
    `<th style="border:.75pt solid #000;padding:3pt 4pt;font-weight:700;text-align:center;font-size:${fs.toFixed(1)}pt">${h}</th>`
  ).join('');

  const html = `
    <style>.pp-page table{${colStyles};table-layout:${curView===1?'auto':'fixed'}}</style>
    <div class="pp-hdr">
      <div class="h-school">${sName}</div>
      <div class="h-title">${viewNames[curView]} ชั้น ${curClass}</div>
      <div class="h-term">ภาคเรียนที่ 1/2569</div>
    </div>
    <table><thead><tr>${ths}</tr></thead><tbody>${tbody}</tbody></table>`;

  document.getElementById('ppPage').innerHTML = html;
  document.getElementById('ppTitle').textContent = 'ตัวอย่างก่อนพิมพ์';
  document.getElementById('ppSub').textContent   = `${viewNames[curView]} ชั้น ${curClass} — ${nRows} คน`;
  document.getElementById('ppOverlay').classList.add('show');
}

function closePrintPreview() {
  document.getElementById('ppOverlay').classList.remove('show');
}

// ── Copy list ────────────────────────────────────────────────
function copyList() {
  var data  = allData.filter(function(d) { return d['ชั้น'] === curClass; });
  if (!data.length) { toast('ไม่มีข้อมูลนักเรียน', 'err'); return; }
  // เปิด options modal
  openCopyOptions();
}

function getSortedRows() {
  var data    = allData.filter(function(d) { return d['ชั้น'] === curClass; });
  var males   = data.filter(function(d) { return d['เพศ']==='ช'; }).sort(function(a,b){ return (a['ชื่อ']||'').localeCompare(b['ชื่อ']||'','th'); });
  var females = data.filter(function(d) { return d['เพศ']==='ญ'; }).sort(function(a,b){ return (a['ชื่อ']||'').localeCompare(b['ชื่อ']||'','th'); });
  return males.concat(females);
}

function buildCopyText(rows) {
  var sep = document.querySelector('input[name="co-sep"]:checked').value;
  var sepChar = sep === 'tab' ? '\t' : sep === 'space' ? ' ' : sep === 'comma' ? ',' : '|';

  var useNo       = document.getElementById('co-no').checked;
  var useCode     = document.getElementById('co-code').checked;
  var useId13     = document.getElementById('co-id13').checked;
  var useFullname = document.getElementById('co-fullname').checked;
  var usePrefix   = document.getElementById('co-prefix').checked;
  var useFname    = document.getElementById('co-fname').checked;
  var useLname    = document.getElementById('co-lname').checked;
  var useDob      = document.getElementById('co-dob').checked;
  var useGender   = document.getElementById('co-gender').checked;

  return rows.map(function(s, i) {
    var parts  = [];
    var prefix = (s['คำนำหน้าชื่อ']||'').trim();
    var fname  = s['ชื่อ']||'';
    var lname  = s['นามสกุล']||'';
    if (useNo)       parts.push(i + 1);
    if (useCode)     parts.push(String(s['รหัสนักเรียน']||'').padStart(4,'0'));
    if (useId13)     parts.push(s['บัตรประชาชน']||'');
    if (useFullname) parts.push((prefix+' '+fname+' '+lname).trim());
    if (usePrefix)   parts.push(prefix);
    if (useFname)    parts.push(fname);
    if (useLname)    parts.push(lname);
    if (useDob)      parts.push(formatDob(s['วันเกิด']||''));
    if (useGender)   parts.push(s['เพศ']==='ช' ? 'ชาย' : 'หญิง');
    return parts.join(sepChar);
  }).join('\n');
}

function openCopyOptions() {
  var rows = getSortedRows();
  updateCopyPreview(rows);

  // ผูก event listener ให้ preview อัปเดต real-time
  var inputs = document.querySelectorAll('#copyOverlay input');
  inputs.forEach(function(el) {
    el.onchange = function() { updateCopyPreview(rows); };
  });

  document.getElementById('copyOverlay').classList.add('show');
}

function updateCopyPreview(rows) {
  var preview = document.getElementById('copyPreview');
  if (!preview) return;
  var text = buildCopyText(rows);
  // แสดงแค่ 3 แถวแรกใน preview
  var previewLines = text.split('\n').slice(0, 3);
  if (text.split('\n').length > 3) previewLines.push('...');
  preview.textContent = previewLines.join('\n');
}

function closeCopyOptions() {
  document.getElementById('copyOverlay').classList.remove('show');
}

function doCopy() {
  var rows = getSortedRows();
  var text = buildCopyText(rows);
  if (!text.trim()) { toast('กรุณาเลือกข้อมูลอย่างน้อย 1 ช่อง', 'err'); return; }

  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(function() {
      toast('คัดลอก ' + rows.length + ' รายการแล้ว', 'ok');
      closeCopyOptions();
    }).catch(function() { fallbackCopy(text); });
  } else {
    fallbackCopy(text);
  }
}

function fallbackCopy(text) {
  var ta = document.createElement('textarea');
  ta.value = text;
  ta.style.cssText = 'position:fixed;top:-999px;left:-999px;opacity:0';
  document.body.appendChild(ta);
  ta.select();
  try {
    document.execCommand('copy');
    toast('คัดลอกแล้ว', 'ok');
    closeCopyOptions();
  } catch(e) {
    toast('browser ไม่รองรับ กรุณาคัดลอกด้วยตนเอง', 'err');
  }
  document.body.removeChild(ta);
}

// ── Export Excel ───────────────────────────────────────────
function exportExcel() {
  const sName = schoolName || 'โรงเรียนบ้านคลอง 14';
  const viewNames = {
    1:'รายชื่อ', 2:'รายชื่อ+วันเกิด',
    3:'รายชื่อ+บัตรประชาชน', 4:'รายชื่อ+ช่องคะแนน'
  };
  const data    = allData.filter(d => d['ชั้น'] === curClass);
  const males   = data.filter(d=>d['เพศ']==='ช').sort((a,b)=>(a['ชื่อ']||'').localeCompare(b['ชื่อ']||'','th'));
  const females = data.filter(d=>d['เพศ']==='ญ').sort((a,b)=>(a['ชื่อ']||'').localeCompare(b['ชื่อ']||'','th'));
  const rows    = [...males,...females];

  const hMap = {
    1:['เลขที่','รหัส','ชื่อ-นามสกุล'],
    2:['เลขที่','รหัส','ชื่อ-นามสกุล','วันเกิด'],
    3:['เลขที่','รหัส','รหัสบัตรประชาชน','ชื่อ-นามสกุล','วันเกิด'],
    4:['เลขที่','รหัส','ชื่อ-นามสกุล','1','2','3','4','5','รวม']
  };

  const dataRows = rows.map((s,i) => {
    const id4  = String(s['รหัสนักเรียน']||'').padStart(4,'0');
    const id13 = s['บัตรประชาชน']||'';
    const nm   = `${(s['คำนำหน้าชื่อ']||'').trim()}${s['ชื่อ']||''} ${s['นามสกุล']||''}`;
    const dob  = formatDob(s['วันเกิด']||'');
    if(curView===1) return [i+1, id4, nm];
    if(curView===2) return [i+1, id4, nm, dob];
    if(curView===3) return [i+1, id4, id13, nm, dob];
    if(curView===4) return [i+1, id4, nm,'','','','','',''];
    return [i+1, id4, nm];
  });

  // สร้าง workbook ด้วย SheetJS
  const wb  = XLSX.utils.book_new();
  const ws  = XLSX.utils.aoa_to_sheet([hMap[curView], ...dataRows]);

  // กำหนดความกว้างคอลัมน์
  const colW = {
    1:[{wch:6},{wch:8},{wch:30}],
    2:[{wch:6},{wch:8},{wch:30},{wch:12}],
    3:[{wch:6},{wch:8},{wch:16},{wch:30},{wch:12}],
    4:[{wch:6},{wch:8},{wch:30},{wch:6},{wch:6},{wch:6},{wch:6},{wch:6},{wch:6}]
  };
  ws['!cols'] = colW[curView];

  // บังคับรหัสและบัตรประชาชนเป็น text (ไม่ตัด 0 นำหน้า)
  const range = XLSX.utils.decode_range(ws['!ref']);
  for(let r=1; r<=range.e.r; r++) {
    const idCell   = ws[XLSX.utils.encode_cell({r, c:1})];
    if(idCell) { idCell.t='s'; idCell.v=String(idCell.v||'').padStart(4,'0'); }
    if(curView===3) {
      const id13Cell = ws[XLSX.utils.encode_cell({r, c:2})];
      if(id13Cell) id13Cell.t='s';
    }
  }

  XLSX.utils.book_append_sheet(wb, ws, `ชั้น ${curClass}`);
  XLSX.writeFile(wb, `${sName}_${viewNames[curView]}_ชั้น${curClass}.xlsx`);
  toast('ดาวน์โหลด Excel สำเร็จ', 'ok');
}

// ── Format date ───────────────────────────────────────────
function formatDob(raw) {
  if (!raw || raw === '-' || raw === 'undefined' || raw === 'NaN') return '-';
  var s = String(raw).trim();

  // รูปแบบ dd/mm/yyyy อยู่แล้ว — คืนค่าเลย
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(s)) return s;

  // รูปแบบ ISO: 2021-10-05T17:00:00.000Z หรือ 2564-10-05
  var iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) {
    var y = parseInt(iso[1]);
    if (y < 2500) y += 543;
    return iso[3] + '/' + iso[2] + '/' + y;
  }

  // กรณี Google Sheets ส่งมาเป็น Date object แปลงเป็น string แล้ว
  // เช่น "Sat Oct 06 2021 00:00:00 GMT+0700"
  var d = new Date(s);
  if (!isNaN(d.getTime())) {
    var dd = String(d.getDate()).padStart(2,'0');
    var mm = String(d.getMonth()+1).padStart(2,'0');
    var yyyy = d.getFullYear() + (d.getFullYear() < 2500 ? 543 : 0);
    return dd + '/' + mm + '/' + yyyy;
  }

  return s;
}

// ── PIN ────────────────────────────────────────────────────
function openPin() { pinVal=''; updDots(); document.getElementById('pinErr').textContent=''; document.getElementById('pinOverlay').classList.add('show'); }
function closePin() { document.getElementById('pinOverlay').classList.remove('show'); }
function pk(d) { if(pinVal.length>=4)return; pinVal+=d; updDots(); if(pinVal.length===4)setTimeout(chkPin,120); }
function pkDel() { pinVal=pinVal.slice(0,-1); updDots(); }
function pkClr() { pinVal=''; updDots(); }
function updDots() { for(let i=0;i<4;i++){const d=document.getElementById('pd'+i);d.classList.toggle('on',i<pinVal.length);d.classList.remove('err');} }
function chkPin() {
  if (pinVal===adminPin) { closePin(); enterAdmin(); }
  else {
    for(let i=0;i<4;i++) document.getElementById('pd'+i).classList.add('err');
    document.getElementById('pinErr').textContent='รหัสไม่ถูกต้อง';
    setTimeout(()=>{ pinVal=''; updDots(); document.getElementById('pinErr').textContent=''; }, 900);
  }
}

// ── Admin ──────────────────────────────────────────────────
function enterAdmin() {
  document.getElementById('viewerLayout').style.display = 'none';
  document.getElementById('adminPanel').classList.add('show');
  document.getElementById('adminPill').classList.add('show');
  document.getElementById('adminExitBtn').style.display = 'inline-flex';
  toast('เข้าสู่โหมดแอดมิน', 'ok');
}
function exitAdmin() {
  document.getElementById('viewerLayout').style.display = 'block';
  document.getElementById('adminPanel').classList.remove('show');
  document.getElementById('adminPill').classList.remove('show');
  document.getElementById('adminExitBtn').style.display = 'none';
}

// ── Upload ─────────────────────────────────────────────────
function setupDrop() {
  const dz=document.getElementById('dropZone'), fi=document.getElementById('fileIn');
  dz.addEventListener('dragover', e=>{e.preventDefault();dz.classList.add('over')});
  dz.addEventListener('dragleave', ()=>dz.classList.remove('over'));
  dz.addEventListener('drop', e=>{e.preventDefault();dz.classList.remove('over');if(e.dataTransfer.files[0])setFile(e.dataTransfer.files[0])});
  fi.addEventListener('change', e=>{if(e.target.files[0])setFile(e.target.files[0])});
}
let pendingFile = null;
function setFile(f) {
  pendingFile = f;
  document.getElementById('fileName').textContent = f.name;
  document.getElementById('fileBadge').classList.add('show');
  document.getElementById('uploadBtn').disabled = false;
  document.getElementById('syncMsg').innerHTML = '';
}
function doUpload() {
  if (!pendingFile) return;
  const reader = new FileReader();
  reader.onload = e => {
    const wb  = XLSX.read(e.target.result, {type:'array'});
    const ws  = wb.Sheets[wb.SheetNames[0]];
    const raw = XLSX.utils.sheet_to_json(ws, {header:1});
    const data = raw.slice(2).filter(r=>r&&r.length>5).map(r=>({
      'บัตรประชาชน':  String(r[2]||''),
      'ชั้น':          String(r[3]||''),
      'ห้อง':          String(r[4]||''),
      'รหัสนักเรียน':  String(r[5]||''),
      'เพศ':           String(r[6]||''),
      'คำนำหน้าชื่อ':  String(r[7]||''),
      'ชื่อ':          String(r[8]||''),
      'นามสกุล':       String(r[9]||''),
      'วันเกิด':       String(r[10]||''),
    }));
    pushToSheets(data);
  };
  reader.readAsArrayBuffer(pendingFile);
}
async function pushToSheets(data) {
  const btn=document.getElementById('uploadBtn'), st=document.getElementById('uploadSt'), msg=document.getElementById('syncMsg');
  btn.disabled=true;
  btn.innerHTML='<span style="width:13px;height:13px;border:2px solid rgba(255,255,255,.4);border-top-color:#fff;border-radius:50%;animation:spin .7s linear infinite;display:inline-block;flex-shrink:0"></span> กำลังบันทึก...';
  st.textContent=`อ่าน ${data.length} รายการ...`; msg.innerHTML='';
  try {
    const json = await bridgeRequest({action:'saveStudents', students:data});
    if (json.success) { msg.className='sync-msg ok'; msg.textContent='✓ '+json.message; toast(json.message,'ok'); setStatus('ok','เชื่อมต่อแล้ว'); }
    else              { msg.className='sync-msg err'; msg.textContent='เกิดข้อผิดพลาด: '+json.message; }
  } catch(e) { msg.className='sync-msg err'; msg.textContent='เชื่อมต่อไม่ได้: '+e.message; }
  st.textContent='';
  btn.disabled=false;
  btn.innerHTML='<svg class="btn-ico" style="stroke:#fff" viewBox="0 0 24 24"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 102.13-9.36L1 10"/></svg> บันทึกลง Google Sheets';
}

// ── Settings ───────────────────────────────────────────────
function saveGasUrl() {
  const v = document.getElementById('gasInput').value.trim();
  if (!v) { toast('กรุณากรอก URL','err'); return; }
  GAS_URL = v; localStorage.setItem('gasUrl', v);
  resetBridge();
  toast('บันทึก URL แล้ว — กำลังโหลดใหม่','ok');
  setTimeout(loadAll, 600);
}

// ── Extra Students List ─────────────────────────────────────
function renderExtraList() {
  var el = document.getElementById('extraList');
  if (!el) return;
  if (!extraStudents.length) {
    el.innerHTML = '<div style="text-align:center;padding:20px;color:var(--gray-400);font-size:13px">ยังไม่มีนักเรียนเพิ่มเติม</div>';
    return;
  }
  var rows = extraStudents.map(function(s, i) {
    var gender = (s['เพศ'] === 'ชาย' || s['เพศ'] === 'ช') ? 'ชาย' : 'หญิง';
    var gColor = gender === 'ชาย' ? 'var(--blue)' : 'var(--pink)';
    var prefix = s['คำนำหน้า'] || s['คำนำหน้าชื่อ'] || '';
    var name   = prefix + (s['ชื่อ'] || '') + ' ' + (s['นามสกุล'] || '');
    var cls    = s['ชั้น'] || '';
    var note   = s['หมายเหตุ'] || '';
    var ri     = s._rowIndex || 0;
    return '<tr style="border-bottom:1px solid var(--gray-100)">' +
      '<td style="padding:8px 10px;font-size:13px">' + name + '</td>' +
      '<td style="padding:8px 10px;font-size:12px;color:' + gColor + '">' + gender + '</td>' +
      '<td style="padding:8px 10px;font-size:12px;color:var(--gray-500)">' + cls + '</td>' +
      '<td style="padding:8px 10px;font-size:11px;color:var(--gray-400)">' + note + '</td>' +
      '<td style="padding:8px 10px;text-align:right">' +
        '<button onclick="deleteExtra(' + i + ',' + ri + ')" style="font-size:11px;padding:3px 10px;border:1px solid #FECACA;background:#FEF2F2;color:var(--red);border-radius:6px;cursor:pointer;font-family:Sarabun,sans-serif">' +
          '✕ ลบ' +
        '</button>' +
      '</td>' +
    '</tr>';
  }).join('');
  el.innerHTML = '<table style="width:100%;border-collapse:collapse">' +
    '<thead><tr style="background:var(--gray-50);border-bottom:1px solid var(--gray-200)">' +
      '<th style="padding:7px 10px;font-size:11px;font-weight:600;color:var(--gray-500);text-align:left">ชื่อ-นามสกุล</th>' +
      '<th style="padding:7px 10px;font-size:11px;font-weight:600;color:var(--gray-500)">เพศ</th>' +
      '<th style="padding:7px 10px;font-size:11px;font-weight:600;color:var(--gray-500)">ชั้น</th>' +
      '<th style="padding:7px 10px;font-size:11px;font-weight:600;color:var(--gray-500)">หมายเหตุ</th>' +
      '<th></th>' +
    '</tr></thead><tbody>' + rows + '</tbody></table>';
}

async function deleteExtra(idx, rowIndex) {
  var s = extraStudents[idx];
  var name = (s['คำนำหน้า']||s['คำนำหน้าชื่อ']||'') + (s['ชื่อ']||'') + ' ' + (s['นามสกุล']||'');
  if (!confirm('ลบ "' + name.trim() + '" ออกจากชีทเพิ่มเติม?\nนักเรียนคนนี้จะหายจากรายชื่อบนเว็บทันที')) return;

  try {
    var json = await bridgeRequest({action:'deleteExtraStudent', rowIndex:rowIndex});
    if (json.success) {
      toast(json.message, 'ok');
      // ลบออกจาก extraStudents และ allData
      extraStudents.splice(idx, 1);
      // ลบออกจาก allData ด้วย (match ชื่อ+ชั้น)
      allData = allData.filter(function(d) {
        return !(d['ชื่อ'] === (s['ชื่อ']||'') && d['นามสกุล'] === (s['นามสกุล']||'') && d['ชั้น'] === (s['ชั้น']||''));
      });
      renderExtraList();
      updateCounts();
      if (curClass === s['ชั้น']) render();
    } else {
      toast('เกิดข้อผิดพลาด: ' + json.message, 'err');
    }
  } catch(e) {
    toast('เชื่อมต่อไม่ได้: ' + e.message, 'err');
  }
}

// ── Add Student Modal ────────────────────────────────────────
function openAddStudent() {
  // ตั้งค่า default ชั้นเป็นชั้นที่กำลังดูอยู่
  var sel = document.getElementById('as-class');
  if (sel && curClass) {
    for (var i = 0; i < sel.options.length; i++) {
      if (sel.options[i].value === curClass) { sel.selectedIndex = i; break; }
    }
  }
  // auto prefix/gender
  document.getElementById('as-prefix').addEventListener('change', function() {
    var g = document.getElementById('as-gender');
    if (this.value === 'เด็กชาย' || this.value === 'นาย') g.value = 'ชาย';
    else g.value = 'หญิง';
  });
  document.getElementById('as-msg').textContent = '';
  document.getElementById('as-msg').style.color = '';
  document.getElementById('addStudentOverlay').classList.add('show');
}

function closeAddStudent() {
  document.getElementById('addStudentOverlay').classList.remove('show');
  // reset form
  ['as-fname','as-lname','as-code','as-id13','as-dob','as-note'].forEach(function(id) {
    document.getElementById(id).value = '';
  });
}

async function saveAddStudent() {
  var fname  = document.getElementById('as-fname').value.trim();
  var lname  = document.getElementById('as-lname').value.trim();
  var cls    = document.getElementById('as-class').value;
  var prefix = document.getElementById('as-prefix').value;
  var gender = document.getElementById('as-gender').value;
  var code   = document.getElementById('as-code').value.trim().padStart(4,'0');
  var id13   = document.getElementById('as-id13').value.trim();
  var dob    = document.getElementById('as-dob').value.trim();
  var note   = document.getElementById('as-note').value.trim();
  var msg    = document.getElementById('as-msg');

  if (!fname || !lname || !cls) {
    msg.textContent = '⚠ กรุณากรอกชื่อ นามสกุล และระดับชั้น';
    msg.style.color = 'var(--red)';
    return;
  }

  var btn = document.getElementById('as-save-btn');
  btn.disabled = true;
  btn.textContent = 'กำลังบันทึก...';
  msg.textContent = '';

  var student = {
    'คำนำหน้าชื่อ': prefix,
    'ชื่อ': fname,
    'นามสกุล': lname,
    'เพศ': gender === 'ชาย' ? 'ช' : 'ญ',
    'ชั้น': cls,
    'ห้อง': '1',
    'รหัสนักเรียน': code,
    'บัตรประชาชน': id13,
    'วันเกิด': dob,
    'หมายเหตุ': note || 'เพิ่มเอง'
  };

  try {
    var json = await bridgeRequest({action:'addExtraStudent', student:student});
    if (json.success) {
      msg.textContent = '✓ บันทึกสำเร็จ';
      msg.style.color = 'var(--green)';
      toast('เพิ่มนักเรียนสำเร็จ', 'ok');
      // เพิ่มใน extraStudents และ allData ทันที
      var newExtra = {
        _rowIndex: json.rowIndex || -1,
        'คำนำหน้า': prefix, 'ชื่อ': fname, 'นามสกุล': lname,
        'เพศ': gender === 'ชาย' ? 'ชาย' : 'หญิง',
        'ชั้น': cls, 'ห้อง': '1', 'รหัส 4 หลัก': code,
        'เลขบัตรประชาชน': id13, 'วันเกิด': dob, 'หมายเหตุ': note||'เพิ่มเอง'
      };
      extraStudents.push(newExtra);
      allData.push({
        'ชั้น': cls, 'ห้อง': '1',
        'เพศ': student['เพศ'],
        'คำนำหน้าชื่อ': prefix,
        'ชื่อ': fname, 'นามสกุล': lname,
        'วันเกิด': dob,
        'บัตรประชาชน': id13,
        'รหัสนักเรียน': code
      });
      renderExtraList();
      updateCounts();
      if (curClass === cls) render();
      setTimeout(closeAddStudent, 1500);
    } else {
      msg.textContent = 'เกิดข้อผิดพลาด: ' + json.message;
      msg.style.color = 'var(--red)';
    }
  } catch(e) {
    msg.textContent = 'เชื่อมต่อไม่ได้: ' + e.message;
    msg.style.color = 'var(--red)';
  }
  btn.disabled = false;
  btn.innerHTML = '<svg class="btn-ico" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg> บันทึก';
}

// ── Print all classes ────────────────────────────────────────
function printAllClasses() {
  var sName = schoolName || document.getElementById('tbSchool').textContent || 'โรงเรียนบ้านคลอง 14';
  var classes = classOrder.filter(function(c) { return allData.some(function(d) { return d['ชั้น'] === c; }); });
  if (!classes.length) { toast('ไม่มีข้อมูลนักเรียน', 'err'); return; }

  var viewNames = {1:'รายชื่อนักเรียน',2:'รายชื่อพร้อมวันเกิด',3:'รายชื่อพร้อมรหัสบัตรประชาชน',4:'รายชื่อพร้อมช่องบันทึกคะแนน'};
  var hMap = {
    1:['เลขที่','รหัส','ชื่อ-นามสกุล'],
    2:['เลขที่','รหัส','ชื่อ-นามสกุล','วันเกิด'],
    3:['เลขที่','รหัส','รหัสบัตรประชาชน','ชื่อ-นามสกุล','วันเกิด'],
    4:['เลขที่','รหัส','ชื่อ-นามสกุล'].concat(Array.from({length:8}, function(){return '';}))
  };

  var allPages = '';
  classes.forEach(function(cls, ci) {
    var data    = allData.filter(function(d) { return d['ชั้น'] === cls; });
    var males   = data.filter(function(d) { return d['เพศ']==='ช'; }).sort(function(a,b){ return (a['ชื่อ']||'').localeCompare(b['ชื่อ']||'','th'); });
    var females = data.filter(function(d) { return d['เพศ']==='ญ'; }).sort(function(a,b){ return (a['ชื่อ']||'').localeCompare(b['ชื่อ']||'','th'); });
    var rows    = males.concat(females);
    var nRows   = rows.length;
    var perRow  = 650 / Math.max(nRows, 1);
    var fs      = Math.min(10, Math.max(6.5, (perRow - 5) / 1.6));
    var fsStr   = fs.toFixed(1);
    var noW=22, codeW=32;
    var colStyle = '';
    if (curView===4) {
      var nW=185, sW=Math.floor((539-noW-codeW-185)/8);
      colStyle = 'th:nth-child(1),td:nth-child(1){width:'+noW+'pt}th:nth-child(2),td:nth-child(2){width:'+codeW+'pt}th:nth-child(3),td:nth-child(3){width:'+nW+'pt}th:nth-child(n+4),td:nth-child(n+4){width:'+sW+'pt}';
    } else if (curView===3) {
      colStyle = 'th:nth-child(1),td:nth-child(1){width:'+noW+'pt}th:nth-child(2),td:nth-child(2){width:'+codeW+'pt}th:nth-child(3),td:nth-child(3){width:110pt}th:nth-child(4),td:nth-child(4){width:250pt}th:nth-child(5),td:nth-child(5){width:65pt}';
    } else if (curView===2) {
      colStyle = 'th:nth-child(1),td:nth-child(1){width:'+noW+'pt}th:nth-child(2),td:nth-child(2){width:'+codeW+'pt}th:nth-child(3),td:nth-child(3){width:420pt}th:nth-child(4),td:nth-child(4){width:65pt}';
    }

    var ths = hMap[curView].map(function(h) {
      return '<th style="border:.75pt solid #000;padding:3pt 4pt;font-weight:700;text-align:center;font-size:'+fsStr+'pt">'+h+'</th>';
    }).join('');

    var tbody = rows.map(function(s,i) {
      var id4  = String(s['รหัสนักเรียน']||'').padStart(4,'0');
      var id13 = s['บัตรประชาชน']||'';
      var nm   = (s['คำนำหน้าชื่อ']||'').trim()+(s['ชื่อ']||'')+' '+(s['นามสกุล']||'');
      var dob  = formatDob(s['วันเกิด']||'');
      var bg   = i%2===1 ? 'background:#f5f5f5' : 'background:#fff';
      var td = function(t,st) { return '<td style="border:.6pt solid #000;padding:2.5pt 4pt;white-space:nowrap;'+bg+';'+(st||'')+'">'+t+'</td>'; };
      var ctr = 'text-align:center';
      var cells = '';
      if (curView===1) cells=td(i+1,ctr)+td(id4,ctr)+td(nm,'');
      else if (curView===2) cells=td(i+1,ctr)+td(id4,ctr)+td(nm,'')+td(dob,ctr);
      else if (curView===3) cells=td(i+1,ctr)+td(id4,ctr)+td(id13,'font-family:monospace;font-size:9pt')+td(nm,'')+td(dob,ctr);
      else cells=td(i+1,ctr)+td(id4,ctr)+td(nm,'')+Array.from({length:8},function(){return td('','');}).join('');
      return '<tr>'+cells+'</tr>';
    }).join('');

    var pageBreak = ci > 0 ? 'page-break-before:always;' : '';
    allPages += '<div style="'+pageBreak+'padding:0">';
    allPages += '<div style="text-align:center;margin-bottom:8pt;padding-bottom:6pt;border-bottom:1.5pt solid #000;font-family:Sarabun,sans-serif">';
    allPages += '<div style="font-size:'+(fs+3).toFixed(1)+'pt;font-weight:700;margin-bottom:2pt">'+sName+'</div>';
    allPages += '<div style="font-size:'+(fs+2).toFixed(1)+'pt;font-weight:600;margin-bottom:1pt">'+viewNames[curView]+' ชั้น '+cls+'</div>';
    allPages += '<div style="font-size:'+(fs+1).toFixed(1)+'pt;color:#333">ภาคเรียนที่ 1/2569</div></div>';
    allPages += '<table style="width:100%;border-collapse:collapse;font-size:'+fsStr+'pt;font-family:Sarabun,sans-serif;'+(curView===1?'table-layout:auto':'table-layout:fixed')+'"><style>'+colStyle+'</style>';
    allPages += '<thead><tr>'+ths+'</tr></thead><tbody>'+tbody+'</tbody></table></div>';
  });

  var printDoc = '<!DOCTYPE html><html><head><meta charset="UTF-8">';
  printDoc += '<link href="https://fonts.googleapis.com/css2?family=Sarabun:wght@400;600;700&display=swap" rel="stylesheet">';
  printDoc += '<style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:Sarabun,sans-serif;background:#fff;color:#000}';
  printDoc += '@page{size:A4 portrait;margin:12mm 10mm 12mm 12mm}</style></head><body>';
  printDoc += allPages + '</body></html>';

  var w = window.open('', '_blank');
  if (!w) { toast('กรุณาอนุญาต Pop-up ใน browser', 'err'); return; }
  w.document.open();
  w.document.write(printDoc);
  w.document.close();
  setTimeout(function() { w.focus(); w.print(); w.close(); }, 1000);
}

// ── Status / Toast ─────────────────────────────────────────
function setStatus(cls, txt) {
  const el = document.getElementById('statusPill');
  el.className = 'status-pill' + (cls ? ' '+cls : '');
  document.getElementById('statusTxt').textContent = txt;
}
function toast(msg, type='') {
  const t = document.getElementById('toast');
  t.textContent = msg; t.className = 'toast show' + (type ? ' '+type : '');
  setTimeout(() => t.className = 'toast', 3000);
}

// ── เลือกนักเรียนหลายชั้น / บันทึกกิจกรรมและเหตุการณ์ ──────
const pickedStudents = new Set();
let loadedRecords = [];
let pickerPin = '';
let editingRecordId = '';
let editingStudents = [];

function openPicker() {
  document.getElementById('pickerPinInput').value = '';
  document.getElementById('pickerPinError').textContent = '';
  document.getElementById('pickerPinOverlay').classList.add('show');
  document.getElementById('pickerPinInput').focus();
}

function closePickerPin() {
  document.getElementById('pickerPinOverlay').classList.remove('show');
  document.getElementById('pickerPinInput').value = '';
  document.getElementById('pickerPinError').textContent = '';
}

async function unlockPicker(event) {
  event.preventDefault();
  const pin = document.getElementById('pickerPinInput').value.trim();
  const error = document.getElementById('pickerPinError');
  const button = document.getElementById('pickerPinSubmit');
  if (!pin) { error.textContent = 'กรุณากรอกรหัส'; return; }
  button.disabled = true;
  error.textContent = '';
  try {
    const result = await bridgeRequest({ action: 'checkPickerPin', pin });
    if (!result.success) throw new Error(result.message || 'รหัสไม่ถูกต้อง');
    pickerPin = pin;
    closePickerPin();
    showPicker();
  } catch (e) { error.textContent = e.message || 'ตรวจรหัสไม่สำเร็จ'; }
  finally { button.disabled = false; }
}

function showPicker() {
  const classSelect = document.getElementById('pickClass');
  classSelect.replaceChildren(new Option('ทุกชั้น', ''));
  classOrder.filter(cls => allData.some(s => s['ชั้น'] === cls))
    .forEach(cls => classSelect.add(new Option(cls, cls)));
  document.getElementById('recordDate').value = new Date().toLocaleDateString('sv-SE');
  document.getElementById('pickOverlay').classList.add('show');
  renderPickerStudents();
  renderPicked();
}

function closePicker() {
  closeRecordEditor();
  document.getElementById('pickOverlay').classList.remove('show');
  pickerPin = '';
  pickedStudents.clear();
  document.getElementById('recordHistorySearch').value = '';
  loadedRecords = [];
  document.getElementById('recordHistory').textContent = 'กดดูประวัติเพื่อแสดงรายการ';
}

function renderPickerStudents() {
  const cls = document.getElementById('pickClass').value;
  const query = document.getElementById('pickSearch').value.trim().toLocaleLowerCase('th');
  const list = document.getElementById('pickStudents');
  list.replaceChildren();
  let count = 0;
  allData.forEach((s, index) => {
    if (cls && s['ชั้น'] !== cls) return;
    const fullName = `${s['คำนำหน้าชื่อ'] || ''}${s['ชื่อ'] || ''} ${s['นามสกุล'] || ''}`.trim();
    if (query && !`${fullName} ${s['รหัสนักเรียน'] || ''}`.toLocaleLowerCase('th').includes(query)) return;
    count++;
    const row = document.createElement('label');
    row.className = 'pick-row';
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = pickedStudents.has(index);
    box.addEventListener('change', () => {
      if (box.checked) pickedStudents.add(index);
      else pickedStudents.delete(index);
      renderPicked();
    });
    const name = document.createElement('span');
    name.textContent = fullName;
    const meta = document.createElement('small');
    meta.textContent = `${s['ชั้น']} · ${s['รหัสนักเรียน'] || ''}`;
    row.append(box, name, meta);
    list.appendChild(row);
  });
  document.getElementById('pickResultCount').textContent = `พบ ${count} คน`;
}

function renderPicked() {
  const students = pickedRows();
  document.getElementById('pickCount').textContent = `เลือกแล้ว ${students.length} คน`;
  const list = document.getElementById('pickSelected');
  list.replaceChildren();
  if (!students.length) { list.textContent = 'ยังไม่ได้เลือกนักเรียน'; return; }
  students.forEach(s => {
    const line = document.createElement('div');
    line.textContent = `${s.cls} ${s.prefix}${s.firstName} ${s.lastName}`;
    list.appendChild(line);
  });
}

function clearPicker() {
  pickedStudents.clear();
  renderPickerStudents();
  renderPicked();
}

function pickedRows() {
  const classRank = cls => {
    const rank = classOrder.indexOf(cls);
    return rank < 0 ? classOrder.length : rank;
  };
  return [...pickedStudents].filter(i => allData[i]).sort((a, b) => {
    const rank = classRank(allData[a]['ชั้น']) - classRank(allData[b]['ชั้น']);
    return rank || a - b;
  }).map(i => {
    const s = allData[i];
    return { cls: s['ชั้น'] || '', room: s['ห้อง'] || '', code: s['รหัสนักเรียน'] || '',
      prefix: s['คำนำหน้าชื่อ'] || '', firstName: s['ชื่อ'] || '', lastName: s['นามสกุล'] || '' };
  });
}

function selectedTable() {
  return pickedRows().map((s, i) => [i + 1, s.cls, s.code,
    `${s.prefix}${s.firstName} ${s.lastName}`.trim()]);
}

async function copyPicked() {
  const rows = selectedTable();
  if (!rows.length) return toast('กรุณาเลือกนักเรียนก่อน', 'err');
  const value = [['ลำดับ', 'ชั้น', 'รหัสนักเรียน', 'ชื่อ-นามสกุล'], ...rows]
    .map(row => row.join('\t')).join('\n');
  try { await navigator.clipboard.writeText(value); toast('คัดลอกรายชื่อแล้ว', 'ok'); }
  catch (_) { toast('คัดลอกไม่ได้ กรุณาตรวจสิทธิ์คลิปบอร์ด', 'err'); }
}

function exportPicked() {
  const rows = selectedTable();
  if (!rows.length) return toast('กรุณาเลือกนักเรียนก่อน', 'err');
  if (typeof XLSX === 'undefined') return toast('ยังโหลดระบบ Excel ไม่สำเร็จ', 'err');
  const sheet = XLSX.utils.aoa_to_sheet([['ลำดับ', 'ชั้น', 'รหัสนักเรียน', 'ชื่อ-นามสกุล'], ...rows]);
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, 'รายชื่อที่เลือก');
  XLSX.writeFile(book, 'รายชื่อนักเรียนที่เลือก.xlsx');
}

function printPicked() {
  printStudentList(pickedRows(), 'รายชื่อนักเรียนที่เลือก', '');
}

function printStudentList(students, title, details) {
  if (!students.length) return toast('ไม่มีรายชื่อนักเรียนให้พิมพ์', 'err');
  const escapeHtml = value => String(value).replace(/[&<>"']/g, char =>
    ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[char]);
  const school = schoolName || document.getElementById('tbSchool').textContent || 'โรงเรียนบ้านคลอง 14';
  const rows = sortRecordStudents(students).map((s, i) => [i + 1, s.cls, s.code,
    `${s.prefix}${s.firstName} ${s.lastName}`.trim()]);
  const body = rows.map(row => `<tr>${row.map(value => `<td>${escapeHtml(value)}</td>`).join('')}</tr>`).join('');
  const html = `<!doctype html><html lang="th"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>
    <link href="https://fonts.googleapis.com/css2?family=Sarabun:wght@400;600;700&display=swap" rel="stylesheet">
    <style>@page{size:A4 portrait;margin:12mm}body{font-family:Sarabun,sans-serif;color:#111}
    h1,h2,p{text-align:center;margin:0}h1{font-size:16pt}h2{font-size:14pt;margin-top:3mm}p{font-size:10pt;margin:2mm 0 7mm}
    table{border-collapse:collapse;width:100%;font-size:11pt}th,td{border:1px solid #333;padding:5px 7px}
    th:nth-child(1),td:nth-child(1){width:8%;text-align:center}th:nth-child(2),td:nth-child(2){width:13%;text-align:center}
    th:nth-child(3),td:nth-child(3){width:18%;text-align:center}thead{display:table-header-group}tr{break-inside:avoid}</style>
    </head><body><h1>${escapeHtml(school)}</h1><h2>${escapeHtml(title)}</h2><p>${escapeHtml(details)}${details ? ' · ' : ''}รวม ${rows.length} คน</p>
    <table><thead><tr><th>ลำดับ</th><th>ชั้น</th><th>รหัสนักเรียน</th><th>ชื่อ-นามสกุล</th></tr></thead><tbody>${body}</tbody></table></body></html>`;
  const printWindow = window.open('', '_blank');
  if (!printWindow) return toast('กรุณาอนุญาต Pop-up ก่อนพิมพ์', 'err');
  printWindow.document.open();
  printWindow.document.write(html);
  printWindow.document.close();
  const ready = printWindow.document.fonts ? printWindow.document.fonts.ready : Promise.resolve();
  ready.then(() => { printWindow.focus(); printWindow.print(); });
}

function sortRecordStudents(students) {
  return [...students].sort((a, b) => {
    const rank = cls => { const i = classOrder.indexOf(cls); return i < 0 ? classOrder.length : i; };
    return rank(a.cls) - rank(b.cls);
  });
}

function updateRecordFields() {
  document.getElementById('recordNameWrap').style.display =
    document.getElementById('recordType').value === 'activity' ? 'block' : 'none';
}

async function recordRequest(payload) {
  return bridgeRequest(payload);
}

async function savePickedRecord() {
  if (!pickerPin) return toast('กรุณากรอกรหัสเลือกนักเรียนอีกครั้ง', 'err');
  const students = pickedRows();
  const type = document.getElementById('recordType').value;
  const name = document.getElementById('recordName').value.trim();
  const date = document.getElementById('recordDate').value;
  if (!students.length || !date || (type === 'activity' && !name))
    return toast('เลือกนักเรียน วันที่ และชื่อกิจกรรม (ถ้ามี)', 'err');
  const btn = document.getElementById('recordSaveBtn');
  btn.disabled = true;
  try {
    const json = await recordRequest({ action: 'saveRecord', pin: pickerPin,
      record: { type, date, name: type === 'activity' ? name : '', note: document.getElementById('recordNote').value.trim(), students } });
    if (!json.success) throw new Error(json.message || 'บันทึกไม่สำเร็จ');
    toast(json.message, 'ok');
    clearPicker();
    await loadRecords();
  } catch (e) { toast(e.message, 'err'); }
  finally { btn.disabled = false; }
}

async function loadRecords() {
  if (!pickerPin) return toast('กรุณากรอกรหัสเลือกนักเรียนอีกครั้ง', 'err');
  const list = document.getElementById('recordHistory');
  list.textContent = 'กำลังโหลด...';
  try {
    const json = await recordRequest({ action: 'getRecords', pin: pickerPin });
    if (!json.success) throw new Error(json.message || 'โหลดประวัติไม่สำเร็จ');
    loadedRecords = json.records;
    renderRecordHistory();
  } catch (e) { loadedRecords = []; list.textContent = e.message; }
}

function renderRecordHistory() {
    const list = document.getElementById('recordHistory');
    const query = document.getElementById('recordHistorySearch').value.trim().toLocaleLowerCase('th');
    const records = loadedRecords.filter(record =>
      `${record.date} ${record.name} ${record.note} ${record.students.map(s => `${s.cls} ${s.prefix}${s.firstName} ${s.lastName}`).join(' ')}`
        .toLocaleLowerCase('th').includes(query));
    list.replaceChildren();
    if (!records.length) { list.textContent = 'ไม่พบรายการ'; return; }
    const labels = { activity: 'กิจกรรม', late: 'มาสาย', conduct: 'ผิดระเบียบ' };
    records.forEach(record => {
      const details = document.createElement('details');
      const summary = document.createElement('summary');
      const title = record.type === 'activity' ? ` · ${record.name}` : '';
      summary.textContent = `${record.date} · ${labels[record.type] || record.type}${title} (${record.students.length} คน)`;
      details.appendChild(summary);
      if (record.note) { const note = document.createElement('div'); note.textContent = record.note; details.appendChild(note); }
      sortRecordStudents(record.students).forEach(s => {
        const line = document.createElement('div');
        line.textContent = `${s.cls} ${s.prefix}${s.firstName} ${s.lastName}`;
        details.appendChild(line);
      });
      const actions = document.createElement('div');
      actions.className = 'pick-actions';
      [['พิมพ์', () => printHistoryRecord(record.id)],
       ['แก้ไข', () => openRecordEditor(record.id)],
       ['ลบ', () => deleteHistoryRecord(record.id)]].forEach(([label, handler]) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'btn';
        button.textContent = label;
        button.addEventListener('click', handler);
        actions.appendChild(button);
      });
      details.appendChild(actions);
      list.appendChild(details);
    });
}

function historyRecord(id) { return loadedRecords.find(record => record.id === id); }

function printHistoryRecord(id) {
  const record = historyRecord(id);
  if (!record) return toast('ไม่พบรายการนี้ กรุณาโหลดประวัติใหม่', 'err');
  const labels = { activity: record.name || 'กิจกรรม', late: 'นักเรียนมาสาย', conduct: 'นักเรียนผิดระเบียบ' };
  const details = [record.date, record.note].filter(Boolean).join(' · ');
  printStudentList(record.students, labels[record.type] || 'รายชื่อนักเรียน', details);
}

function studentIdentity(student) {
  return [student.cls, student.code, student.prefix, student.firstName, student.lastName].join('\u001f');
}

function openRecordEditor(id) {
  const record = historyRecord(id);
  if (!record) return toast('ไม่พบรายการนี้ กรุณาโหลดประวัติใหม่', 'err');
  editingRecordId = id;
  editingStudents = record.students.map(s => ({ ...s }));
  const classSelect = document.getElementById('editClass');
  classSelect.replaceChildren(new Option('ทุกชั้น', ''));
  classOrder.filter(cls => allData.some(s => s['ชั้น'] === cls))
    .forEach(cls => classSelect.add(new Option(cls, cls)));
  document.getElementById('editSearch').value = '';
  document.getElementById('editType').value = record.type;
  document.getElementById('editDate').value = record.date;
  document.getElementById('editName').value = record.type === 'activity' ? record.name : '';
  document.getElementById('editNote').value = record.note || '';
  updateEditFields();
  renderEditCandidates();
  renderEditingStudents();
  document.getElementById('editOverlay').classList.add('show');
}

function closeRecordEditor() {
  document.getElementById('editOverlay').classList.remove('show');
  editingRecordId = '';
  editingStudents = [];
}

function updateEditFields() {
  document.getElementById('editNameWrap').style.display =
    document.getElementById('editType').value === 'activity' ? 'block' : 'none';
}

function renderEditCandidates() {
  const cls = document.getElementById('editClass').value;
  const query = document.getElementById('editSearch').value.trim().toLocaleLowerCase('th');
  const list = document.getElementById('editCandidates');
  list.replaceChildren();
  let count = 0;
  allData.forEach(s => {
    if (cls && s['ชั้น'] !== cls) return;
    const student = { cls: s['ชั้น'] || '', room: s['ห้อง'] || '', code: s['รหัสนักเรียน'] || '',
      prefix: s['คำนำหน้าชื่อ'] || '', firstName: s['ชื่อ'] || '', lastName: s['นามสกุล'] || '' };
    const name = `${student.prefix}${student.firstName} ${student.lastName}`.trim();
    if (query && !`${name} ${student.code}`.toLocaleLowerCase('th').includes(query)) return;
    count++;
    const row = document.createElement('label');
    row.className = 'pick-row';
    const box = document.createElement('input');
    box.type = 'checkbox';
    box.checked = editingStudents.some(existing => studentIdentity(existing) === studentIdentity(student));
    box.addEventListener('change', () => {
      if (box.checked) editingStudents.push(student);
      else editingStudents = editingStudents.filter(existing => studentIdentity(existing) !== studentIdentity(student));
      renderEditingStudents();
    });
    const label = document.createElement('span');
    label.textContent = name;
    const meta = document.createElement('small');
    meta.textContent = `${student.cls} · ${student.code}`;
    row.append(box, label, meta);
    list.appendChild(row);
  });
  document.getElementById('editResultCount').textContent = `พบ ${count} คน`;
}

function renderEditingStudents() {
  editingStudents = sortRecordStudents(editingStudents);
  document.getElementById('editCount').textContent = `ในรายการ ${editingStudents.length} คน`;
  const list = document.getElementById('editSelected');
  list.replaceChildren();
  if (!editingStudents.length) { list.textContent = 'ยังไม่มีนักเรียนในรายการ'; return; }
  editingStudents.forEach((student, index) => {
    const row = document.createElement('div');
    row.className = 'edit-selected-row';
    const name = document.createElement('span');
    name.textContent = `${student.cls} ${student.prefix}${student.firstName} ${student.lastName}`;
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'btn';
    remove.textContent = 'นำออก';
    remove.setAttribute('aria-label', `นำ ${name.textContent} ออกจากรายการ`);
    remove.addEventListener('click', () => {
      editingStudents.splice(index, 1);
      renderEditingStudents();
      renderEditCandidates();
    });
    row.append(name, remove);
    list.appendChild(row);
  });
}

async function saveEditedRecord() {
  if (!editingRecordId || !pickerPin) return toast('กรุณาเปิดรายการอีกครั้ง', 'err');
  const type = document.getElementById('editType').value;
  const record = { type, date: document.getElementById('editDate').value,
    name: type === 'activity' ? document.getElementById('editName').value.trim() : '',
    note: document.getElementById('editNote').value.trim(), students: editingStudents };
  if (!record.students.length || !record.date || (type === 'activity' && !record.name))
    return toast('กรอกวันที่ ชื่อกิจกรรม (ถ้ามี) และเลือกนักเรียนอย่างน้อย 1 คน', 'err');
  const button = document.getElementById('editSaveBtn');
  button.disabled = true;
  try {
    const result = await recordRequest({ action: 'updateRecord', id: editingRecordId, record, pin: pickerPin });
    if (!result.success) throw new Error(result.message || 'แก้ไขไม่สำเร็จ');
    closeRecordEditor();
    toast(result.message, 'ok');
    await loadRecords();
  } catch (e) { toast(e.message, 'err'); }
  finally { button.disabled = false; }
}

async function deleteHistoryRecord(id) {
  const record = historyRecord(id);
  if (!record || !pickerPin) return toast('กรุณาโหลดประวัติใหม่', 'err');
  const title = record.type === 'activity' ? record.name : (record.type === 'late' ? 'มาสาย' : 'ผิดระเบียบ');
  if (!window.confirm(`ลบรายการ “${title}” วันที่ ${record.date} จำนวน ${record.students.length} คน?`)) return;
  try {
    const result = await recordRequest({ action: 'deleteRecord', id, pin: pickerPin });
    if (!result.success) throw new Error(result.message || 'ลบไม่สำเร็จ');
    toast(result.message, 'ok');
    await loadRecords();
  } catch (e) { toast(e.message, 'err'); }
}
