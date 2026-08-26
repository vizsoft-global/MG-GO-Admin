export const DRIVER_IMPORT_HEADERS = [
  "Full Name",
  "Phone (+965, optional)",
  "Civil ID (optional)",
  "Employee ID",
  "Restaurant IDs (name, RST code, or UUID)",
  "Partner",
  "Zone",
  "Vehicle",
  "Nationality",
  "Rider Category",
  "Active (yes/no)",
] as const;

export const DRIVER_IMPORT_SAMPLE_ROW = [
  "Ahmed Ali",
  "+96599123456",
  "281010100001",
  "12345",
  "RST-0001",
  "",
  "",
  "BIKE-1024",
  "IN",
  "in_house",
  "yes",
] as const;

export const DRIVER_IMPORT_TEMPLATE_PATH = "/api/drivers/import-template.xlsx";
