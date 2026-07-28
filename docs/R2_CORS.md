# Cloudflare R2 bucket CORS (driver app + admin)

Apply in **Cloudflare Dashboard → R2 → `dpd-private` → Settings → CORS policy**.

Admin proof viewing uses **server presigned GET URLs** in `<img>` / `<iframe>` (no browser CORS preflight). This policy is required for the **driver app** direct `PUT` uploads to presigned URLs.

```json
[
  {
    "AllowedOrigins": [
      "http://localhost:52078",
      "https://bites-delivery-app.flutterflow.app",
      "https://bites-admin-panel.flutterflow.app",
      "https://dpdadmin.vercel.app"
    ],
    "AllowedMethods": ["GET", "PUT", "HEAD"],
    "AllowedHeaders": ["*"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3600
  }
]
```

For local Flutter web on another port, add e.g. `http://localhost:*` if your Cloudflare plan supports wildcard origins, or add the exact origin.
