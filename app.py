"""Interactive AegisICU inference dashboard for Hugging Face Spaces."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import gradio as gr
import matplotlib.pyplot as plt
import pandas as pd


ROOT = Path(__file__).resolve().parent
ARTIFACTS = ROOT / "artifacts"
PREDICTIONS = ARTIFACTS / "test_predictions.csv"


def load_assets() -> tuple[pd.DataFrame, dict[str, Any], pd.DataFrame, list[str]]:
    predictions = pd.read_csv(PREDICTIONS)
    metadata = json.loads((ARTIFACTS / "metadata.json").read_text(encoding="utf-8"))
    results = pd.read_csv(ARTIFACTS / "final_results.csv")
    features = json.loads((ARTIFACTS / "feature_names.json").read_text(encoding="utf-8"))
    return predictions, metadata, results, features


PREDICTIONS_DF, METADATA, RESULTS_DF, FEATURE_NAMES = load_assets()
STAYS = sorted(PREDICTIONS_DF["icustay_id"].dropna().unique().tolist())


def stay_frame(stay_id: int) -> pd.DataFrame:
    return PREDICTIONS_DF[PREDICTIONS_DF["icustay_id"] == stay_id].sort_values("t")


def render_stay(stay_id: int, threshold: float) -> tuple[str, Any, pd.DataFrame]:
    frame = stay_frame(int(stay_id))
    if frame.empty:
        return "No records found for this ICU stay.", None, pd.DataFrame()

    latest = frame.iloc[-1]
    risk = float(latest["xgb_risk_score"])
    status = "CRITICAL ALERT" if risk >= threshold else "ELEVATED MONITORING" if risk >= threshold * 0.7 else "NORMAL STABILITY"
    color = "🔴" if risk >= threshold else "🟠" if risk >= threshold * 0.7 else "🟢"
    summary = (
        f"## {color} {status}\n"
        f"**Patient:** #{int(latest['subject_id'])}  |  **ICU stay:** #{int(stay_id)}  |  "
        f"**Current risk:** `{risk:.1%}`  |  **Alert threshold:** `{threshold:.1%}`\n\n"
        f"**Age:** {int(latest['age'])}  |  **Gender:** "
        f"{'Male' if latest['gender_male'] == 1 else 'Female'}  |  "
        f"**NEWS2:** {int(latest['news2_score'])}/20  |  "
        f"**Monitoring time:** {float(latest['t']):.1f} hours"
    )

    fig, ax = plt.subplots(figsize=(10, 4))
    ax.plot(frame["t"], frame["xgb_risk_score"], marker="o", label="XGBoost risk")
    ax.plot(frame["t"], frame["news2_norm_score"], linestyle=":", label="NEWS2 baseline")
    ax.axhline(threshold, color="#dc2626", linestyle="--", label="Alert threshold")
    alerts = frame[frame["xgb_risk_score"] >= threshold]
    if not alerts.empty:
        ax.scatter(alerts["t"], alerts["xgb_risk_score"], color="#dc2626", zorder=3, label="Alert")
    ax.set(xlabel="Hours since ICU admission", ylabel="Predicted deterioration probability", ylim=(-0.02, 1.02))
    ax.grid(alpha=0.25)
    ax.legend(loc="upper left")
    fig.tight_layout()

    columns = [
        "t", "heart_rate_last", "resp_rate_last", "sbp_last", "spo2_last",
        "temp_c_last", "lactate_last", "creatinine_last", "news2_score", "xgb_risk_score",
    ]
    table = frame[[column for column in columns if column in frame.columns]].tail(10).round(4)
    return summary, fig, table


def apply_uploaded_features(file: Any) -> str:
    """Score an uploaded feature CSV using the trained XGBoost model."""
    if file is None:
        return "Upload a CSV containing the engineered feature columns listed below."
    try:
        import xgboost as xgb

        uploaded = pd.read_csv(file.name if hasattr(file, "name") else file)
        missing = [column for column in FEATURE_NAMES if column not in uploaded.columns]
        if missing:
            return f"CSV is missing {len(missing)} feature columns, including: {', '.join(missing[:8])}"
        model = xgb.XGBClassifier()
        model.load_model(str(ARTIFACTS / "xgb_final.json"))
        scores = model.predict_proba(uploaded[FEATURE_NAMES])[:, 1]
        output = uploaded.copy()
        output["xgb_risk_score"] = scores
        output["alert"] = scores >= float(METADATA.get("operating_threshold", 0.05))
        return output.head(100).to_markdown(index=False)
    except Exception as exc:
        return f"Unable to score uploaded data: `{type(exc).__name__}: {exc}`"


def model_summary() -> str:
    return (
        f"### Model evaluation\n"
        f"- Test AUROC: **{METADATA.get('final_test_auroc', 0):.4f}**\n"
        f"- Test windows: **{METADATA.get('test_windows_count', 0)}**\n"
        f"- Test patients: **{METADATA.get('test_patients_count', 0)}**\n"
        f"- Features: **{METADATA.get('num_features', len(FEATURE_NAMES))}**\n\n"
        "This is a clinical decision-support demonstration, not a diagnostic device."
    )


with gr.Blocks(title="AegisICU") as demo:
    gr.Markdown(
        "# 🏥 AegisICU — Interactive ICU Early Warning System\n"
        "Server-backed inference dashboard using the trained XGBoost model. "
        "Use the selector for the included test cohort or upload engineered feature rows for new predictions."
    )
    with gr.Tab("Live patient monitor"):
        with gr.Row():
            stay = gr.Dropdown(choices=STAYS, value=STAYS[0], label="ICU stay")
            threshold = gr.Slider(0.05, 0.95, value=float(METADATA.get("operating_threshold", 0.05)),
                                  step=0.05, label="Clinical alert threshold")
        refresh = gr.Button("Refresh risk assessment", variant="primary")
        summary = gr.Markdown()
        chart = gr.Plot()
        table = gr.Dataframe(label="Latest physiological measurements")
        refresh.click(render_stay, [stay, threshold], [summary, chart, table])
        stay.change(render_stay, [stay, threshold], [summary, chart, table])
        threshold.change(render_stay, [stay, threshold], [summary, chart, table])
        demo.load(render_stay, [stay, threshold], [summary, chart, table])

    with gr.Tab("Score new data"):
        gr.Markdown(
            "Upload a CSV with the 87 engineered columns from `artifacts/feature_names.json`. "
            "Each row is scored on the server using the trained model."
        )
        upload = gr.File(file_types=[".csv"], label="Engineered feature CSV")
        score = gr.Button("Run model inference", variant="primary")
        scored = gr.Markdown()
        score.click(apply_uploaded_features, upload, scored)

    with gr.Tab("Model performance"):
        gr.Dataframe(RESULTS_DF, label="Held-out test cohort results", interactive=False)
        gr.Markdown(model_summary())


if __name__ == "__main__":
    demo.launch()
