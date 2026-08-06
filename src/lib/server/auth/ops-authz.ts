// src/lib/server/auth/ops-authz.ts
// #820: /ops 認可のための Cognito group 定義と判定ヘルパ。
//
// 現状（PR-A）: 定数と判定ヘルパを追加するのみ。実際の /ops 認可切替は PR-C で行う。
// 将来の階層化（`ops-cs` / `ops-eng` など）に備え、名前は enum 化して 1 箇所で管理する。

import { error } from '@sveltejs/kit';
import { OPS_MFA_REQUIRED, OPS_MFA_REQUIRED_REASON } from '$lib/policy/capabilities';
import type { AuthContext, Identity } from './types';

/**
 * 運営ダッシュボード `/ops` 全体を操作できる group 名。
 * Cognito User Pool の group 名と一致させる（CDK 側で同じ文字列で作成する）。
 */
export const OPS_GROUP = 'ops';

/**
 * すべての ops 系 group を列挙。
 * 将来 `ops-cs` / `ops-eng` のように分割しても、1 箇所の変更で判定が追従する。
 */
export const OPS_GROUPS = [OPS_GROUP] as const;

export type OpsGroup = (typeof OPS_GROUPS)[number];

/**
 * identity が ops group に所属しているか判定する。
 * - local identity は常に false（`/ops` は Cognito 配信のみ想定）
 * - groups が未提供（旧トークン等）の場合も false
 */
export function isOpsMember(identity: Identity | null): boolean {
	if (!identity || identity.type !== 'cognito') return false;
	const groups = identity.groups;
	if (!groups || groups.length === 0) return false;
	return OPS_GROUPS.some((g) => groups.includes(g));
}

/**
 * このセッションが MFA を経て開始されたか (#4266)。
 *
 * **判定はセッション単位**: MFA を「今の ID token が MFA を経ているか」ではなく
 * **「このセッションが MFA を経て開始されたか」** で見る。silent refresh
 * (`REFRESH_TOKEN_AUTH`) で再発行される ID token が `amr` を保持するかは AWS 公式
 * ドキュメントで確定できず (2026-08-05 調査)、identity 側だけを見ると運営者が無操作で
 * 締め出され再ログインまで戻れない。ログイン時に確定した値を署名付き context token
 * (`context-token.ts`、既存機構) が保持し、ここで OR を取る。
 *
 * **fail-closed**: identity / context のどちらからも MFA を確認できない (旧トークン /
 * claim 欠落 = `undefined`) 場合は `false`。「不明なら通す」にはしない
 * (ADR-0024 ENV silent skip 禁止と同じ規律)。
 *
 * #4363 で `/ops` の MFA 要求自体は既定 off になったが、**本判定は残す**
 * (`OPS_MFA_REQUIRED` を `true` に戻せばそのまま効く)。
 */
export function hasMfaAuthenticatedSession(
	identity: Identity | null,
	context?: Pick<AuthContext, 'mfaAuthenticated'> | null,
): boolean {
	const tokenMfa = identity?.type === 'cognito' && identity.mfaAuthenticated === true;
	const sessionMfa = context?.mfaAuthenticated === true;
	return tokenMfa || sessionMfa;
}

/**
 * `/ops` に入れるか判定する単一述語。**既定では ops group 所属のみ**を要求する
 * (#4363、オーナー決裁 2026-08-06 で MFA 要求を撤去)。
 *
 * 経緯: #4266 で CloudFront 層の IP allowlist (2 枚目の防御) を廃止した際、その代替として
 * MFA を要求した。IP allowlist を廃止した理由:
 *   - 対象 path に `/admin` (= 保護者 = 顧客の見守り画面) が含まれ、有効化すると全顧客が 403
 *   - 運営者のグローバル IP が固定でなく、プロキシ経由では `event.viewer.ip` が回線 IP と一致しない
 *
 * しかし運営 1 人・ops group メンバー 0 人の段階では TOTP 登録の運用コストに見合わず、
 * オーナーが MFA 要求の撤去を決裁した。**結果として `/ops` の防御は
 * 「Cognito 認証 + ops group 所属」だけになり、多層防御が 1 層減っている。**
 * 残る防御・再評価トリガー (T1〜T4) は `docs/design/14-セキュリティ設計書.md` §5.2.9 が SSOT。
 *
 * **fail-closed は group 側で維持**: group が確認できない (identity=null / local /
 * groups 欠落) 場合は拒否する。緩めたのは MFA の 1 条件だけである。
 *
 * `requireMfa` は既定で `OPS_MFA_REQUIRED` (現在 false)。呼び出し側で上書きするのは
 * 「フラグを戻せば #4266 当時の判定に復帰する」ことを test で機械的に固定するため
 * (`tests/unit/routes/ops-mfa-not-required.test.ts`)。**production の呼び出しでは指定しない**。
 */
export function hasOpsAccess(
	identity: Identity | null,
	context?: Pick<AuthContext, 'mfaAuthenticated'> | null,
	requireMfa: boolean = OPS_MFA_REQUIRED,
): boolean {
	if (!isOpsMember(identity)) return false;
	if (!requireMfa) return true;
	return hasMfaAuthenticatedSession(identity, context);
}

/**
 * `/ops` 配下に入れなければ 403 で止める、**`/ops` 認可の単一強制点** (#4309)。
 *
 * `/ops` はグローバル認可層 (`authorizeCognito` → `isPublicRoute`) を意図的に通過させ、
 * 認可の担い手を route 側に置いている。理由は認可層が ops group / MFA を表現できないため
 * (`ROUTE_RULES.roles` は owner / parent / child の 3 値しか持たない)。詳細は
 * `authorization.ts` の `isPublicRoute` にある `/ops` の注釈。
 *
 * したがって `/ops` の防御は本関数**だけ**であり、`+layout.server.ts` (page) と
 * 各 `+server.ts` (API endpoint) の**両方**がこれを呼ぶ必要がある。
 * SvelteKit の `+layout.server.ts` は page の load にしか適用されず `+server.ts` には
 * 走らないため、layout に置いた gate は API を 1 mm も守らない (#4309 の実害:
 * `/ops/export?type=sales` が未認証で 200 + 実顧客の売上台帳 CSV を返していた)。
 *
 * 判定を 2 つに分けないため、layout / endpoint は本関数を共有する。適用範囲は
 * `tests/unit/architecture/ops-route-auth-fitness.test.ts` が FS 列挙で機械強制する
 * (新しく `/ops` 配下に API を足した人が黙って穴を開けられないようにする)。
 */
export function requireOpsAccess(locals: App.Locals): void {
	if (hasOpsAccess(locals.identity, locals.context)) return;
	// ops group には居るが MFA 判定で落ちた場合だけ理由を返す。運営者が「なぜ入れないか」を
	// 画面から自力で判断できないと、TOTP 設定漏れ / トークン更新での claim 落ちを
	// コードを読むまで切り分けられない。非 ops には理由を出さない (存在の示唆を避ける)。
	//
	// #4282: 併せて機械可読な `reason` を載せる。`+error.svelte` はこの値のときだけ
	// MFA 設定導線 (`OpsMfaSetupNotice`) に切り替える — メッセージ本文の文字列一致に
	// 表示を依存させない。値は policy 層の deny reason と同一 (`OPS_MFA_REQUIRED_REASON`)。
	// 403 (データを一切 load しない fail-closed) は変えず、表示だけを分ける。
	//
	// #4363: MFA 要求が off の間、`hasOpsAccess` は ops member を必ず通すため本分岐には
	// 到達しない (= 復旧導線は表示されない)。分岐を消さずフラグ条件を明示しているのは、
	// `OPS_MFA_REQUIRED` を `true` に戻したときに拒否理由と復旧導線 (`OpsMfaSetupNotice`)
	// が同時に復活するようにするため (戻すのに再実装を要さない)。
	if (OPS_MFA_REQUIRED && isOpsMember(locals.identity)) {
		error(403, {
			message: 'Forbidden: ops access requires MFA',
			reason: OPS_MFA_REQUIRED_REASON,
		});
	}
	error(403, 'Forbidden');
}

/**
 * グローバル master (全テナント共有の統計基準値 = `market_benchmarks` 等) への書込を
 * ops/admin 相当に限定する単一強制点 (#3824、CWE-639 隣接 / #3593 ④ の実厳格化)。
 *
 * `market_benchmarks` は tenant 非依存のグローバル master であり、1 テナントの書込が
 * 全テナントに波及する。したがって「通常の保護者 (parent-admin) 操作」から到達させず、
 * ops/admin 相当の権限に限定する (ADR-0063 単一強制点 / ADR-0022 admin bypass 禁止と整合)。
 *
 * 書込許可:
 * - `local` identity (NUC セルフホスト): 単一テナントの唯一運用者 = ops/admin 相当。
 *   全テナント波及の概念がなく、`capabilities.ts` の `canWriteDb` と同じ信頼ベース (ADR-0051)。
 * - `cognito` ops group member: SaaS 運営スタッフ。
 *
 * 書込拒否 (`error(403)` を throw):
 * - `cognito` parent-admin (非 ops、通常の保護者顧客): 1 家庭の保護者が全テナント共有の
 *   統計基準値を書換える権限昇格を防ぐ。
 * - `anonymous` (demo) / 未認証: そもそも hooks で write no-op だが fail-closed で 403。
 *
 * 読取 (`findBenchmark` / `findAllBenchmarks`) は本 guard の対象外 (全 admin が自テナント
 * 統計比較のため読める)。書込 (`upsertBenchmark`) 到達点でのみ呼ぶこと。
 */
export function requireGlobalMasterWriteAccess(locals: App.Locals): void {
	const identity = locals.identity;
	if (identity?.type === 'local') return;
	if (isOpsMember(identity)) return;
	error(403, 'Forbidden: global master write requires ops access');
}
