# Commercialization Checklist

## Product

- Confirm target ICP, pricing, and sales motion.
- Define trial policy, upgrade path, and support SLA.
- Publish public API docs for `POST /v1/chat/completions`.

## Security

- Set strong `JWT_SECRET`, `PROVIDER_CONFIG_SECRET`, and `APP_KEY_PEPPER`.
- Configure real provider keys in the deployment environment.
- Review tenant roles, AppKey scopes, and audit-log retention.

## Billing

- Verify billing snapshots in `billing_records`.
- Confirm invoice/reconciliation status workflow.
- Reconcile monthly budget limits against contract terms.

## Operations

- Monitor `/ops/overview` and `/ops/audit-logs`.
- Validate provider configuration and health before launch.
- Prepare staging and production rollout / rollback procedures.
