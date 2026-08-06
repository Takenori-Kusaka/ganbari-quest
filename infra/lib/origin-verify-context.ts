// infra/lib/origin-verify-context.ts
// #4280 案 b — CloudFront → origin shared secret の **単一 fail-fast 点**
//
// CloudFront を作る配備で「secret 未指定のまま synth が通る」= header 無しの distribution が
// できあがり、アプリ側の検査 (fail-open) も同時に無効になる = **黙って無防備**になる。
// これは #4266 で実際に刺された形 (未登録 secret が空文字に展開され、防御コードごと消えた)
// と同一クラスなので、同じ形を作らない (ADR-0024 ENV silent skip 禁止)。
//
// 置き場所を `infra/bin/app.ts` の 1 箇所に絞る理由:
//   - どの `cdk` 実行 (synth / diff / deploy、stack を絞った実行も含む) も app.ts を必ず通る
//   - stack constructor 側で throw すると、NetworkStack を直接 synth する既存 unit test 群
//     (11 file) が本質と無関係に壊れ、テストが「context を足すだけ」の作業に劣化する

/**
 * CDK context key。deploy workflow が `-c originVerifySecret=...` で渡す。
 *
 * **命名が camelCase なのは意図的**: これは env 変数名ではなく CDK context の key 名であり、
 * 値 (`'originVerifySecret'`) と表記を揃える。SCREAMING_SNAKE で書くと env 変数と誤読され、
 * 「配布経路 4 つを用意すべき env」に見えてしまう (実際 `check-new-required-env.mjs` が
 * env 命名と同型として誤検出した)。この定数はプロセスの環境変数として読まれることはない。
 * 配布が要る env 変数は別物の `ORIGIN_VERIFY_SECRET` (`.env.example` / `infra/CLAUDE.md`)。
 */
export const originVerifyContextKey = 'originVerifySecret';

/**
 * ローテーション中だけ渡す **1 世代前** の secret の CDK context key (#4364)。
 *
 * `originVerifyContextKey` と違い **optional**。定常状態では未指定が正しく、
 * 未指定なら Lambda env `ORIGIN_VERIFY_SECRET_PREVIOUS` は注入されない (= 新値のみ受理)。
 * CloudFront には渡さない (CloudFront が送るのは常に現行値 1 本だけ)。
 */
export const originVerifyPreviousContextKey = 'originVerifySecretPrevious';

/**
 * 実運用で使える最小長。`src/lib/runtime/env.ts` の `ORIGIN_VERIFY_SECRET`
 * (`z.string().min(32)`) と同値。ここを緩めるとアプリ側 boot が落ちるだけなので揃える。
 */
export const ORIGIN_VERIFY_MIN_LENGTH = 32;

/** context を引くための最小 interface (`cdk.App` の node を受ける。テスト容易性のため型を絞る)。 */
export interface ContextReader {
	tryGetContext(key: string): unknown;
}

/**
 * CDK context から shared secret を解決する。未指定 / 短すぎる場合は throw して
 * synth を止める (deploy には一切進ませない)。
 *
 * @throws 未設定・空文字・32 文字未満のとき
 */
export function resolveOriginVerifySecret(node: ContextReader): string {
	const raw = node.tryGetContext(originVerifyContextKey);
	const secret = typeof raw === 'string' ? raw.trim() : '';

	if (!secret) {
		throw new Error(
			`[origin-verify] CDK context \`${originVerifyContextKey}\` が未設定です (#4280)。\n` +
				'CloudFront → origin の shared secret header がないと、Lambda Function URL 直叩きで\n' +
				'/admin ・ /api/v1/admin ・ /ops に到達でき、CloudFront 層の制御 (geoRestriction 等) を\n' +
				'迂回できます。空文字で素通しすると防御が黙って消えるため synth を止めます (ADR-0024)。\n' +
				'\n' +
				'対処:\n' +
				'  1. GitHub Secret を登録する:\n' +
				'     gh secret set ORIGIN_VERIFY_SECRET --body "$(node -e \'console.log(require("crypto").randomBytes(32).toString("hex"))\')" \\\n' +
				'       --repo Takenori-Kusaka/ganbari-quest\n' +
				`  2. cdk 実行に \`-c ${originVerifyContextKey}=\${{ secrets.ORIGIN_VERIFY_SECRET }}\` を渡す\n` +
				'  3. ローカル synth / cfn-lint はダミー値でよい (scripts/check-cdk-cfn-lint.mjs 参照)',
		);
	}

	if (secret.length < ORIGIN_VERIFY_MIN_LENGTH) {
		throw new Error(
			`[origin-verify] CDK context \`${originVerifyContextKey}\` が短すぎます ` +
				`(${secret.length} 文字、最低 ${ORIGIN_VERIFY_MIN_LENGTH} 文字、#4280)。` +
				'アプリ側 env schema (ORIGIN_VERIFY_SECRET) も同じ下限を要求するため、' +
				'短い値を通すと Lambda が起動時に落ちます。32 byte hex (64 文字) を推奨します。',
		);
	}

	return secret;
}

/**
 * ローテーション中の **1 世代前** の secret を CDK context から解決する (#4364)。
 *
 * 未指定 / 空文字は正常 (= 定常状態、新値のみ受理) なので `undefined` を返す。
 * **指定されているのに短すぎる場合だけ throw する**: そのまま捨てると
 * 「旧値を渡したつもりなのに受理されず、ローテーション中に /admin が 404」という
 * 黙った失敗になる (ADR-0024 silent skip 禁止)。
 *
 * @throws 指定されているが 32 文字未満のとき
 */
export function resolveOriginVerifyPreviousSecret(node: ContextReader): string | undefined {
	const raw = node.tryGetContext(originVerifyPreviousContextKey);
	const secret = typeof raw === 'string' ? raw.trim() : '';

	if (!secret) return undefined;

	if (secret.length < ORIGIN_VERIFY_MIN_LENGTH) {
		throw new Error(
			`[origin-verify] CDK context \`${originVerifyPreviousContextKey}\` が短すぎます ` +
				`(${secret.length} 文字、最低 ${ORIGIN_VERIFY_MIN_LENGTH} 文字、#4364)。\n` +
				'これはローテーション中に旧 header を受理するための 1 世代前の値です。黙って捨てると\n' +
				'CloudFront がまだ旧値を送っている間 /admin ・ /api/v1/admin ・ /ops が 404 になります。\n' +
				'\n' +
				'対処: 旧値をそのまま渡す (加工しない)。ローテーションが完了したなら\n' +
				`GitHub Secret \`ORIGIN_VERIFY_SECRET_PREVIOUS\` を空にして本 context を外す\n` +
				'(手順: docs/runbooks/origin-verify-secret-rotation.md)',
		);
	}

	return secret;
}
