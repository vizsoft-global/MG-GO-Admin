"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { Loader2, Upload } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/contexts/auth-context";
import { AppModalFooter } from "@/components/app/app-modal-footer";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ASSET_ICON_OPTIONS } from "./asset-icons";
import { AssetCatalogIcon } from "./asset-catalog-icon";
import { isAssetErrorKey } from "./asset-errors";
import { useCreateAssetCatalogItem, useUpdateAssetCatalogItem } from "./use-assets";
import type { AssetCatalogRow } from "./types";

function assetErrorToast(
  t: ReturnType<typeof useTranslations<"pages.assets">>,
  error?: string,
) {
  if (error && isAssetErrorKey(error)) return t(`errors.${error}`);
  return t("errors.save_failed");
}

function AssetFormBody({
  asset,
  onClose,
  onSaved,
}: {
  asset: AssetCatalogRow | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const t = useTranslations("pages.assets");
  const { can } = useAuth();
  const canManage = can("assets.manage");
  const isEdit = Boolean(asset);
  const createMutation = useCreateAssetCatalogItem();
  const updateMutation = useUpdateAssetCatalogItem();
  const [isPending, startTransition] = useTransition();
  const fileRef = useRef<HTMLInputElement>(null);

  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [description, setDescription] = useState("");
  const [iconKey, setIconKey] = useState("Package");
  const [totalQuantity, setTotalQuantity] = useState("0");
  const [reorderLevel, setReorderLevel] = useState("0");
  const [isActive, setIsActive] = useState(true);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [removeImage, setRemoveImage] = useState(false);

  useEffect(() => {
    setName(asset?.name ?? "");
    setCode(asset?.code ?? "");
    setDescription(asset?.description ?? "");
    setIconKey(asset?.icon_key ?? "Package");
    setTotalQuantity(String(asset?.total_quantity ?? 0));
    setReorderLevel(String(asset?.reorder_level ?? 0));
    setIsActive(asset?.is_active ?? true);
    setImagePreview(asset?.image_url ?? null);
    setImageFile(null);
    setRemoveImage(false);
  }, [asset]);

  useEffect(() => {
    return () => {
      if (imagePreview?.startsWith("blob:")) {
        URL.revokeObjectURL(imagePreview);
      }
    };
  }, [imagePreview]);

  const handleFileChange = (file: File | null) => {
    if (!file) return;
    setImageFile(file);
    setRemoveImage(false);
    if (imagePreview?.startsWith("blob:")) URL.revokeObjectURL(imagePreview);
    setImagePreview(URL.createObjectURL(file));
  };

  const handleSave = () => {
    if (!canManage) return;
    const total = parseInt(totalQuantity, 10);
    const reorder = parseInt(reorderLevel, 10);
    if (!name.trim() || !Number.isFinite(total) || !Number.isFinite(reorder)) {
      toast.error(t("errors.missing_fields"));
      return;
    }

    startTransition(async () => {
      const formData = new FormData();
      formData.append("name", name.trim());
      formData.append("code", code.trim());
      formData.append("description", description.trim());
      formData.append("iconKey", iconKey);
      formData.append("totalQuantity", String(Math.max(0, total)));
      formData.append("reorderLevel", String(Math.max(0, reorder)));
      formData.append("isActive", isActive ? "true" : "false");
      if (isEdit && asset) formData.append("id", asset.id);
      if (imageFile) formData.append("image", imageFile);
      if (removeImage) formData.append("removeImage", "true");

      const result =
        isEdit && asset
          ? await updateMutation.mutateAsync(formData)
          : await createMutation.mutateAsync(formData);

      if (result.error) {
        toast.error(assetErrorToast(t, result.error));
        return;
      }

      if (result.imageWarning && isAssetErrorKey(result.imageWarning)) {
        toast.warning(t(`errors.${result.imageWarning}`));
      }

      toast.success(isEdit ? t("updated") : t("created"));
      onClose();
      onSaved();
    });
  };

  const title = isEdit ? t("editAssetTitle") : t("addAssetTitle");

  return (
    <>
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 pt-4 pb-3">
        <div className="space-y-1.5">
          <Label htmlFor="asset-name">{t("fieldName")}</Label>
          <Input
            id="asset-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={!canManage || isPending}
            className="rounded-lg bg-background"
          />
          <p className="text-[11px] text-muted-foreground">{t("nameHint")}</p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="asset-code">{t("fieldCode")}</Label>
          <Input
            id="asset-code"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            disabled={!canManage || isPending}
            placeholder="gps"
            className="rounded-lg bg-background"
          />
          <p className="text-[11px] text-muted-foreground">{t("codeHint")}</p>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="asset-description">{t("fieldDescription")}</Label>
          <Textarea
            id="asset-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={2}
            className="resize-none"
            disabled={!canManage || isPending}
          />
        </div>

        <div className="space-y-1.5">
          <Label>{t("fieldIcon")}</Label>
          <Select
            value={iconKey}
            onValueChange={(value) => setIconKey(value ?? "Package")}
            disabled={!canManage || isPending}
          >
            <SelectTrigger className="rounded-lg bg-background">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ASSET_ICON_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-[11px] text-muted-foreground">{t("iconFallbackHint")}</p>
        </div>

        <div className="space-y-2">
          <Label>{t("fieldImage")}</Label>
          <div className="flex items-start gap-4">
            <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-lg border border-border bg-muted/40 p-1.5">
              {imagePreview && !removeImage ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={imagePreview} alt="" className="h-full w-full object-contain" />
              ) : (
                <AssetCatalogIcon iconKey={iconKey} className="h-6 w-6 text-muted-foreground" />
              )}
            </div>
            <div className="flex flex-col gap-2">
              <input
                ref={fileRef}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/svg+xml"
                className="hidden"
                onChange={(e) => handleFileChange(e.target.files?.[0] ?? null)}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="cursor-pointer rounded-lg"
                disabled={!canManage || isPending}
                onClick={() => fileRef.current?.click()}
              >
                <Upload className="me-2 h-3.5 w-3.5" />
                {t("uploadImage")}
              </Button>
              {imagePreview && !removeImage ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="cursor-pointer text-destructive hover:text-destructive"
                  disabled={!canManage || isPending}
                  onClick={() => {
                    if (imagePreview.startsWith("blob:")) URL.revokeObjectURL(imagePreview);
                    setImageFile(null);
                    setImagePreview(null);
                    setRemoveImage(true);
                  }}
                >
                  {t("removeImage")}
                </Button>
              ) : null}
            </div>
          </div>
          <p className="text-[11px] text-muted-foreground">{t("imageHint")}</p>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="asset-total">{t("fieldTotalQuantity")}</Label>
            <Input
              id="asset-total"
              type="number"
              min={0}
              value={totalQuantity}
              onChange={(e) => setTotalQuantity(e.target.value)}
              disabled={!canManage || isPending}
              className="rounded-lg bg-background"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="asset-reorder">{t("fieldReorderLevel")}</Label>
            <Input
              id="asset-reorder"
              type="number"
              min={0}
              value={reorderLevel}
              onChange={(e) => setReorderLevel(e.target.value)}
              disabled={!canManage || isPending}
              className="rounded-lg bg-background"
            />
          </div>
        </div>

        <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2.5">
          <Label htmlFor="asset-active">{t("fieldActive")}</Label>
          <Switch
            id="asset-active"
            checked={isActive}
            onCheckedChange={setIsActive}
            disabled={!canManage || isPending}
          />
        </div>
      </div>

      <AppModalFooter title={title} subtitle={t("nameHint")}>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-9 cursor-pointer rounded-md"
          onClick={onClose}
          disabled={isPending}
        >
          {t("cancel")}
        </Button>
        {canManage ? (
          <Button
            type="button"
            size="sm"
            className="h-9 cursor-pointer rounded-md px-4"
            onClick={handleSave}
            disabled={isPending || !name.trim()}
          >
            {isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : isEdit ? (
              t("saveChanges")
            ) : (
              t("createAsset")
            )}
          </Button>
        ) : null}
      </AppModalFooter>
    </>
  );
}

export function AssetFormSheet({
  asset,
  open,
  onOpenChange,
  onSaved,
}: {
  asset: AssetCatalogRow | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex max-h-[min(90vh,720px)] max-w-lg flex-col gap-0 overflow-visible rounded-xl p-0"
        showCloseButton
        closeOutside
      >
        {open ? (
          <AssetFormBody
            key={asset?.id ?? "new"}
            asset={asset}
            onClose={() => onOpenChange(false)}
            onSaved={onSaved}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
