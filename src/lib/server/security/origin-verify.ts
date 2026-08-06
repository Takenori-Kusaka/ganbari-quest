// src/lib/server/security/origin-verify.ts
// #4280 案 b — CloudFront → origin の shared secret header 検証 (front door 強制)
//
// ## これは何を守るか
//
// Lambda Function URL は `authType: NONE` で公開されており (infra/lib/compute-stack.ts)、
// URL を知っていれば CloudFront を経由せず直接到達できる。CloudFront 層に置いた制御
// (現状は geoRestriction JP、将来の edge 制御も同様) は、その経路には一切効かない。
//
// 本モジュールは「**この request は正面玄関 (CloudFront) を通ってきたか**」だけを判定する。
// CloudFront が origin custom header (`x-origin-verify: <secret>`) を付与し、origin 側で
// 値の一致を確認する。CloudFront は viewer が同名 header を送ってきても**設定値で上書き**
// するため、外部から header を偽装して通ることはできない。
//
// ## これは認証ではない
//
// 本検査は認証・認可を一切代替しない。保護対象 path は従来どおり Cognito セッション +
// parent-gate PIN (`/admin`) / ops group 所属 (`/ops`) で守られる。本検査が足すのは
// 「edge 層の制御を迂回できない」という 1 点だけである。
//
// ## なぜ「CloudFront を通らない到達を一律に拒否」しないか (重要)
//
// 実経路には、CloudFront を通れない / 通る必要のない正当な呼び出しが存在する。
//
//   - `/api/stripe/webhook` — Stripe の送信元は米国。CloudFront は geoRestriction JP のため
//     経由させられない (実測: 本番 `we_1TGnf6BgMFbHJZ0Z3Djw6rpL` / staging
//     `we_1TcfvFBgMFbHJZ0Z5t5Tt53B` とも Function URL 直で登録済)。この経路は **Stripe 署名検証**
//     という、IP / 経路制限より強い認証を既に持つ
//   - `/api/cron/*` — cron-dispatcher Lambda が Function URL 直で POST する
//     (`FUNCTION_URL` env)。この経路は **CRON_SECRET** (`verifyCronAuth`) で認証済
//   - `/api/health` / `/api/ready` — Lambda Web Adapter の readiness / post-deploy smoke が
//     Function URL 直で叩く。公開情報のみを返す
//
// したがって本検査は **deny list ではなく allow list**（保護する prefix を明示列挙）で構成する。
// 列挙外の path は「front door 必須ではない」= 各自の認証で守る、という宣言である。

// cspell 例外 (本 file 限定、.cspell.json への global 追加はしない):
//   - `Tcfv`: staging Stripe webhook endpoint ID `we_1TcfvFBgMFbHJZ0Z5t5Tt53B` の実値の一部。
//     実在の識別子であり、綴りを変えると実測の証跡でなくなる (tests/CLAUDE.md §負例 fixture と cspell)。
// cspell:ignore Tcfv

import { timingSafeEqual } from 'node:crypto';

/**
 * CloudFront が origin request に付与する共有シークレット header 名。
 * AWS の慣行 (`X-Origin-Verify`) に合わせる。HTTP header 名は case-insensitive で、
 * `Request.headers.get()` は大小を問わず引ける。
 */
export const ORIGIN_VERIFY_HEADER = 'x-origin-verify';

/**
 * front door (CloudFront) 経由を必須とする path prefix。
 *
 * 選定基準 = 「**運営者 / 保護者の管理面**であり、ブラウザからのみ到達し、
 * edge 層の制御 (geoRestriction 等) が防御として意味を持つもの」。
 *
 *   - `/admin`        保護者の見守り画面 (Cognito セッション + parent-gate PIN)
 *   - `/api/v1/admin` 上記画面が呼ぶ管理 API (同上)
 *   - `/ops`          運営専用ダッシュボード。売上 / コホート / コストが出る
 *                     (ops group 所属、src/lib/server/auth/ops-authz.ts)
 *
 * ここに **列挙しない path は本検査の対象外**であり、それぞれが自前の認証を持つ
 * (Stripe 署名 / CRON_SECRET / Cognito セッション / 公開情報)。冒頭コメント参照。
 */
export const FRONT_DOOR_PROTECTED_PREFIXES = ['/admin', '/api/v1/admin', '/ops'] as const;

/**
 * front door 検査の判定結果。
 *
 *   - `allow`          通してよい (保護対象外 / header 一致)
 *   - `deny`           保護対象なのに header が無い or 不一致
 *   - `not-configured` 保護対象だが secret 未設定のため検査できない (下記 fail-open)
 */
export type FrontDoorDecision = 'allow' | 'deny' | 'not-configured';

/**
 * path が front door 必須かを判定する。
 *
 * prefix の**境界**まで見る (`/admin` は `/admin` `/admin/...` に一致し、
 * `/administrator` には一致しない)。prefix 一致を `startsWith` だけで済ませると
 * 別リソースを巻き込む / 逆に漏らす (#3956 教訓: 構造化識別子を緩い一致で判定しない)。
 */
export function isFrontDoorProtectedPath(pathname: string): boolean {
	return FRONT_DOOR_PROTECTED_PREFIXES.some(
		(prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
	);
}

/** 長さ差を漏らさない定数時間比較。長さ不一致は即 false (長さは秘密ではない)。 */
function secretEquals(actual: string, expected: string): boolean {
	const a = Buffer.from(actual, 'utf8');
	const b = Buffer.from(expected, 'utf8');
	if (a.length !== b.length) return false;
	return timingSafeEqual(a, b);
}

/**
 * header 値に一致した secret の **個数** を返す (#4364)。
 *
 * ## なぜ boolean ではなく個数を返すか
 *
 * ローテーション中は新旧 2 値を受理する (下記 `evaluateFrontDoor`)。ここを
 * `equals(current) || equals(previous)` と書くと **短絡評価**になり、
 * 「新値一致 = 比較 1 回 / 旧値一致 = 比較 2 回」という応答時間差が生まれて、
 * 外部から「今どちらの値が現役か」を区別できてしまう (secret 探索の手掛かりになる)。
 *
 * 「一致した個数」を返す契約にすると、実装は **必ず全候補を評価しなければならない** ため
 * 短絡評価が構造的に書けない。この不変条件は
 * `tests/unit/security/origin-verify.test.ts` の「先頭が一致しても後続を評価する」で固定する
 * (同じ値を 2 つ渡して 2 が返ることを要求する = 短絡実装では通らない)。
 *
 * header が無い / 空文字のときだけは早期 return する (値の内容とは無関係な入力形状の判定で、
 * secret の情報を一切含まないため timing 差は問題にならない)。
 */
export function countMatchingSecrets(
	headerValue: string | null,
	accepted: readonly string[],
): number {
	if (!headerValue) return 0;
	let matches = 0;
	for (const secret of accepted) {
		if (secretEquals(headerValue, secret)) matches += 1;
	}
	return matches;
}

/**
 * front door 検査本体 (純関数・I/O なし)。
 *
 * `hooks.server.ts` は全リクエスト経路のため、ここに DB / 外部 I/O を足してはならない。
 *
 * ## 新旧 2 値受理 (#4364、ローテーションを無停止にするための必須要件)
 *
 * secret は **2 つの stack に配られる**: CloudFront の origin custom header (NetworkStack) と
 * Lambda env (ComputeStack)。`cdk deploy --all` は NetworkStack が ComputeStack の
 * Function URL に依存するため **Compute → Network の順**で走る。したがって値を変えると
 * 「Lambda は新値を期待しているのに CloudFront はまだ旧値を送っている」窓が必ず開き
 * (distribution が Deployed になるまで数分)、その間 `/admin` ・ `/api/v1/admin` ・ `/ops` は
 * 全顧客で 404 になる。
 *
 * そこで `previousSecret` (`ORIGIN_VERIFY_SECRET_PREVIOUS`) を**併せて受理**する。
 * AWS の参照実装 (Security Blog の `X-Origin-Verify`) が AWSCURRENT + AWSPENDING を
 * OR 受理して既定 1 日間隔のローテーションでも窓を作らないのと同じ形。
 *
 * ローテーション手順 (3 段。どの段でも窓が開かない) は
 * `docs/runbooks/origin-verify-secret-rotation.md` が SSOT。
 * **旧値を配らないまま `ORIGIN_VERIFY_SECRET` を変えてはならない** (それが上記の窓)。
 *
 * @param pathname       `event.url.pathname`
 * @param headerValue    `request.headers.get(ORIGIN_VERIFY_HEADER)`
 * @param expectedSecret `ORIGIN_VERIFY_SECRET` (未設定なら undefined / 空文字)
 * @param previousSecret `ORIGIN_VERIFY_SECRET_PREVIOUS` (ローテーション中のみ設定。
 *                       未設定なら新値のみで判定する = 定常状態)
 */
export function evaluateFrontDoor(
	pathname: string,
	headerValue: string | null,
	expectedSecret: string | undefined,
	previousSecret?: string | undefined,
): FrontDoorDecision {
	if (!isFrontDoorProtectedPath(pathname)) return 'allow';

	// secret 未設定 = 検査不能。**fail-open** にする (詳細は下記)。
	//
	// なぜ fail-open が安全か:
	//   1. 本検査は認証ではなく「経路の限定」。無効化しても Cognito + PIN / ops group 所属
	//      という主防御は 1 枚も剥がれない。fail-closed にした場合に失われるもの (全顧客の
	//      /admin が 404) の方が、得られるもの (経路限定) より桁違いに大きい
	//   2. **CloudFront が存在しない配備が正当に存在する**。NUC セルフホスト (LAN 内直配信) と
	//      ローカル開発は front door 自体を持たないため、fail-closed にすると起動不能になる
	//   3. AWS 側で「設定漏れによる無防備」が起きないことは**別レイヤで担保済**:
	//      `infra/lib/origin-verify-context.ts` が secret 未指定の CDK synth を throw で止め、
	//      `deploy.yml` の `Validate required secrets` が GitHub Secret 未登録の deploy を止める。
	//      つまり CloudFront を持つ配備で header 無しになる経路は存在しない (ADR-0024)
	//   4. 黙って無効化しない: 呼び出し側 (`hooks.server.ts`) が `not-configured` を
	//      プロセス 1 回だけ log する
	if (!expectedSecret) return 'not-configured';

	// 旧値が未設定 (定常状態) なら候補は新値のみ。ローテーション中だけ 2 候補になる。
	const accepted = previousSecret ? [expectedSecret, previousSecret] : [expectedSecret];
	return countMatchingSecrets(headerValue, accepted) > 0 ? 'allow' : 'deny';
}
