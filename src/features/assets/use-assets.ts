"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query/query-keys";
import {
  adjustAssetStock,
  createAssetCatalogItem,
  fetchAssetCatalogForDriverForm,
  fetchAssetDetail,
  fetchAssetsCatalog,
  returnAssetAssignment,
  updateAssetCatalogItem,
} from "./assets-actions";

export function useAssetsCatalog() {
  return useQuery({
    queryKey: queryKeys.assets.list(),
    queryFn: fetchAssetsCatalog,
  });
}

export function useAssetDetail(id: string | null, enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.assets.detail(id ?? ""),
    queryFn: () => fetchAssetDetail(id!),
    enabled: Boolean(id) && enabled,
  });
}

export function useDriverFormAssetCatalog(intakeId: string | null, enabled: boolean) {
  return useQuery({
    queryKey: queryKeys.assets.catalogForDriver(intakeId),
    queryFn: () => fetchAssetCatalogForDriverForm(intakeId),
    enabled,
  });
}

function invalidateAssets(qc: ReturnType<typeof useQueryClient>) {
  void qc.invalidateQueries({ queryKey: queryKeys.assets.all() });
  void qc.invalidateQueries({ queryKey: queryKeys.drivers.all() });
}

export function useCreateAssetCatalogItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: createAssetCatalogItem,
    onSuccess: () => invalidateAssets(qc),
  });
}

export function useUpdateAssetCatalogItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: updateAssetCatalogItem,
    onSuccess: () => invalidateAssets(qc),
  });
}

export function useAdjustAssetStock() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: adjustAssetStock,
    onSuccess: () => invalidateAssets(qc),
  });
}

export function useReturnAssetAssignment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: returnAssetAssignment,
    onSuccess: () => invalidateAssets(qc),
  });
}
