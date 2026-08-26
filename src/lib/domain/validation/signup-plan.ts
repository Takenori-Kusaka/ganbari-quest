// src/lib/domain/validation/signup-plan.ts (#4501)
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
// 用語:
//   'premium' が現行の表示名で、'family' は DB / 内部 tier コードに残る旧名 (terms.ts §プラン)。
//   本 module は**外から来た文字列**を扱うため両方を受理し、内部表現に正規化する。

/** `?plan=` として受理する外部入力。旧 alias 'family' を含む。 */
export const SIGNUP_PLAN_PARAMS = ['standard', 'premium', 'family'] as const;

/** 正規化後の関心プラン。顧客が「どちらのプランを見て来たか」を表す。 */
export type SignupPlanInterest = 'standard' | 'premium';

/**
 * `?plan=` の値を正規化する。未知の値・空・null は `null` (= プラン指定なし)。
 *
 * - `'family'` は旧 alias として `'premium'` へ寄せる (ブックマーク / 既存 LP リンク救済)
 * - 大文字小文字と前後空白は無視する
 *
 * **これはトライアルの tier を決める関数ではない。** トライアルは FR-2 により常に
 * premium 固定 (`TRIAL_TIER`)。本関数は「トライアルを開始してよいか」と
 * 「どのプランに関心があるか」だけを返す。
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
