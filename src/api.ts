export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}

/** The request never reached the server (no signal, or it took too long). */
export class NetworkError extends Error {}

/** True when an error from api() means "no connection" rather than the server saying no. */
export const isNetworkError = (err: unknown) => err instanceof NetworkError;

export async function api<T>(
  path: string,
  options: { method?: string; body?: unknown; timeoutMs?: number } = {},
): Promise<T> {
  // A weak signal at the field can leave a request hanging; a timeout lets the app fall back to what's on the phone.
  const abort = new AbortController();
  const timer = options.timeoutMs ? setTimeout(() => abort.abort(), options.timeoutMs) : undefined;
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method: options.method ?? (options.body === undefined ? "GET" : "POST"),
      headers: options.body === undefined ? undefined : { "Content-Type": "application/json" },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      credentials: "same-origin",
      signal: abort.signal,
    });
  } catch {
    throw new NetworkError("No connection to the server.");
  } finally {
    clearTimeout(timer);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(data.error ?? `Something went wrong (${res.status}).`, res.status);
  return data as T;
}

/** Uploads a file with progress reports (fetch can't report upload progress). */
export function upload<T>(
  path: string,
  file: File,
  onProgress?: (fraction: number) => void,
  fields: Record<string, string> = {},
): Promise<T> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", `/api${path}`);
    xhr.setRequestHeader("X-Batter-Beats", "1");
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress?.(e.loaded / e.total);
    };
    xhr.onload = () => {
      let data: { error?: string } = {};
      try {
        data = JSON.parse(xhr.responseText);
      } catch {
        // not JSON
      }
      if (xhr.status >= 200 && xhr.status < 300) resolve(data as T);
      else reject(new ApiError(data.error ?? `Upload failed (${xhr.status}).`, xhr.status));
    };
    xhr.onerror = () => reject(new ApiError("Upload failed. Check your connection.", 0));
    const form = new FormData();
    // Other fields before the file, so the server has them when the file arrives.
    for (const [k, v] of Object.entries(fields)) form.append(k, v);
    form.append("file", file);
    xhr.send(form);
  });
}
