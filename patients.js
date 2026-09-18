// AegisICU — Patient Management Module
// Handles: Add Patient, Real-Time Vital Simulation, Alerts, Notes
"use strict";

// ─────────────────────────────────────────────────────────────────────────────
// ALERT SYSTEM
// ─────────────────────────────────────────────────────────────────────────────
window.AEGIS_ALERTS = [];
let alertIdCounter = 1000;

function pushAlert(patientId, patientName, message, level = 'critical') {
  const alert = {
    id: alertIdCounter++,
    patientId,
    patientName,
    message,
    level,
    time: new Date(),
    read: false
  };
  window.AEGIS_ALERTS.unshift(alert);
  if (window.AEGIS_ALERTS.length > 50) window.AEGIS_ALERTS.pop();
  renderAlertBadge();
  showToastAlert(alert);
  return alert;
}

function renderAlertBadge() {
  const unread = window.AEGIS_ALERTS.filter(a => !a.read).length;
  const badge = document.getElementById('alert-badge-count');
  if (badge) {
    badge.textContent = unread;
    badge.style.display = unread > 0 ? 'flex' : 'none';
  }
}

function showToastAlert(alert) {
  const colors = { critical: '#f43f5e', elevated: '#f59e0b', stable: '#10b981', info: '#06b6d4' };
  const icons  = { critical: '🚨', elevated: '⚠️', stable: '✅', info: 'ℹ️' };
  const col = colors[alert.level] || colors.info;

  const toast = document.createElement('div');
  toast.className = 'aegis-toast';
  toast.style.cssText = `
    position:fixed; bottom:70px; right:20px; max-width:320px; z-index:99999;
    padding:12px 16px; border-radius:10px;
    background:white; border:1px solid ${col}44;
    box-shadow:0 4px 20px rgba(0,0,0,0.12), 0 0 0 1px ${col}22;
    animation:toastIn 0.35s cubic-bezier(0.34,1.56,0.64,1);
    cursor:pointer; transition:opacity 0.3s;
  `;
  toast.innerHTML = `
    <div style="display:flex;align-items:flex-start;gap:10px">
      <span style="font-size:18px;line-height:1">${icons[alert.level]}</span>
      <div style="flex:1">
        <div style="font-size:11px;font-weight:700;color:${col};margin-bottom:2px;font-family:'JetBrains Mono',monospace">${alert.patientId} — ${alert.patientName}</div>
        <div style="font-size:12px;color:#1a202c;line-height:1.4">${alert.message}</div>
        <div style="font-size:10px;color:#a0aec0;margin-top:4px">${alert.time.toLocaleTimeString()}</div>
      </div>
      <button onclick="this.closest('.aegis-toast').remove()" style="background:none;border:none;color:#a0aec0;cursor:pointer;font-size:14px;padding:0;line-height:1">✕</button>
    </div>
  `;
  document.body.appendChild(toast);
  toast.onclick = (e) => { if (e.target.tagName !== 'BUTTON') toast.remove(); };
  setTimeout(() => { toast.style.opacity = '0'; setTimeout(() => toast.remove(), 300); }, 5000);
}

// ─────────────────────────────────────────────────────────────────────────────
// REAL-TIME VITAL SIMULATION ENGINE
// ─────────────────────────────────────────────────────────────────────────────
window.AEGIS_RT_STATE = {};

function initRealTimeState(patientIdx) {
  const p = window.AEGIS_PATIENTS[patientIdx];
  const v = p.vitals[0];
  window.AEGIS_RT_STATE[patientIdx] = {
    hr:      v.hr,
    rr:      v.rr,
    spo2:    v.spo2,
    sbp:     v.sbp,
    lactate: v.lactate,
    temp:    v.temp,
    gcs:     v.gcs,
    tick:    0,
    lastAlertTick: -20
  };
}

function tickRealTimeVitals() {
  window.AEGIS_PATIENTS.forEach((p, idx) => {
    if (!window.AEGIS_RT_STATE[idx]) initRealTimeState(idx);
    const rt = window.AEGIS_RT_STATE[idx];
    rt.tick++;

    const riskNow = getRiskAtT(p, Math.min(rt.tick % 36 + 1, 36));
    const intensity = riskNow;

    // Drift vitals realistically
    rt.hr      = clamp(rt.hr      + (Math.random()-0.48)*2.5 + intensity*0.3, 35, 175);
    rt.rr      = clamp(rt.rr      + (Math.random()-0.45)*0.7 + intensity*0.2, 8, 40);
    rt.spo2    = clamp(rt.spo2    + (Math.random()-0.55)*0.3 - intensity*0.05, 70, 100);
    rt.sbp     = clamp(rt.sbp     + (Math.random()-0.52)*3   - intensity*0.2, 55, 210);
    rt.lactate = clamp(rt.lactate + (Math.random()-0.40)*0.1 + intensity*0.03, 0.5, 12);
    rt.temp    = clamp(rt.temp    + (Math.random()-0.50)*0.05, 35.0, 40.5);
    rt.gcs     = Math.max(3, Math.min(15, rt.gcs + (Math.random() > 0.95 ? -1 : 0)));

    // Trigger alerts for critical patients
    if (p.status === 'critical' && rt.tick - rt.lastAlertTick > 30 && Math.random() < 0.03) {
      rt.lastAlertTick = rt.tick;
      const alertMsgs = [
        `SpO₂ critical: ${rt.spo2.toFixed(1)}% — respiratory support recommended`,
        `HR surge: ${Math.round(rt.hr)} bpm — cardiac monitoring escalated`,
        `Lactate elevated: ${rt.lactate.toFixed(2)} mmol/L — metabolic acidosis risk`,
        `SBP drop: ${Math.round(rt.sbp)} mmHg — vasopressor threshold approaching`,
        `RR increasing: ${rt.rr.toFixed(1)}/min — intubation risk flagged`,
      ];
      pushAlert(p.id, p.name, alertMsgs[Math.floor(Math.random() * alertMsgs.length)], 'critical');
    }
    if (p.status === 'elevated' && rt.tick - rt.lastAlertTick > 60 && Math.random() < 0.01) {
      rt.lastAlertTick = rt.tick;
      pushAlert(p.id, p.name, `Risk score rising — continuous monitoring advised`, 'elevated');
    }
  });

  // Update display for active patient
  const activeIdx = window.STATE ? STATE.activePatientIdx : 0;
  const rt = window.AEGIS_RT_STATE[activeIdx];
  const p  = window.AEGIS_PATIENTS[activeIdx];
  if (!rt) return;

  // Update vital chips with live data
  const hrEl   = document.getElementById('vital-chip-hr');
  const rrEl   = document.getElementById('vital-chip-rr');
  const spo2El = document.getElementById('vital-chip-spo2');
  const sbpEl  = document.getElementById('vital-chip-sbp');
  const lacEl  = document.getElementById('vital-chip-lac');

  if (hrEl)   { hrEl.textContent   = `HR ${Math.round(rt.hr)} bpm`; hrEl.style.color = rt.hr > 120 ? '#f43f5e' : '#f1f5f9'; }
  if (rrEl)   { rrEl.textContent   = `RR ${rt.rr.toFixed(1)}/min`; rrEl.style.color = rt.rr > 25 ? '#f43f5e' : rt.rr > 20 ? '#f59e0b' : '#f1f5f9'; }
  if (spo2El) { spo2El.textContent = `SpO₂ ${rt.spo2.toFixed(1)}%`; spo2El.style.color = rt.spo2 < 90 ? '#f43f5e' : rt.spo2 < 94 ? '#f59e0b' : '#10b981'; }
  if (sbpEl)  { sbpEl.textContent  = `SBP ${Math.round(rt.sbp)}`; sbpEl.style.color = rt.sbp < 90 ? '#f43f5e' : rt.sbp < 100 ? '#f59e0b' : '#f1f5f9'; }
  if (lacEl)  { lacEl.textContent  = `Lac ${rt.lactate.toFixed(2)}`; lacEl.style.color = rt.lactate > 4 ? '#f43f5e' : rt.lactate > 2 ? '#f59e0b' : '#10b981'; }

  // Update live RT badge in header
  const rtBadge = document.getElementById('rt-vital-badge');
  if (rtBadge) {
    const riskNow = getRiskAtT(p, STATE.currentT);
    rtBadge.innerHTML = `<span class="rt-pulse-dot"></span>LIVE ${p.id} — HR:${Math.round(rt.hr)} • SpO₂:${rt.spo2.toFixed(0)}% • SBP:${Math.round(rt.sbp)}`;
    rtBadge.style.color = riskNow >= 0.5 ? '#f43f5e' : riskNow >= 0.35 ? '#f59e0b' : '#10b981';
  }
}

function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }

// Start real-time simulation
function startRealTimeSim() {
  if (window.AEGIS_RT_INTERVAL) clearInterval(window.AEGIS_RT_INTERVAL);
  window.AEGIS_PATIENTS.forEach((_, idx) => initRealTimeState(idx));
  window.AEGIS_RT_INTERVAL = setInterval(tickRealTimeVitals, 2000);
  console.log('[AegisICU] Real-time vital simulation started ✓');
}

// ─────────────────────────────────────────────────────────────────────────────
// PATIENT NOTES
// ─────────────────────────────────────────────────────────────────────────────
window.AEGIS_NOTES = {};

function getNextBedAssignment() {
  const highestBedNumber = (window.AEGIS_PATIENTS || []).reduce((highest, patient) => {
    const match = String(patient.bed || '').match(/(\d+)\s*$/);
    return Math.max(highest, match ? Number(match[1]) : 0);
  }, 0);
  return `MICU Bed ${String(highestBedNumber + 1).padStart(2, '0')}`;
}

function addNote(patientId, noteText, author = 'Dr. System') {
  if (!window.AEGIS_NOTES[patientId]) window.AEGIS_NOTES[patientId] = [];
  window.AEGIS_NOTES[patientId].unshift({
    id: Date.now(),
    text: noteText,
    author,
    time: new Date()
  });
}

function getNotes(patientId) {
  return window.AEGIS_NOTES[patientId] || [];
}

// ─────────────────────────────────────────────────────────────────────────────
// ADD PATIENT MODAL
// ─────────────────────────────────────────────────────────────────────────────
window.openAddPatientModal = function() {
  const overlay = document.getElementById('add-patient-overlay');
  const bedInput = document.getElementById('ap-bed');
  if (bedInput) bedInput.value = getNextBedAssignment();
  if (overlay) overlay.classList.add('visible');
};

window.closeAddPatientModal = function() {
  const overlay = document.getElementById('add-patient-overlay');
  if (overlay) overlay.classList.remove('visible');
  const form = document.getElementById('add-patient-form');
  if (form) form.reset();
};

window.submitAddPatient = function(e) {
  e.preventDefault();
  const f = e.target;

  const name   = f.querySelector('#ap-name').value.trim();
  const age    = parseInt(f.querySelector('#ap-age').value);
  const sex    = f.querySelector('#ap-sex').value;
  const bed    = getNextBedAssignment();
  const dx     = f.querySelector('#ap-diagnosis').value.trim();
  const status = f.querySelector('#ap-status').value;
  const hr     = parseInt(f.querySelector('#ap-hr').value) || 85;
  const rr     = parseFloat(f.querySelector('#ap-rr').value) || 18;
  const spo2   = parseFloat(f.querySelector('#ap-spo2').value) || 97;
  const sbp    = parseInt(f.querySelector('#ap-sbp').value) || 120;
  const lactate= parseFloat(f.querySelector('#ap-lactate').value) || 1.2;
  const comorbsRaw = f.querySelector('#ap-comorbidities').value.trim();
  const comorbs = comorbsRaw ? comorbsRaw.split(',').map(c => c.trim()) : [];

  const newId = `PT-${20000 + window.AEGIS_PATIENTS.length}`;
  const eventT  = status === 'critical' ? 14 + Math.floor(Math.random()*8) : status === 'elevated' ? 22 + Math.floor(Math.random()*8) : 30 + Math.floor(Math.random()*6);
  const alertT  = eventT - 6 - Math.floor(Math.random()*3);
  const peakRisk= status === 'critical' ? 0.82 + Math.random()*0.12 : status === 'elevated' ? 0.65 + Math.random()*0.15 : 0.50 + Math.random()*0.15;
  const leadTime= eventT - alertT;

  const newPatient = {
    id:          newId,
    name,
    age,
    sex,
    bed,
    diagnosis:   dx,
    event_t:     eventT,
    alert_t:     alertT,
    peak_risk:   parseFloat(peakRisk.toFixed(3)),
    lead_time:   leadTime,
    rr_velocity: parseFloat((1.5 + Math.random() * 5).toFixed(1)),
    status,
    comorbidities: comorbs,
    vitals: generateVitals({
      hr_base: hr, rr_base: rr, spo2_base: spo2, sbp_base: sbp,
      lactate_base: lactate, temp_base: 37.2, gcs_base: 14,
      event_t: eventT, hr_drift: 0.8, rr_drift: 0.6,
      spo2_drop: 0.5, sbp_drop: 1.2, lac_rise: 0.15
    }),
    risk: generateRiskTrajectory(eventT, alertT, peakRisk),
    shap: generateSHAP(eventT, alertT),
    isNew: true
  };

  window.AEGIS_PATIENTS.push(newPatient);

  // Update metrics
  window.AEGIS_METRICS.monitored_beds = window.AEGIS_PATIENTS.length;
  window.AEGIS_METRICS.critical_alerts = window.AEGIS_PATIENTS.filter(p => p.status === 'critical').length;
  window.AEGIS_METRICS.elevated_alerts = window.AEGIS_PATIENTS.filter(p => p.status === 'elevated').length;

  // Init RT state for new patient
  initRealTimeState(window.AEGIS_PATIENTS.length - 1);

  // Rebuild bed rail
  if (typeof buildBedRail === 'function') buildBedRail();

  // Update KPI
  updateMonitoredBedsKPI();

  // Alert
  pushAlert(newId, name, `Patient admitted — ${dx}`, status === 'critical' ? 'critical' : 'info');

  closeAddPatientModal();

  // Show confirmation
  showSuccessToast(`✓ Patient ${name} (${newId}) admitted to ${bed}`);
};

function updateMonitoredBedsKPI() {
  const el = document.getElementById('monitored-beds');
  if (!el) return;
  const m = window.AEGIS_METRICS;
  el.textContent = `${m.monitored_beds} Active • ${m.critical_alerts} 🚨 • ${m.elevated_alerts} ⚠️`;
}

function showSuccessToast(msg) {
  const t = document.createElement('div');
  t.style.cssText = `position:fixed;bottom:70px;right:20px;padding:12px 18px;background:white;border:1px solid #a7f3d0;border-radius:10px;color:#065f46;font-size:13px;font-weight:600;z-index:99999;animation:toastIn 0.35s ease;box-shadow:0 4px 16px rgba(0,0,0,0.1)`;
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => { t.style.opacity = '0'; t.style.transition = 'opacity 0.3s'; setTimeout(() => t.remove(), 300); }, 3500);
}

// ─────────────────────────────────────────────────────────────────────────────
// ALERTS MODAL
// ─────────────────────────────────────────────────────────────────────────────
window.openAlertsModal = function() {
  const body = document.getElementById('alerts-modal-body');
  if (!body) return;
  window.AEGIS_ALERTS.forEach(a => a.read = true);
  renderAlertBadge();

  const html = window.AEGIS_ALERTS.length === 0
    ? `<div style="text-align:center;padding:40px;color:#64748b">No active alerts at this time</div>`
    : window.AEGIS_ALERTS.map(a => {
        const colors = { critical:'#ef4444', elevated:'#f59e0b', stable:'#10b981', info:'#06b6d4' };
        const icons  = { critical:'🚨', elevated:'⚠️', stable:'✅', info:'ℹ️' };
        const col = colors[a.level] || colors.info;
        return `<div style="padding:12px 14px;margin-bottom:8px;border-radius:8px;background:#f8fafc;border:1px solid #e2e8f0;border-left:4px solid ${col}">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
            <span style="font-size:12px;font-weight:700;color:${col}">${icons[a.level]} ${a.patientId} — ${a.patientName}</span>
            <span style="font-size:10px;color:#64748b">${a.time.toLocaleTimeString()}</span>
          </div>
          <div style="font-size:12px;color:#1e293b;line-height:1.4;font-weight:500">${a.message}</div>
        </div>`;
      }).join('');

  body.innerHTML = html;
  const countBadge = document.getElementById('alerts-count-badge');
  if (countBadge) countBadge.textContent = `${window.AEGIS_ALERTS.length} Alerts`;
  document.getElementById('alerts-overlay').classList.add('visible');
};

window.closeAlertsModal = function() {
  document.getElementById('alerts-overlay').classList.remove('visible');
};

// ─────────────────────────────────────────────────────────────────────────────
// PATIENT NOTES MODAL
// ─────────────────────────────────────────────────────────────────────────────
window.openPatientNotesModal = function() {
  const p = window.AEGIS_PATIENTS[STATE.activePatientIdx];
  if (!p) return;
  const overlay = document.getElementById('notes-overlay');
  const title   = document.getElementById('notes-modal-title');
  const body    = document.getElementById('notes-modal-body');

  if (title) title.textContent = `Notes — ${p.name} (${p.id})`;
  renderNotesList(p.id, body);
  overlay.classList.add('visible');
};

window.closeNotesModal = function() {
  document.getElementById('notes-overlay').classList.remove('visible');
};

window.submitNote = function() {
  const inp = document.getElementById('notes-input');
  const author = document.getElementById('notes-author').value || 'Dr. Unknown';
  if (!inp || !inp.value.trim()) return;
  const p = window.AEGIS_PATIENTS[STATE.activePatientIdx];
  addNote(p.id, inp.value.trim(), author);
  inp.value = '';
  renderNotesList(p.id, document.getElementById('notes-modal-body'));
  showSuccessToast('✓ Note saved');
};

function renderNotesList(patientId, container) {
  if (!container) return;
  const notes = getNotes(patientId);
  container.innerHTML = notes.length === 0
    ? `<div style="text-align:center;padding:30px;color:#a0aec0">No notes yet. Add the first note below.</div>`
    : notes.map(n => `
        <div style="padding:10px 12px;margin-bottom:8px;border-radius:8px;background:#f8fafc;border:1px solid #e2e8f0">
          <div style="display:flex;justify-content:space-between;margin-bottom:4px">
            <span style="font-size:11px;color:#3b82f6;font-weight:600">${n.author}</span>
            <span style="font-size:10px;color:#a0aec0">${n.time.toLocaleString()}</span>
          </div>
          <div style="font-size:12px;color:#4a5568;line-height:1.5">${n.text}</div>
        </div>`).join('');
}

// ─────────────────────────────────────────────────────────────────────────────
// DISCHARGE PATIENT
// ─────────────────────────────────────────────────────────────────────────────
window.dischargePatient = function(idx) {
  if (idx === undefined) idx = STATE.activePatientIdx;
  const p = window.AEGIS_PATIENTS[idx];
  if (!p) return;
  if (window.AEGIS_PATIENTS.length === 1) {
    showSuccessToast('At least one monitored patient must remain in the ICU view');
    return;
  }
  if (!confirm(`Discharge ${p.name} (${p.id}) from ${p.bed}?`)) return;

  window.AEGIS_PATIENTS.splice(idx, 1);
  const nextRtState = {};
  window.AEGIS_PATIENTS.forEach((_, patientIdx) => {
    const oldIdx = patientIdx >= idx ? patientIdx + 1 : patientIdx;
    if (window.AEGIS_RT_STATE[oldIdx]) nextRtState[patientIdx] = window.AEGIS_RT_STATE[oldIdx];
  });
  window.AEGIS_RT_STATE = nextRtState;

  window.AEGIS_METRICS.monitored_beds = window.AEGIS_PATIENTS.length;
  window.AEGIS_METRICS.critical_alerts = window.AEGIS_PATIENTS.filter(p => p.status === 'critical').length;
  window.AEGIS_METRICS.elevated_alerts = window.AEGIS_PATIENTS.filter(p => p.status === 'elevated').length;

  if (STATE.activePatientIdx >= window.AEGIS_PATIENTS.length) {
    STATE.activePatientIdx = Math.max(0, window.AEGIS_PATIENTS.length - 1);
  }

  if (typeof buildBedRail === 'function') buildBedRail();
  if (typeof switchPatient === 'function') switchPatient(STATE.activePatientIdx);
  updateMonitoredBedsKPI();
  showSuccessToast(`✓ ${p.name} discharged successfully`);
};

// ─────────────────────────────────────────────────────────────────────────────
// INJECT UI ELEMENTS
// ─────────────────────────────────────────────────────────────────────────────
function initPatientsModule() {
  injectAddPatientModal();
  injectAlertsModal();
  injectNotesModal();
  injectNavButtons();
  injectRTVitalBadge();
  injectToastStyles();
  startRealTimeSim();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initPatientsModule);
} else {
  initPatientsModule();
}

function injectToastStyles() {
  const style = document.createElement('style');
  style.textContent = `
    @keyframes toastIn {
      from { opacity:0; transform:translateY(20px) scale(0.95); }
      to   { opacity:1; transform:translateY(0) scale(1); }
    }
    .rt-pulse-dot {
      display:inline-block; width:6px; height:6px;
      border-radius:50%; background:currentColor;
      margin-right:5px; animation:rtPulse 1.2s infinite;
    }
    @keyframes rtPulse {
      0%,100% { opacity:1; transform:scale(1); }
      50% { opacity:0.4; transform:scale(0.7); }
    }
    #alert-nav-btn { position:relative; }
    #alert-badge-count {
      position:absolute; top:4px; right:4px;
      width:16px; height:16px; border-radius:50%;
      background:#ef4444; color:#fff;
      font-size:9px; font-weight:700;
      display:flex; align-items:center; justify-content:center;
      font-family:'JetBrains Mono',monospace;
      box-shadow:0 0 8px rgba(239,68,68,0.6);
    }
    .notes-input-wrap { display:flex; flex-direction:column; gap:8px; margin-top:12px; padding-top:12px; border-top:1px solid var(--border, #e2e8f0); }
    .vitals-live-grid {
      display:grid; grid-template-columns:repeat(3,1fr); gap:10px;
      margin-bottom:16px;
    }
    .vital-live-card {
      padding:10px 12px; border-radius:8px;
      background:#f8fafc; border:1px solid #e2e8f0;
      text-align:center;
    }
    .vital-live-value { font-size:18px; font-weight:700; font-family:'JetBrains Mono',monospace; }
    .vital-live-label { font-size:9px; color:#64748b; text-transform:uppercase; letter-spacing:0.5px; margin-top:2px; }
    .discharge-btn-wrap { display:flex; justify-content:flex-end; margin-top:8px; }
  `;
  document.head.appendChild(style);
}

function injectRTVitalBadge() {
  const header = document.getElementById('app-header');
  if (!header || document.getElementById('rt-vital-badge')) return;
  const badge = document.createElement('div');
  badge.id = 'rt-vital-badge';
  badge.innerHTML = `<span class="rt-pulse-dot"></span>LIVE TELEMETRY`;
  header.appendChild(badge);
}

function injectNavButtons() {
  const rail = document.getElementById('nav-rail');
  if (!rail) return;

  // Add Patient button
  const addBtn = document.createElement('button');
  addBtn.className = 'nav-btn';
  addBtn.id = 'add-patient-btn-nav';
  addBtn.setAttribute('aria-label', 'Add Patient');
  addBtn.innerHTML = `➕<span class="tooltip">Add Patient</span>`;
  addBtn.style.cssText = 'margin-top:4px;';
  addBtn.onclick = () => window.openAddPatientModal();

  // Alerts button
  const alertBtn = document.createElement('button');
  alertBtn.className = 'nav-btn';
  alertBtn.id = 'alert-nav-btn';
  alertBtn.setAttribute('aria-label', 'Alerts');
  alertBtn.innerHTML = `🔔<span class="tooltip">Alerts</span><span id="alert-badge-count" style="display:none">0</span>`;
  alertBtn.onclick = () => window.openAlertsModal();

  // Notes button
  const notesBtn = document.createElement('button');
  notesBtn.className = 'nav-btn';
  notesBtn.id = 'notes-nav-btn';
  notesBtn.setAttribute('aria-label', 'Patient Notes');
  notesBtn.innerHTML = `📝<span class="tooltip">Patient Notes</span>`;
  notesBtn.onclick = () => window.openPatientNotesModal();

  // Discharge button
  const discBtn = document.createElement('button');
  discBtn.className = 'nav-btn';
  discBtn.id = 'discharge-nav-btn';
  discBtn.setAttribute('aria-label', 'Discharge Patient');
  discBtn.innerHTML = `🚪<span class="tooltip">Discharge Patient</span>`;
  discBtn.onclick = () => window.dischargePatient();

  const spacer = rail.querySelector('.nav-spacer');
  if (spacer) {
    rail.insertBefore(addBtn, spacer);
    rail.insertBefore(alertBtn, spacer);
    rail.insertBefore(notesBtn, spacer);
    rail.insertBefore(discBtn, spacer);
  } else {
    rail.appendChild(addBtn);
    rail.appendChild(alertBtn);
    rail.appendChild(notesBtn);
    rail.appendChild(discBtn);
  }
}

function injectAddPatientModal() {
  const modal = document.createElement('div');
  modal.className = 'aegis-overlay-modal';
  modal.id = 'add-patient-overlay';
  modal.onclick = (e) => { if (e.target === modal) window.closeAddPatientModal(); };
  modal.innerHTML = `
    <div class="aegis-modal-card" style="width:min(760px,96vw)">
      <div class="aegis-modal-hdr">
        <div class="aegis-modal-hdr-title">
          <span style="font-size:18px">➕</span>
          Admit New Patient to ICU
        </div>
        <button class="aegis-close-btn" onclick="window.closeAddPatientModal()">✕</button>
      </div>
      <div class="aegis-modal-body-scroll">
        <form id="add-patient-form" onsubmit="window.submitAddPatient(event)">

          <div class="form-section-title">Patient Demographics</div>
          <div class="form-grid">
            <div class="form-group">
              <label class="form-label" for="ap-name">Full Name *</label>
              <input class="form-input" id="ap-name" type="text" placeholder="e.g. Jane Doe" required />
            </div>
            <div class="form-group">
              <label class="form-label" for="ap-bed">Next Bed Assignment</label>
              <input class="form-input" id="ap-bed" type="text" value="MICU Bed 19" readonly aria-describedby="ap-bed-help" />
              <span id="ap-bed-help" style="font-size:10px;color:#64748b">Assigned automatically in sequence for each new admission.</span>
            </div>
            <div class="form-group">
              <label class="form-label" for="ap-age">Age *</label>
              <input class="form-input" id="ap-age" type="number" min="1" max="120" placeholder="e.g. 65" required />
            </div>
            <div class="form-group">
              <label class="form-label" for="ap-sex">Sex</label>
              <select class="form-input" id="ap-sex">
                <option value="F">Female</option>
                <option value="M">Male</option>
              </select>
            </div>
            <div class="form-group full">
              <label class="form-label" for="ap-diagnosis">Primary Diagnosis *</label>
              <input class="form-input" id="ap-diagnosis" type="text" placeholder="e.g. Septic Shock — Pulmonary Source" required />
            </div>
            <div class="form-group full">
              <label class="form-label" for="ap-comorbidities">Comorbidities (comma-separated)</label>
              <input class="form-input" id="ap-comorbidities" type="text" placeholder="e.g. T2DM, Hypertension, CKD II" />
            </div>
            <div class="form-group">
              <label class="form-label" for="ap-status">Acuity Status *</label>
              <select class="form-input" id="ap-status">
                <option value="critical">🔴 Critical</option>
                <option value="elevated">🟡 Elevated</option>
                <option value="stable">🟢 Stable</option>
              </select>
            </div>
          </div>

          <div class="form-section-title">Admission Vitals</div>
          <div class="form-grid">
            <div class="form-group">
              <label class="form-label" for="ap-hr">Heart Rate (bpm)</label>
              <input class="form-input" id="ap-hr" type="number" min="30" max="200" placeholder="e.g. 95" />
            </div>
            <div class="form-group">
              <label class="form-label" for="ap-rr">Resp. Rate (/min)</label>
              <input class="form-input" id="ap-rr" type="number" min="5" max="50" step="0.5" placeholder="e.g. 22" />
            </div>
            <div class="form-group">
              <label class="form-label" for="ap-spo2">SpO₂ (%)</label>
              <input class="form-input" id="ap-spo2" type="number" min="60" max="100" step="0.1" placeholder="e.g. 94" />
            </div>
            <div class="form-group">
              <label class="form-label" for="ap-sbp">Systolic BP (mmHg)</label>
              <input class="form-input" id="ap-sbp" type="number" min="50" max="220" placeholder="e.g. 108" />
            </div>
            <div class="form-group">
              <label class="form-label" for="ap-lactate">Lactate (mmol/L)</label>
              <input class="form-input" id="ap-lactate" type="number" min="0.5" max="15" step="0.1" placeholder="e.g. 2.4" />
            </div>
          </div>

          <div style="display:flex;justify-content:flex-end;gap:10px;margin-top:20px;padding-top:16px;border-top:1px solid rgba(255,255,255,0.07)">
            <button type="button" class="btn-secondary" onclick="window.closeAddPatientModal()">Cancel</button>
            <button type="submit" class="btn-primary">➕ Admit Patient</button>
          </div>
        </form>
      </div>
    </div>`;
  document.body.appendChild(modal);
}

function injectAlertsModal() {
  const modal = document.createElement('div');
  modal.className = 'aegis-overlay-modal';
  modal.id = 'alerts-overlay';
  modal.onclick = (e) => { if (e.target === modal) window.closeAlertsModal(); };
  modal.innerHTML = `
    <div class="aegis-modal-card">
      <div class="aegis-modal-hdr">
        <div class="aegis-modal-hdr-title">
          <span>🔔</span> ICU Alert Feed
          <span id="alerts-count-badge" style="padding:2px 8px;border-radius:20px;background:rgba(244,63,94,0.15);border:1px solid rgba(244,63,94,0.3);color:#f43f5e;font-size:10px;font-family:'JetBrains Mono',monospace"></span>
        </div>
        <button class="aegis-close-btn" onclick="window.closeAlertsModal()">✕</button>
      </div>
      <div class="aegis-modal-body-scroll" id="alerts-modal-body">
        <div style="text-align:center;padding:40px;color:#475569">No alerts yet</div>
      </div>
    </div>`;
  document.body.appendChild(modal);
}

function injectNotesModal() {
  const modal = document.createElement('div');
  modal.className = 'aegis-overlay-modal';
  modal.id = 'notes-overlay';
  modal.onclick = (e) => { if (e.target === modal) window.closeNotesModal(); };
  modal.innerHTML = `
    <div class="aegis-modal-card">
      <div class="aegis-modal-hdr">
        <div class="aegis-modal-hdr-title">
          <span>📝</span>
          <span id="notes-modal-title">Patient Notes</span>
        </div>
        <button class="aegis-close-btn" onclick="window.closeNotesModal()">✕</button>
      </div>
      <div class="aegis-modal-body-scroll">
        <div id="notes-modal-body" style="margin-bottom:4px">
          <div style="text-align:center;padding:30px;color:#475569">No notes yet.</div>
        </div>
        <div class="notes-input-wrap">
          <div style="display:flex;gap:8px">
            <input class="form-input" id="notes-author" type="text" placeholder="Your name (e.g. Dr. Smith)" style="flex:1;max-width:200px" />
            <span style="font-size:11px;color:#475569;align-self:center">Clinical note:</span>
          </div>
          <div style="display:flex;gap:8px;align-items:flex-end">
            <textarea class="form-input" id="notes-input" rows="3" placeholder="Enter clinical observation, order, or note..."
              style="flex:1;resize:none;font-family:'Inter',sans-serif"></textarea>
            <button class="btn-primary" onclick="window.submitNote()" style="padding:10px 16px;white-space:nowrap">💾 Save Note</button>
          </div>
        </div>
      </div>
    </div>`;
  document.body.appendChild(modal);
}

console.log('[AegisICU] Patient management module loaded ✓');
