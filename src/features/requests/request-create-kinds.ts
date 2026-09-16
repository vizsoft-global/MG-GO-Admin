import {
  FUEL_REFUND_ATTACHMENT_KINDS,
  FUEL_REQUEST_ATTACHMENT_KINDS,
} from "@/features/fuel/fleet-request-utils";

export type CreateKindSpec = {
  kind: string;
  required: boolean;
};

const FUEL_OPTIONAL_KINDS = new Set<string>();
const FUEL_REFUND_OPTIONAL_KINDS = new Set(["rejected_fuel_invoice"]);

function specsFrom(
  kinds: readonly string[],
  optional: ReadonlySet<string>,
): CreateKindSpec[] {
  return kinds.map((kind) => ({ kind, required: !optional.has(kind) }));
}

export const FUEL_CREATE_KIND_SPECS = specsFrom(
  FUEL_REQUEST_ATTACHMENT_KINDS,
  FUEL_OPTIONAL_KINDS,
);
export const FUEL_REFUND_CREATE_KIND_SPECS = specsFrom(
  FUEL_REFUND_ATTACHMENT_KINDS,
  FUEL_REFUND_OPTIONAL_KINDS,
);

export function createKindSpecs(type: string): readonly CreateKindSpec[] {
  switch (type) {
    case "fuel":
      return FUEL_CREATE_KIND_SPECS;
    case "fuel_refund":
      return FUEL_REFUND_CREATE_KIND_SPECS;
    default:
      return [];
  }
}

export function missingRequiredCreateKind(
  type: string,
  presentKinds: Iterable<string>,
): string | null {
  const have = new Set(presentKinds);
  for (const spec of createKindSpecs(type)) {
    if (spec.required && !have.has(spec.kind)) return spec.kind;
  }
  return null;
}

export function isKnownCreateKind(type: string, kind: string): boolean {
  return createKindSpecs(type).some((spec) => spec.kind === kind);
}

export function typedRequiresAmount(type: string): boolean {
  return type === "fuel" || type === "fuel_refund";
}
