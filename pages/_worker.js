/**
 * Cloudflare Pages 的進階模式入口（_worker.js）。
 *
 * 目的是讓前端和 API 變成「同源」：使用者打開 https://guoding.pages.dev，
 * app 直接呼叫 /api/... 相對路徑，不需要在設定裡填伺服器網址，
 * 瀏覽器也不會有跨來源（CORS）的問題。
 *
 *   /api/*  -> 轉給 guoding 這個 Worker（靠 Pages 的 service binding「API」）
 *   其他     -> 原本的靜態檔案（index.html）
 *
 * service binding 要在 Cloudflare 儀表板設定一次：
 *   Workers & Pages -> guoding（Pages 專案）-> Settings -> Functions
 *   -> Service bindings -> Variable name 填 API、Service 選 guoding
 */
export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);

    if (pathname === '/api' || pathname.startsWith('/api/')) {
      if (!env.API) {
        return new Response(
          JSON.stringify({ error: '伺服器尚未設定 service binding「API」，請參考 pages/_worker.js 的說明。' }),
          { status: 503, headers: { 'Content-Type': 'application/json; charset=utf-8' } },
        );
      }
      return env.API.fetch(request);
    }

    return env.ASSETS.fetch(request);
  },
};
