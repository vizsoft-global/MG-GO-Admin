import { Camera, FileText } from "lucide-react";
import { formatKuwaitDateTime } from "./fleet-labels";

export function FleetAttachmentRow({
  title,
  fileName,
  capturedAt,
  source,
}: {
  title: string;
  fileName?: string | null;
  capturedAt?: string | null;
  source?: "mobile_camera" | "admin_upload" | string | null;
}) {
  const fromCamera = source === "mobile_camera";
  const captured = capturedAt ? formatKuwaitDateTime(capturedAt) : null;
  return (
    <div className="flex items-start gap-2 rounded-lg border border-border bg-card px-3 py-2">
      {fromCamera ? (
        <Camera className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      ) : (
        <FileText className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      )}
      <div className="min-w-0">
        <p className="truncate text-xs font-medium text-foreground">{title}</p>
        {fileName ? <p className="truncate text-[10px] text-muted-foreground">{fileName}</p> : null}
        {captured ? (
          <p className="text-[10px] text-muted-foreground">
            Captured {captured}
            {fromCamera ? " · From mobile camera" : source === "admin_upload" ? " · Admin upload" : ""}
          </p>
        ) : null}
      </div>
    </div>
  );
}
