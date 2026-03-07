# Security Policy

## Supported Versions

Use this section to tell people about which versions of your project are currently being supported with security updates.

| Version | Supported          |
| ------- | ------------------ |
| 1.1.x   | :white_check_mark: |
| 1.0.x   | :x:                |
| < 1.0   | :x:                |

## Runtime Security Model

MyTube supports two runtime security models via `SECURITY_MODEL`:

- `strict`: Hardened mode intended for non-TCB App Admin operation.
- `legacy`: Compatibility mode for short migration windows only.

Production deployments are fail-closed for this setting:

- `SECURITY_MODEL` must be explicitly set.
- Invalid values cause startup failure.

## Trust Boundaries and Roles

MyTube distinguishes three operator roles:

- **Platform Operator (TCB)**: trusted infrastructure owner who controls host/cluster/container runtime.
- **Security Operator (controlled privileged role)**: can approve/operate security-sensitive platform settings under change control.
- **App Admin (non-TCB)**: application-level administrator for business features only.

Application trust boundary requirements:

- App Admin must not directly access OS command execution surfaces.
- App Admin must not directly access container control surfaces.
- App Admin must not directly access host filesystem control surfaces.

High-risk control planes (restricted in strict model):

- Task hooks execution surface.
- `yt-dlp` custom/free-form configuration surface.
- `mountDirectories` host path control surface.
- In-app `cloudflared` process control surface.

Operational default and migration policy:

- New installations should use `SECURITY_MODEL=strict`.
- Existing upgraded instances may temporarily use `legacy` only during a short migration window with explicit auditability.

Migration references:

- [Security Migration Plan (EN)](documents/en/security-migration-plan.md)
- [Security Breaking Changes Matrix (EN)](documents/en/security-breaking-changes.md)
- [Security Migration Runbook (EN)](documents/en/security-migration-runbook.md)
- [安全迁移计划（中文）](documents/zh/security-migration-plan.md)
- [安全 Breaking 变更矩阵（中文）](documents/zh/security-breaking-changes.md)
- [安全迁移 Runbook（中文）](documents/zh/security-migration-runbook.md)

## Reporting a Vulnerability

We take the security of our software seriously. If you believe you have found a security vulnerability in MyTube, please report it to us as described below.

**Please do not report security vulnerabilities through public GitHub issues.**

Instead, please report them by:

1.  Sending an email to [INSERT EMAIL HERE].
2.  Opening a draft Security Advisory if you are a collaborator.

You should receive a response within 48 hours. If for some reason you do not, please follow up via email to ensure we received your original message.

We prefer all communications to be in English or Chinese.

## Disclosure Policy

1.  We will investigate the issue and verify the vulnerability.
2.  We will work on a patch to fix the vulnerability.
3.  We will release a new version of the software with the fix.
4.  We will publish a Security Advisory to inform users about the vulnerability and the fix.
