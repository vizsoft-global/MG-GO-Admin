"use client";

import { useTranslations } from "next-intl";
import { Briefcase, Building, Car, IdCard, MapPinned, Users } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DriverRestaurantPicker } from "../driver-restaurant-picker";
import {
  CLIENT_ID_MAX_LENGTH,
  CLIENT_NAME_MAX_LENGTH,
} from "../driver-client-fields";
import type { PartnerOption, RestaurantOption, ZoneOption, VehicleOption } from "../types";
import { FieldBlock, FieldError, SectionHeading } from "./driver-form-primitives";
import { SearchableSelect } from "./searchable-select";

export function DriverFormAssignmentCard({
  partnerId,
  onPartnerChange,
  zoneId,
  onZoneChange,
  vehicleId,
  onVehicleChange,
  vehicleTypeKey,
  onVehicleTypeChange,
  clientId,
  onClientIdChange,
  clientName,
  onClientNameChange,
  restaurants,
  selectedRestaurantIds,
  onRestaurantsChange,
  partners,
  zones,
  vehicles,
  disabled,
  errors,
  noVehicleLabel,
  placeholderPartner,
  placeholderZone,
  placeholderVehicle,
  placeholderClientId,
  placeholderClientName,
  assignmentHint,
  labels,
}: {
  partnerId: string;
  onPartnerChange: (value: string) => void;
  zoneId: string;
  onZoneChange: (value: string) => void;
  vehicleId: string;
  onVehicleChange: (value: string) => void;
  vehicleTypeKey: string;
  onVehicleTypeChange: (value: string) => void;
  clientId: string;
  onClientIdChange: (value: string) => void;
  clientName: string;
  onClientNameChange: (value: string) => void;
  restaurants: RestaurantOption[];
  selectedRestaurantIds: string[];
  onRestaurantsChange: (ids: string[]) => void;
  partners: PartnerOption[];
  zones: ZoneOption[];
  vehicles: VehicleOption[];
  disabled?: boolean;
  errors: { partnerId?: string; zoneId?: string; restaurants?: string };
  assignmentHint: string;
  noVehicleLabel: string;
  placeholderPartner: string;
  placeholderZone: string;
  placeholderVehicle: string;
  labels: {
    section: string;
    partner: string;
    zone: string;
    vehicle: string;
    vehicleType: string;
    restaurants: string;
    clientId: string;
    clientName: string;
  };
  placeholderClientId: string;
  placeholderClientName: string;
}) {
  const tLive = useTranslations("pages.liveTracking");
  return (
    <section className="flex h-full flex-col space-y-3 rounded-lg border border-border bg-card p-4">
      <SectionHeading icon={Briefcase} accent="primary">
        {labels.section}
      </SectionHeading>
      <div className="grid gap-2.5 sm:grid-cols-2">
        <FieldBlock>
          <Label className="inline-flex items-center gap-1.5">
            <Users className="h-3.5 w-3.5 text-muted-foreground" />
            {labels.partner}
          </Label>
          <SearchableSelect
            value={partnerId}
            onValueChange={onPartnerChange}
            items={partners.map((partner) => ({ value: partner.id, label: partner.name }))}
            placeholder={placeholderPartner}
            disabled={disabled || partners.length === 0}
            invalid={Boolean(errors.partnerId)}
          />
          <FieldError message={errors.partnerId} />
        </FieldBlock>
        <FieldBlock>
          <Label className="inline-flex items-center gap-1.5">
            <MapPinned className="h-3.5 w-3.5 text-muted-foreground" />
            {labels.zone}
          </Label>
          <SearchableSelect
            value={zoneId}
            onValueChange={onZoneChange}
            items={zones.map((zone) => ({
              value: zone.id,
              label: `${zone.name} (${zone.code})`,
            }))}
            placeholder={placeholderZone}
            disabled={disabled || zones.length === 0}
            invalid={Boolean(errors.zoneId)}
          />
          <FieldError message={errors.zoneId} />
        </FieldBlock>
      </div>
      <p className="text-[10px] text-muted-foreground">{assignmentHint}</p>
      <FieldBlock>
        <Label className="inline-flex items-center gap-1.5">
          <Car className="h-3.5 w-3.5 text-muted-foreground" />
          {labels.vehicle}
        </Label>
        <SearchableSelect
          value={vehicleId}
          onValueChange={onVehicleChange}
          items={[
            { value: "__none__", label: noVehicleLabel },
            ...vehicles.map((vehicle) => ({
              value: vehicle.id,
              label: `${vehicle.bike_id}${vehicle.reg_number ? ` · ${vehicle.reg_number}` : ""}`,
            })),
          ]}
          placeholder={placeholderVehicle}
          disabled={disabled}
        />
      </FieldBlock>
      <FieldBlock>
        <Label className="inline-flex items-center gap-1.5">
          <Car className="h-3.5 w-3.5 text-muted-foreground" />
          {labels.vehicleType}
        </Label>
        <Select
          items={[
            { value: "bike", label: tLive("filterVehicleBike") },
            { value: "car", label: tLive("filterVehicleCar") },
          ]}
          value={vehicleTypeKey}
          onValueChange={(value) => {
            if (value) onVehicleTypeChange(value);
          }}
        >
          <SelectTrigger className="h-9" disabled={disabled}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="bike" label={tLive("filterVehicleBike")}>
              {tLive("filterVehicleBike")}
            </SelectItem>
            <SelectItem value="car" label={tLive("filterVehicleCar")}>
              {tLive("filterVehicleCar")}
            </SelectItem>
          </SelectContent>
        </Select>
      </FieldBlock>
      <div className="grid gap-2.5 sm:grid-cols-2">
        <FieldBlock>
          <Label htmlFor="driver-client-id" className="inline-flex items-center gap-1.5">
            <IdCard className="h-3.5 w-3.5 text-muted-foreground" />
            {labels.clientId}
          </Label>
          <Input
            id="driver-client-id"
            value={clientId}
            disabled={disabled}
            maxLength={CLIENT_ID_MAX_LENGTH}
            placeholder={placeholderClientId}
            onChange={(event) => onClientIdChange(event.target.value)}
            className="h-9 rounded-md text-sm"
          />
        </FieldBlock>
        <FieldBlock>
          <Label htmlFor="driver-client-name" className="inline-flex items-center gap-1.5">
            <Building className="h-3.5 w-3.5 text-muted-foreground" />
            {labels.clientName}
          </Label>
          <Input
            id="driver-client-name"
            value={clientName}
            disabled={disabled}
            maxLength={CLIENT_NAME_MAX_LENGTH}
            placeholder={placeholderClientName}
            onChange={(event) => onClientNameChange(event.target.value)}
            className="h-9 rounded-md text-sm"
          />
        </FieldBlock>
      </div>
      <FieldBlock>
        <Label>{labels.restaurants}</Label>
        <DriverRestaurantPicker
          variant="compact"
          restaurants={restaurants}
          selectedIds={selectedRestaurantIds}
          onChange={onRestaurantsChange}
          disabled={disabled}
        />
        <FieldError message={errors.restaurants} />
      </FieldBlock>
    </section>
  );
}

