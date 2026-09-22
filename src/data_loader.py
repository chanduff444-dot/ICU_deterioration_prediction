"""
Data Loader & Cohort Selection for ICU Early Warning System.
Loads MIMIC-III demo tables, applies physiologic bounds clipping,
and builds an adult ICU cohort with safe timestamp/age handling.
"""

import os
import pandas as pd
import numpy as np

# Physiologic plausible bounds (clip outside these ranges)
PHYSIO_BOUNDS = {
    "heart_rate": (20, 250),    # bpm
    "resp_rate": (4, 60),      # breaths/min
    "spo2": (50, 100),         # %
    "sbp": (40, 250),          # mmHg
    "dbp": (20, 180),          # mmHg
    "temp_c": (25, 43),        # Celsius
    "lactate": (0.1, 30),      # mmol/L
    "creatinine": (0.1, 20),   # mg/dL
}

# Standard mapping for common MIMIC-III vitals
VITAL_ITEMIDS = {
    211: 'heart_rate', 220045: 'heart_rate',
    618: 'resp_rate', 220210: 'resp_rate',
    646: 'spo2', 220277: 'spo2',
    51: 'sbp', 220050: 'sbp',
    8368: 'dbp', 220051: 'dbp',
    678: 'temp_f', 223761: 'temp_c',
}

# Standard mapping for common MIMIC-III labs
LAB_ITEMIDS = {
    50813: 'lactate',
    50912: 'creatinine',
    51301: 'wbc',
    50983: 'sodium',
    50971: 'potassium',
    50882: 'bicarbonate',
}


def clip_physio(series: pd.Series, var_name: str) -> pd.Series:
    """Clips series within physiologically plausible boundaries."""
    lo, hi = PHYSIO_BOUNDS.get(var_name, (series.min(), series.max()))
    return series.clip(lower=lo, upper=hi)


def load_and_preprocess_cohort(data_dir: str):
    """
    Loads raw MIMIC-III CSV files and constructs the cleaned ICU cohort.

    Returns:
        cohort_stays: DataFrame of ICU stays meeting inclusion criteria.
        cohort_vitals_mapped: Cleaned and clipped vitals time series.
        cohort_labs_mapped: Cleaned and clipped labs time series.
    """
    print(f"Loading raw tables from {data_dir}...")
    patients = pd.read_csv(os.path.join(data_dir, "PATIENTS.csv"))
    admissions = pd.read_csv(os.path.join(data_dir, "ADMISSIONS.csv"))
    icustays = pd.read_csv(os.path.join(data_dir, "ICUSTAYS.csv"))
    chartevents = pd.read_csv(os.path.join(data_dir, "CHARTEVENTS.csv"),
                              usecols=['icustay_id', 'itemid', 'charttime', 'valuenum'])
    labevents = pd.read_csv(os.path.join(data_dir, "LABEVENTS.csv"),
                            usecols=['subject_id', 'hadm_id', 'itemid', 'charttime', 'valuenum'])

    # 1. Parse ICU stay boundaries
    icustays['intime'] = pd.to_datetime(icustays['intime'])
    icustays['outtime'] = pd.to_datetime(icustays['outtime'])
    icustays['los_hours'] = (icustays['outtime'] - icustays['intime']).dt.total_seconds() / 3600.0

    # 2. Select first ICU stay per patient
    icustays_sorted = icustays.sort_values(['subject_id', 'intime'])
    first_stay = icustays_sorted.groupby('subject_id').first().reset_index()

    # 3. Calculate age safely (avoids pandas 2.0+ int64 overflow from ~300yr obfuscated birth years)
    patients['dob'] = pd.to_datetime(patients['dob'], errors='coerce')
    cohort = first_stay.merge(patients[['subject_id', 'dob', 'gender']], on='subject_id', how='left')
    cohort['age'] = cohort['intime'].dt.year - cohort['dob'].dt.year
    cohort.loc[cohort['age'] > 89, 'age'] = 90.0

    # 4. Inclusion filters: age >= 18, ICU length of stay >= 6 hours
    cohort = cohort[(cohort['age'] >= 18) & (cohort['los_hours'] >= 6.0)].copy()

    cohort_stays = cohort[['subject_id', 'hadm_id', 'icustay_id', 'intime', 'outtime',
                           'los_hours', 'age', 'gender']].copy()

    # 5. Link in-hospital death outcome
    admissions['deathtime'] = pd.to_datetime(admissions['deathtime'])
    cohort_stays = cohort_stays.merge(
        admissions[['hadm_id', 'deathtime']], on='hadm_id', how='left'
    )
    cohort_stays['death_hours_since_admit'] = (
        cohort_stays['deathtime'] - cohort_stays['intime']
    ).dt.total_seconds() / 3600.0

    print(f"Cohort ready: {len(cohort_stays)} stays from {cohort_stays['subject_id'].nunique()} unique patients.")

    # 6. Process vitals
    chartevents['charttime'] = pd.to_datetime(chartevents['charttime'])
    cohort_vitals = chartevents.merge(
        cohort_stays[['icustay_id', 'intime']], on='icustay_id', how='inner'
    )
    cohort_vitals['hours_since_admit'] = (
        cohort_vitals['charttime'] - cohort_vitals['intime']
    ).dt.total_seconds() / 3600.0
    cohort_vitals = cohort_vitals[cohort_vitals['hours_since_admit'] >= 0].copy()

    cohort_vitals['variable'] = cohort_vitals['itemid'].map(VITAL_ITEMIDS)
    cohort_vitals_mapped = cohort_vitals.dropna(subset=['variable']).copy()

    # Convert Fahrenheit to Celsius
    is_f = cohort_vitals_mapped['variable'] == 'temp_f'
    cohort_vitals_mapped.loc[is_f, 'valuenum'] = (cohort_vitals_mapped.loc[is_f, 'valuenum'] - 32.0) * 5.0 / 9.0
    cohort_vitals_mapped.loc[is_f, 'variable'] = 'temp_c'

    # Apply clipping
    for var_name in cohort_vitals_mapped['variable'].unique():
        mask = cohort_vitals_mapped['variable'] == var_name
        cohort_vitals_mapped.loc[mask, 'valuenum'] = clip_physio(
            cohort_vitals_mapped.loc[mask, 'valuenum'], var_name
        )

    # 7. Process labs
    labevents['charttime'] = pd.to_datetime(labevents['charttime'])
    cohort_labs = labevents.merge(
        cohort_stays[['subject_id', 'hadm_id', 'icustay_id', 'intime']],
        on=['subject_id', 'hadm_id'], how='inner'
    )
    cohort_labs['hours_since_admit'] = (
        cohort_labs['charttime'] - cohort_labs['intime']
    ).dt.total_seconds() / 3600.0
    cohort_labs = cohort_labs[cohort_labs['hours_since_admit'] >= 0].copy()

    cohort_labs['variable'] = cohort_labs['itemid'].map(LAB_ITEMIDS)
    cohort_labs_mapped = cohort_labs.dropna(subset=['variable']).copy()

    # Apply clipping
    for var_name in cohort_labs_mapped['variable'].unique():
        mask = cohort_labs_mapped['variable'] == var_name
        cohort_labs_mapped.loc[mask, 'valuenum'] = clip_physio(
            cohort_labs_mapped.loc[mask, 'valuenum'], var_name
        )

    return cohort_stays, cohort_vitals_mapped, cohort_labs_mapped
