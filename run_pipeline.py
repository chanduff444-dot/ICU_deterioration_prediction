"""
End-to-end execution script for the ICU Early Warning System.
Runs data extraction, feature engineering, model training, evaluation, and artifact generation.
"""

import os
import sys
import time

# Ensure src is in python path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from src.data_loader import load_and_preprocess_cohort
from src.features import generate_sliding_windows, extract_window_features
from src.train_evaluate import train_and_evaluate_pipeline


def main():
    start_time = time.time()
    base_dir = os.path.dirname(os.path.abspath(__file__))
    data_dir = os.path.join(base_dir, "data")
    artifact_dir = os.path.join(base_dir, "artifacts")

    print("==================================================================")
    print("  ICU Early Warning System — Deterioration Prediction Pipeline    ")
    print("==================================================================")
    print(f"Base Directory:     {base_dir}")
    print(f"Data Directory:     {data_dir}")
    print(f"Artifact Directory: {artifact_dir}\n")

    # Step 1: Load cohort & clean physiologic boundaries
    print("[1/4] Loading and cleaning MIMIC-III cohort data...")
    cohort_stays, cohort_vitals, cohort_labs = load_and_preprocess_cohort(data_dir)

    # Step 2: Generate sliding prediction windows
    print("\n[2/4] Constructing hourly sliding prediction windows (H=6h, W=6h)...")
    windows_df = generate_sliding_windows(cohort_stays, horizon_hours=6.0, window_hours=6.0)

    # Step 3: Fast feature aggregation & NEWS2 computation
    print("\n[3/4] Aggregating physiological trends and computing clinical scores...")
    dataset_df, feature_cols = extract_window_features(
        windows_df, cohort_vitals, cohort_labs, cohort_stays, window_hours=6.0
    )

    # Step 4: Model training, evaluation, and artifact export
    print("\n[4/4] Executing stratified patient-split, training models, and exporting...")
    results_df, metadata = train_and_evaluate_pipeline(
        dataset_df, feature_cols, cohort_stays, artifact_dir=artifact_dir, random_seed=42
    )

    total_time = time.time() - start_time
    print("\n==================================================================")
    print(f"  Pipeline execution completed successfully in {total_time:.1f} seconds!  ")
    print(f"  Final XGBoost AUROC: {metadata['final_test_auroc']:.4f}")
    print(f"  Artifacts saved to:  {artifact_dir}")
    print("==================================================================")
    print("To launch the clinical dashboard for your reviewer, run:")
    print("    streamlit run app/dashboard.py")
    print("==================================================================")


if __name__ == "__main__":
    main()
