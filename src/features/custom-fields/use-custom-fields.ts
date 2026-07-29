"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  archiveCustomFieldDefinition,
  listCustomFieldDefinitions,
  reorderCustomFieldDefinitions,
  setCustomFieldActive,
  upsertCustomFieldDefinition,
} from "./custom-fields-actions";
import type { CustomFieldDefinitionInput } from "@/lib/custom-fields/types";
import { DRIVER_ENTITY_TYPE } from "@/lib/custom-fields/types";
import { queryKeys } from "@/lib/query/query-keys";

export function useCustomFieldDefinitions(opts?: { includeInactive?: boolean }) {
  const includeInactive = opts?.includeInactive ?? false;
  return useQuery({
    queryKey: queryKeys.customFields.list(DRIVER_ENTITY_TYPE, includeInactive),
    queryFn: () => listCustomFieldDefinitions(DRIVER_ENTITY_TYPE, { includeInactive }),
    staleTime: 30_000,
  });
}

export function useUpsertCustomFieldDefinition() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CustomFieldDefinitionInput) => upsertCustomFieldDefinition(input),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.customFields.all() });
    },
  });
}

export function useSetCustomFieldActive() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) =>
      setCustomFieldActive(id, active),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.customFields.all() });
    },
  });
}

export function useArchiveCustomFieldDefinition() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => archiveCustomFieldDefinition(id),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.customFields.all() });
    },
  });
}

export function useReorderCustomFieldDefinitions() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (ids: string[]) => reorderCustomFieldDefinitions(ids),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.customFields.all() });
    },
  });
}
