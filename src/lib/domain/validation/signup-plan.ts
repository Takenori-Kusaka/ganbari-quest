// src/lib/domain/validation/signup-plan.ts (#4501 / #4702)
//
// `/auth/signup?plan=…` の値域 SSOT。
//
// 背景:
//   UI (`signup/+page.svelte`) は planParam が truthy なら「トライアルが始まる」と表示し、
//   server (`signup/+page.server.ts`) は 'standard' / 'family' だけを受理していた。
//   **現行 SSOT の tier 名 'premium' は silent 棄却されるのに、旧 alias 'family' は通る**
//   という非対称があり、`?plan=premium` で来た顧客には「トライアルが開始されます」と
//   表示されながら実際には開始されなかった (#4501 GAMMA-SC-04)。
//
//   値域を 1 箇所に閉じ、UI と server が同じ関数を通ることで表示と挙動を一致させる。
//
//   #4702: メール登録経路 (`?/confirm` action) だけがこの規則を使っていたため、Google 登録経路
//   (`/auth/oauth/google` → cookie → `/auth/callback` → `/auth/oauth/trial-start`) では `?plan=`
//   が無視され、登録手段によってトライアルの有無が変わる dead-end があった。OAuth は redirect を
//   挟むため `?plan=` を直接引き回せず、cookie で往復させる (下記 OAUTH_PLAN_* 定数)。
//
// 用語:
//   'premium' が現行の表示名で、'family' は DB / 内部 tier コードに残る旧名 (terms.ts §プラン)。
//   本 module は**外から来た文字列**を扱うため両方を受理し、内部表現に正規化する。

/** `?plan=` として受理する外部入力。旧 alias 'family' を含む。 */
export const SIGNUP_PLAN_PARAMS = ['standard', 'premium', 'family'] as const;

/** 正規化後の関心プラン。顧客が「どちらのプランを見て来たか」を表す。 */
export type SignupPlanInterest = 'standard' | 'premium';

/** Google 登録経路で `?plan=` を往復させる cookie 名 (`/auth/oauth/google` → `/auth/callback`)。 */
export const OAUTH_PLAN_COOKIE_NAME = 'oauth_plan';

/** OAuth 往復 cookie の寿命 (秒)。Google 側の同意画面を挟むため `oauth_next` と同じ 10 分。 */
export const OAUTH_PLAN_MAX_AGE_SECONDS = 600;

/**
 * `?plan=` の値を正規化する。未知の値・空・null は `null` (= プラン指定なし)。
 *
 * - `'family'` は旧 alias として `'premium'` へ寄せる (ブックマーク / 既存 LP リンク救済)
 * - 大文字小文字と前後空白は無視する
 *
 * **これはトライアルの tier を決める関数ではない。** トライアルは FR-2 により常に
 * premium 固定 (`TRIAL_TIER`)。本関数は「トライアルを開始してよいか」と
 * 「どのプランに関心があるか」だけを返す。メール登録経路 (`signup/+page.server.ts`) と
 * Google 登録経路 (`oauth/google/+server.ts` → `oauth/trial-start/+server.ts`) は共に
 * 本関数だけを通して `?plan=` を解釈する。
 */
export function parseSignupPlanParam(
	planInput: string | null | undefined,
): SignupPlanInterest | null {
	if (!planInput) return null;
	const normalized = planInput.trim().toLowerCase();
	if (normalized === 'standard') return 'standard';
	if (normalized === 'premium' || normalized === 'family') return 'premium';
	return null;
}
