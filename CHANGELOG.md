# Changelog

## v0.0.4

- Scope Steam account-name uniqueness to each owner, with a separate shared-local
  namespace. Migrate the old global index without changing existing account/chat data.
- Remove Steam account identities and Guard email domains from lifecycle logs.
- Add cross-owner password/QR, legacy migration and console privacy regressions.

## v0.0.3

- Generalize documentation examples and test-tool configuration for publication.
- Resolve test dependencies through their owning packages for clean pnpm installs.

## v0.0.2

- Require native HTTPS with an explicit domain/origin and certificate/private key.
  No HTTP listener or downgrade fallback is provided; Compose publishes only port 443.
- Require matching HTTPS authentication origins, Secure cookies and HSTS responses.
  Protect certificate files from Git, build contexts and development file serving.
- Require Steam WebSocket transport over TLS, filtering discovered servers to WSS
  on port 443. Raw TCP is no longer selected for account login or token reuse.
- Preserve Steam credential encryption, account ownership checks, escaped UI text,
  bounded QR sessions and acknowledged chat sends from the hardening work.
- Add HTTPS runtime and transport regression checks, and update Debian 13 setup.

## v0.0.1

- Original upstream release.
