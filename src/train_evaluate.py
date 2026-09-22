"""
Model Training, Validation, Final Evaluation, and Artifact Export.
Trains NEWS2 baseline, Logistic Regression, and XGBoost.
Computes AUROC, PR-AUC, F1, Recall, Precision, Brier Score, and Lead Time.
"""

import os
import json
import joblib
import numpy as np
import pandas as pd
from typing import Dict, Any, Tuple
from sklearn.linear_model import LogisticRegression
from sklearn.preprocessing import StandardScaler
from sklearn.impute import SimpleImputer
from sklearn.model_selection import StratifiedShuffleSplit
from sklearn.metrics import (
    roc_auc_score, roc_curve, precision_recall_curve, average_precision_score,
    f1_score, recall_score, precision_score, brier_score_loss, confusion_matrix
)
from xgboost import XGBClassifier


def split_data_patient_level(dataset_df: pd.DataFrame, random_seed: int = 42):
    """
    Splits data at the subject_id level with stratification on ever_positive flag.
    70% train / 15% validation / 15% test. Ensures ZERO patient leakage.
    """
    patient_outcome = dataset_df.groupby('subject_id')['label'].max().reset_index()
    patient_outcome.columns = ['subject_id', 'ever_positive']

    # 1. Train vs (Val + Test)
    sss1 = StratifiedShuffleSplit(n_splits=1, test_size=0.30, random_state=random_seed)
    train_idx, temp_idx = next(sss1.split(patient_outcome, patient_outcome['ever_positive']))
    train_patients = set(patient_outcome.iloc[train_idx]['subject_id'])
    temp_df = patient_outcome.iloc[temp_idx].reset_index(drop=True)

    # 2. Val vs Test
    sss2 = StratifiedShuffleSplit(n_splits=1, test_size=0.50, random_state=random_seed)
    val_idx, test_idx = next(sss2.split(temp_df, temp_df['ever_positive']))
    val_patients = set(temp_df.iloc[val_idx]['subject_id'])
    test_patients = set(temp_df.iloc[test_idx]['subject_id'])

    # Leakage assertions
    assert len(train_patients & val_patients) == 0, "Patient leakage between Train and Val!"
    assert len(train_patients & test_patients) == 0, "Patient leakage between Train and Test!"
    assert len(val_patients & test_patients) == 0, "Patient leakage between Val and Test!"

    train_df = dataset_df[dataset_df['subject_id'].isin(train_patients)].copy()
    val_df = dataset_df[dataset_df['subject_id'].isin(val_patients)].copy()
    test_df = dataset_df[dataset_df['subject_id'].isin(test_patients)].copy()

    print("Patient-level stratified split complete:")
    print(f"  Train: {len(train_df)} windows ({train_df['label'].sum()} pos, {len(train_patients)} patients)")
    print(f"  Val:   {len(val_df)} windows ({val_df['label'].sum()} pos, {len(val_patients)} patients)")
    print(f"  Test:  {len(test_df)} windows ({test_df['label'].sum()} pos, {len(test_patients)} patients)")

    return train_df, val_df, test_df


def evaluate_predictions(y_true: pd.Series, y_score: np.ndarray, threshold: float = 0.5, model_name: str = "") -> Dict[str, Any]:
    """Calculates comprehensive discrimination, calibration, and threshold metrics."""
    auroc = float(roc_auc_score(y_true, y_score)) if len(np.unique(y_true)) > 1 else 0.5
    pr_auc = float(average_precision_score(y_true, y_score)) if len(np.unique(y_true)) > 1 else 0.0
    y_pred = (y_score >= threshold).astype(int)

    f1 = float(f1_score(y_true, y_pred, zero_division=0))
    recall = float(recall_score(y_true, y_pred, zero_division=0))
    precision = float(precision_score(y_true, y_pred, zero_division=0))
    brier = float(brier_score_loss(y_true, y_score))

    return {
        'model': model_name,
        'AUROC': round(auroc, 4),
        'PR_AUC': round(pr_auc, 4),
        'F1': round(f1, 4),
        'Recall': round(recall, 4),
        'Precision': round(precision, 4),
        'Brier': round(brier, 4),
        'Threshold': round(threshold, 4)
    }


def compute_lead_time(df: pd.DataFrame, y_score: np.ndarray, threshold: float, event_times_by_stay: Dict[int, float]) -> np.ndarray:
    """
    For stays with a true deterioration/death event, measures hours between first threshold alert
    and actual event time (only alerts strictly prior to event qualify).
    """
    df_eval = df.copy()
    df_eval['score'] = y_score
    lead_times = []
    for stay_id, grp in df_eval.groupby('icustay_id'):
        event_t = event_times_by_stay.get(stay_id, np.nan)
        if pd.isna(event_t):
            continue
        alerts = grp[(grp['score'] >= threshold) & (grp['t'] < event_t)]
        if not alerts.empty:
            first_alert_t = alerts['t'].min()
            lead_times.append(event_t - first_alert_t)
    return np.array(lead_times)


def train_and_evaluate_pipeline(dataset_df: pd.DataFrame,
                                feature_cols: list,
                                cohort_stays: pd.DataFrame,
                                artifact_dir: str,
                                random_seed: int = 42):
    """
    Full pipeline: Trains models, tunes operating threshold, evaluates test set,
    and exports all required artifacts for deployment & presentation.
    """
    os.makedirs(artifact_dir, exist_ok=True)
    train_df, val_df, test_df = split_data_patient_level(dataset_df, random_seed=random_seed)

    X_train, y_train = train_df[feature_cols], train_df['label']
    X_val, y_val = val_df[feature_cols], val_df['label']
    X_test, y_test = test_df[feature_cols], test_df['label']

    # --- 1. Baseline: Logistic Regression ---
    print("\nTraining Logistic Regression baseline...")
    imputer = SimpleImputer(strategy='median')
    X_tr_imp = imputer.fit_transform(X_train)
    scaler = StandardScaler()
    X_tr_scaled = scaler.fit_transform(X_tr_imp)

    lr_model = LogisticRegression(class_weight='balanced', max_iter=1000, random_state=random_seed)
    lr_model.fit(X_tr_scaled, y_train)

    X_val_imp = imputer.transform(X_val)
    X_val_scaled = scaler.transform(X_val_imp)
    lr_val_score = lr_model.predict_proba(X_val_scaled)[:, 1]

    # --- 2. Baseline: NEWS2 (Simplified NHS Ceiling 20) ---
    news2_val_score = (val_df['news2_score'] / 20.0).values

    # --- 3. Primary ML Model: XGBoost ---
    print("Training XGBoost Early Warning Classifier...")
    pos_count = int(y_train.sum())
    neg_count = len(y_train) - pos_count
    spw = float(neg_count / pos_count) if pos_count > 0 else 1.0

    xgb_val_model = XGBClassifier(
        objective='binary:logistic',
        eval_metric='auc',
        max_depth=5,
        learning_rate=0.08,
        n_estimators=300,
        subsample=0.8,
        colsample_bytree=0.8,
        scale_pos_weight=spw,
        random_state=random_seed
    )
    xgb_val_model.fit(X_train, y_train)
    xgb_val_score = xgb_val_model.predict_proba(X_val)[:, 1]

    # --- 4. Select Operating Threshold on Validation Set ---
    # Robust search: try to achieve target recall >= 0.80; if not attainable, maximize F1
    thresholds_to_try = np.linspace(0.05, 0.95, 91)
    best_thresh = 0.50
    candidates = []
    for thresh in thresholds_to_try:
        y_val_p = (xgb_val_score >= thresh).astype(int)
        r = recall_score(y_val, y_val_p, zero_division=0)
        p = precision_score(y_val, y_val_p, zero_division=0)
        f1 = f1_score(y_val, y_val_p, zero_division=0)
        candidates.append({'thresh': thresh, 'recall': r, 'precision': p, 'f1': f1})

    cand_df = pd.DataFrame(candidates)
    high_recall_cands = cand_df[cand_df['recall'] >= 0.80]
    if not high_recall_cands.empty:
        # Highest threshold that still retains >=80% recall to minimize false alarms
        best_thresh = float(high_recall_cands.iloc[-1]['thresh'])
    else:
        # Fallback to highest F1 threshold
        best_thresh = float(cand_df.sort_values('f1', ascending=False).iloc[0]['thresh'])

    print(f"Selected Clinical Operating Threshold: {best_thresh:.3f}")

    # --- 5. Final Model: Retrain on Combined (Train + Val) ---
    print("Retraining final tuned model on Train + Validation sets...")
    X_trainval = pd.concat([X_train, X_val], ignore_index=True)
    y_trainval = pd.concat([y_train, y_val], ignore_index=True)
    spw_final = float((len(y_trainval) - y_trainval.sum()) / max(y_trainval.sum(), 1))

    xgb_final = XGBClassifier(
        objective='binary:logistic',
        eval_metric='auc',
        max_depth=5,
        learning_rate=0.08,
        n_estimators=300,
        subsample=0.8,
        colsample_bytree=0.8,
        scale_pos_weight=spw_final,
        random_state=random_seed
    )
    xgb_final.fit(X_trainval, y_trainval)

    # --- 6. Held-out Test Set Evaluation ---
    print("\nEvaluating on Held-Out Test Set (Single Final Pass)...")
    xgb_test_score = xgb_final.predict_proba(X_test)[:, 1]
    xgb_metrics = evaluate_predictions(y_test, xgb_test_score, threshold=best_thresh, model_name="XGBoost (Final)")

    X_test_imp = imputer.transform(X_test)
    X_test_scaled = scaler.transform(X_test_imp)
    lr_test_score = lr_model.predict_proba(X_test_scaled)[:, 1]
    lr_metrics = evaluate_predictions(y_test, lr_test_score, threshold=0.5, model_name="Logistic Regression")

    news2_test_score = (test_df['news2_score'] / 20.0).values
    news2_metrics = evaluate_predictions(y_test, news2_test_score, threshold=0.25, model_name="NEWS2 (Clinical Score)")

    results_df = pd.DataFrame([news2_metrics, lr_metrics, xgb_metrics])
    print(results_df.to_string(index=False))

    # Lead time analysis
    event_times_by_stay = cohort_stays.set_index('icustay_id')['death_hours_since_admit'].to_dict()
    lead_times = compute_lead_time(test_df, xgb_test_score, threshold=best_thresh, event_times_by_stay=event_times_by_stay)
    if len(lead_times) > 0:
        print(f"Lead time alerts: {len(lead_times)} events detected in advance.")
        print(f"  Median advance lead time: {np.median(lead_times):.1f} hours")
    else:
        print("  Lead time: No true positive death events occurred with prior alert in test partition.")

    # --- 7. Save Predictions & Export Artifacts ---
    print(f"\nSaving artifacts to {artifact_dir}...")
    xgb_final.save_model(os.path.join(artifact_dir, 'xgb_final.json'))
    joblib.dump(lr_model, os.path.join(artifact_dir, 'lr_model.pkl'))
    joblib.dump(imputer, os.path.join(artifact_dir, 'lr_imputer.pkl'))
    joblib.dump(scaler, os.path.join(artifact_dir, 'lr_scaler.pkl'))

    with open(os.path.join(artifact_dir, 'feature_names.json'), 'w') as f:
        json.dump(feature_cols, f, indent=2)

    results_df.to_csv(os.path.join(artifact_dir, 'final_results.csv'), index=False)

    metadata = {
        'horizon_hours': 6.0,
        'window_hours': 6.0,
        'operating_threshold': float(best_thresh),
        'final_test_auroc': float(xgb_metrics['AUROC']),
        'final_test_prauc': float(xgb_metrics['PR_AUC']),
        'final_test_recall': float(xgb_metrics['Recall']),
        'final_test_precision': float(xgb_metrics['Precision']),
        'random_seed': random_seed,
        'num_features': len(feature_cols),
        'test_patients_count': int(test_df['subject_id'].nunique()),
        'test_windows_count': len(test_df)
    }
    with open(os.path.join(artifact_dir, 'metadata.json'), 'w') as f:
        json.dump(metadata, f, indent=2)

    # Save test predictions DataFrame with timestamps & features for instant dashboard loading
    test_export = test_df.copy()
    test_export['xgb_risk_score'] = xgb_test_score
    test_export['lr_risk_score'] = lr_test_score
    test_export['news2_norm_score'] = news2_test_score
    test_export['alert_fired'] = (xgb_test_score >= best_thresh).astype(int)
    test_export.to_csv(os.path.join(artifact_dir, 'test_predictions.csv'), index=False)

    print("All artifacts successfully saved!")
    return results_df, metadata
