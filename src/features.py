"""
Feature Engineering & Window Aggregation for ICU Early Warning System.
Extracts sliding window physiological features and clinical NEWS2 score.
"""

import numpy as np
import pandas as pd
from typing import List, Tuple
from src.data_loader import VITAL_ITEMIDS, LAB_ITEMIDS


def generate_sliding_windows(cohort_stays: pd.DataFrame,
                             horizon_hours: float = 6.0,
                             window_hours: float = 6.0) -> pd.DataFrame:
    """
    Generates hourly observation points t for each ICU stay from t=4 to los - H.
    Label = 1 if deterioration occurs in (t, t + H], else 0.
    """
    rows = []
    for _, stay in cohort_stays.iterrows():
        max_t = stay['los_hours'] - horizon_hours
        if max_t < 4.0:
            continue
        for t in np.arange(4.0, max_t, 1.0):
            label = 0
            if pd.notna(stay['death_hours_since_admit']):
                if t < stay['death_hours_since_admit'] <= (t + horizon_hours):
                    label = 1
            rows.append({
                'icustay_id': stay['icustay_id'],
                'subject_id': stay['subject_id'],
                't': t,
                'label': label
            })

    windows_df = pd.DataFrame(rows)
    print(f"Generated {len(windows_df)} sliding windows. Positive windows: {windows_df['label'].sum()} ({windows_df['label'].mean():.2%})")
    return windows_df


def compute_news2(row: pd.Series) -> int:
    """
    Simplified NEWS2 score from respiratory rate, SpO2, temperature, systolic BP, and heart rate.
    Standard NHS thresholds (0-3 points per vital).
    """
    score = 0
    # Resp Rate
    rr = row.get('resp_rate_last', np.nan)
    if pd.notna(rr):
        if rr <= 8 or rr >= 25:
            score += 3
        elif 21 <= rr <= 24:
            score += 2
        elif 9 <= rr <= 11:
            score += 1

    # SpO2
    spo2 = row.get('spo2_last', np.nan)
    if pd.notna(spo2):
        if spo2 <= 91:
            score += 3
        elif 92 <= spo2 <= 93:
            score += 2
        elif 94 <= spo2 <= 95:
            score += 1

    # Temperature (Celsius)
    temp = row.get('temp_c_last', np.nan)
    if pd.notna(temp):
        if temp <= 35.0:
            score += 3
        elif temp >= 39.1:
            score += 2
        elif 35.1 <= temp <= 36.0 or 38.1 <= temp <= 39.0:
            score += 1

    # Systolic Blood Pressure
    sbp = row.get('sbp_last', np.nan)
    if pd.notna(sbp):
        if sbp <= 90 or sbp >= 220:
            score += 3
        elif 91 <= sbp <= 100:
            score += 2
        elif 101 <= sbp <= 110:
            score += 1

    # Heart Rate
    hr = row.get('heart_rate_last', np.nan)
    if pd.notna(hr):
        if hr <= 40 or hr >= 131:
            score += 3
        elif 111 <= hr <= 130:
            score += 2
        elif (41 <= hr <= 50) or (91 <= hr <= 110):
            score += 1

    return int(score)


def extract_window_features(windows_df: pd.DataFrame,
                            cohort_vitals: pd.DataFrame,
                            cohort_labs: pd.DataFrame,
                            cohort_stays: pd.DataFrame,
                            window_hours: float = 6.0) -> Tuple[pd.DataFrame, List[str]]:
    """
    Fast, pre-indexed aggregation of vitals, labs, and demographics for each sliding window.
    Fixes np.polyfit length mismatches and eliminates Colab row-by-row iteration bottleneck.
    """
    print("Extracting sliding-window physiological features...")
    vital_vars = sorted(set(VITAL_ITEMIDS.values()) - {'temp_f'})
    lab_vars = sorted(set(LAB_ITEMIDS.values()))

    # Group by icustay_id for O(1) indexed lookups
    vitals_by_stay = {k: v.sort_values('hours_since_admit') for k, v in cohort_vitals.groupby('icustay_id')}
    labs_by_stay = {k: v.sort_values('hours_since_admit') for k, v in cohort_labs.groupby('icustay_id')}

    feature_records = []
    for row in windows_df.itertuples():
        stay_id = row.icustay_id
        t = row.t
        feats = {'icustay_id': stay_id, 't': t}

        # 1. Vitals Window
        v_data = vitals_by_stay.get(stay_id)
        if v_data is not None and not v_data.empty:
            w_v = v_data[(v_data['hours_since_admit'] > (t - window_hours)) & (v_data['hours_since_admit'] <= t)]
        else:
            w_v = None

        for var in vital_vars:
            if w_v is not None and not w_v.empty:
                sub = w_v[w_v['variable'] == var].dropna(subset=['valuenum', 'hours_since_admit'])
                vals = sub['valuenum']
            else:
                sub = pd.DataFrame()
                vals = pd.Series([], dtype=float)

            if len(vals) == 0:
                feats[f'{var}_last'] = np.nan
                feats[f'{var}_mean'] = np.nan
                feats[f'{var}_min'] = np.nan
                feats[f'{var}_max'] = np.nan
                feats[f'{var}_std'] = np.nan
                feats[f'{var}_slope'] = np.nan
                feats[f'{var}_count'] = 0
                feats[f'{var}_time_since_last'] = np.nan
            else:
                feats[f'{var}_last'] = float(vals.iloc[-1])
                feats[f'{var}_mean'] = float(vals.mean())
                feats[f'{var}_min'] = float(vals.min())
                feats[f'{var}_max'] = float(vals.max())
                feats[f'{var}_std'] = float(vals.std()) if len(vals) > 1 else 0.0

                # Safe polyfit: ensure exact matching length and non-zero time span
                x_vals = sub['hours_since_admit'].values
                if len(vals) >= 2 and (x_vals[-1] > x_vals[0]):
                    feats[f'{var}_slope'] = float(np.polyfit(x_vals, vals.values, 1)[0])
                else:
                    feats[f'{var}_slope'] = 0.0

                feats[f'{var}_count'] = len(vals)
                feats[f'{var}_time_since_last'] = float(t - sub['hours_since_admit'].iloc[-1])

        # 2. Labs Window
        l_data = labs_by_stay.get(stay_id)
        if l_data is not None and not l_data.empty:
            w_l = l_data[(l_data['hours_since_admit'] > (t - window_hours)) & (l_data['hours_since_admit'] <= t)]
        else:
            w_l = None

        for var in lab_vars:
            if w_l is not None and not w_l.empty:
                sub = w_l[w_l['variable'] == var].dropna(subset=['valuenum', 'hours_since_admit'])
                vals = sub['valuenum']
            else:
                sub = pd.DataFrame()
                vals = pd.Series([], dtype=float)

            if len(vals) == 0:
                feats[f'{var}_last'] = np.nan
                feats[f'{var}_mean'] = np.nan
                feats[f'{var}_min'] = np.nan
                feats[f'{var}_max'] = np.nan
                feats[f'{var}_count'] = 0
                feats[f'{var}_time_since_last'] = np.nan
            else:
                feats[f'{var}_last'] = float(vals.iloc[-1])
                feats[f'{var}_mean'] = float(vals.mean())
                feats[f'{var}_min'] = float(vals.min())
                feats[f'{var}_max'] = float(vals.max())
                feats[f'{var}_count'] = len(vals)
                feats[f'{var}_time_since_last'] = float(t - sub['hours_since_admit'].iloc[-1])

        feature_records.append(feats)

    features_df = pd.DataFrame(feature_records)
    dataset_df = windows_df.merge(features_df, on=['icustay_id', 't'], how='left')

    # 3. Add Demographics
    dataset_df = dataset_df.merge(
        cohort_stays[['icustay_id', 'age', 'gender']], on='icustay_id', how='left'
    )
    dataset_df['gender_male'] = (dataset_df['gender'] == 'M').astype(int)
    dataset_df.drop(columns=['gender'], inplace=True)

    # 4. Add NEWS2 Score
    dataset_df['news2_score'] = dataset_df.apply(compute_news2, axis=1)

    # 5. Extract Feature Column Names
    exclude_cols = {'icustay_id', 'subject_id', 't', 'label'}
    feature_cols = [c for c in dataset_df.columns if c not in exclude_cols]

    print(f"Feature matrix complete: {dataset_df.shape[0]} windows, {len(feature_cols)} predictor features.")
    return dataset_df, feature_cols
