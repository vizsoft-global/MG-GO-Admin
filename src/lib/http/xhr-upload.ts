export type XhrUploadProgress = {
  loaded: number;
  total: number;
  percent: number;
};

export type XhrUploadResult<T = unknown> = {
  status: number;
  json: T;
};

export function xhrUpload<T = unknown>(options: {
  url: string;
  formData: FormData;
  onProgress?: (progress: XhrUploadProgress) => void;
  signal?: AbortSignal;
}): Promise<XhrUploadResult<T>> {
  const { url, formData, onProgress, signal } = options;

  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url);

    const onAbort = () => {
      xhr.abort();
      reject(new DOMException("Aborted", "AbortError"));
    };
    signal?.addEventListener("abort", onAbort);

    xhr.upload.onprogress = (e) => {
      if (!e.lengthComputable || !onProgress) return;
      const percent =
        e.total > 0 ? Math.min(100, Math.round((e.loaded / e.total) * 100)) : 0;
      onProgress({ loaded: e.loaded, total: e.total, percent });
    };

    xhr.onload = () => {
      signal?.removeEventListener("abort", onAbort);
      let json: T;
      try {
        json = xhr.responseText
          ? (JSON.parse(xhr.responseText) as T)
          : ({} as T);
      } catch {
        reject(new Error("invalid_json"));
        return;
      }
      resolve({ status: xhr.status, json });
    };

    xhr.onerror = () => {
      signal?.removeEventListener("abort", onAbort);
      reject(new Error("network_error"));
    };

    xhr.onabort = () => {
      signal?.removeEventListener("abort", onAbort);
      reject(new DOMException("Aborted", "AbortError"));
    };

    xhr.send(formData);
  });
}
