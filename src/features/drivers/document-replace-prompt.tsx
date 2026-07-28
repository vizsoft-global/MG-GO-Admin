"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { DocumentExpiryConfig } from "./types";

export function ReplaceExpiryPrompt({
  open,
  currentExpiry,
  onCancel,
  onKeepDate,
  onUpdateDate,
  labels,
}: {
  open: boolean;
  currentExpiry: DocumentExpiryConfig;
  onCancel: () => void;
  onKeepDate: () => void;
  onUpdateDate: (expiresAt: string) => void;
  labels: {
    title: string;
    keepDate: string;
    updateDate: string;
    cancel: string;
    expiresOn: string;
    confirm: string;
  };
}) {
  if (!open) return null;

  return (
    <div className="mt-1.5 space-y-2 rounded-md border border-amber-200 bg-amber-50/80 p-2">
      <p className="text-[11px] font-medium text-amber-900">{labels.title}</p>
      <div className="flex flex-wrap gap-1">
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-7 cursor-pointer rounded-md px-2 text-[11px]"
          onClick={onKeepDate}
        >
          {labels.keepDate}
        </Button>
        <ReplaceDateForm
          defaultDate={currentExpiry.expiresAt ?? ""}
          labels={{ expiresOn: labels.expiresOn, confirm: labels.updateDate }}
          onConfirm={onUpdateDate}
        />
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 cursor-pointer rounded-md px-2 text-[11px]"
          onClick={onCancel}
        >
          {labels.cancel}
        </Button>
      </div>
    </div>
  );
}

function ReplaceDateForm({
  defaultDate,
  labels,
  onConfirm,
}: {
  defaultDate: string;
  labels: { expiresOn: string; confirm: string };
  onConfirm: (expiresAt: string) => void;
}) {
  return (
    <form
      className="flex flex-wrap items-center gap-1"
      onSubmit={(event) => {
        event.preventDefault();
        const form = event.currentTarget;
        const input = form.elements.namedItem("expiresAt") as HTMLInputElement;
        if (input.value) onConfirm(input.value);
      }}
    >
      <Input
        name="expiresAt"
        type="date"
        className="h-7 w-[9.5rem] text-[11px]"
        defaultValue={defaultDate}
        required
        aria-label={labels.expiresOn}
      />
      <Button
        type="submit"
        size="sm"
        className="h-7 cursor-pointer rounded-md px-2 text-[11px]"
      >
        {labels.confirm}
      </Button>
    </form>
  );
}
