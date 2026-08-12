// Verifies the RPC/table payloads the e-sign screens render, authenticated as the admin user.
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

  const rpc = async (name, body) => {
    const r = await fetch(`${url}/rest/v1/rpc/${name}`, {
      method: 'POST',
      headers: H,
      body: JSON.stringify(body),
    });
    return { status: r.status, body: await r.json() };
  };
  const rest = async (path) => {
    const r = await fetch(`${url}/rest/v1/${path}`, { headers: H });
    return { status: r.status, body: await r.json() };
  };

  const list = await rpc('admin_list_esign_requests', { p_status: null, p_limit: 100, p_offset: 0 });
  console.log('== admin_list_esign_requests ==', list.status);
  console.log(JSON.stringify(list.body).slice(0, 1200));

  const pending = await rpc('admin_list_esign_requests', {
    p_status: 'pending',
    p_limit: 100,
    p_offset: 0,
  });
  console.log('\n== status=pending rows ==', (pending.body.rows || []).length);

  const cats = await rest(
    'esign_categories?select=key,label_en,icon_key,screenshot_restricted,is_active&order=sort_order',
  );
  console.log('\n== esign_categories ==', cats.status);
  console.log(JSON.stringify(cats.body));

  const counts = await rest('esign_requests?select=status,created_at,signed_at');
  console.log('\n== esign_requests for KPI ==', counts.status, JSON.stringify(counts.body));

  const settings = await rest('app_settings?id=eq.1&select=esign_screenshot_default');
  console.log('\n== app_settings.esign_screenshot_default ==', JSON.stringify(settings.body));
})();
