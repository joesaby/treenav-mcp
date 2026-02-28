---
title: "Configuration Reference"
description: "All configuration options, environment variables, secret management, and advanced settings"
type: reference
category: getting-started
tags: [configuration, environment-variables, secrets, settings, reference]
---

# Configuration Reference

All configuration is provided through environment variables. The application reads
its settings at startup; changes require a restart.

## Environment Variables

| Variable | Required | Default | Description |
|---|---|---|---|
| `API_KEY` | Yes | — | Your API authentication key |
| `BASE_URL` | No | `https://api.example.com/v1` | API base URL |
| `LOG_LEVEL` | No | `info` | Logging level: `debug`, `info`, `warn`, `error` |
| `TIMEOUT_MS` | No | `5000` | Request timeout in milliseconds |
| `MAX_RETRIES` | No | `3` | Maximum retry attempts on transient errors |
| `DEBUG` | No | `false` | Enable verbose debug output |

Set `DEBUG=true` and `LOG_LEVEL=debug` together for full request/response logging.

## Secret Management

Never commit secrets to source control. Preferred approaches:

**Kubernetes Secrets:**
```yaml
apiVersion: v1
kind: Secret
metadata:
  name: api-credentials
type: Opaque
stringData:
  API_KEY: "your_api_key_here"
```

**HashiCorp Vault:**
```bash
vault kv put secret/api API_KEY=your_key_here
# Retrieve at runtime via Vault Agent or direct API call
```

**Local development:** Use a `.env` file (add to `.gitignore`) and load it with
`dotenv` or equivalent.

## Advanced Settings

These settings are for tuning performance in high-load environments:

| Variable | Default | Description |
|---|---|---|
| `CONNECTION_POOL_SIZE` | `10` | HTTP connection pool size |
| `KEEP_ALIVE_MS` | `60000` | Keep-alive timeout for persistent connections |
| `TLS_VERIFY` | `true` | Set to `false` only in local dev with self-signed certs |
| `COMPRESS_RESPONSES` | `true` | Enable gzip compression for responses > 1 KB |
