// cspell:ignore opsedit
// ↑ #4309 のコメント内の負例。`/ops` に前方一致する**実在しない route** を例示するためのもので、
//   綴りを直すと「素朴な startsWith が何を巻き込むか」の説明が成立しない (file scope に閉じる)。

// src/lib/server/auth/authorization.ts
// ロール × ルート 認可マトリクス (#0123: viewer廃止, device廃止)

import { AUTH_LICENSE_STATUS } from '$lib/domain/constants/auth-license-status';
import type { AuthContext, AuthResult, Identity, Role } from './types';

interface RouteRule {
	pattern: string;
	/** 許可するロール。空配列 = 認証不要 */
	roles: Role[];
	/** owner 限定ルート */
	ownerOnly?: boolean;
	/** 未認証時のリダイレクト先 */
	unauthRedirect?: string;
	/** ロール不足時のリダイレクト先 */
	forbiddenRedirect?: string;
}

/**
 * ルート保護ルール（上から順にマッチング、最初に一致したルールを適用）
 * #0123 チケットの認可マトリクスに基づく
 */
const ROUTE_RULES: RouteRule[] = [
	// サブスクリプション管理 — owner + parent (#2818: /admin/license → /admin/subscription rename)
	{
		pattern: '/admin/subscription',
		roles: ['owner', 'parent'],
		unauthRedirect: '/auth/login',
		forbiddenRedirect: '/admin',
	},
	// メンバー管理 — owner + parent
	{
		pattern: '/admin/members',
		roles: ['owner', 'parent'],
		unauthRedirect: '/auth/login',
		forbiddenRedirect: '/admin',
	},
	// ご家族の見守り画面全般 — owner + parent
	{
		pattern: '/admin',
		roles: ['owner', 'parent'],
		unauthRedirect: '/auth/login',
		forbiddenRedirect: '/switch?reason=admin_forbidden',
	},
	// 子供画面 — 全ロール（/switch, /preschool/*, /baby/*, /checklist/*）
	{ pattern: '/switch', roles: ['owner', 'parent', 'child'], unauthRedirect: '/auth/login' },
	{ pattern: '/preschool', roles: ['owner', 'parent', 'child'], unauthRedirect: '/auth/login' },
	{ pattern: '/baby', roles: ['owner', 'parent', 'child'], unauthRedirect: '/auth/login' },
	{ pattern: '/checklist', roles: ['owner', 'parent', 'child'], unauthRedirect: '/auth/login' },
	// 管理 API — owner + parent
	{
		pattern: '/api/v1/admin',
		roles: ['owner', 'parent'],
	},
	// 子供 API — 全ロール
	{
		pattern: '/api/v1',
		roles: ['owner', 'parent', 'child'],
	},
	// テナント配下の静的ファイル配信 — 全ロール（認証必須）。
	// #3133: ROUTE_RULES 不在だと findMatchingRule が undefined → default-allow に落ち、
	// 認証済なら他テナントの静的ファイルを GET できる cross-tenant IDOR になる。
	// 明示登録で「認証必須」を担保し、実際の tenant 一致検証は各ハンドラ側で行う
	// (ROUTE_RULES はロール検査のみで path 内の tenantId を知らないため)。
	{ pattern: '/tenants', roles: ['owner', 'parent', 'child'], unauthRedirect: '/auth/login' },
	{ pattern: '/uploads', roles: ['owner', 'parent', 'child'], unauthRedirect: '/auth/login' },
];

/**
 * Cognito モード用認可チェック
 * ルート × ロール × ライセンス状態を検証する
 */
export function authorizeCognito(
	path: string,
	identity: Identity | null,
	context: AuthContext | null,
): AuthResult {
	// 公開ルート（認証不要）
	if (isPublicRoute(path)) {
		// 認証済みで /auth/login にアクセスしたら適切な画面へ
		if (path.startsWith('/auth/login') && identity && context) {
			const redirect = context.role === 'child' ? '/switch' : '/admin';
			return { allowed: false, redirect };
		}
		return { allowed: true };
	}

	// 認証チェック
	if (!identity) {
		const rule = findMatchingRule(path);
		return { allowed: false, redirect: rule?.unauthRedirect ?? '/auth/login', status: 401 };
	}

	// Context がない場合（テナント未所属 = membership 未確定）
	if (!context) {
		// オンボーディング系ルートは Context なしでもアクセス可能
		if (path.startsWith('/onboarding') || path.startsWith('/auth')) {
			return { allowed: true };
		}
		// #4636: ログイン済みなのに所属が無い状態で /auth/login に送ると、ログイン →
		// /admin → /auth/login の往復になり出口が無い。理由と次アクション (招待の再試行 /
		// 新しく家族グループを作る) を持つ `/auth/join` に着地させる。
		return { allowed: false, redirect: '/auth/join' };
	}

	// ライセンス状態チェック
	const licenseResult = checkLicenseAccess(path, context);
	if (!licenseResult.allowed) return licenseResult;

	// ルール検索
	const rule = findMatchingRule(path);
	if (!rule) return { allowed: true };

	// ロールチェック
	if (rule.roles.length > 0 && !rule.roles.includes(context.role)) {
		return {
			allowed: false,
			redirect: rule.forbiddenRedirect ?? '/switch',
			status: 403,
		};
	}

	return { allowed: true };
}

function findMatchingRule(path: string): RouteRule | undefined {
	return ROUTE_RULES.find((rule) => path.startsWith(rule.pattern));
}

function isPublicRoute(path: string): boolean {
	return (
		path === '/' ||
		// #832: SEO エンドポイントはプリレンダ対象。未認証でもクローラ・ビルドがアクセスできるよう公開する。
		// local モードの hooks.server.ts と同様の除外（cognito モードにも適用が必要）。
		path === '/sitemap.xml' ||
		path === '/robots.txt' ||
		path.startsWith('/auth') ||
		path.startsWith('/pricing') ||
		path.startsWith('/setup') ||
		path.startsWith('/_app') ||
		path.startsWith('/favicon') ||
		path.startsWith('/api/health') ||
		// #3657: LWA readiness の shallow probe。認証なしで 200 を返せる必要がある
		path.startsWith('/api/ready') ||
		path.startsWith('/api/stripe/webhook') ||
		// #4206: cron dispatcher (EventBridge → Lambda → Function URL への HTTP POST) は
		// Cognito セッションを持たないため、ここに無いと identity === null で 401 になり
		// **route の handler に到達する前に**全滅する (本番 AWS で 1 ヶ月継続、成功率 0.8%)。
		// /api/stripe/webhook と同じ「セッションを持たない外部呼び出し」で、認証は各 route の
		// verifyCronAuth (CRON_SECRET / OPS_SECRET_KEY) が担う。
		// **この行は「認証不要」ではなく「認証の担い手が route 側にある」の意**であり、
		// 全 cron route が verifyCronAuth を呼ぶことは
		// tests/unit/architecture/cron-route-auth-fitness.test.ts が FS 列挙で機械強制する
		// (1 本でも呼び忘れれば無認証で外部公開になるため、その guard が唯一の防波堤)。
		// 境界は `/api/cron/` に限定する — 素朴な startsWith('/api/cron') は
		// `/api/cronjobs` のような別 route まで巻き込んで公開してしまう。
		path === '/api/cron' ||
		path.startsWith('/api/cron/') ||
		path.startsWith('/legal') ||
		path.startsWith('/demo') ||
		path.startsWith('/marketplace') ||
		// #4309: `/api/cron/` と同じく「認証不要」ではなく **「認証の担い手が route 側にある」** の意。
		// 本認可層は ops group を表現できない — `RouteRule.roles` が持つのは
		// owner / parent / child の 3 値だけで、Cognito group は語彙に無い。
		// ここから外すと `/ops` は「認証済みの任意のテナントメンバーなら通る」+ ライセンス状態
		// (期限切れ → /admin/subscription へリダイレクト) に縛られ、運営者が締め出される一方で
		// 顧客が入れてしまう。したがって判定は route 側の `requireOpsAccess`
		// (ops-authz.ts、ops group 所属 / fail-closed) に集約し、本行はそこへ委譲する宣言である。
		// **page (`+layout.server.ts`) と API (`+server.ts`) の両方が呼ぶ必要がある** —
		// layout の gate は `+server.ts` に走らず、それが #4309 の実害 (未認証で売上台帳 CSV 200)。
		// 適用範囲は tests/unit/architecture/ops-route-auth-fitness.test.ts が FS 列挙で機械強制する。
		// 境界は `/ops` 完全一致と `/ops/` に限定する — 素朴な startsWith('/ops') は
		// `/opsedit` のような別 route まで巻き込んで公開してしまう (cron の #4206 と同型)。
		path === '/ops' ||
		path.startsWith('/ops/') ||
		path.startsWith('/view')
	);
}

function checkLicenseAccess(path: string, context: AuthContext): AuthResult {
	const { licenseStatus } = context;

	if (licenseStatus === AUTH_LICENSE_STATUS.ACTIVE || licenseStatus === AUTH_LICENSE_STATUS.NONE) {
		return { allowed: true };
	}

	if (licenseStatus === AUTH_LICENSE_STATUS.EXPIRED) {
		// サブスクリプション管理・決済ページは期限切れでもアクセス可能（更新促進）
		// #2818: /admin/license → /admin/subscription rename + /api/v1/admin/license 物理削除
		if (
			path.startsWith('/admin/subscription') ||
			path.startsWith('/api/stripe') ||
			path.startsWith('/pricing')
		) {
			return { allowed: true };
		}
		return { allowed: false, redirect: '/admin/subscription?reason=expired' };
	}

	if (licenseStatus === AUTH_LICENSE_STATUS.SUSPENDED) {
		// #3993: 旧コメントは「suspended = 読み取り専用。POST/PUT/DELETE は API レイヤで制御」
		// と書いていたが、**その制御は存在しなかった**。読み手の全分岐が `allowed: true` を返し、
		// API レイヤにも suspended を見て書き込みを拒む経路は無い。
		//
		// PO 判断 (#3993): `suspended` は「解約完了 = 無料プラン相当」であり読み取り専用にしない
		// (`phase1-cancellation-requirements.md` FR-3「解約は無料プランに移行 (データ保持)」)。
		// 退会 (アカウント削除) とは別動線であり、そちらの読み取り専用ロックは
		// `hooks.server.ts` が `soft_deleted_at` で判定する。
		//
		// したがって**実装は正しく、コメントが誤っていた**。無料プラン相当として書き込みを許可し、
		// 上限は free tier の plan limit が担う。
		return { allowed: true };
	}

	return { allowed: true };
}
