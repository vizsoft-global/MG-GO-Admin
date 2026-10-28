"use client";

import { useState, type ReactNode } from "react";
import { Trash2 } from "lucide-react";
import { toast } from "sonner";
import { TABLE_HEAD_CLASS } from "@/components/app/constants";
import { EmptyState } from "@/components/app/empty-state";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Link } from "@/i18n/navigation";

const card = "rounded-xl border border-[var(--portal-border)] bg-[var(--portal-canvas)] p-4";
const field =
  "h-9 border-[var(--portal-border)] bg-[var(--portal-canvas)] text-[var(--portal-ink)] placeholder:text-[var(--portal-muted)] focus-visible:border-[var(--portal-btn)] focus-visible:ring-[var(--portal-btn)]/40";

type ProjectKey = "keeta" | "americana";
type SeeKey = "dashboard" | "employees" | "leave" | "onLeave";
type DraftUser = { id: string; name: string; email: string };

const PROJECTS: { key: ProjectKey; label: string }[] = [
  { key: "keeta", label: "Keeta" },
  { key: "americana", label: "Americana" },
];

const SEES: { key: SeeKey; label: string }[] = [
  { key: "dashboard", label: "Dashboard" },
  { key: "employees", label: "Employees and documents" },
  { key: "leave", label: "Leave plan" },
  { key: "onLeave", label: "On leave right now" },
];

const PRIVACY: { label: string; checked: boolean }[] = [
  { label: "View documents", checked: true },
  { label: "Download documents", checked: true },
  { label: "Upload documents", checked: false },
  { label: "Replace documents", checked: false },
  { label: "Delete documents", checked: false },
  { label: "Show phone", checked: false },
  { label: "Show bank details", checked: false },
  { label: "Show salary", checked: false },
  { label: "Show leave reasons", checked: false },
];

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className={card}>
      <h2 className="mb-3 text-sm font-semibold text-[var(--portal-ink)]">{title}</h2>
      {children}
    </section>
  );
}

export function CreatePortalShell() {
  // TODO: mock — local draft only, no Firestore write
  const [clientName, setClientName] = useState("");
  const [contactName, setContactName] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [projects, setProjects] = useState<Record<ProjectKey, boolean>>({ keeta: true, americana: false });
  const [sees, setSees] = useState<Record<SeeKey, boolean>>({
    dashboard: true,
    employees: true,
    leave: true,
    onLeave: true,
  });
  const [users, setUsers] = useState<DraftUser[]>([]);
  const [userName, setUserName] = useState("");
  const [userEmail, setUserEmail] = useState("");

  function addUser() {
    const name = userName.trim();
    const email = userEmail.trim();
    if (!name || !email) return;
    setUsers((prev) => [...prev, { id: crypto.randomUUID(), name, email }]);
    setUserName("");
    setUserEmail("");
  }

  function saveDraft() {
    toast.success("Draft saved");
  }

  function publish() {
    if (!clientName.trim()) {
      toast.error("Client name is required");
      return;
    }
    toast.success("Portal published");
  }

  return (
    <div className="min-h-0 space-y-3 bg-[var(--portal-canvas)] p-3">
      <div>
        <h1 className="type-h1 text-[var(--portal-ink)]">New client portal</h1>
        <p className="text-sm text-[var(--portal-muted)]">Choose what this client can open. Nothing is saved yet.</p>
      </div>

      <Section title="Client details">
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="space-y-1 text-xs text-[var(--portal-muted)]">
            <span className="block">
              Client name <span className="text-[var(--portal-badge-red-fg)]">*</span>
            </span>
            <Input className={field} value={clientName} onChange={(event) => setClientName(event.target.value)} />
          </label>
          <label className="space-y-1 text-xs text-[var(--portal-muted)]">
            <span className="block">Contact name</span>
            <Input className={field} value={contactName} onChange={(event) => setContactName(event.target.value)} />
          </label>
          <label className="space-y-1 text-xs text-[var(--portal-muted)]">
            <span className="block">Contact email</span>
            <Input
              className={field}
              type="email"
              value={contactEmail}
              onChange={(event) => setContactEmail(event.target.value)}
            />
          </label>
        </div>
      </Section>

      <Section title="Projects">
        <div className="flex flex-wrap gap-4">
          {PROJECTS.map((project) => (
            <label key={project.key} className="flex h-9 items-center gap-2 text-sm text-[var(--portal-ink)]">
              <Checkbox
                tone="portal"
                checked={projects[project.key]}
                onCheckedChange={(checked) =>
                  setProjects((prev) => ({ ...prev, [project.key]: checked === true }))
                }
              />
              {project.label}
            </label>
          ))}
        </div>
      </Section>

      <Section title="What the client sees">
        <div className="grid gap-2 sm:grid-cols-2">
          {SEES.map((item) => (
            <label
              key={item.key}
              className="flex h-9 items-center justify-between gap-3 rounded-lg border border-[var(--portal-border)] px-3 text-sm text-[var(--portal-ink)]"
            >
              <span>{item.label}</span>
              <Switch
                tone="portal"
                checked={sees[item.key]}
                onCheckedChange={(checked) => setSees((prev) => ({ ...prev, [item.key]: checked === true }))}
              />
            </label>
          ))}
        </div>
      </Section>

      <Section title="Documents and privacy">
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {PRIVACY.map((row) => (
            <label key={row.label} className="flex h-9 items-center gap-2 text-sm text-[var(--portal-ink)]">
              <Checkbox tone="portal" locked checked={row.checked} />
              {row.label}
            </label>
          ))}
        </div>
      </Section>

      <Section title="Client users">
        <div className="mb-3 flex flex-wrap items-end gap-2">
          <label className="min-w-40 flex-1 space-y-1 text-xs text-[var(--portal-muted)]">
            <span className="block">Name</span>
            <Input className={field} value={userName} onChange={(event) => setUserName(event.target.value)} />
          </label>
          <label className="min-w-48 flex-1 space-y-1 text-xs text-[var(--portal-muted)]">
            <span className="block">Email</span>
            <Input
              className={field}
              type="email"
              value={userEmail}
              onChange={(event) => setUserEmail(event.target.value)}
            />
          </label>
          <Button type="button" variant="portal-secondary" className="h-9 cursor-pointer" onClick={addUser}>
            Add user
          </Button>
        </div>
        {users.length === 0 ? (
          <EmptyState title="No client users yet." />
        ) : (
          <Table className="text-sm">
            <TableHeader>
              <TableRow>
                <TableHead className={TABLE_HEAD_CLASS}>Name</TableHead>
                <TableHead className={TABLE_HEAD_CLASS}>Email</TableHead>
                <TableHead className={TABLE_HEAD_CLASS}>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {users.map((user) => (
                <TableRow key={user.id}>
                  <TableCell className="font-medium text-[var(--portal-ink)]">{user.name}</TableCell>
                  <TableCell>{user.email}</TableCell>
                  <TableCell>
                    <Button
                      type="button"
                      variant="portal-neutral"
                      className="h-9 cursor-pointer text-[var(--portal-badge-red-fg)]"
                      onClick={() => setUsers((prev) => prev.filter((row) => row.id !== user.id))}
                    >
                      <Trash2 className="size-4" />
                      Remove
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Section>

      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button
          variant="portal-neutral"
          className="h-9 cursor-pointer"
          render={<Link href="/client-portal/clients" />}
        >
          Cancel
        </Button>
        <Button type="button" variant="portal-secondary" className="h-9 cursor-pointer" onClick={saveDraft}>
          Save draft
        </Button>
        <Button type="button" variant="portal" className="h-9 cursor-pointer" onClick={publish}>
          Publish
        </Button>
      </div>
    </div>
  );
}
