// src/lib/server/cron/tenant-slice.ts
// #4337 / #4682: 全テナント走査 cron が「1 回の実行で処理する担当分」を決める共有ロジック。
//
// **`tenants.slice(0, limit)` を書いてはいけない** — 上限を超えたテナントが毎回同じ理由で
// 落ち続け、しかも「次回に持ち越す」と log に書けば嘘になる (永久に順番が回ってこない)。
// これは #4682 が根治しようとしている「一覧の limit を全件処理に流用する」class そのもの。

/**
 * #4337: 実行日 (JST 暦日) から決まる「今回処理するスライス」を選ぶ。
 *
 * 全テナントを tenantId 昇順に並べ、`limit` 件ずつの固定スライスに分割し、
 * 実行日の通し日数 (UNIX epoch からの日数) で剰余を取ってスライスを 1 つ選ぶ。
 *
 * この方式を採る理由:
 * - **再開位置に永続ストアが要らない**。settings はテナント単位 (`ISettingsRepo` の全 API が
 *   tenantId 必須) で、cron 全体のカーソルを置ける横断 kv が存在しない。テナント毎に
 *   「最終処理日」を持たせると全テナント分の設定読み取り = N+1 が増え ADR-0065 に反する
 * - **同じ先頭 N 件を毎回処理する形にならない**。スライスは日付で 1 つずつ前進し
 *   `ceil(total / limit)` 日で全テナントを重複なく網羅して周回する
 * - **決定的**。同じ実行日なら同じスライスを選ぶので、失敗した日の再実行が
 *   その日の担当分をやり直す (ランダム / 実行時刻依存だと再実行で別集合を触る)
 *
 * テナント総数が `limit` 以下なら常にスライスは 1 つ = 全件処理となる。
 */
export function selectTenantSlice<T extends { tenantId: string }>(
	tenants: T[],
	limit: number,
	today: string,
): { slice: T[]; sliceIndex: number; sliceCount: number } {
	if (tenants.length === 0) return { slice: [], sliceIndex: 0, sliceCount: 1 };

	const ordered = [...tenants].sort((a, b) => (a.tenantId < b.tenantId ? -1 : 1));
	const sliceCount = Math.max(1, Math.ceil(ordered.length / limit));
	// 暦日文字列を UTC 深夜として解釈するため、プロセス TZ に依存しない (#4015 / #4127)
	const dayIndex = Math.floor(Date.parse(`${today}T00:00:00Z`) / 86_400_000);
	const sliceIndex = ((dayIndex % sliceCount) + sliceCount) % sliceCount;
	const start = sliceIndex * limit;
	return { slice: ordered.slice(start, start + limit), sliceIndex, sliceCount };
}
