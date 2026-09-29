// Placeholder for the "headcount" Worker while sign-in (Google) is built.
// It reserves the name and workers.dev URL and serves a static notice. It never reads any secret.
const page = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Headcount — coming soon</title><style>
:root{color-scheme:dark}body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0b0c0f;color:#e9e7e2;
font:16px/1.5 system-ui,-apple-system,Segoe UI,Inter,sans-serif}main{max-width:32rem;padding:24px;text-align:center}
h1{font-size:2rem;margin:0 0 .5rem;letter-spacing:-.02em}p{color:#a9a59c;margin:0}.dot{color:#f5b04a}
</style></head><body><main><h1><span class="dot">●</span> Headcount</h1><p>The AI Office is being set up. Check back soon.</p></main></body></html>`;

export default {
  fetch(request: Request): Response {
    const { pathname } = new URL(request.url);
    if (pathname.startsWith('/api/')) {
      return Response.json({ error: { code: 'unavailable', message: 'Headcount is being set up.' } }, { status: 503 });
    }
    return new Response(page, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
  },
};
