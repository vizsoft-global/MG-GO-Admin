"use client";

import { useMemo } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SearchSelect } from "@/components/ui/search-select";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { partnerSearchOptions, zoneSearchOptions } from "@/lib/search-options";
import { RestaurantCoordinateInputs } from "./restaurant-coordinate-inputs";
import type { RestaurantLocation } from "./restaurant-location-utils";
import { RESTAURANT_STATUSES, type RestaurantStatus } from "./restaurant-status";
import type { RestaurantPartnerOption, RestaurantZoneOption } from "./types";

type FieldLabels = {
  partner: string;
  zone: string;
  name: string;
  externalMerchantId: string;
  externalMerchantIdHint: string;
  mapLink: string;
  mapLinkHint: string;
  mapAutoFilledHint?: string;
  status: string;
  statusHint: string;
  selectPartner: string;
  selectZone: string;
  selectNone: string;
  namePlaceholder: string;
  mapLinkPlaceholder: string;
  statusDraft: string;
  statusPublished: string;
  statusArchived: string;
  coordinatesSection: string;
  coordinatesLatitude: string;
  coordinatesLongitude: string;
  coordinatesHint: string;
  coordinatesInvalidLatitude: string;
  coordinatesInvalidLongitude: string;
};

function statusLabel(t: FieldLabels, status: RestaurantStatus) {
  switch (status) {
    case "published":
      return t.statusPublished;
    case "archived":
      return t.statusArchived;
    default:
      return t.statusDraft;
  }
}

export function RestaurantFormFields({
  labels,
  partnerId,
  zoneId,
  name,
  externalMerchantId,
  mapLink,
  status,
  location,
  partners,
  zones,
  partnersLoading,
  zonesLoading,
  onPartnerIdChange,
  onZoneIdChange,
  onNameChange,
  onExternalMerchantIdChange,
  onMapLinkChange,
  onStatusChange,
  onLocationChange,
}: {
  labels: FieldLabels;
  partnerId: string;
  zoneId: string;
  name: string;
  externalMerchantId: string;
  mapLink: string;
  status: RestaurantStatus;
  location: RestaurantLocation | null;
  partners: RestaurantPartnerOption[];
  zones: RestaurantZoneOption[];
  partnersLoading: boolean;
  zonesLoading: boolean;
  onPartnerIdChange: (id: string) => void;
  onZoneIdChange: (id: string) => void;
  onNameChange: (value: string) => void;
  onExternalMerchantIdChange: (value: string) => void;
  onMapLinkChange: (value: string) => void;
  onStatusChange: (value: RestaurantStatus) => void;
  onLocationChange: (next: RestaurantLocation | null) => void;
}) {
  const partnerSelectItems = useMemo(
    () => [
      { value: "", label: labels.selectNone, keywords: [labels.selectNone] },
      ...partnerSearchOptions(partners),
    ],
    [labels.selectNone, partners],
  );
  const zoneSelectItems = useMemo(
    () => [
      { value: "", label: labels.selectNone, keywords: [labels.selectNone] },
      ...zoneSearchOptions(zones),
    ],
    [labels.selectNone, zones],
  );
  const statusSelectItems = RESTAURANT_STATUSES.map((s) => ({
    value: s,
    label: statusLabel(labels, s),
  }));

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <Label>{labels.partner}</Label>
        <SearchSelect
          items={partnerSelectItems}
          value={partnerId || null}
          onChange={(v) => onPartnerIdChange(v ?? "")}
          placeholder={labels.selectPartner}
          searchPlaceholder={labels.selectPartner}
          defaultLimit={8}
          recentsKey="restaurant-form-partner"
          disabled={partnersLoading}
          clearable={false}
        />
      </div>

      <div className="space-y-1.5">
        <Label>{labels.zone}</Label>
        <SearchSelect
          items={zoneSelectItems}
          value={zoneId || null}
          onChange={(v) => onZoneIdChange(v ?? "")}
          placeholder={labels.selectZone}
          searchPlaceholder={labels.selectZone}
          defaultLimit={8}
          recentsKey="restaurant-form-zone"
          disabled={zonesLoading}
          clearable={false}
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="restaurant-name">{labels.name}</Label>
        <Input
          id="restaurant-name"
          value={name}
          onChange={(e) => onNameChange(e.target.value)}
          placeholder={labels.namePlaceholder}
          className="rounded-lg bg-background"
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="external-id">{labels.externalMerchantId}</Label>
        <Input
          id="external-id"
          value={externalMerchantId}
          onChange={(e) => onExternalMerchantIdChange(e.target.value)}
          className="rounded-lg bg-background font-mono text-sm"
        />
        <p className="text-[11px] text-muted-foreground">
          {labels.externalMerchantIdHint}
        </p>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="map-link">{labels.mapLink}</Label>
        <Input
          id="map-link"
          value={mapLink}
          onChange={(e) => onMapLinkChange(e.target.value)}
          placeholder={labels.mapLinkPlaceholder}
          className="rounded-lg bg-background text-sm"
        />
        <p className="text-[11px] text-muted-foreground">{labels.mapLinkHint}</p>
        {labels.mapAutoFilledHint ? (
          <p className="text-[11px] text-muted-foreground/80">
            {labels.mapAutoFilledHint}
          </p>
        ) : null}
      </div>

      <RestaurantCoordinateInputs
        location={location}
        onLocationChange={onLocationChange}
        labels={{
          section: labels.coordinatesSection,
          latitude: labels.coordinatesLatitude,
          longitude: labels.coordinatesLongitude,
          hint: labels.coordinatesHint,
          invalidLatitude: labels.coordinatesInvalidLatitude,
          invalidLongitude: labels.coordinatesInvalidLongitude,
        }}
      />

      <div className="space-y-1.5">
        <Label>{labels.status}</Label>
        <Select
          items={statusSelectItems}
          value={status}
          onValueChange={(v) =>
            onStatusChange((v as RestaurantStatus) ?? "draft")
          }
        >
          <SelectTrigger className="h-9 w-full cursor-pointer rounded-lg bg-background">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {RESTAURANT_STATUSES.map((s) => (
              <SelectItem
                key={s}
                value={s}
                label={statusLabel(labels, s)}
              >
                {statusLabel(labels, s)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-[11px] text-muted-foreground">{labels.statusHint}</p>
      </div>
    </div>
  );
}
