// Signs in via the Supabase auth REST API and prints @supabase/ssr-compatible cookie chunks.
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
const ref = url.replace('https://', '').split('.')[0];

(async () => {
  const res = await fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@vizsoft.in', password: 'umc#1S#rR$yh616' }),
  });
  const session = await res.json();
  if (!session.access_token) {
    console.error('AUTH FAILED', JSON.stringify(session).slice(0, 400));
    process.exit(1);
  }
  const payload = {
    access_token: session.access_token,
    token_type: session.token_type,
    expires_in: session.expires_in,
    expires_at: session.expires_at,
    refresh_token: session.refresh_token,
    user: session.user,
  };
  const encoded = 'base64-' + Buffer.from(JSON.stringify(payload)).toString('base64');
  const name = `sb-${ref}-auth-token`;
  const MAX = 3180;
  const cookies = [];
  if (encoded.length <= MAX) {
    cookies.push({ name, value: encoded });
  } else {
    for (let i = 0, n = 0; i < encoded.length; i += MAX, n += 1) {
      cookies.push({ name: `${name}.${n}`, value: encoded.slice(i, i + MAX) });
    }
  }
  fs.writeFileSync('.figma-esign5/cookies.json', JSON.stringify(cookies, null, 1));
  console.log('wrote', cookies.length, 'cookie chunk(s) for', name, 'user', session.user.email);
})();
