// Mirrors the existence probe added to fetchEsignDocumentLinks.
const fs = require('fs');
const env = Object.fromEntries(
  fs
    .readFileSync('.env.local', 'utf8')
    .split(/\r?\n/)
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    }),
);
const url = env.NEXT_PUBLIC_SUPABASE_URL;
const key = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

(async () => {
  const auth = await (
    await fetch(`${url}/auth/v1/token?grant_type=password`, {
      method: 'POST',
      headers: { apikey: key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'admin@vizsoft.in', password: 'umc#1S#rR$yh616' }),
    })
  ).json();
  const H = {
    apikey: key,
    Authorization: `Bearer ${auth.access_token}`,
    'Content-Type': 'application/json',
  };

  const raw = 'esign-documents/demo/leave-policy.pdf';
  const slash = raw.lastIndexOf('/');
  const folder = raw.slice(0, slash);
  const fileName = raw.slice(slash + 1);

  const listRes = await fetch(`${url}/storage/v1/object/list/esign-documents`, {
    method: 'POST',
    headers: H,
    body: JSON.stringify({ prefix: folder, search: fileName, limit: 100, offset: 0 }),
  });
  const listed = await listRes.json();
  console.log('list status', listRes.status, 'objects:', JSON.stringify(listed));
  const exists = Array.isArray(listed) && listed.some((o) => o.name === fileName);
  console.log('exists =', exists, '=> signedUrl would be', exists ? 'a URL' : 'null (honest empty state)');

  // and prove a signed URL for the missing key really is broken
  const signRes = await fetch(`${url}/storage/v1/object/sign/esign-documents/${raw}`, {
    method: 'POST',
    headers: H,
    body: JSON.stringify({ expiresIn: 60 }),
  });
  const signed = await signRes.json();
  console.log('sign status', signRes.status, JSON.stringify(signed).slice(0, 200));
  if (signed.signedURL) {
    const head = await fetch(`${url}/storage/v1${signed.signedURL}`);
    console.log('fetching that signed URL ->', head.status, head.statusText);
  }
})();
