/**
 * Cloudflare Pages 的進階模式入口（_worker.js，必須放在部署目錄的根層）。
 *
 * 目的是把 https://guoding.pages.dev 和 https://guoding.skyzbpt.workers.dev
 * 整合成同一個來源：使用者只開 guoding.pages.dev，app 呼叫 /api/... 相對路徑，
 * 不需要設定伺服器網址，瀏覽器也不會有跨來源（CORS）的問題。
 *
 *   /api/*  -> 轉給 guoding 這個 Worker
 *   其他     -> 原本的靜態檔案（index.html）
 *
 * 轉送有兩條路，會自動選用可用的那一條：
 *   1. service binding「API」——走 Cloudflare 內部網路，不經過公開網路，比較快。
 *      要在儀表板設定一次：guoding（Pages 專案）-> Settings -> Functions
 *      -> Service bindings -> Variable name 填 API、Service 選 guoding。
 *   2. 沒設定 binding 時，直接打 WORKER_ORIGIN 這個公開網址。
 *      所以就算完全沒設定 binding，同步一樣會通。
 */

const WORKER_ORIGIN = 'https://guoding.skyzbpt.workers.dev';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
      // 有 service binding 就走內部網路
      if (env.API) return env.API.fetch(request);

      // 沒有的話改打公開網址：換掉 origin，其餘（路徑、查詢字串、method、
      // headers、body）原樣轉送
      const target = new URL(url.pathname + url.search, WORKER_ORIGIN);
      return fetch(new Request(target, request));
    }

    return env.ASSETS.fetch(request);
  },
};
