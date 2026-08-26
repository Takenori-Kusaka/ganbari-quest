// #4644: オフライン着地ページ。
//
// Service Worker の precache に**確実に**載せるため prerender する。動的 load を持つと
// SvelteKit は静的化しないため precache 対象 (`$service-worker` の `prerendered`) に
// 現れず、オフライン時にこのページ自体が取得できないという本末転倒になる。
export const prerender = true;

// オフラインで開かれる = ネットワークが死んでいる状態なので、クライアント側の
// データ取得を一切持たない (持てない)。
export const ssr = true;
export const csr = true;
