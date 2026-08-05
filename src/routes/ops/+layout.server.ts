// src/routes/ops/+layout.server.ts
// #820 PR-C: /ops 認可を Cognito ops group ベースに刷新
//
// 旧実装（#0176）: `OPS_SECRET_KEY` による Bearer token / cookie / URL パラメータ認証。
// 問題点:
//   - actor 識別不能（共有シークレット）→ 監査ログに「誰が操作したか」残らない
//   - シークレット漏洩時の影響範囲が無限大
//   - cookie 平文保存の既知課題（docs/security/security-code-review-2026-03.md:189）
//
// 新実装（PR-C）: Cognito `ops` group 所属チェック。
//   - actor 識別 = Cognito sub
//   - 非所属は 403（以前は 401）
//   - hooks.server.ts で resolveIdentity 済みの `locals.identity` を使用
//   - cognito-dev mode（ローカル / CI）では DEV_USERS の `groups: ['ops']` 指定で通過
//
// OPS_SECRET_KEY env の完全除去・設計書更新は PR-D で対応（Issue #820）。

import { error } from '@sveltejs/kit';
import { hasOpsAccess, isOpsMember } from '$lib/server/auth/ops-authz';
import type { LayoutServerLoad } from './$types';

export const load: LayoutServerLoad = async ({ locals }) => {
	// #4266: CloudFront の IP allowlist 廃止に伴い、主防御を ops group + MFA に強化した。
	// MFA 情報が取れない場合も拒否する (fail-closed)。判定は hasOpsAccess に集約。
	if (!hasOpsAccess(locals.identity, locals.context)) {
		// ops group には居るが MFA 判定で落ちた場合だけ理由を返す。運営者が「なぜ入れないか」を
		// 画面から自力で判断できないと、TOTP 設定漏れ / トークン更新での claim 落ちを
		// コードを読むまで切り分けられない。非 ops には理由を出さない (存在の示唆を避ける)。
		if (isOpsMember(locals.identity)) {
			error(403, 'Forbidden: ops access requires MFA');
		}
		error(403, 'Forbidden');
	}
	return {};
};
