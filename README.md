# AegisICU: ICU Deterioration Prediction

AegisICU is an end-to-end ICU early-warning system that estimates the risk of
in-hospital deterioration or death up to **six hours in advance**. It combines
physiological trends, laboratory measurements, a NEWS2 clinical baseline, and
machine-learning models with interactive dashboards for clinical review.

> **Research and demonstration software only.** AegisICU is not a medical
> device and must not be used for diagnosis, treatment, triage, or real-world
> clinical decisions.

## Highlights

- Builds hourly, six-hour observation windows from ICU time-series data.
- Extracts vital-sign and laboratory summary/trend features plus NEWS2 scores.
- Trains Logistic Regression and XGBoost models with patient-level splits.
- Prevents patient leakage by keeping each `subject_id` in only one split.
- Selects an operating alert threshold on validation data.
- Exports reusable model artifacts and held-out predictions.
- Provides three ways to explore results:
  - a browser-based static AegisICU dashboard,
  - a Streamlit clinical review dashboard,
  - a Gradio inference dashboard with CSV scoring.

## Repository layout

```text
.
├── app/
│   ├── dashboard.py                 # Streamlit clinical review dashboard
│   └── web/                         # Source for the static browser dashboard
├── artifacts/
│   ├── feature_names.json           # Engineered feature schema
│   ├── metadata.json                # Configuration and evaluation metadata
│   └── final_results.csv            # Model comparison metrics
├── data/                            # Local MIMIC-III CSV files (not committed)
├── src/
│   ├── data_loader.py               # Cohort creation and data cleaning
│   ├── features.py                  # Windowing and feature engineering
│   └── train_evaluate.py            # Training, evaluation, and export
├── app.py                           # Gradio inference dashboard
├── run_pipeline.py                  # End-to-end training entry point
├── ICU_Early_Warning_System_Fixed.ipynb
├── requirements.txt
└── README.md
```

## Requirements

- Python 3.10 or newer
- The MIMIC-III Clinical Database Demo (or another compatible, authorized
  extract)
- Approximately 2 GB of free disk space for the source tables and generated
  artifacts

The repository intentionally does **not** include clinical CSV data, patient
level prediction rows, or serialized trained models. Obtain
MIMIC-III through its official PhysioNet access process and use it only
according to its data-use agreement. Place the required CSV files in `data/`.
The pipeline currently reads:

`PATIENTS.csv`, `ADMISSIONS.csv`, `ICUSTAYS.csv`, `CHARTEVENTS.csv`, and
`LABEVENTS.csv`.

## Installation

From the repository root:

```powershell
python -m venv .venv
.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
python -m pip install -r requirements.txt
```

## Quick start

### 1. Train and evaluate the models

After placing the authorized source data in `data/`:

```powershell
python run_pipeline.py
```

The pipeline cleans the cohort, creates six-hour sliding windows, engineers
features, performs a 70/15/15 patient-level train/validation/test split, tunes
the operating threshold, and writes outputs to `artifacts/`.

### 2. Launch the Streamlit dashboard

```powershell
streamlit run app/dashboard.py
```

Open <http://localhost:8501>. The dashboard shows risk trajectories, alert
thresholds, physiological measurements, NEWS2 comparisons, and reviewer
talking points.

### 3. Launch the Gradio inference dashboard

```powershell
python app.py
```

The Gradio interface lets you inspect locally generated test stays, compare
model performance, and upload a CSV containing the engineered columns listed
in `artifacts/feature_names.json` for XGBoost scoring. Run the training
pipeline first so the local model and prediction artifacts exist.

### 4. Launch the static browser dashboard

The repository also contains the client-side AegisICU experience in
`index.html`, `app.js`, `clinical_data.js`, `patients.js`, and `styles.css`.
Run it through the included local server:

```powershell
python run_web.py
```

This dashboard uses browser-side demonstration telemetry and does not require
the Python model pipeline.

## Modeling approach

| Component | Configuration |
| --- | --- |
| Prediction target | In-hospital deterioration/death proxy |
| Prediction horizon | 6 hours |
| Observation window | 6 hours |
| Prediction unit | Hourly sliding window per ICU stay |
| Clinical baseline | Simplified NEWS2 score |
| ML models | Balanced Logistic Regression and tuned XGBoost |
| Split strategy | Patient-level stratified 70% train / 15% validation / 15% test |
| Random seed | 42 |
| Feature count | 87 |

The patient-level split is important: windows from the same patient must not
appear in both training and evaluation data, otherwise reported performance
would be optimistic because of leakage.

## Evaluation snapshot

The checked-in artifacts were generated from the current held-out test split.
The values below are descriptive results for this dataset and configuration,
not clinical validation:

| Model | AUROC | PR-AUC | Recall | Precision | F1 | Brier |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| NEWS2 (clinical score) | 0.5688 | 0.0335 | 0.5000 | 0.0034 | 0.0068 | 0.0532 |
| Logistic Regression | 0.8899 | 0.0960 | 0.2500 | 0.0185 | 0.0345 | 0.0278 |
| XGBoost (final) | 0.8148 | 0.0089 | 0.0000 | 0.0000 | 0.0000 | 0.0031 |

Metrics can change when the data extract, preprocessing, library versions,
random seed, or artifact files change. Always inspect `artifacts/metadata.json`
and `artifacts/final_results.csv` after retraining.

## Data governance and limitations

- MIMIC-III is restricted clinical research data; do not commit it, redistribute
  it, or use it outside the applicable PhysioNet terms.
- This project uses a small demonstration cohort and is not externally
  validated.
- The deterioration/death label is a proxy and should not be interpreted as a
  complete clinical deterioration definition.
- The class imbalance makes precision-recall metrics and threshold behavior
  especially important.
- Missingness, measurement frequency, documentation practices, and cohort
  selection can introduce bias.
- Model scores are not calibrated clinical probabilities and require proper
  prospective validation before any operational use.

## Reproducing the notebook

The notebook
`ICU_Early_Warning_System_Fixed.ipynb` documents the analysis and the fixes for
age-overflow handling, paired timestamp/value filtering, efficient window
aggregation, local data paths, and operating-threshold selection.

## License and attribution

The source code in this repository is provided for educational and research
purposes. MIMIC-III data is governed by PhysioNet's separate data-use terms
and is not licensed by this repository. Review `data/LICENSE.txt` when working
with an authorized local copy.
