import type { XhrUploadProgress } from "@/lib/http/xhr-upload";

export function xhrPut(options: {
  url: string;
  body: Blob;
  onProgress?: (progress: XhrUploadProgress) => void;
  signal?: AbortSignal;
}): Promise<{ status: number; responseText: string }> {
  const { url, body, onProgress, signal } = options;

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);

    const onAbort = () => {
      xhr.abort();
      reject(new DOMException("Aborted", "AbortError"));
    };
    signal?.addEventListener("abort", onAbort);

    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable || !onProgress) return;
      const percent =
        event.total > 0
          ? Math.min(100, Math.round((event.loaded / event.total) * 100))
          : 0;
      onProgress({ loaded: event.loaded, total: event.total, percent });
    };

    xhr.onload = () => {
      signal?.removeEventListener("abort", onAbort);
      resolve({ status: xhr.status, responseText: xhr.responseText });
    };

    xhr.onerror = () => {
      signal?.removeEventListener("abort", onAbort);
      reject(new Error("network_error"));
    };

    xhr.onabort = () => {
      signal?.removeEventListener("abort", onAbort);
      reject(new DOMException("Aborted", "AbortError"));
    };

    xhr.send(body);
  });
}
