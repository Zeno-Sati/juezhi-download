// 觉知下载页：页面和安装说明图是静态文件；/juezhi.apk 和 /info.json 取 GitHub 上最新发布的那个版本。
// 安装包经 Cloudflare 转一道并缓存，国内手机不用直接连 GitHub。发新版只要在 GitHub 发布，这里不用改。
const REPO = 'Zeno-Sati/juezhi-download';
const ASSET = 'juezhi.apk';
// Owner's try-out build: pre-release tagged "test" (never "latest", so /juezhi.apk and the page are unchanged).
// Not linked from the page; replaced each time. Not cached, so a new upload is served at once.
const TEST_TAG = 'test';

// No GitHub API (it limits lookups from shared servers): the public "latest" link redirects to
// /releases/download/<tag>/juezhi.apk, which names the version; one HEAD on that file gives its size.
async function latestRelease(ctx) {
  const cache = caches.default;
  const key = new Request('https://cache.internal/juezhi-latest-release-v2');
  const hit = await cache.match(key);
  if (hit) return hit.json();
  const hop = await fetch(`https://github.com/${REPO}/releases/latest/download/${ASSET}`, {redirect: 'manual'});
  const location = hop.headers.get('Location') || '';
  const match = location.match(/\/releases\/download\/([^/]+)\//);
  if (!match) throw new Error(`GitHub ${hop.status}`);
  const url = new URL(location, 'https://github.com').toString();
  const head = await fetch(url, {method: 'HEAD'});
  const info = {
    version: decodeURIComponent(match[1]).replace(/^v/, ''),
    date: head.headers.get('Last-Modified') ? new Date(head.headers.get('Last-Modified')).toISOString() : '',
    size: Number(head.headers.get('Content-Length') || 0),
    url,
  };
  ctx.waitUntil(cache.put(key, new Response(JSON.stringify(info), {headers: {'Cache-Control': 'max-age=300'}})));
  return info;
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === '/info.json') {
      try {
        const {version, date, size} = await latestRelease(ctx);
        return Response.json({version, date, size}, {headers: {'Cache-Control': 'max-age=300'}});
      } catch (error) {
        return Response.json({error: String(error.message || error)}, {status: 502});
      }
    }
    if (url.pathname === '/test.apk') {
      const upstream = await fetch(`https://github.com/${REPO}/releases/download/${TEST_TAG}/${ASSET}`, {cf: {cacheTtl: 0}});
      if (!upstream.ok) return new Response('现在没有测试版', {status: 404, headers: {'Content-Type': 'text/plain; charset=utf-8'}});
      const headers = new Headers();
      headers.set('Content-Type', 'application/vnd.android.package-archive');
      headers.set('Content-Disposition', 'attachment; filename="juezhi-test.apk"');
      const length = upstream.headers.get('Content-Length');
      if (length) headers.set('Content-Length', length);
      headers.set('Cache-Control', 'no-store');
      return new Response(upstream.body, {status: 200, headers});
    }
    if (url.pathname === '/juezhi.apk' || url.pathname === '/download') {
      let info;
      try {
        info = await latestRelease(ctx);
      } catch (error) {
        return Response.redirect(`https://github.com/${REPO}/releases/latest/download/${ASSET}`, 302);
      }
      if (!info.url) return new Response('还没有可下载的版本', {status: 404});
      // Same version → same URL → Cloudflare keeps a copy, so most downloads never reach GitHub.
      const upstream = await fetch(info.url, {cf: {cacheEverything: true, cacheTtl: 86400}});
      if (!upstream.ok) return Response.redirect(info.url, 302);
      const headers = new Headers();
      headers.set('Content-Type', 'application/vnd.android.package-archive');
      headers.set('Content-Disposition', `attachment; filename="${ASSET}"`);
      const length = upstream.headers.get('Content-Length');
      if (length) headers.set('Content-Length', length);
      headers.set('Cache-Control', 'public, max-age=3600');
      return new Response(upstream.body, {status: 200, headers});
    }
    return env.ASSETS.fetch(request);
  },
};
