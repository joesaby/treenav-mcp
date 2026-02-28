---
title: "ML Data Pipeline"
description: "Building reproducible data preprocessing and feature engineering pipelines with scikit-learn and Apache Airflow."
tags: [pipeline, feature-engineering, preprocessing, etl, airflow, scikit-learn, data-validation]
type: architecture
category: data-science
---

# ML Data Pipeline

A data pipeline transforms raw input data into model-ready features through a
sequence of preprocessing and feature engineering steps.

## Pipeline Architecture

The standard flow:

```
Raw Data → Validation → Preprocessing → Feature Engineering → Train/Val/Test Split → Model
```

## Data Validation

Validate incoming data before feeding it to the pipeline:

- **Schema validation** — verify column names and types
- **Range checks** — values within expected bounds
- **Missing value audit** — flag columns exceeding 5% null rate
- **Distribution drift detection** — alert on significant statistical changes

## Preprocessing

### Numeric Features

```python
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler
from sklearn.impute import SimpleImputer

numeric_pipeline = Pipeline([
    ("impute", SimpleImputer(strategy="median")),
    ("scale", StandardScaler()),
])
```

### Categorical Features

```python
from sklearn.preprocessing import OneHotEncoder

categorical_pipeline = Pipeline([
    ("impute", SimpleImputer(strategy="most_frequent")),
    ("encode", OneHotEncoder(handle_unknown="ignore", sparse_output=False)),
])
```

## Feature Engineering

### Temporal Features

Extract calendar features from datetime columns:

```python
df["hour"] = df["timestamp"].dt.hour
df["day_of_week"] = df["timestamp"].dt.dayofweek
df["is_weekend"] = df["day_of_week"].isin([5, 6]).astype(int)
```

### Interaction Features

```python
df["price_per_unit"] = df["total_price"] / df["quantity"].clip(lower=1)
df["review_ratio"] = df["positive_reviews"] / df["total_reviews"].clip(lower=1)
```

## Airflow DAG

Orchestrate the pipeline as a DAG with daily scheduling:

```python
from airflow import DAG
from airflow.operators.python import PythonOperator

with DAG("ml_pipeline", schedule_interval="@daily", catchup=False) as dag:
    validate   = PythonOperator(task_id="validate_data",    python_callable=validate_data)
    preprocess = PythonOperator(task_id="preprocess",       python_callable=run_preprocessing)
    features   = PythonOperator(task_id="feature_engineer", python_callable=engineer_features)
    train      = PythonOperator(task_id="train_model",      python_callable=train_model)

    validate >> preprocess >> features >> train
```
