# Security Policy

## Supported Branch

Security fixes are applied to `main`.

## Reporting a Vulnerability

Do not open public issues for secrets, credential exposure, authentication bypass, data leakage, or infrastructure compromise.

Contact the maintainer privately and include:

- A concise description of the issue.
- Steps to reproduce.
- Affected endpoint, worker, or service.
- Whether credentials, recipient data, SMTP secrets, or API keys may be exposed.

## Operational Kill Switch

Sovereign Engine includes a global API/session kill switch:

```text
POST /api/security/kill-switch
```

Set `SECURITY_KILL_SWITCH_TOKEN` and call the endpoint with the configured token during incident response.

## Secret Handling

Never commit real values for:

- `DATABASE_URL`
- `REDIS_URL`
- `SMTP_PASS`
- `SMTP_ACCOUNTS`
- `ZEROBOUNCE_API_KEY`
- `REPUTATION_PUBLIC_API_KEY`
- `SECURITY_KILL_SWITCH_TOKEN`
- Any provider API key or webhook secret

Use environment variables, AWS Secrets Manager, SSM Parameter Store, or the deployment platform secret manager.
