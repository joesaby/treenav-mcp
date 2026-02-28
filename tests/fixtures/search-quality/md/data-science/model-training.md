---
title: "Model Training Guide"
description: "Training, evaluating, and checkpointing ML models using PyTorch and experiment tracking with MLflow."
tags: [machine-learning, training, pytorch, loss, epoch, checkpoint, mlflow, evaluation]
type: guide
category: data-science
---

# Model Training Guide

This guide covers the standard training loop, evaluation, and experiment tracking
for supervised ML models.

## Training Loop

### Basic Training Loop

```python
for epoch in range(num_epochs):
    model.train()
    for batch_idx, (data, target) in enumerate(train_loader):
        optimizer.zero_grad()
        output = model(data)
        loss = criterion(output, target)
        loss.backward()
        optimizer.step()

    val_loss, val_accuracy = evaluate(model, val_loader)
    print(f"Epoch {epoch}: val_loss={val_loss:.4f} val_acc={val_accuracy:.4f}")
```

### Loss Functions

| Task | Loss Function | When to Use |
|---|---|---|
| Binary classification | BCEWithLogitsLoss | Sigmoid output layer |
| Multi-class classification | CrossEntropyLoss | Softmax output |
| Regression | MSELoss / HuberLoss | Continuous targets |

## Model Evaluation

### Metrics

Standard classification metrics:

- **Accuracy** — fraction of correct predictions
- **Precision** — TP / (TP + FP) — how many predicted positives are correct
- **Recall** — TP / (TP + FN) — how many actual positives are caught
- **F1 Score** — harmonic mean of precision and recall
- **AUC-ROC** — area under the receiver operating characteristic curve

### Confusion Matrix

```python
from sklearn.metrics import classification_report
y_pred = model_predict(test_loader)
print(classification_report(y_test, y_pred))
```

## Checkpointing

Save model state after each epoch to resume training after interruption:

```python
torch.save({
    "epoch": epoch,
    "model_state_dict": model.state_dict(),
    "optimizer_state_dict": optimizer.state_dict(),
    "val_loss": val_loss,
}, f"checkpoints/model_epoch_{epoch}.pt")
```

To resume:
```python
checkpoint = torch.load("checkpoints/model_epoch_10.pt")
model.load_state_dict(checkpoint["model_state_dict"])
optimizer.load_state_dict(checkpoint["optimizer_state_dict"])
```

## Experiment Tracking with MLflow

```python
import mlflow

with mlflow.start_run():
    mlflow.log_param("lr", learning_rate)
    mlflow.log_param("batch_size", batch_size)
    mlflow.log_metric("val_loss", val_loss, step=epoch)
    mlflow.log_metric("val_accuracy", val_accuracy, step=epoch)
    mlflow.pytorch.log_model(model, "model")
```
