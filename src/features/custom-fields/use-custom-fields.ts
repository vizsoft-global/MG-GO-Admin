"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  archiveCustomFieldDefinition,
  listCustomFieldDefinitions,
  reorderCustomFieldDefinitions,
  saveEntityCustomFields,
  setCustomFieldActive,
  upsertCustomFieldDefinition,
} from "./custom-fields-actions";
import type {
  CustomFieldDefinitionInput,
  CustomFieldValues,
} from "@/lib/custom-fields/types";
import { DRIVER_ENTITY_TYPE } from "@/lib/custom-fields/types";
import { queryKeys } from "@/lib/query/query-keys";

/**
 * Definitions for one entity.
 *
 * Defaulting to `driver` keeps every existing call site working unchanged, while
 * a list page for any other registered entity passes its own key — one hook, one
 * cache entry per entity, so a Restaurants column can never be rendered from a
 * Vehicles definition.
 */
export function useCustomFieldDefinitions(
  entityType: string = DRIVER_ENTITY_TYPE,
  opts?: { includeInactive?: boolean },
) {
  const includeInactive = opts?.includeInactive ?? false;
  return useQuery({
    queryKey: queryKeys.customFields.list(entityType, includeInactive),
    queryFn: () => listCustomFieldDefinitions(entityType, { includeInactive }),
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
    mutationFn: ({ id, active, entityType }: { id: string; active: boolean; entityType?: string }) =>
      setCustomFieldActive(id, active, entityType),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.customFields.all() });
    },
  });
}

export function useArchiveCustomFieldDefinition() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, entityType }: { id: string; entityType?: string }) =>
      archiveCustomFieldDefinition(id, entityType),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.customFields.all() });
    },
  });
}

export function useReorderCustomFieldDefinitions() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ ids, entityType }: { ids: string[]; entityType?: string }) =>
      reorderCustomFieldDefinitions(ids, entityType),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.customFields.all() });
    },
  });
}

export function useSaveEntityCustomFields(entityType: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ entityId, values }: { entityId: string; values: CustomFieldValues }) =>
      saveEntityCustomFields(entityType, entityId, values),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: queryKeys.customFields.all() });
    },
  });
}
