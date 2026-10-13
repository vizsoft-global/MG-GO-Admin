# Cursor rules

| File | Scope |
|------|--------|
| [`KA.mdc`](./KA.mdc) | **Always applied (mandatory)** — reply to the user in Kannada; keep code, paths, commands, identifiers and error messages in English |
| [`project-architecture.mdc`](./project-architecture.mdc) | **Always applied** — admin panel architecture, schema, modules, synergy rules |
| [`ui-system.mdc`](./ui-system.mdc) | **Always applied (mandatory)** — density, semantic color, footer-first modals, navigation patterns. Complete pre-ship checklist before finishing UI work. |

**Related docs (not auto-injected):**
- [`docs/DESIGN_SYSTEM.md`](../docs/DESIGN_SYSTEM.md) — design tokens and layouts
- [`docs/DRIVER_APP_HANDOFF.md`](../docs/DRIVER_APP_HANDOFF.md) — paste into AI when building the driver mobile app

When changing schema, RLS, or driver-facing APIs: update **both** `project-architecture.mdc` (change log) and `DRIVER_APP_HANDOFF.md`.
