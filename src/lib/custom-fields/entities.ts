/**
 * The entities an operator may add columns to.
 *
 * Every entry is a **master-data** record with an edit form: a column the admin
 * defines here needs a place to be written, and a transactional row (a delivery,
 * an attendance log) has none. Transactional tables keep the Columns picker they
 * already have, over the fields the schema actually carries.
 *
 * Adding an entity is one entry here plus three lines on its list page — that is
 * the whole point of the registry: the definitions, the column, the slicer and
 * the form input all read it.
 */
import type { Permission } from "@/lib/auth/permissions";
import { DRIVER_ENTITY_TYPE } from "./types";

export type CustomFieldEntity = {
  /** Stored on `custom_field_definitions.entity_type` and on the row's `custom_fields`. */
  key: string;
  /** i18n key under `pages.customFields.entities.*`. */
  labelKey: string;
  /** Firestore collection the values live on. */
  collection: string;
  /** Slug that may read the definitions (the list page's own gate). */
  viewPermission: Permission;
  /** Slug that may write a row. Definitions themselves need super admin. */
  managePermission: Permission;
  /** The Employees list already renders `cf:` columns; others opt in below. */
  hasListColumns: boolean;
};


export const CUSTOM_FIELD_ENTITIES: readonly CustomFieldEntity[] = [
  {
    key: DRIVER_ENTITY_TYPE,
    labelKey: "drivers",
    collection: "drivers",
    viewPermission: "drivers.view",
    managePermission: "drivers.manage",
    hasListColumns: true,
  },
  {
    key: "partner",
    labelKey: "partners",
    collection: "partners",
    viewPermission: "partners.view",
    managePermission: "partners.manage",
    hasListColumns: true,
  },
  {
    key: "restaurant",
    labelKey: "restaurants",
    collection: "restaurants",
    viewPermission: "restaurants.view",
    managePermission: "restaurants.manage",
    hasListColumns: false,
  },
  {
    key: "zone",
    labelKey: "zones",
    collection: "zones",
    viewPermission: "zones.view",
    managePermission: "zones.manage",
    hasListColumns: false,
  },
  {
    key: "vehicle",
    labelKey: "vehicles",
    collection: "vehicles",
    viewPermission: "vehicles.view",
    managePermission: "vehicles.manage",
    hasListColumns: false,
  },
] as const;

export const CUSTOM_FIELD_ENTITY_KEYS = CUSTOM_FIELD_ENTITIES.map((entity) => entity.key);

export function isCustomFieldEntity(value: unknown): value is string {
  return typeof value === "string" && CUSTOM_FIELD_ENTITY_KEYS.includes(value);
}

export function customFieldEntity(key: string): CustomFieldEntity | null {
  return CUSTOM_FIELD_ENTITIES.find((entity) => entity.key === key) ?? null;
}

/**
 * Which entity a table's `cf:` column ids belong to.
 *
 * A page passes its own key, so a column id can never be read against the wrong
 * definition — `cf:colour` means one thing on Restaurants and another on Vehicles.
 */
export function entityForColumnId(entityKey: string): string {
  return entityKey;
}
