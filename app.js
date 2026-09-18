/* ═══════════════════════════════════════════════════════════════════════════
   AegisICU — Application Logic & Rendering Engine
   ═══════════════════════════════════════════════════════════════════════════ */

"use strict";

// ─────────────────────────────────────────────────────────────────────────────
// STATE
// ─────────────────────────────────────────────────────────────────────────────
const STATE = {
  activePatientIdx: 0,
  currentT: 4,
  maxT: 36,
  isPlaying: false,
  playbackInterval: null,
  activeNav: 'bedside',
  liveClockInterval: null,
  liveSeconds: 0,
  riskChart: null,
  shapChart: null,
  benchRocChart: null,
  benchBarChart: null,
  ldChart: null,
  animationFrame: null,
  biometricAngle: 0,
  particleAngle: 0,
  pulsePhase: 0,
  resizeObserver: null
};

// Global export for multi-script coordination
window.STATE = STATE;

// ─────────────────────────────────────────────────────────────────────────────
// CONVENIENCE GETTERS
// ─────────────────────────────────────────────────────────────────────────────
const getPatient = () => window.AEGIS_PATIENTS[STATE.activePatientIdx];
const getMetrics = () => window.AEGIS_METRICS;

const getRiskAtT = (patient, t) => {
  if (!patient || !patient.risk) return 0;
  const entry = patient.risk.find(r => r.t === t);
  return entry ? entry.risk : 0;
};

const getVitalAtT = (patient, t) => {
  if (!patient || !patient.vitals) return { hr: 80, rr: 18, spo2: 98, sbp: 120, lactate: 1.0, gcs: 15 };
  const entry = patient.vitals.find(v => v.t === t);
  return entry || patient.vitals[0];
};

const getSHAPAtT = (patient, t) => {
  if (!patient || !patient.shap) return { t: 1, features: [] };
  const entry = patient.shap.find(s => s.t === t);
  return entry || patient.shap[0];
};

const getRiskColor = (risk) => {
  if (risk >= 0.50) return '#ef4444';
  if (risk >= 0.35) return '#f59e0b';
  return '#10b981';
};

const getRiskGlow = (risk) => {
  if (risk >= 0.50) return 'rgba(239,68,68,0.4)';
  if (risk >= 0.35) return 'rgba(245,158,11,0.35)';
  return 'rgba(16,185,129,0.35)';
};

window.getPatient   = getPatient;
window.getRiskAtT   = getRiskAtT;
window.getVitalAtT  = getVitalAtT;
window.getSHAPAtT   = getSHAPAtT;
window.getRiskColor = getRiskColor;
window.getRiskGlow  = getRiskGlow;

// ─────────────────────────────────────────────────────────────────────────────
// DOM REFS
// ─────────────────────────────────────────────────────────────────────────────
let DOM = {};

function cacheDom() {
  DOM = {
    // Header
    liveClockEl:     document.getElementById('live-clock'),
    monitoredBedsEl: document.getElementById('monitored-beds'),

    // Patient overlay
    patientIdEl:     document.getElementById('patient-id-display'),
    patientNameEl:   document.getElementById('patient-name-display'),
    patientMetaEl:   document.getElementById('patient-meta-display'),

    // Action buttons
    btnJumpEvent:    document.getElementById('btn-jump-event'),
    btnJumpAlert:    document.getElementById('btn-jump-alert'),
    btnPlaySim:      document.getElementById('btn-play-sim'),

    // Gauge elements
    gauges: {
      risk: {
        fill: document.getElementById('gauge-risk-fill'),
        val:  document.getElementById('gauge-risk-val'),
        sub:  document.getElementById('gauge-risk-sub')
      },
      lead: {
        fill: document.getElementById('gauge-lead-fill'),
        val:  document.getElementById('gauge-lead-val'),
        sub:  document.getElementById('gauge-lead-sub')
      },
      rr: {
        fill: document.getElementById('gauge-rr-fill'),
        val:  document.getElementById('gauge-rr-val'),
        sub:  document.getElementById('gauge-rr-sub')
      }
    },

    // Charts
    riskChartCanvas:  document.getElementById('risk-trajectory-chart'),
    shapChartCanvas:  document.getElementById('shap-chart'),
    peakBadgeEl:      document.getElementById('risk-peak-badge'),

    // Status pill
    statusPillEl:     document.getElementById('status-pill'),

    // Biometric canvas
    bioCanvas:        document.getElementById('biometric-canvas'),
    bioOverlayVitals: document.getElementById('bio-overlay-vitals'),

    // Vital chips
    vitalHR:    document.getElementById('vital-chip-hr'),
    vitalRR:    document.getElementById('vital-chip-rr'),
    vitalSpO2:  document.getElementById('vital-chip-spo2'),
    vitalSBP:   document.getElementById('vital-chip-sbp'),
    vitalLac:   document.getElementById('vital-chip-lac'),

    // Scrubber
    timeScrubber: document.getElementById('time-scrubber'),
    scrubTimeEl:  document.getElementById('scrub-time-display'),
    playBtn:      document.getElementById('play-btn'),

    // Bed rail
    bedRail:      document.getElementById('bed-rail-inner'),

    // Nav buttons
    navBtns:      document.querySelectorAll('.nav-btn[data-nav]'),

    // Modal
    modalOverlay: document.getElementById('modal-overlay'),
    modalTitle:   document.getElementById('modal-title'),
    modalBody:    document.getElementById('modal-body'),
    modalClose:   document.getElementById('modal-close-btn'),

    // Bench charts
    benchRocCanvas: null,
    benchBarCanvas: null,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// LIVE CLOCK
// ─────────────────────────────────────────────────────────────────────────────
function startLiveClock() {
  function tick() {
    if (!DOM.liveClockEl) return;
    const now = new Date();
    DOM.liveClockEl.textContent = now.toTimeString().slice(0, 8);
  }
  tick();
  setInterval(tick, 1000);
}

// ─────────────────────────────────────────────────────────────────────────────
// PATIENT SELECTION
// ─────────────────────────────────────────────────────────────────────────────
function switchPatient(idx) {
  STATE.activePatientIdx = idx;
  STATE.currentT = 4;
  updateBedRailActive();
  updateScrubber();
  updatePatientOverlay();
  updateStatusPill();
  updateGauges();
  updateVitalChips();
  rebuildRiskChart();
  rebuildSHAPChart();
  redrawBiometric();
  if (typeof window.updateRTVitalRow === 'function') {
    window.updateRTVitalRow();
  }
}
window.switchPatient = switchPatient;

function buildBedRail() {
  if (!DOM.bedRail) return;
  const patients = window.AEGIS_PATIENTS || [];
  DOM.bedRail.innerHTML = patients.map((patient, idx) => `
    <button class="bed-orb status-${patient.status}${idx === STATE.activePatientIdx ? ' active' : ''}"
      type="button" data-patient-index="${idx}" aria-label="Select ${patient.bed}, ${patient.name}">
      <span>${patient.bed.replace(/^.*?(\d+)$/, '$1')}</span>
      <small>${patient.id.replace('PT-', '')}</small>
    </button>
  `).join('');

  DOM.bedRail.querySelectorAll('[data-patient-index]').forEach(button => {
    button.addEventListener('click', () => switchPatient(Number(button.dataset.patientIndex)));
  });
}

function updateBedRailActive() {
  DOM.bedRail?.querySelectorAll('[data-patient-index]').forEach(button => {
    button.classList.toggle('active', Number(button.dataset.patientIndex) === STATE.activePatientIdx);
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// PATIENT OVERLAY
// ─────────────────────────────────────────────────────────────────────────────
function updatePatientOverlay() {
  const p = getPatient();
  if (!p) return;
  if (DOM.patientIdEl)   DOM.patientIdEl.textContent   = p.id;
  if (DOM.patientNameEl) DOM.patientNameEl.textContent  = p.name;
  if (DOM.patientMetaEl) DOM.patientMetaEl.textContent  =
    `${p.age}y ${p.sex === 'M' ? 'Male' : 'Female'} • ${p.bed} • ${p.diagnosis} at t=${p.event_t}.0h`;
}

// ─────────────────────────────────────────────────────────────────────────────
// STATUS PILL
// ─────────────────────────────────────────────────────────────────────────────
function updateStatusPill() {
  const p  = getPatient();
  const el = DOM.statusPillEl;
  if (!el || !p) return;
  el.className = `status-pill ${p.status}`;
  const risk = getRiskAtT(p, STATE.currentT);
  const icons = { critical: '🚨', elevated: '⚠️', stable: '✅' };
  el.innerHTML = `${icons[p.status] || '🔔'} ${(risk * 100).toFixed(1)}% ${p.status.toUpperCase()} — t=${STATE.currentT}.0h (${p.lead_time}h Lead)`;
}

// ─────────────────────────────────────────────────────────────────────────────
// RADIAL GAUGES
// ─────────────────────────────────────────────────────────────────────────────
function setGauge(gaugeDef, value, maxVal, color) {
  if (!gaugeDef || !gaugeDef.fill) return;
  const circumference = 2 * Math.PI * 38; // r=38 for 90px svg
  const offset = circumference * (1 - Math.min(Math.max(value, 0) / maxVal, 1));
  gaugeDef.fill.style.strokeDasharray  = circumference;
  gaugeDef.fill.style.strokeDashoffset = offset;
  gaugeDef.fill.style.stroke = color;
}

function updateGauges() {
  const p    = getPatient();
  if (!p) return;
  const risk = getRiskAtT(p, STATE.currentT);
  const col  = getRiskColor(risk);

  // Gauge 1: Risk %
  setGauge(DOM.gauges.risk, risk, 1.0, col);
  if (DOM.gauges.risk.val) {
    DOM.gauges.risk.val.textContent = `${(risk * 100).toFixed(1)}%`;
    DOM.gauges.risk.val.style.color = col;
    DOM.gauges.risk.val.style.textShadow = 'none';
  }
  if (DOM.gauges.risk.sub) DOM.gauges.risk.sub.textContent = 'XGBoost Risk';

  // Gauge 2: Lead time
  const lead = p.lead_time || 0;
  setGauge(DOM.gauges.lead, lead, 12, '#f59e0b');
  if (DOM.gauges.lead.val) {
    DOM.gauges.lead.val.textContent = `${lead.toFixed(1)}h`;
    DOM.gauges.lead.val.style.color = '#b45309';
    DOM.gauges.lead.val.style.textShadow = 'none';
  }
  if (DOM.gauges.lead.sub) DOM.gauges.lead.sub.textContent = 'Early Warning';

  // Gauge 3: RR Velocity
  const rrv = p.rr_velocity || 0;
  setGauge(DOM.gauges.rr, rrv, 12, '#06b6d4');
  if (DOM.gauges.rr.val) {
    DOM.gauges.rr.val.textContent = `+${rrv.toFixed(1)}`;
    DOM.gauges.rr.val.style.color = '#0891b2';
    DOM.gauges.rr.val.style.textShadow = 'none';
  }
  if (DOM.gauges.rr.sub) DOM.gauges.rr.sub.textContent = '/h RR Velocity';
}

// ─────────────────────────────────────────────────────────────────────────────
// VITAL CHIPS
// ─────────────────────────────────────────────────────────────────────────────
function updateVitalChips() {
  const p = getPatient();
  const v = getVitalAtT(p, STATE.currentT);
  if (!v) return;
  if (DOM.vitalHR)   DOM.vitalHR.textContent   = `HR ${v.hr} bpm`;
  if (DOM.vitalRR)   DOM.vitalRR.textContent   = `RR ${v.rr}/min`;
  if (DOM.vitalSpO2) DOM.vitalSpO2.textContent = `SpO₂ ${v.spo2}%`;
  if (DOM.vitalSBP)  DOM.vitalSBP.textContent  = `SBP ${v.sbp}`;
  if (DOM.vitalLac)  DOM.vitalLac.textContent  = `Lac ${v.lactate}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// TIME SCRUBBER
// ─────────────────────────────────────────────────────────────────────────────
function updateScrubber() {
  const scrubber = DOM.timeScrubber;
  if (!scrubber) return;
  scrubber.value = STATE.currentT;
  const pct = ((STATE.currentT - 1) / (STATE.maxT - 1) * 100).toFixed(1);
  scrubber.style.setProperty('--pct', `${pct}%`);
  if (DOM.scrubTimeEl) DOM.scrubTimeEl.textContent = `t = ${STATE.currentT}h`;
}

function onScrubChange(e) {
  STATE.currentT = parseInt(e.target.value, 10);
  updateScrubber();
  updateGauges();
  updateVitalChips();
  updateStatusPill();
  updateRiskChartCursor();
  updateSHAPChart();
  redrawBiometric();
}

// ─────────────────────────────────────────────────────────────────────────────
// PLAYBACK
// ─────────────────────────────────────────────────────────────────────────────
function togglePlayback() {
  STATE.isPlaying = !STATE.isPlaying;
  if (DOM.playBtn) DOM.playBtn.textContent = STATE.isPlaying ? '⏸' : '▶';

  if (STATE.isPlaying) {
    STATE.playbackInterval = setInterval(() => {
      if (STATE.currentT >= STATE.maxT) {
        STATE.currentT = 1;
      } else {
        STATE.currentT++;
      }
      updateScrubber();
      updateGauges();
      updateVitalChips();
      updateStatusPill();
      updateRiskChartCursor();
      updateSHAPChart();
      redrawBiometric();
    }, 600);
  } else {
    clearInterval(STATE.playbackInterval);
    STATE.playbackInterval = null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// RISK TRAJECTORY CHART
// ─────────────────────────────────────────────────────────────────────────────
function buildRiskChart() {
  const ctx = DOM.riskChartCanvas?.getContext('2d');
  if (!ctx) return;

  if (STATE.riskChart) { STATE.riskChart.destroy(); STATE.riskChart = null; }

  const p    = getPatient();
  const labels = p.risk.map(r => `t${r.t}`);
  const values = p.risk.map(r => r.risk);
  const threshold = Array(values.length).fill(getMetrics().threshold);

  const gradient = ctx.createLinearGradient(0, 0, 0, ctx.canvas.height || 150);
  gradient.addColorStop(0, 'rgba(59,130,246,0.3)');
  gradient.addColorStop(0.6, 'rgba(59,130,246,0.08)');
  gradient.addColorStop(1, 'rgba(59,130,246,0)');

  STATE.riskChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'XGBoost Risk',
          data: values,
          borderColor: '#3b82f6',
          backgroundColor: gradient,
          borderWidth: 2,
          pointRadius: 0,
          pointHoverRadius: 4,
          pointHoverBackgroundColor: '#3b82f6',
          fill: true,
          tension: 0.4
        },
        {
          label: 'Alert Threshold',
          data: threshold,
          borderColor: 'rgba(245,158,11,0.6)',
          borderWidth: 1.5,
          borderDash: [4, 4],
          pointRadius: 0,
          fill: false,
          tension: 0
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 600 },
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: 'rgba(255,255,255,0.98)',
          borderColor: '#e2e8f0',
          borderWidth: 1,
          titleColor: '#4a5568',
          bodyColor: '#3b82f6',
          callbacks: {
            label: (ctx) => ` ${(ctx.raw * 100).toFixed(1)}% risk`
          }
        },
        annotation: buildRiskAnnotations(p)
      },
      scales: {
        x: {
          grid: { color: 'rgba(0,0,0,0.04)' },
          ticks: { color: '#a0aec0', font: { size: 9, family: 'JetBrains Mono' },
            maxTicksLimit: 10,
            callback: (val, i) => (i % 6 === 0) ? `t${p.risk[i]?.t}h` : '' }
        },
        y: {
          min: 0, max: 1,
          grid: { color: 'rgba(0,0,0,0.04)' },
          ticks: { color: '#a0aec0', font: { size: 9, family: 'JetBrains Mono' },
            callback: v => `${(v * 100).toFixed(0)}%`, stepSize: 0.25 }
        }
      }
    }
  });

  updateRiskChartCursor();
  updatePeakBadge(p);
}

function buildRiskAnnotations(p) {
  if (!window.Chart?.registry?.plugins?.get) return {};
  return {};
}

function rebuildRiskChart() {
  buildRiskChart();
}

function updateRiskChartCursor() {
  if (!STATE.riskChart) return;
  const p = getPatient();
  const idx = STATE.currentT - 1;
  STATE.riskChart.data.datasets[0].pointRadius = p.risk.map((_, i) => i === idx ? 5 : 0);
  STATE.riskChart.data.datasets[0].pointBackgroundColor = p.risk.map((r, i) => i === idx ? '#e879f9' : 'transparent');
  STATE.riskChart.update('none');
}

function updatePeakBadge(p) {
  if (!DOM.peakBadgeEl) return;
  const maxEntry = p.risk.reduce((a, b) => b.risk > a.risk ? b : a, p.risk[0]);
  DOM.peakBadgeEl.textContent = `Peak: ${(maxEntry.risk * 100).toFixed(1)}% @ t=${maxEntry.t}h`;
}

// ─────────────────────────────────────────────────────────────────────────────
// SHAP CHART
// ─────────────────────────────────────────────────────────────────────────────
function buildSHAPChart() {
  const ctx = DOM.shapChartCanvas?.getContext('2d');
  if (!ctx) return;
  if (STATE.shapChart) { STATE.shapChart.destroy(); STATE.shapChart = null; }

  const p    = getPatient();
  const shap = getSHAPAtT(p, STATE.currentT);
  const feats = shap.features.slice(0, 6);

  const colors = ['#3b82f6','#ef4444','#f59e0b','#06b6d4','#10b981','#8b5cf6'];

  STATE.shapChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: feats.map(f => f.name),
      datasets: [{
        data: feats.map(f => f.value),
        backgroundColor: colors.map(c => c + '22'),
        borderColor: colors,
        borderWidth: 1.5,
        borderRadius: 4
      }]
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 400 },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: 'rgba(255,255,255,0.98)',
          borderColor: '#e2e8f0',
          borderWidth: 1,
          titleColor: '#4a5568',
          bodyColor: '#1a202c',
          callbacks: {
            label: (ctx) => ` SHAP: ${ctx.raw.toFixed(4)} (${feats[ctx.dataIndex].pct}%)`
          }
        }
      },
      scales: {
        x: {
          grid: { color: 'rgba(0,0,0,0.05)' },
          ticks: { color: '#a0aec0', font: { size: 8, family: 'JetBrains Mono' },
            callback: v => v.toFixed(2) }
        },
        y: {
          grid: { display: false },
          ticks: { color: '#4a5568', font: { size: 9 } }
        }
      }
    }
  });
}

function updateSHAPChart() {
  if (!STATE.shapChart) return;
  const p    = getPatient();
  const shap = getSHAPAtT(p, STATE.currentT);
  const feats = shap.features.slice(0, 6);
  STATE.shapChart.data.labels = feats.map(f => f.name);
  STATE.shapChart.data.datasets[0].data = feats.map(f => f.value);
  STATE.shapChart.update('none');
}

function rebuildSHAPChart() { buildSHAPChart(); }

// ─────────────────────────────────────────────────────────────────────────────
// HOLOGRAPHIC BIOMETRIC CANVAS
// ─────────────────────────────────────────────────────────────────────────────
function startBiometricAnimation() {
  const canvas = DOM.bioCanvas;
  if (!canvas) return;

  function frame() {
    STATE.biometricAngle += 0.004;
    STATE.particleAngle  += 0.008;
    STATE.pulsePhase     += 0.05;
    drawBiometricCore(canvas);
    STATE.animationFrame = requestAnimationFrame(frame);
  }

  STATE.animationFrame = requestAnimationFrame(frame);
}

function redrawBiometric() {
  // Will be redrawn on next animation frame automatically
}

function drawBiometricCore(canvas) {
  const W = canvas.offsetWidth || 400;
  const H = canvas.offsetHeight || 350;
  if (canvas.width !== W || canvas.height !== H) {
    canvas.width  = W;
    canvas.height = H;
  }

  const ctx  = canvas.getContext('2d');
  const cx   = W / 2;
  const cy   = H / 2 - 10;
  const R    = Math.min(W, H) * 0.28;
  const p    = getPatient();
  const risk = getRiskAtT(p, STATE.currentT);
  const col  = getRiskColor(risk);
  const glowRGBA = getRiskGlow(risk);

  // Light background
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, W, H);

  ctx.clearRect(0, 0, W, H);

  // ── Subtle ambient background glow
  const bgGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, R * 2);
  bgGrad.addColorStop(0, glowRGBA.replace('0.5)', '0.08)'));
  bgGrad.addColorStop(1, 'transparent');
  ctx.fillStyle = bgGrad;
  ctx.fillRect(0, 0, W, H);

  // ── Outer telemetry rings
  for (let ring = 3; ring >= 1; ring--) {
    const rr = R * (0.95 + ring * 0.18);
    const alpha = 0.04 + (Math.sin(STATE.pulsePhase + ring) * 0.5 + 0.5) * 0.06;
    ctx.beginPath();
    ctx.arc(cx, cy, rr, 0, Math.PI * 2);
    ctx.strokeStyle = col.replace('#', 'rgba(').replace(/(..)(..)(..)/, (_, r, g, b) =>
      `${parseInt(r,16)},${parseInt(g,16)},${parseInt(b,16)},${alpha.toFixed(3)})`);
    ctx.lineWidth = 0.5;
    ctx.stroke();

    // Tick marks
    for (let i = 0; i < 24; i++) {
      const angle = (i / 24) * Math.PI * 2;
      const x1 = cx + Math.cos(angle) * (rr - 4);
      const y1 = cy + Math.sin(angle) * (rr - 4);
      const x2 = cx + Math.cos(angle) * rr;
      const y2 = cy + Math.sin(angle) * rr;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.strokeStyle = `rgba(255,255,255,0.08)`;
      ctx.lineWidth = 0.5;
      ctx.stroke();
    }
  }

  // ── Main sphere gradient
  const sphereGrad = ctx.createRadialGradient(cx - R * 0.25, cy - R * 0.25, R * 0.05, cx, cy, R);
  if (risk >= 0.50) {
    sphereGrad.addColorStop(0, 'rgba(244,63,94,0.18)');
    sphereGrad.addColorStop(0.4, 'rgba(139,22,51,0.22)');
    sphereGrad.addColorStop(0.8, 'rgba(60,0,20,0.30)');
    sphereGrad.addColorStop(1, 'rgba(10,0,5,0.35)');
  } else if (risk >= 0.35) {
    sphereGrad.addColorStop(0, 'rgba(245,158,11,0.15)');
    sphereGrad.addColorStop(0.4, 'rgba(120,60,0,0.20)');
    sphereGrad.addColorStop(0.8, 'rgba(40,15,0,0.28)');
    sphereGrad.addColorStop(1, 'rgba(8,4,0,0.35)');
  } else {
    sphereGrad.addColorStop(0, 'rgba(6,182,212,0.15)');
    sphereGrad.addColorStop(0.4, 'rgba(16,100,90,0.18)');
    sphereGrad.addColorStop(0.8, 'rgba(0,40,35,0.25)');
    sphereGrad.addColorStop(1, 'rgba(0,8,8,0.35)');
  }
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.fillStyle = sphereGrad;
  ctx.fill();

  // ── Equatorial glow ring
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.strokeStyle = col + '88';
  ctx.lineWidth = 2;
  ctx.shadowColor = col;
  ctx.shadowBlur = 20 + Math.sin(STATE.pulsePhase) * 10;
  ctx.stroke();
  ctx.shadowBlur = 0;

  // ── Wireframe geodesic mesh (left hemisphere — like the reference image)
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.clip();

  const meshAlpha = 0.10 + risk * 0.15;
  ctx.strokeStyle = `rgba(255,255,255,${meshAlpha.toFixed(3)})`;
  ctx.lineWidth = 0.4;

  // Longitude lines (left half)
  for (let i = 0; i <= 8; i++) {
    const angle = STATE.biometricAngle + (i / 8) * Math.PI;
    ctx.beginPath();
    ctx.ellipse(cx, cy, R * Math.abs(Math.cos(angle)), R, angle, 0, Math.PI * 2);
    ctx.stroke();
  }

  // Latitude lines
  for (let j = 1; j <= 7; j++) {
    const lat = (j / 8 - 0.5) * 2;
    const yr  = cy + lat * R;
    const xr  = R * Math.sqrt(Math.max(0, 1 - lat * lat));
    ctx.beginPath();
    ctx.ellipse(cx, yr, xr, xr * 0.18, 0, 0, Math.PI * 2);
    ctx.stroke();
  }

  ctx.restore();

  // ── Animated pulse aura (cardiac)
  const pulseR = R * (0.65 + Math.sin(STATE.pulsePhase * 2) * 0.08);
  const pulseGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, pulseR);
  pulseGrad.addColorStop(0, col + '44');
  pulseGrad.addColorStop(0.6, col + '11');
  pulseGrad.addColorStop(1, 'transparent');
  ctx.beginPath();
  ctx.arc(cx, cy, pulseR, 0, Math.PI * 2);
  ctx.fillStyle = pulseGrad;
  ctx.fill();

  // ── Orbital particles
  const nParticles = 12;
  for (let i = 0; i < nParticles; i++) {
    const angle    = STATE.particleAngle + (i / nParticles) * Math.PI * 2;
    const orbitR   = R * (1.12 + (i % 3) * 0.08);
    const inclination = Math.sin((i / nParticles) * Math.PI) * 0.5;
    const px  = cx + Math.cos(angle) * orbitR;
    const py  = cy + Math.sin(angle) * orbitR * 0.35 + Math.sin(angle + inclination) * orbitR * 0.15;
    const sz  = 1.5 + (i % 3) * 0.5;
    const alpha = 0.3 + Math.sin(angle + STATE.pulsePhase) * 0.3;
    ctx.beginPath();
    ctx.arc(px, py, sz, 0, Math.PI * 2);
    ctx.fillStyle = col.replace('#','rgba(').replace(/(..)(..)(..)/, (_, r, g, b) =>
      `${parseInt(r,16)},${parseInt(g,16)},${parseInt(b,16)},${Math.max(0,alpha).toFixed(2)})`);
    ctx.fill();
  }

  // ── Highlight gleam (top-left)
  const gleam = ctx.createRadialGradient(cx - R * 0.35, cy - R * 0.35, 0, cx - R * 0.35, cy - R * 0.35, R * 0.4);
  gleam.addColorStop(0, 'rgba(255,255,255,0.12)');
  gleam.addColorStop(1, 'transparent');
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.fillStyle = gleam;
  ctx.fill();

  // ── Centre ECG cardioid line
  drawECGLine(ctx, cx, cy, R, risk, col);

  // ── Risk text in core
  ctx.save();
  ctx.font = `bold ${Math.round(R * 0.22)}px 'Inter', sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = col;
  ctx.shadowColor = col;
  ctx.shadowBlur = 8;
  ctx.fillText(`${(risk * 100).toFixed(1)}%`, cx, cy - R * 0.08);
  ctx.font = `600 ${Math.round(R * 0.1)}px 'Inter', sans-serif`;
  ctx.fillStyle = 'rgba(74,85,104,0.7)';
  ctx.shadowBlur = 0;
  ctx.fillText('RISK SCORE', cx, cy + R * 0.12);
  ctx.restore();
}

function drawECGLine(ctx, cx, cy, R, risk, col) {
  const amplitude = R * 0.15 * (0.5 + risk * 0.8);
  const width     = R * 1.6;
  const x0        = cx - width / 2;
  const y0        = cy + R * 0.55;
  const steps     = 80;

  ctx.save();
  ctx.beginPath();
  ctx.strokeStyle = col + 'cc';
  ctx.lineWidth = 1.5;
  ctx.shadowColor = col;
  ctx.shadowBlur = 8;

  for (let i = 0; i <= steps; i++) {
    const t   = i / steps;
    const x   = x0 + t * width;
    const frac = (t * 4) % 1;
    let dy = 0;
    if (frac < 0.1)       dy = 0;
    else if (frac < 0.15) dy = -amplitude * 0.3;
    else if (frac < 0.2)  dy = amplitude;
    else if (frac < 0.25) dy = -amplitude * 0.5;
    else if (frac < 0.35) dy = -amplitude * 0.15;
    else                  dy = 0;

    dy += Math.sin(t * Math.PI * 2 + STATE.pulsePhase * 1.5) * amplitude * 0.06 * risk;

    if (i === 0) ctx.moveTo(x, y0 + dy);
    else         ctx.lineTo(x, y0 + dy);
  }
  ctx.stroke();
  ctx.restore();
}

// ─────────────────────────────────────────────────────────────────────────────
// NAVIGATION
// ─────────────────────────────────────────────────────────────────────────────
function setupNav() {
  DOM.navBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const nav = btn.dataset.nav;
      if (nav === STATE.activeNav) return;
      DOM.navBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      STATE.activeNav = nav;

      if (nav === 'bedside') {
        closeModal();
      } else if (nav === 'cohort') {
        openCohortModal();
      } else if (nav === 'model') {
        openModelModal();
      } else if (nav === 'vitals') {
        openVitalsModal();
      } else if (nav === 'safety') {
        openSafetyModal();
      }
    });
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// MODAL SYSTEM
// ─────────────────────────────────────────────────────────────────────────────
function openModal(title, htmlContent) {
  if (!DOM.modalOverlay || !DOM.modalTitle || !DOM.modalBody) return;
  DOM.modalTitle.textContent = title;
  DOM.modalBody.innerHTML = htmlContent;
  DOM.modalOverlay.classList.add('visible');
  DOM.modalOverlay.setAttribute('aria-hidden', 'false');
}

function closeModal() {
  if (!DOM.modalOverlay) return;
  DOM.modalOverlay.classList.remove('visible');
  DOM.modalOverlay.setAttribute('aria-hidden', 'true');
  DOM.navBtns.forEach(b => {
    if (b.dataset.nav === 'bedside') b.classList.add('active');
    else b.classList.remove('active');
  });
  STATE.activeNav = 'bedside';
  // Rebuild any charts that were destroyed
  setTimeout(() => {
    buildRiskChart();
    buildSHAPChart();
  }, 100);
}

// ─────────────────────────────────────────────────────────────────────────────
// COHORT MODAL
// ─────────────────────────────────────────────────────────────────────────────
function openCohortModal() {
  const rows = window.AEGIS_PATIENTS.map((p, i) => {
    const currentRisk = getRiskAtT(p, STATE.currentT);
    const riskPct = (currentRisk * 100).toFixed(1);
    const barColor = getRiskColor(currentRisk);
    const statusIcon = { critical: '🔴', elevated: '🟡', stable: '🟢' }[p.status] || '⚪';
    return `
      <tr onclick="window.switchPatientAndClose(${i})" title="Switch to ${p.name}">
        <td>${statusIcon} ${p.id}</td>
        <td><strong>${p.name}</strong></td>
        <td>${p.age}y ${p.sex}</td>
        <td>${p.bed}</td>
        <td style="color:${barColor};font-family:'JetBrains Mono',monospace">${riskPct}%</td>
        <td class="risk-bar-cell">
          <div class="risk-bar-bg"><div class="risk-bar-fill" style="width:${riskPct}%;background:${barColor}"></div></div>
        </td>
        <td style="font-family:'JetBrains Mono',monospace;color:#f59e0b">${p.lead_time}h</td>
        <td style="color:#94a3b8;font-size:10px">${p.diagnosis.slice(0,28)}…</td>
      </tr>`;
  }).join('');

  const html = `
    <div class="fade-in-up">
      <div style="display:flex;gap:12px;margin-bottom:16px;flex-wrap:wrap">
        <div style="padding:8px 14px;background:rgba(244,63,94,0.1);border:1px solid rgba(244,63,94,0.3);border-radius:8px;font-size:12px;color:#f43f5e">
          🚨 Critical: ${window.AEGIS_METRICS.critical_alerts} patients
        </div>
        <div style="padding:8px 14px;background:rgba(245,158,11,0.1);border:1px solid rgba(245,158,11,0.3);border-radius:8px;font-size:12px;color:#f59e0b">
          ⚠️ Elevated: ${window.AEGIS_METRICS.elevated_alerts} patients
        </div>
        <div style="padding:8px 14px;background:rgba(16,185,129,0.1);border:1px solid rgba(16,185,129,0.3);border-radius:8px;font-size:12px;color:#10b981">
          ✅ Stable: ${window.AEGIS_PATIENTS.filter(p=>p.status==='stable').length} patients
        </div>
      </div>
      <div class="cohort-table-wrap">
        <table class="cohort-table">
          <thead>
            <tr>
              <th>ID</th><th>Name</th><th>Demo</th><th>Bed</th>
              <th>Risk@t</th><th>Risk Bar</th><th>Lead Time</th><th>Diagnosis</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div>`;

  openModal('📋 ICU Cohort Triage — 18 Monitored Patients', html);
}

window.switchPatientAndClose = function(idx) {
  closeModal();
  setTimeout(() => switchPatient(idx), 150);
};

// ─────────────────────────────────────────────────────────────────────────────
// MODEL PERFORMANCE MODAL
// ─────────────────────────────────────────────────────────────────────────────
function openModelModal() {
  const bm = window.AEGIS_BENCHMARKS;
  const rows = bm.models.map(m => `
    <tr>
      <td style="color:${m.color};font-weight:600">${m.name}</td>
      <td style="font-family:'JetBrains Mono',monospace;color:${m.color}">${m.auroc.toFixed(3)}</td>
      <td style="font-family:'JetBrains Mono',monospace">${m.auprc.toFixed(3)}</td>
      <td style="font-family:'JetBrains Mono',monospace">${(m.sensitivity*100).toFixed(1)}%</td>
      <td style="font-family:'JetBrains Mono',monospace">${(m.specificity*100).toFixed(1)}%</td>
      <td style="font-family:'JetBrains Mono',monospace">${(m.ppv*100).toFixed(1)}%</td>
      <td style="font-family:'JetBrains Mono',monospace">${(m.f1*100).toFixed(1)}%</td>
      <td style="font-family:'JetBrains Mono',monospace;color:#f59e0b">${m.leadTime.toFixed(1)}h</td>
    </tr>`).join('');

  const html = `
    <div class="fade-in-up">
      <div class="bench-card" style="margin-bottom:16px">
        <div class="bench-card-title">Model Comparison Table — MIMIC-III Test Set (n=2,847)</div>
        <div class="cohort-table-wrap">
          <table class="cohort-table">
            <thead><tr>
              <th>Model</th><th>AUROC</th><th>AUPRC</th><th>Sensitivity</th>
              <th>Specificity</th><th>PPV</th><th>F1</th><th>Avg Lead Time</th>
            </tr></thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
      </div>
      <div class="benchmark-grid">
        <div class="bench-card">
          <div class="bench-card-title">ROC Curves</div>
          <div style="height:220px;position:relative"><canvas id="bench-roc-canvas"></canvas></div>
        </div>
        <div class="bench-card">
          <div class="bench-card-title">AUROC Comparison</div>
          <div style="height:220px;position:relative"><canvas id="bench-bar-canvas"></canvas></div>
        </div>
        <div class="bench-card">
          <div class="bench-card-title">Lead Time Distribution (XGBoost)</div>
          <div style="height:180px;position:relative"><canvas id="bench-ld-canvas"></canvas></div>
        </div>
        <div class="bench-card">
          <div class="bench-card-title">Key Clinical Findings</div>
          <div style="padding:8px 0">
            ${[
              ['AUROC Improvement over NEWS2', '+36.2%', '#e879f9'],
              ['Sensitivity at threshold 0.35', '82.4%', '#10b981'],
              ['Avg ICU lead time', '6.1 hours', '#f59e0b'],
              ['False alarm rate (1-Spec)', '12.7%', '#06b6d4'],
              ['Patients detectable >4h early', '74.3%', '#8b5cf6'],
              ['MIMIC-III test cohort size', '2,847', '#f1f5f9']
            ].map(([k,v,c]) => `
              <div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid rgba(255,255,255,0.05)">
                <span style="font-size:11px;color:#94a3b8">${k}</span>
                <span style="font-family:'JetBrains Mono',monospace;font-size:12px;font-weight:700;color:${c}">${v}</span>
              </div>`).join('')}
          </div>
        </div>
      </div>
    </div>`;

  openModal('📊 Model Performance Benchmarks', html);

  setTimeout(() => {
    buildBenchROCChart();
    buildBenchBarChart();
    buildLeadDistChart();
  }, 100);
}

function buildBenchROCChart() {
  const canvas = document.getElementById('bench-roc-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const bm  = window.AEGIS_BENCHMARKS;

  new Chart(ctx, {
    type: 'line',
    data: {
      datasets: [
        {
          label: 'XGBoost (AegisICU)',
          data: bm.roc_xgb.map(([x,y]) => ({x, y})),
          borderColor: '#e879f9', borderWidth: 2, pointRadius: 0, fill: false, tension: 0.3
        },
        {
          label: 'NEWS2',
          data: bm.roc_news2.map(([x,y]) => ({x, y})),
          borderColor: '#34d399', borderWidth: 1.5, borderDash: [4,3], pointRadius: 0, fill: false, tension: 0.3
        },
        {
          label: 'Chance',
          data: [{x:0,y:0},{x:1,y:1}],
          borderColor: 'rgba(255,255,255,0.15)', borderWidth: 1, borderDash: [2,2], pointRadius: 0, fill: false
        }
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { labels: { color: '#94a3b8', font: { size: 10 } } },
        tooltip: { backgroundColor: 'rgba(8,12,22,0.95)', borderColor: 'rgba(255,255,255,0.1)', borderWidth: 1 }
      },
      scales: {
        x: { type: 'linear', min: 0, max: 1, grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { color: '#475569', font: { size: 9 } }, title: { display: true, text: 'FPR', color: '#475569', font: { size: 9 } } },
        y: { min: 0, max: 1, grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { color: '#475569', font: { size: 9 } }, title: { display: true, text: 'TPR', color: '#475569', font: { size: 9 } } }
      }
    }
  });
}

function buildBenchBarChart() {
  const canvas = document.getElementById('bench-bar-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const bm  = window.AEGIS_BENCHMARKS;

  new Chart(ctx, {
    type: 'bar',
    data: {
      labels: bm.models.map(m => m.name.replace(' (AegisICU)','').replace('Logistic Regression','LogReg')),
      datasets: [{
        label: 'AUROC',
        data: bm.models.map(m => m.auroc),
        backgroundColor: bm.models.map(m => m.color + '44'),
        borderColor: bm.models.map(m => m.color),
        borderWidth: 1.5,
        borderRadius: 4
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { backgroundColor: 'rgba(8,12,22,0.95)', borderColor: 'rgba(255,255,255,0.1)', borderWidth: 1 } },
      scales: {
        x: { grid: { display: false }, ticks: { color: '#475569', font: { size: 8 } } },
        y: { min: 0.4, max: 1.0, grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { color: '#475569', font: { size: 9 }, callback: v => v.toFixed(2) } }
      }
    }
  });
}

function buildLeadDistChart() {
  const canvas = document.getElementById('bench-ld-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const ld  = window.AEGIS_LEAD_TIME_DIST;

  new Chart(ctx, {
    type: 'bar',
    data: {
      labels: ld.bins,
      datasets: [{
        label: 'Patients',
        data: ld.counts,
        backgroundColor: ld.counts.map(c => `rgba(139,92,246,${0.2 + c/50})`),
        borderColor: '#8b5cf6',
        borderWidth: 1,
        borderRadius: 3
      }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { backgroundColor: 'rgba(8,12,22,0.95)', borderColor: 'rgba(255,255,255,0.1)', borderWidth: 1 } },
      scales: {
        x: { grid: { display: false }, ticks: { color: '#475569', font: { size: 9 } } },
        y: { grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { color: '#475569', font: { size: 9 } } }
      }
    }
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// VITALS MULTI-CHANNEL MODAL
// ─────────────────────────────────────────────────────────────────────────────
function openVitalsModal() {
  const p = getPatient();
  const times  = p.vitals.map(v => `t${v.t}`);
  const chartConfigs = [
    { key: 'hr',   label: 'Heart Rate (bpm)',   color: '#f43f5e', unit: 'bpm', min: 30, max: 180 },
    { key: 'rr',   label: 'Respiratory Rate',  color: '#06b6d4', unit: '/min', min: 6, max: 45 },
    { key: 'spo2', label: 'SpO₂ (%)',           color: '#10b981', unit: '%',   min: 65, max: 100 },
    { key: 'sbp',  label: 'Systolic BP (mmHg)',color: '#f59e0b', unit: 'mmHg',min: 50, max: 220 },
    { key: 'lactate', label: 'Lactate (mmol/L)',color: '#e879f9',unit: 'mmol/L',min:0, max:15 },
    { key: 'gcs',  label: 'GCS Score',         color: '#8b5cf6', unit: '',    min: 3, max: 15 }
  ];

  const canvases = chartConfigs.map((cfg, i) =>
    `<div class="bench-card" style="padding:10px 12px">
      <div class="bench-card-title">${cfg.label}</div>
      <div style="height:120px;position:relative"><canvas id="vitals-chart-${i}"></canvas></div>
    </div>`).join('');

  openModal(`🩺 Multi-Channel Vitals — ${p.name} (${p.id})`,
    `<div class="fade-in-up"><div class="benchmark-grid">${canvases}</div></div>`);

  setTimeout(() => {
    chartConfigs.forEach((cfg, i) => {
      const canvas = document.getElementById(`vitals-chart-${i}`);
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      const values = p.vitals.map(v => v[cfg.key]);
      const alertIdx = STATE.currentT - 1;

      const grad = ctx.createLinearGradient(0, 0, 0, 120);
      grad.addColorStop(0, cfg.color + '44');
      grad.addColorStop(1, cfg.color + '05');

      new Chart(ctx, {
        type: 'line',
        data: {
          labels: times,
          datasets: [{
            data: values,
            borderColor: cfg.color,
            backgroundColor: grad,
            borderWidth: 1.5,
            pointRadius: values.map((_, j) => j === alertIdx ? 4 : 0),
            pointBackgroundColor: cfg.color,
            fill: true,
            tension: 0.4
          }]
        },
        options: {
          responsive: true, maintainAspectRatio: false,
          plugins: { legend: { display: false }, tooltip: { backgroundColor: 'rgba(8,12,22,0.95)', borderColor: 'rgba(255,255,255,0.1)', borderWidth: 1 } },
          scales: {
            x: { grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { color: '#475569', font: { size: 8 }, maxTicksLimit: 8, callback: (v, i) => (i % 6 === 0) ? times[i] : '' } },
            y: { min: cfg.min, max: cfg.max, grid: { color: 'rgba(255,255,255,0.04)' }, ticks: { color: '#475569', font: { size: 8 } } }
          }
        }
      });
    });
  }, 150);
}

// ─────────────────────────────────────────────────────────────────────────────
// LIMITATIONS & SAFETY MODAL
// ─────────────────────────────────────────────────────────────────────────────
function openSafetyModal() {
  const html = `
    <div class="fade-in-up">
      <div class="limit-section">
        <h3>⚠️ Clinical Validation Status</h3>
        <p>AegisICU v2.0 is a <strong>research prototype</strong> trained and validated on MIMIC-III retrospective data. It is <em>not cleared by any regulatory authority</em> (FDA, CE Mark) for clinical decision-making. All risk predictions must be reviewed by qualified clinical staff before acting on any alert.</p>
      </div>
      <div class="limit-section">
        <h3>📊 Known Limitations</h3>
        <ul>
          <li>Validated exclusively on MIMIC-III (Beth Israel Deaconess Medical Center, 2001–2012). Generalizability to other ICU settings, geographies, and populations is uncertain.</li>
          <li>Model calibration may drift in real-time deployment. Regular recalibration every 3–6 months is recommended.</li>
          <li>SHAP attributions represent feature contributions in the XGBoost model — they are <em>not</em> causal explanations of patient physiology.</li>
          <li>The 6-hour prediction horizon assumes relatively stable physiological trajectories. Sudden acute events (e.g., PE, arrhythmia) may not be captured until closer to onset.</li>
          <li>Missing data imputation uses a last-observation-carried-forward (LOCF) + median-fill approach. Systematic missingness patterns (e.g., no labs ordered = stable assumption) may introduce bias.</li>
          <li>The model does not account for therapeutic interventions (vasopressors, ventilator changes, blood transfusions) that clinicians have already initiated.</li>
        </ul>
      </div>
      <div class="limit-section">
        <h3>🔬 Recommended Future Work</h3>
        <ul>
          <li>Prospective multi-center external validation (ANZICS APD, eICU Collaborative Research Database)</li>
          <li>Temporal recalibration / concept drift monitoring with automated alerts</li>
          <li>Integration of treatment-aware counterfactual predictions</li>
          <li>Formal clinical trial (RCT) to evaluate impact on patient outcomes (LOS, mortality)</li>
          <li>Equity analysis across race, sex, insurance status, and comorbidity burden</li>
          <li>FHIR/HL7 integration for direct EHR embedding (Epic, Cerner SmartApp)</li>
        </ul>
      </div>
      <div class="limit-section">
        <h3>📋 Responsible AI Framework</h3>
        <ul>
          <li>All predictions display calibrated probability — no binary black-box alerts</li>
          <li>SHAP explanations provided at every prediction to support clinical transparency</li>
          <li>Operating threshold (0.35) chosen to balance sensitivity/specificity for ICU triage</li>
          <li>Human oversight mandatory: system functions as decision support, not replacement</li>
          <li>Role-based access: Clinicians see patient-level detail; Hospital Leads see aggregate analytics only</li>
        </ul>
      </div>
      <div class="limit-section">
        <h3>📄 Model Card Summary</h3>
        <div style="font-family:'JetBrains Mono',monospace;font-size:11px;color:#94a3b8;line-height:1.8">
          Model: XGBoost 1.7.6 &nbsp;|&nbsp; Features: 47 clinical variables<br>
          Train set: MIMIC-III 2001-2010 (n=14,218) &nbsp;|&nbsp; Test set: 2010-2012 (n=2,847)<br>
          Threshold: 0.35 &nbsp;|&nbsp; AUROC: 0.890 &nbsp;|&nbsp; AUPRC: 0.761<br>
          Version: 2.0.26 &nbsp;|&nbsp; Last recalibration: 2024-11-15
        </div>
      </div>
    </div>`;

  openModal('⚠️ Limitations, Safety & Responsible AI', html);
}

// ─────────────────────────────────────────────────────────────────────────────
// INITIALIZATION
// ─────────────────────────────────────────────────────────────────────────────
function init() {
  cacheDom();
  startLiveClock();
  buildBedRail();
  updatePatientOverlay();
  updateStatusPill();
  updateScrubber();
  updateGauges();
  updateVitalChips();

  // Build charts after short delay for layout to settle
  setTimeout(() => {
    buildRiskChart();
    buildSHAPChart();
    startBiometricAnimation();
  }, 200);

  // Scrubber
  if (DOM.timeScrubber) {
    DOM.timeScrubber.min = 1;
    DOM.timeScrubber.max = STATE.maxT;
    DOM.timeScrubber.value = STATE.currentT;
    DOM.timeScrubber.addEventListener('input', onScrubChange);
  }

  // Play button
  if (DOM.playBtn) DOM.playBtn.addEventListener('click', togglePlayback);

  // Action buttons
  if (DOM.btnJumpEvent) DOM.btnJumpEvent.addEventListener('click', () => {
    const p = getPatient();
    STATE.currentT = p.event_t;
    updateScrubber(); updateGauges(); updateVitalChips(); updateStatusPill();
    updateRiskChartCursor(); updateSHAPChart(); redrawBiometric();
  });

  if (DOM.btnJumpAlert) DOM.btnJumpAlert.addEventListener('click', () => {
    const p = getPatient();
    STATE.currentT = p.alert_t;
    updateScrubber(); updateGauges(); updateVitalChips(); updateStatusPill();
    updateRiskChartCursor(); updateSHAPChart(); redrawBiometric();
  });

  if (DOM.btnPlaySim) DOM.btnPlaySim.addEventListener('click', () => {
    STATE.currentT = 1;
    updateScrubber();
    if (!STATE.isPlaying) togglePlayback();
  });

  // Modal close
  if (DOM.modalClose) DOM.modalClose.addEventListener('click', closeModal);
  if (DOM.modalOverlay) {
    DOM.modalOverlay.addEventListener('click', event => {
      if (event.target === DOM.modalOverlay) closeModal();
    });
  }
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      closeModal();
      document.querySelectorAll('.aegis-overlay-modal.visible').forEach(overlay => {
        overlay.classList.remove('visible');
      });
    }
  });

  // Nav
  setupNav();

  // ResizeObserver for canvas
  if (window.ResizeObserver && DOM.bioCanvas) {
    STATE.resizeObserver = new ResizeObserver(() => {
      // Canvas will resize on next frame
    });
    STATE.resizeObserver.observe(DOM.bioCanvas.parentElement);
  }

  console.log('[AegisICU] App initialized ✓');
}

// Wait for DOM and data
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
