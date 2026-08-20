export const DRIVER_IMPORT_HEADERS = [
  "Full Name",
  "Phone (+965)",
  "Civil ID",
  "Employee ID",
  "Partner",
  "Zone",
  "Vehicle",
  "Restaurant IDs (name, RST code, or UUID)",
  "Nationality",
  "Rider Category",
] as const;

export const DRIVER_IMPORT_SAMPLE_ROW = [
  "Ahmed Ali",
  "+96599123456",
  "281010100001",
  "12345",
  "",
  "",
  "BIKE-1024",
  "RST-0001,RST-0002",
  "IN",
  "in_house",
] as const;

export const DRIVER_IMPORT_TEMPLATE_PATH = "/api/drivers/import-template.xlsx";
