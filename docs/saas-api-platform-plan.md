# SaaS API Platform Plan

This document defines how to turn Rapids into a reusable API service layer for multiple SaaS projects.

## Objective

Provide one shared API platform that handles auth, tenant isolation, key management, usage tracking, and operational concerns, while allowing each SaaS product to plug in its own business logic and data.

## What the platform should own

- Authentication and authorization.
- Tenant and project identity.
- API key lifecycle.
- Usage metering and quota enforcement.
- Request logging and audit trails.
- Shared primitives such as pagination, validation, and error formats.
- Environment management for `dev`, `staging`, and `prod`.

## What each SaaS project should own

- Product-specific business endpoints.
- Product-specific database tables and domain models.
- Product-specific workflows, webhooks, and background jobs.
- Product-specific billing rules if they differ from the shared defaults.

## Target architecture

### 1. Control plane

Create an internal control plane that manages:

- Tenants.
- SaaS projects.
- Environments.
- API keys.
- Scopes and permissions.
- Quotas and rate limits.
- Webhook destinations.
- Usage records.

This becomes the single source of truth for who can call what.

### 2. Data plane

Each API request should resolve into a request context:

- tenant ID
- project ID
- environment
- caller identity
- scopes
- quota state

All downstream handlers should use that context instead of parsing headers directly.

### 3. Shared platform API

Expose stable platform endpoints for:

- creating and revoking keys
- listing tenants and projects
- inspecting usage
- rotating credentials
- checking service health

### 4. Product APIs

Keep product endpoints separate from the control plane routes.
Examples:

- `/v1/billing/...`
- `/v1/catalog/...`
- `/v1/notifications/...`
- `/v1/your-domain/...`

Each product route should still use the same shared auth and request-context middleware.

## Platform rules

### Authentication

- Support `Authorization: Bearer <token>` and `Authorization: ApiKey <token>`.
- Bind every token to a tenant and project.
- Reject requests that do not map cleanly to a tenant/project context.

### Authorization

- Use scopes for coarse permissions.
- Use tenant/project boundaries for hard isolation.
- Do not rely on route-level checks alone for protection.

### Rate limits and quotas

- Enforce limits per key, per project, and per tenant.
- Track both burst behavior and monthly usage.
- Return deterministic errors when a quota is exceeded.

### Versioning

- Use URL versioning for public APIs, such as `/v1`.
- Keep platform and product contracts independently versioned when needed.

### Errors

- Return a consistent JSON error shape.
- Include a stable error code.
- Avoid leaking internal implementation details.

### Idempotency

- Require idempotency keys for write operations that create external side effects.
- Store idempotency results for safe retries.

## Current repo fit

Rapids already provides a useful base:

- API key creation and validation.
- Admin auth for protected operations.
- App and shared-secret records.
- Request logging and health checks.
- SQLite-backed persistence.

The next step is to extend that foundation into a tenant-aware control plane instead of treating all keys as global.

## Recommended implementation phases

### Phase 1: Platform foundation

Deliverables:

- Tenant and project tables.
- API key records that include tenant and project ownership.
- Shared request-context middleware.
- Consistent auth failure responses.
- Request audit logging.

Success criteria:

- Every request is attributable to one tenant and one project.
- No endpoint can operate without a resolved context, except health checks.

### Phase 2: Usage and limits

Deliverables:

- Per-key request counters.
- Per-tenant quotas.
- Rate-limit enforcement.
- Usage summary endpoint.

Success criteria:

- The platform can block abusive or over-quota clients without manual intervention.

### Phase 3: Developer experience

Deliverables:

- OpenAPI spec.
- Curl examples.
- SDK generation path.
- Onboarding flow for new projects.
- Key rotation and revocation workflow.

Success criteria:

- A new SaaS project can be onboarded without touching core platform code.

### Phase 4: Production operations

Deliverables:

- Structured logs.
- Trace or request IDs.
- Alerting for auth failures and quota saturation.
- Backups and restore procedure.
- Deployment configuration per environment.

Success criteria:

- The service can be operated safely across multiple SaaS projects.

### Phase 5: Monetization and billing

Deliverables:

- Usage-to-billing mapping.
- Plan tiers.
- Overage handling.
- Invoice export or webhook events.

Success criteria:

- Usage data can drive commercial billing without rewriting the API layer.

## Data model additions

Add these core entities:

- `tenants`
- `projects`
- `environments`
- `api_keys`
- `key_scopes`
- `usage_events`
- `quota_policies`
- `audit_events`

## API surface to standardize

These should be consistent across all SaaS projects:

- Authentication headers.
- Pagination parameters.
- Filtering conventions.
- Error response schema.
- Success envelope format.
- Rate-limit headers.

## Rollout strategy

1. Keep the existing API-key service working.
2. Introduce tenant-aware records behind the same auth layer.
3. Move one SaaS project onto the new context model.
4. Add quotas and usage tracking after the request flow is stable.
5. Publish SDKs and OpenAPI only after the contract settles.

## First concrete build tasks

- Add `tenant_id` and `project_id` to key records.
- Add middleware that resolves request context from the token.
- Add usage logging for every authenticated request.
- Add a `GET /v1/me` or `GET /v1/context` endpoint for debugging caller identity.
- Add quota checks before route handlers execute.
- Add a migration path for existing global keys.

## Success definition

The platform is ready when:

- multiple SaaS projects can share the same auth and metering layer
- each request is isolated by tenant and project
- key rotation and revocation are safe and fast
- usage is measurable and billable
- adding a new SaaS project does not require copying the platform logic

