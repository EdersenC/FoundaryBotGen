# Security Policy

Foundry NPCBOT is an early local-first MVP. Treat the companion as a privileged service because an authorized caller can submit prompts and consume local model resources.

## Safe deployment

- Keep `NPCBOT_HOST=127.0.0.1` unless a network deployment has been intentionally secured.
- Generate a unique, high-entropy `NPCBOT_PAIRING_TOKEN`. Never commit or place it in a URL.
- Treat `companion/.env` as a credential file. It is ignored by Git, but must not be uploaded, shared, or included in screenshots; only `.env.example` is safe to distribute.
- Set `NPCBOT_ALLOWED_ORIGINS` to the exact Foundry origins used by the GM. Do not use wildcard origins.
- Do not expose the companion directly to the public internet. The MVP does not provide TLS, user accounts, rate limiting, or hardened multi-tenant isolation.
- Keep Ollama on loopback unless it has an independent authenticated network boundary.
- Run both Foundry and the companion as unprivileged operating-system users.
- Treat generated content as untrusted text. Review it in the module and do not render model output with unsanitized DOM APIs.

Changing a pairing token requires updating the companion environment and the local Foundry module setting, then restarting the companion.

## Reporting a vulnerability

Do not publish secrets, exploit details, or private campaign material in a public issue. Once this repository has a hosting location, use its private security-advisory channel or contact the maintainer privately. Include the affected version, deployment shape, reproduction steps, and impact without including a live pairing token.

There is no security support guarantee for unreleased source snapshots. Fixes will be prioritized by practical impact to the GM workstation, campaign data, or network boundary.
