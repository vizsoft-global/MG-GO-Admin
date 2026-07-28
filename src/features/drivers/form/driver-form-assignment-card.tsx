"use client";

import { Briefcase, Car, MapPinned, Users } from "lucide-react";
import { Label } from "@/components/ui/label";
import { DriverRestaurantPicker } from "../driver-restaurant-picker";
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
  labels,
}: {
  partnerId: string;
  onPartnerChange: (value: string) => void;
  zoneId: string;
  onZoneChange: (value: string) => void;
  vehicleId: string;
  onVehicleChange: (value: string) => void;
  restaurants: RestaurantOption[];
  selectedRestaurantIds: string[];
  onRestaurantsChange: (ids: string[]) => void;
  partners: PartnerOption[];
  zones: ZoneOption[];
  vehicles: VehicleOption[];
  disabled?: boolean;
  errors: { partnerId?: string; zoneId?: string };
  noVehicleLabel: string;
  placeholderPartner: string;
  placeholderZone: string;
  placeholderVehicle: string;
  labels: {
    section: string;
    partner: string;
    zone: string;
    vehicle: string;
    restaurants: string;
  };
}) {
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
        <Label>{labels.restaurants}</Label>
        <DriverRestaurantPicker
          variant="compact"
          restaurants={restaurants}
          selectedIds={selectedRestaurantIds}
          onChange={onRestaurantsChange}
          disabled={disabled}
        />
      </FieldBlock>
    </section>
  );
}

