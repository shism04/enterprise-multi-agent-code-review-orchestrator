---
name: security-analysis
description: Security-focused review using OWASP Top 10 and secure-coding checks. Use for every file in a code review, regardless of language.
---

# Security Analysis

Apply to EVERY file. Report a vulnerability only if you can show the vulnerable line and a realistic way it is reached.

## OWASP Top 10 quick map
1. **Broken access control**: endpoints or functions that act on a resource id from the request without checking ownership/role; client-side-only checks; "admin" decided by a request field.
2. **Cryptographic failures**: MD5/SHA1 for passwords, `Math.random()` for tokens, hardcoded keys/IVs, plain-text secrets or PII in logs, HTTP instead of HTTPS.
3. **Injection**: SQL built with string concatenation or template literals; `eval`, `new Function`, `child_process.exec` with user input; NoSQL operators from raw bodies; path traversal (`../`) in file paths; SSRF (fetching user-supplied URLs).
4. **Insecure design**: no rate limiting on login/reset/payment flows; trusting client-calculated prices, discounts or roles; premium/paid features gated only in the UI.
5. **Security misconfiguration**: CORS `*` with credentials, debug mode on, verbose stack traces returned to clients, default credentials.
6. **Vulnerable components**: new dependencies that are unpinned, abandoned or typosquatted (flag only if visible in the diff).
7. **Auth failures**: passwords compared with `==`, tokens without expiry, session ids in URLs, missing lockout.
8. **Integrity failures**: unsafe deserialization (`pickle`, `yaml.load`, `JSON.parse` result used as trusted object), unsigned updates.
9. **Logging failures**: secrets/tokens/card numbers logged; no audit trail for sensitive actions.
10. **SSRF / open redirect**: redirect targets taken from query params without an allowlist.

## Front-end specifics
- XSS: `innerHTML`, `dangerouslySetInnerHTML`, `document.write`, unescaped template output. Prefer `textContent` or a sanitizer.
- Tokens in `localStorage`; missing `rel="noopener"` on `target="_blank"`.

## Secrets
- Strings that look like API keys, tokens, private keys, connection strings. Severity is CRITICAL even if "just for testing".

## Input handling
- Validate type, length, range and format at the boundary (schema validation). Never trust `req.body`, `req.query`, headers, cookies, file names, or webhook payloads.

## Severity guidance
- critical: injection, auth bypass, leaked secret, trusting client for payment/entitlement.
- high: XSS, weak crypto on sensitive data, missing authorization on a write.
- medium: missing rate limiting, verbose errors, unsafe defaults.
- low: missing security headers, minor hygiene.

## Output
For each finding: line, vulnerability class (e.g. "A03 Injection"), exploit scenario in one sentence, fix with code example, severity.
