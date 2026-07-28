# Adding a new page

> Architecture: [`.cursor/rules/project-architecture.mdc`](../.cursor/rules/project-architecture.mdc)  
> Mobile app handoff: [`docs/DRIVER_APP_HANDOFF.md`](./DRIVER_APP_HANDOFF.md) — update when schema/RLS affects drivers.

## Design system (read first)

Before building UI, review:

- [`docs/DESIGN_SYSTEM.md`](./DESIGN_SYSTEM.md) — tokens, page recipes, forbidden patterns
- [`.cursor/rules/ui-system.mdc`](../.cursor/rules/ui-system.mdc) — agent rules (always applied)
- [`src/components/app/`](../src/components/app/) — `AppPage`, `AppListCard`, `AppSettingsLayout`, etc.

## Quick start

```bash
npm run new:page -- <slug> [permission]
```

Example:

```bash
npm run new:page -- drivers users.view
```

## Checklist

- [ ] Run the scaffold command (or mirror its output manually)
- [ ] Add a `NAV_ITEMS` entry in `src/config/navigation.ts`
- [ ] Add permission to `PERMISSIONS` and `ROLE_PERMISSIONS` in `src/lib/auth/permissions.ts`
- [ ] Add matching keys in `src/messages/en.json` and `src/messages/ar.json`
- [ ] **Index page:** `AppPage` → `AppPageHeader` → optional `KpiGrid` → `AppListCard` + `AppDataTable`
- [ ] **Detail page:** `AppPage` → back link → summary `Card` → `TabBar` → panels
- [ ] **Form page:** `AppPage` (narrow) → `AppFormSection` stack → footer actions
- [ ] **Settings:** content inside `AppSettingsLayout` (via settings layout)
- [ ] Table headers: `TABLE_HEAD_CLASS` from `@/components/app/constants`
- [ ] Wrap sensitive actions in `<PermissionGuard permission="...">`
- [ ] Use semantic tokens only — no raw hex in feature code
- [ ] Test `/en/<slug>` and `/ar/<slug>` (RTL)

## Route structure

All dashboard pages live under:

`src/app/[locale]/(dashboard)/<slug>/page.tsx`

Client data shells go in `src/features/<domain>/`.
