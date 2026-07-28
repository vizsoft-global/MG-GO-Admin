# DPD Admin — Component Recipes

> Tailwind + shadcn patterns. Use theme tokens only — no raw hex in components.  
> See [`TOKENS.md`](./TOKENS.md) and [`../references/`](../references/).

---

## AppShell

Cream outer background with white inset panel.

```tsx
<div className="min-h-svh bg-background p-3">
  <div className="flex min-h-[calc(100svh-1.5rem)] overflow-hidden rounded-2xl border border-border bg-card shadow-[0_4px_24px_rgba(15,15,15,0.06)]">
    {/* Sidebar + SidebarInset */}
  </div>
</div>
```

---

## Sidebar

- White background (`bg-sidebar`)
- Logo: 32px coral-tint square + brand name
- Nav item: `h-10 rounded-lg px-3 gap-3`
- Active: `bg-sidebar-accent text-sidebar-accent-foreground font-medium`
- Inactive: `text-muted-foreground hover:bg-muted/60`

```tsx
<div className="flex h-8 w-8 items-center justify-center rounded-lg bg-sidebar-accent text-sidebar-accent-foreground">
  <Package className="h-4 w-4" />
</div>
```

---

## AppHeader

```
┌─────────────────────────────────────────────────────────┐
│ [≡]  Page Title          [Import] [Export▾] [+ Add …]  │
│      Subtitle text                    🌐 🌙 👤          │
└─────────────────────────────────────────────────────────┘
```

```tsx
<header className="flex h-16 shrink-0 items-center gap-4 border-b border-border px-6">
  <SidebarTrigger />
  <div className="flex flex-1 flex-col gap-0.5">
    <h1 className="text-xl font-semibold">{title}</h1>
    {subtitle && <p className="text-sm text-muted-foreground">{subtitle}</p>}
  </div>
  <div className="flex items-center gap-2">{actions}</div>
</header>
```

**Buttons:**
- Primary: `<Button>` default variant (dark fill)
- Ghost: `<Button variant="outline">` for Import/Export
- Accent text links: `text-accent font-medium`

---

## KPI strip

```tsx
<div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
  <KpiCard label="Total Drivers" value="248" />
</div>
```

```tsx
// KpiCard
<div className="rounded-xl border border-border bg-card p-4 shadow-sm">
  <p className="text-xs font-medium text-muted-foreground">{label}</p>
  <p className="mt-1 text-2xl font-semibold tabular-nums text-foreground">{value}</p>
</div>
```

---

## Tabs (filter row)

```tsx
<div className="flex gap-6 border-b border-border">
  <button className="border-b-2 border-accent pb-2 text-sm font-semibold text-accent">
    All Drivers
  </button>
  <button className="pb-2 text-sm text-muted-foreground hover:text-foreground">
    Pending Verification
  </button>
</div>
```

Use shadcn `<Tabs>` with custom active class: `data-[state=active]:border-accent data-[state=active]:text-accent`.

---

## DataTable

- Wrapper: `rounded-xl border border-border overflow-hidden`
- Header row: `bg-muted/30 text-xs font-semibold uppercase tracking-wider text-muted-foreground`
- Body row: `border-t border-border hover:bg-muted/40 transition-colors`
- Action column: `text-muted-foreground` with `MoreHorizontal` icon

```tsx
<TableHead className="text-muted-foreground">Driver ID</TableHead>
```

---

## StatusPill

| Variant | Classes |
|---------|---------|
| success | `bg-[var(--success-bg)] text-[var(--success)]` |
| warning | `bg-[var(--warning-bg)] text-[var(--warning)]` |
| danger | `bg-[var(--danger-bg)] text-[var(--danger)]` |
| neutral | `bg-muted text-muted-foreground` |

```tsx
<span className="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold">
  Active
</span>
```

---

## Buttons

| Type | Variant |
|------|---------|
| Primary CTA | `default` (dark) |
| Secondary | `outline` |
| Ghost | `ghost` |
| Destructive | `destructive` |
| Link / accent | `link` with `text-accent` |

All buttons: `cursor-pointer transition-colors duration-200`.

---

## Modal (Create Offer pattern)

```tsx
<DialogContent className="max-w-2xl rounded-2xl p-6">
  <DialogHeader>
    <DialogTitle className="text-xl font-semibold">Create Offer</DialogTitle>
  </DialogHeader>
  <div className="grid grid-cols-3 gap-4">{/* fields */}</div>
  <DialogFooter className="gap-2 sm:justify-end">
    <Button variant="outline">Cancel</Button>
    <Button>Create Offer</Button>
  </DialogFooter>
</DialogContent>
```

---

## SearchInput

```tsx
<div className="relative">
  <Search className="absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
  <Input className="ps-9" placeholder="Search..." />
</div>
```

---

## Pagination

- Previous/Next: outline buttons
- Current page: `bg-primary text-primary-foreground`
- Others: ghost

---

## Right rail (detail pages)

```tsx
<div className="w-80 shrink-0 space-y-4 border-s border-border ps-6">
  <Card>{/* Earnings trend chart */}</Card>
  <Card>{/* Quick stats list */}</Card>
</div>
```

---

## PageHeader (app pattern)

Use `PageHeaderProvider` + `<PageHeader>` on each page. Title renders in `AppHeader`; page body only has KPI/tabs/content below.

```tsx
<PageHeader
  title={t("title")}
  subtitle={t("subtitle")}
  actions={<Button>+ Add Driver</Button>}
  tabs={<FilterTabs />}
/>
```
