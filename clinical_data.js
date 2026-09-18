// AegisICU Clinical Data — MIMIC-III Inspired Synthetic Dataset
// All data is pre-computed for frontend-only operation

"use strict";

// ─────────────────────────────────────────────────────────────────────────────
// HELPER: Generate realistic hourly vital signs with trends
// ─────────────────────────────────────────────────────────────────────────────
function generateVitals(config, hours = 36) {
  const data = [];
  let hr = config.hr_base, rr = config.rr_base, spo2 = config.spo2_base;
  let sbp = config.sbp_base, lactate = config.lactate_base;
  let temp = config.temp_base, gcs = config.gcs_base;

  for (let t = 1; t <= hours; t++) {
    const eventPhase = t >= config.event_t ? 1 : 0;
    const buildUp = Math.max(0, (t - (config.event_t - 10)) / 10);

    hr      += (Math.random() - 0.48) * 3 + buildUp * config.hr_drift * eventPhase;
    rr      += (Math.random() - 0.45) * 0.8 + buildUp * config.rr_drift * eventPhase;
    spo2    += (Math.random() - 0.55) * 0.4 - buildUp * config.spo2_drop * eventPhase;
    sbp     += (Math.random() - 0.52) * 4 - buildUp * config.sbp_drop * eventPhase;
    lactate += (Math.random() - 0.40) * 0.15 + buildUp * config.lac_rise * eventPhase;
    temp    += (Math.random() - 0.50) * 0.05;
    gcs     = Math.max(3, Math.min(15, gcs + (Math.random() > 0.85 ? -1 : 0) * eventPhase));

    data.push({
      t,
      hr:      Math.round(Math.max(35, Math.min(175, hr))),
      rr:      parseFloat(Math.max(8, Math.min(40, rr)).toFixed(1)),
      spo2:    parseFloat(Math.max(70, Math.min(100, spo2)).toFixed(1)),
      sbp:     Math.round(Math.max(55, Math.min(210, sbp))),
      lactate: parseFloat(Math.max(0.5, Math.min(12, lactate)).toFixed(2)),
      temp:    parseFloat(Math.max(35.0, Math.min(40.5, temp)).toFixed(1)),
      gcs:     Math.round(gcs)
    });
  }
  return data;
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPER: Generate risk trajectory with alert at alert_t, peak at event_t
// ─────────────────────────────────────────────────────────────────────────────
function generateRiskTrajectory(event_t, alert_t, peak_risk, hours = 36) {
  const trajectory = [];
  for (let t = 1; t <= hours; t++) {
    let risk;
    if (t < alert_t - 4) {
      risk = 0.05 + Math.random() * 0.08 + (t / (alert_t - 4)) * 0.10;
    } else if (t < alert_t) {
      const p = (t - (alert_t - 4)) / 4;
      risk = 0.15 + p * 0.20 + Math.random() * 0.03;
    } else if (t <= event_t) {
      const p = (t - alert_t) / (event_t - alert_t);
      risk = 0.35 + p * (peak_risk - 0.35) + (Math.random() - 0.5) * 0.03;
    } else {
      const p = (t - event_t) / (hours - event_t);
      risk = peak_risk - p * 0.15 + (Math.random() - 0.5) * 0.02;
    }
    trajectory.push({ t, risk: parseFloat(Math.max(0.02, Math.min(0.99, risk)).toFixed(4)) });
  }
  return trajectory;
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPER: Generate SHAP attributions per hour
// ─────────────────────────────────────────────────────────────────────────────
function generateSHAP(event_t, alert_t, hours = 36) {
  const features = ['Lactate Rise', 'RR Velocity', 'SpO2 Decline', 'SBP Drop', 'HR Surge', 'GCS Delta', 'Temp Spike', 'MAP Trend'];
  const shapData = [];
  for (let t = 1; t <= hours; t++) {
    const intensity = t < alert_t ? 0.3 : t < event_t ? 0.7 + (t - alert_t) / (event_t - alert_t) * 0.3 : 0.85;
    const values = features.map((f, i) => {
      const base = [0.18, 0.15, 0.13, 0.11, 0.09, 0.07, 0.05, 0.04][i];
      return parseFloat((base * intensity * (0.8 + Math.random() * 0.4)).toFixed(4));
    });
    const total = values.reduce((a, b) => a + b, 0);
    shapData.push({
      t,
      features: features.map((name, i) => ({
        name,
        value: values[i],
        pct: parseFloat((values[i] / total * 100).toFixed(1))
      })).sort((a, b) => b.value - a.value).slice(0, 6)
    });
  }
  return shapData;
}

// ─────────────────────────────────────────────────────────────────────────────
// 18 PATIENTS — Full clinical profiles
// ─────────────────────────────────────────────────────────────────────────────
window.AEGIS_PATIENTS = [
  {
    id: 'PT-10013', name: 'Eleanor Vance', age: 68, sex: 'F',
    bed: 'MICU Bed 04', diagnosis: 'Acute Cardiopulmonary Decompensation',
    event_t: 24, alert_t: 17, peak_risk: 0.884, lead_time: 7.0,
    rr_velocity: 4.8, status: 'critical',
    comorbidities: ['CHF Stage III', 'CKD II', 'T2DM'],
    vitals: generateVitals({ hr_base:88, rr_base:18, spo2_base:96, sbp_base:128, lactate_base:1.4, temp_base:37.1, gcs_base:15, event_t:24, hr_drift:0.8, rr_drift:0.6, spo2_drop:0.5, sbp_drop:1.2, lac_rise:0.18 }),
    risk: generateRiskTrajectory(24, 17, 0.884),
    shap: generateSHAP(24, 17)
  },
  {
    id: 'PT-10027', name: 'Marcus Chen', age: 71, sex: 'M',
    bed: 'MICU Bed 07', diagnosis: 'Septic Shock — Pulmonary Source',
    event_t: 20, alert_t: 13, peak_risk: 0.921, lead_time: 7.0,
    rr_velocity: 6.2, status: 'critical',
    comorbidities: ['COPD', 'Hypertension', 'CAD'],
    vitals: generateVitals({ hr_base:102, rr_base:22, spo2_base:92, sbp_base:105, lactate_base:2.8, temp_base:38.6, gcs_base:14, event_t:20, hr_drift:1.2, rr_drift:0.9, spo2_drop:0.8, sbp_drop:1.8, lac_rise:0.25 }),
    risk: generateRiskTrajectory(20, 13, 0.921),
    shap: generateSHAP(20, 13)
  },
  {
    id: 'PT-10041', name: 'Fatima Al-Rashid', age: 55, sex: 'F',
    bed: 'MICU Bed 11', diagnosis: 'Acute Liver Failure',
    event_t: 28, alert_t: 19, peak_risk: 0.796, lead_time: 9.0,
    rr_velocity: 3.1, status: 'elevated',
    comorbidities: ['Cirrhosis Child-C', 'Coagulopathy'],
    vitals: generateVitals({ hr_base:95, rr_base:20, spo2_base:94, sbp_base:115, lactate_base:3.1, temp_base:37.8, gcs_base:13, event_t:28, hr_drift:0.7, rr_drift:0.5, spo2_drop:0.4, sbp_drop:1.0, lac_rise:0.22 }),
    risk: generateRiskTrajectory(28, 19, 0.796),
    shap: generateSHAP(28, 19)
  },
  {
    id: 'PT-10058', name: 'Robert Okafor', age: 63, sex: 'M',
    bed: 'MICU Bed 02', diagnosis: 'ARDS — Post-Trauma',
    event_t: 22, alert_t: 15, peak_risk: 0.867, lead_time: 7.0,
    rr_velocity: 5.4, status: 'critical',
    comorbidities: ['Trauma Coagulopathy', 'AKI'],
    vitals: generateVitals({ hr_base:112, rr_base:26, spo2_base:90, sbp_base:98, lactate_base:3.5, temp_base:38.2, gcs_base:12, event_t:22, hr_drift:1.0, rr_drift:0.8, spo2_drop:0.7, sbp_drop:1.5, lac_rise:0.20 }),
    risk: generateRiskTrajectory(22, 15, 0.867),
    shap: generateSHAP(22, 15)
  },
  {
    id: 'PT-10065', name: 'Priya Mehta', age: 48, sex: 'F',
    bed: 'CICU Bed 01', diagnosis: 'STEMI — Cardiogenic Shock',
    event_t: 18, alert_t: 11, peak_risk: 0.943, lead_time: 7.0,
    rr_velocity: 7.1, status: 'critical',
    comorbidities: ['Hypertension', 'T2DM', 'Hyperlipidemia'],
    vitals: generateVitals({ hr_base:118, rr_base:24, spo2_base:91, sbp_base:95, lactate_base:4.2, temp_base:37.5, gcs_base:14, event_t:18, hr_drift:1.5, rr_drift:1.0, spo2_drop:0.9, sbp_drop:2.0, lac_rise:0.30 }),
    risk: generateRiskTrajectory(18, 11, 0.943),
    shap: generateSHAP(18, 11)
  },
  {
    id: 'PT-10072', name: 'David Kim', age: 77, sex: 'M',
    bed: 'MICU Bed 09', diagnosis: 'Pneumonia with Respiratory Failure',
    event_t: 30, alert_t: 21, peak_risk: 0.754, lead_time: 9.0,
    rr_velocity: 2.9, status: 'elevated',
    comorbidities: ['COPD Gold III', 'Atrial Fibrillation'],
    vitals: generateVitals({ hr_base:90, rr_base:21, spo2_base:93, sbp_base:120, lactate_base:1.9, temp_base:38.9, gcs_base:15, event_t:30, hr_drift:0.6, rr_drift:0.4, spo2_drop:0.3, sbp_drop:0.8, lac_rise:0.15 }),
    risk: generateRiskTrajectory(30, 21, 0.754),
    shap: generateSHAP(30, 21)
  },
  {
    id: 'PT-10089', name: 'Sarah Thompson', age: 34, sex: 'F',
    bed: 'MICU Bed 14', diagnosis: 'Fulminant Myocarditis',
    event_t: 16, alert_t: 10, peak_risk: 0.912, lead_time: 6.0,
    rr_velocity: 5.8, status: 'critical',
    comorbidities: ['Recent Viral Illness'],
    vitals: generateVitals({ hr_base:130, rr_base:28, spo2_base:89, sbp_base:88, lactate_base:4.8, temp_base:38.3, gcs_base:14, event_t:16, hr_drift:1.3, rr_drift:0.9, spo2_drop:0.8, sbp_drop:1.8, lac_rise:0.28 }),
    risk: generateRiskTrajectory(16, 10, 0.912),
    shap: generateSHAP(16, 10)
  },
  {
    id: 'PT-10094', name: 'James Obi', age: 82, sex: 'M',
    bed: 'MICU Bed 16', diagnosis: 'GI Bleed with Hemodynamic Instability',
    event_t: 26, alert_t: 18, peak_risk: 0.812, lead_time: 8.0,
    rr_velocity: 3.5, status: 'elevated',
    comorbidities: ['Cirrhosis', 'AKI', 'Thrombocytopenia'],
    vitals: generateVitals({ hr_base:105, rr_base:19, spo2_base:95, sbp_base:100, lactate_base:2.2, temp_base:37.0, gcs_base:14, event_t:26, hr_drift:0.9, rr_drift:0.5, spo2_drop:0.4, sbp_drop:1.3, lac_rise:0.16 }),
    risk: generateRiskTrajectory(26, 18, 0.812),
    shap: generateSHAP(26, 18)
  },
  {
    id: 'PT-10101', name: 'Nina Rossi', age: 59, sex: 'F',
    bed: 'MICU Bed 05', diagnosis: 'DKA with AKI',
    event_t: 32, alert_t: 24, peak_risk: 0.698, lead_time: 8.0,
    rr_velocity: 2.1, status: 'stable',
    comorbidities: ['T1DM', 'CKD III'],
    vitals: generateVitals({ hr_base:92, rr_base:22, spo2_base:97, sbp_base:125, lactate_base:1.6, temp_base:37.2, gcs_base:15, event_t:32, hr_drift:0.5, rr_drift:0.4, spo2_drop:0.2, sbp_drop:0.7, lac_rise:0.12 }),
    risk: generateRiskTrajectory(32, 24, 0.698),
    shap: generateSHAP(32, 24)
  },
  {
    id: 'PT-10115', name: 'Ahmed Khalil', age: 66, sex: 'M',
    bed: 'MICU Bed 08', diagnosis: 'Hepatic Encephalopathy Grade III',
    event_t: 25, alert_t: 16, peak_risk: 0.845, lead_time: 9.0,
    rr_velocity: 4.2, status: 'elevated',
    comorbidities: ['Cirrhosis', 'HBV', 'Ascites'],
    vitals: generateVitals({ hr_base:88, rr_base:17, spo2_base:95, sbp_base:110, lactate_base:2.5, temp_base:37.6, gcs_base:11, event_t:25, hr_drift:0.7, rr_drift:0.5, spo2_drop:0.3, sbp_drop:1.1, lac_rise:0.19 }),
    risk: generateRiskTrajectory(25, 16, 0.845),
    shap: generateSHAP(25, 16)
  },
  {
    id: 'PT-10128', name: 'Mary Sullivan', age: 73, sex: 'F',
    bed: 'CICU Bed 03', diagnosis: 'Acute PE — Massive',
    event_t: 14, alert_t: 8, peak_risk: 0.958, lead_time: 6.0,
    rr_velocity: 8.3, status: 'critical',
    comorbidities: ['DVT History', 'AF', 'Obesity'],
    vitals: generateVitals({ hr_base:125, rr_base:30, spo2_base:86, sbp_base:82, lactate_base:5.1, temp_base:37.4, gcs_base:13, event_t:14, hr_drift:1.8, rr_drift:1.2, spo2_drop:1.0, sbp_drop:2.5, lac_rise:0.35 }),
    risk: generateRiskTrajectory(14, 8, 0.958),
    shap: generateSHAP(14, 8)
  },
  {
    id: 'PT-10137', name: 'Leon Dubois', age: 52, sex: 'M',
    bed: 'MICU Bed 12', diagnosis: 'Pancreatitis — Severe Necrotizing',
    event_t: 29, alert_t: 20, peak_risk: 0.778, lead_time: 9.0,
    rr_velocity: 3.3, status: 'elevated',
    comorbidities: ['Alcohol Use Disorder', 'Hyperlipidemia'],
    vitals: generateVitals({ hr_base:97, rr_base:20, spo2_base:94, sbp_base:118, lactate_base:2.0, temp_base:38.1, gcs_base:14, event_t:29, hr_drift:0.7, rr_drift:0.5, spo2_drop:0.3, sbp_drop:0.9, lac_rise:0.14 }),
    risk: generateRiskTrajectory(29, 20, 0.778),
    shap: generateSHAP(29, 20)
  },
  {
    id: 'PT-10143', name: 'Aisha Mohammed', age: 41, sex: 'F',
    bed: 'MICU Bed 03', diagnosis: 'SLE Lupus Nephritis Flare',
    event_t: 33, alert_t: 26, peak_risk: 0.651, lead_time: 7.0,
    rr_velocity: 1.8, status: 'stable',
    comorbidities: ['SLE', 'CKD IV', 'Hypertension'],
    vitals: generateVitals({ hr_base:84, rr_base:16, spo2_base:98, sbp_base:145, lactate_base:1.2, temp_base:37.9, gcs_base:15, event_t:33, hr_drift:0.4, rr_drift:0.3, spo2_drop:0.2, sbp_drop:0.6, lac_rise:0.10 }),
    risk: generateRiskTrajectory(33, 26, 0.651),
    shap: generateSHAP(33, 26)
  },
  {
    id: 'PT-10156', name: 'George Papadopoulos', age: 79, sex: 'M',
    bed: 'MICU Bed 15', diagnosis: 'Urinary Sepsis — Gram Negative',
    event_t: 21, alert_t: 14, peak_risk: 0.891, lead_time: 7.0,
    rr_velocity: 5.0, status: 'critical',
    comorbidities: ['BPH', 'CKD II', 'Atrial Fibrillation'],
    vitals: generateVitals({ hr_base:100, rr_base:21, spo2_base:93, sbp_base:105, lactate_base:2.9, temp_base:38.7, gcs_base:13, event_t:21, hr_drift:1.1, rr_drift:0.7, spo2_drop:0.6, sbp_drop:1.4, lac_rise:0.22 }),
    risk: generateRiskTrajectory(21, 14, 0.891),
    shap: generateSHAP(21, 14)
  },
  {
    id: 'PT-10162', name: 'Lin Wei', age: 45, sex: 'F',
    bed: 'MICU Bed 06', diagnosis: 'Acute Asthma — Status Asthmaticus',
    event_t: 12, alert_t: 7, peak_risk: 0.834, lead_time: 5.0,
    rr_velocity: 6.5, status: 'critical',
    comorbidities: ['Severe Asthma', 'Anxiety Disorder'],
    vitals: generateVitals({ hr_base:115, rr_base:32, spo2_base:88, sbp_base:112, lactate_base:2.6, temp_base:37.3, gcs_base:14, event_t:12, hr_drift:1.2, rr_drift:1.0, spo2_drop:0.8, sbp_drop:1.0, lac_rise:0.20 }),
    risk: generateRiskTrajectory(12, 7, 0.834),
    shap: generateSHAP(12, 7)
  },
  {
    id: 'PT-10178', name: 'Carlos Fuentes', age: 58, sex: 'M',
    bed: 'MICU Bed 10', diagnosis: 'Acute Alcoholic Hepatitis',
    event_t: 27, alert_t: 20, peak_risk: 0.721, lead_time: 7.0,
    rr_velocity: 2.4, status: 'stable',
    comorbidities: ['Alcohol Use Disorder', 'Malnutrition'],
    vitals: generateVitals({ hr_base:96, rr_base:18, spo2_base:96, sbp_base:118, lactate_base:1.8, temp_base:37.7, gcs_base:14, event_t:27, hr_drift:0.6, rr_drift:0.4, spo2_drop:0.2, sbp_drop:0.8, lac_rise:0.12 }),
    risk: generateRiskTrajectory(27, 20, 0.721),
    shap: generateSHAP(27, 20)
  },
  {
    id: 'PT-10184', name: 'Dorothy Walsh', age: 86, sex: 'F',
    bed: 'MICU Bed 17', diagnosis: 'Hypertensive Emergency + AKI',
    event_t: 19, alert_t: 12, peak_risk: 0.876, lead_time: 7.0,
    rr_velocity: 4.5, status: 'critical',
    comorbidities: ['Hypertension', 'CKD III', 'Heart Failure'],
    vitals: generateVitals({ hr_base:94, rr_base:20, spo2_base:93, sbp_base:195, lactate_base:2.1, temp_base:37.2, gcs_base:14, event_t:19, hr_drift:0.8, rr_drift:0.6, spo2_drop:0.5, sbp_drop:2.2, lac_rise:0.18 }),
    risk: generateRiskTrajectory(19, 12, 0.876),
    shap: generateSHAP(19, 12)
  },
  {
    id: 'PT-10191', name: 'Oliver Jensen', age: 61, sex: 'M',
    bed: 'MICU Bed 18', diagnosis: 'Diabetic Ketoacidosis + Sepsis',
    event_t: 23, alert_t: 15, peak_risk: 0.859, lead_time: 8.0,
    rr_velocity: 4.1, status: 'elevated',
    comorbidities: ['T2DM', 'CKD I', 'Peripheral Neuropathy'],
    vitals: generateVitals({ hr_base:108, rr_base:24, spo2_base:92, sbp_base:102, lactate_base:3.2, temp_base:38.4, gcs_base:14, event_t:23, hr_drift:0.9, rr_drift:0.7, spo2_drop:0.6, sbp_drop:1.3, lac_rise:0.21 }),
    risk: generateRiskTrajectory(23, 15, 0.859),
    shap: generateSHAP(23, 15)
  }
];

// ─────────────────────────────────────────────────────────────────────────────
// GLOBAL METRICS
// ─────────────────────────────────────────────────────────────────────────────
window.AEGIS_METRICS = {
  horizon: 6.0,
  auroc: 0.8904,
  news2_auroc: 0.5283,
  sofa_auroc: 0.6714,
  logreg_auroc: 0.7892,
  threshold: 0.35,
  version: '2.0.26',
  monitored_beds: 18,
  critical_alerts: 4,
  elevated_alerts: 5
};

// ─────────────────────────────────────────────────────────────────────────────
// BENCHMARK MODEL COMPARISON DATA
// ─────────────────────────────────────────────────────────────────────────────
window.AEGIS_BENCHMARKS = {
  models: [
    { name: 'XGBoost (AegisICU)', auroc: 0.890, auprc: 0.761, sensitivity: 0.824, specificity: 0.873, ppv: 0.634, npv: 0.942, f1: 0.718, leadTime: 6.0, color: '#e879f9' },
    { name: 'Logistic Regression', auroc: 0.789, auprc: 0.621, sensitivity: 0.731, specificity: 0.824, ppv: 0.548, npv: 0.912, f1: 0.626, leadTime: 4.2, color: '#60a5fa' },
    { name: 'NEWS2 Score', auroc: 0.528, auprc: 0.412, sensitivity: 0.598, specificity: 0.672, ppv: 0.402, npv: 0.831, f1: 0.481, leadTime: 1.8, color: '#34d399' },
    { name: 'SOFA Score', auroc: 0.671, auprc: 0.524, sensitivity: 0.664, specificity: 0.749, ppv: 0.489, npv: 0.874, f1: 0.563, leadTime: 2.5, color: '#fbbf24' },
    { name: 'Random Forest', auroc: 0.862, auprc: 0.724, sensitivity: 0.798, specificity: 0.851, ppv: 0.611, npv: 0.929, f1: 0.692, leadTime: 5.1, color: '#f87171' }
  ],
  // ROC curve points [fpr, tpr] for XGBoost
  roc_xgb: Array.from({length: 51}, (_, i) => {
    const fpr = i / 50;
    const tpr = Math.min(1, Math.pow(fpr, 0.32) * 1.05 + (fpr < 0.1 ? fpr * 2.5 : 0));
    return [parseFloat(fpr.toFixed(3)), parseFloat(Math.max(0, Math.min(1, tpr)).toFixed(3))];
  }),
  roc_news2: Array.from({length: 51}, (_, i) => {
    const fpr = i / 50;
    const tpr = Math.min(1, Math.pow(fpr, 0.88) * 1.02);
    return [parseFloat(fpr.toFixed(3)), parseFloat(Math.max(0, Math.min(1, tpr)).toFixed(3))];
  })
};

// ─────────────────────────────────────────────────────────────────────────────
// LEAD TIME DISTRIBUTION (hours)
// ─────────────────────────────────────────────────────────────────────────────
window.AEGIS_LEAD_TIME_DIST = {
  bins: ['1-2h', '2-3h', '3-4h', '4-5h', '5-6h', '6-7h', '7-8h', '8-9h', '9-10h', '>10h'],
  counts: [3, 7, 14, 21, 28, 34, 29, 22, 15, 9],
  median: 5.8,
  mean: 6.1,
  p25: 4.2,
  p75: 8.1
};

console.log('[AegisICU] Clinical dataset loaded:', window.AEGIS_PATIENTS.length, 'patients.');
