// src/lib/features/admin/action-result.ts (#4693)
//
// **form action を fetch で叩いたときの結果判定 SSOT**。
//
// # なぜ必要か
//
// SvelteKit の `fail(403, { error })` は `type: 'failure'` の ActionResult を返すが、
// これを `resp.ok` で判定すると **失敗が成功として扱われる**。実際に
// `/admin/activities` の「まとめて追加」「別のお子さまからコピー」は、無料プランの上限に
// 達した状態でサーバーが `{type:'failure', status:403, PLAN_LIMIT_EXCEEDED}` を返しているのに
// 画面には「一括追加しました」「コピーが完了しました」と出て、**1 件も増えていない**
// (#4693 実測)。出るべきだった上限メッセージとアップグレード導線が握り潰されていた。
//
// 判定を「HTTP status」ではなく **ActionResult の `type`** に統一し、成功 / 失敗の分岐と
// エラーの取り出しをこの 1 関数に集約する。`resp.ok` を各 handler が独自に見る形には戻さない
// (`tests/unit/architecture/admin-action-result-no-http-ok.test.ts` が検出する)。

import { deserialize } from '$app/forms';

export type AdminActionResult =
	| { ok: true; data: Record<string, unknown> | undefined }
	| { ok: false; error: unknown };

/**
 * form action の fetch レスポンスを ActionResult として読み、成功 / 失敗を判定する。
 *
 * - `type: 'success'` → `{ ok: true, data }`
 * - `type: 'failure'` → `{ ok: false, error }` (error は `getActionErrorDisplay` に渡せる形のまま)
 * - `redirect` / `error` / deserialize 不能 → `{ ok: false, error: undefined }`
 *   (呼び出し側の fallback 文言を使わせる。ここで文言を決めない)
 */
export async function readAdminActionResult(resp: Response): Promise<AdminActionResult> {
	let text: string;
	try {
		text = await resp.text();
	} catch {
		return { ok: false, error: undefined };
	}

	try {
		const result = deserialize(text);
		if (result.type === 'success') {
			return { ok: true, data: result.data as Record<string, unknown> | undefined };
		}
		if (result.type === 'failure') {
			return { ok: false, error: (result.data as { error?: unknown } | undefined)?.error };
		}
		return { ok: false, error: undefined };
	} catch {
		return { ok: false, error: undefined };
	}
}

/** form action を fetch で叩くときの必須ヘッダ (これが無いと ActionResult 形式で返らない、#2745)。 */
export const ADMIN_ACTION_FETCH_HEADERS = {
	accept: 'application/json',
	'x-sveltekit-action': 'true',
} as const;
