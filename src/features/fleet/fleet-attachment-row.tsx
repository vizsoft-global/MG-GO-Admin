import { Camera, ExternalLink, FileText, Trash2 } from "lucide-react";
import { formatKuwaitDateTime } from "./fleet-labels";

export function FleetAttachmentRow({
  title,
  fileName,
  capturedAt,
  source,
  onOpen,
  onRemove,
}: {
  title: string;
  fileName?: string | null;
  capturedAt?: string | null;
  source?: "mobile_camera" | "admin_upload" | string | null;
  onOpen?: () => void;
  onRemove?: () => void;
}) {
  const fromCamera = source === "mobile_camera";
  const captured = capturedAt ? formatKuwaitDateTime(capturedAt) : null;
  const meta = (
    <>
      {fromCamera ? (
        <Camera className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      ) : (
        <FileText className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" />
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate text-xs font-medium text-foreground">{title}</p>
        {fileName ? <p className="truncate text-[10px] text-muted-foreground">{fileName}</p> : null}
        {captured ? (
          <p className="text-[10px] text-muted-foreground">
            Captured {captured}
            {fromCamera ? " · From mobile camera" : source === "admin_upload" ? " · Admin upload" : ""}
          </p>
        ) : null}
      </div>
    </>
  );

  return (
    <div className="flex items-start gap-2 rounded-lg border border-border bg-card px-3 py-2">
      {onOpen ? (
        <button
          type="button"
          onClick={onOpen}
          className="flex min-w-0 flex-1 items-start gap-2 rounded-md text-start text-primary hover:bg-primary/10"
        >
          {meta}
          <ExternalLink className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span className="sr-only">View</span>
        </button>
      ) : (
        <div className="flex min-w-0 flex-1 items-start gap-2">{meta}</div>
      )}
      {onRemove ? (
        <button
          type="button"
          onClick={onRemove}
          className="inline-flex size-8 shrink-0 items-center justify-center rounded-md text-destructive hover:bg-destructive/10"
        >
          <Trash2 className="h-3.5 w-3.5" />
          <span className="sr-only">Remove</span>
        </button>
      ) : null}
    </div>
  );
}
