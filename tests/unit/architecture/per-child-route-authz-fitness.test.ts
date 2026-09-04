// tests/unit/architecture/per-child-route-authz-fitness.test.ts
//
// 「`/api/v1/**` の route が要求から childId を受け取るなら、その childId が要求者のものであることを
// 検証している」ことを機械強制する fitness function。
//
// 背景:
//   `ROUTE_RULES` (`src/lib/server/auth/authorization.ts`) は `/api/v1` を
//   `['owner','parent','child']` に開いている。これは正しい — 子供は自分のポイント・メッセージ・
//   記録を読み書きするからで、ここを閉じると子供画面が全部死ぬ。したがって
//   **「その childId が要求者のものか」を見るのは route 側の責務**であり、その唯一の seam が
//   `requireChildAccess` / `requireChildScope` (`src/lib/server/auth/guards.ts`) である。
//
//   ところがこの guard は **本番コードから 1 度も呼ばれていなかった** (単体テストだけが呼んでいた)。
//   結果、child セッションは URL / body / query / cookie の childId を差し替えるだけで
//   兄弟の私信・ポイント・週次評価を読み、ボイスを消し、顔写真を差し替え、ログインボーナスを
//   先取りできた (家庭内 IDOR / CWE-639)。`docs/design/14-セキュリティ設計書.md` はこの class を
//   自ら名指ししているが、実際に塞がれていたのは export endpoint だけで、それを見る fitness
//   (`tests/unit/routes/export-authz-symmetry-3246.test.ts`) も `export/` prefix に閉じていた。
//
//   本 test はその適用範囲を `/api/v1/**` 全体に広げた対の装置である
//   (`ops-route-auth-fitness` #4309 / `cron-route-auth-fitness` #4206 と**同じ狙い**の装置だが、
//   母数の取り方は同一ではない: cron/ops は「配下の全 route が guard を呼ぶ」で除外リストを持たない。
//   `/api/v1` は per-child でない route を大量に含むためそれは成立せず、
//   **[P2]-[P6] は「childId を綴る route」を候補にする file 単位の検査、[P7]-[P9] は read / mutation を
//   問わず全 handler を母数にする handler 単位の検査** という 2 段構えにしている。
//   cron 型の「guard の戻り値を使っている」検査は [P9] が対応する)。
//
// 検証範囲:
//   [P1] 母数 — 実 FS 上の `src/routes/api/v1/**/+server.ts` を列挙する (literal 固定禁止)。
//        新しい per-child API を足した人が本 test を書き換えなくても自動で検査対象に入る。
//   [P2] 候補判定 — コメント / 文字列を潰したコードに「要求由来の childId」が現れる route を候補とする。
//        コメントだけで候補から外れたり、コメントに書いた guard 名で緑になったりしないよう
//        `stripCommentsAndStrings` を通す (#4206 の実測教訓)。
//   [P3] 候補は guard を **import し、かつ呼んで** いること (import だけの素通しを検出する)。
//   [P4] no-silent-gap — 候補なのに guard を呼ばない route は、理由と根拠 (basis) 付きで
//        `PER_CHILD_GUARD_EXEMPTIONS` に宣言されていなければ fail。
//   [P5] 除外宣言は **機械で反証可能** であること。basis ごとに「その主張が今も成り立つか」を
//        実コードに当てて検証する (宣言しただけで通る自由 pass を作らない)。
//   [P6] stale 宣言の除去 — 実在しない / もう候補でない / 既に guard を呼んでいる route が
//        除外に残っていたら fail。
//   [P7] handler 母数 — `/api/v1/**` (admin 除く) の **全 handler (read / mutation とも)** が guard に
//        到達すること。[P2] の候補判定は「childId と綴るか」なので、**行 id しか受け取らない**
//        per-child route (`DELETE /activity-logs/[id]` / `PATCH /usage`) を原理的に拾えない。
//        母数を handler 単位の全数にすることでその穴を塞ぐ (同時に「多メソッド route で片側だけ守る」
//        も検出される)。handler 宣言は `export const GET` と `export (async) function GET(` の
//        **両形式**を見る — 片方しか見ないと書き方を変えるだけで母数から落ちる。
//   [P8] handler の除外宣言も機械で反証 / stale 検出する。特に `family-row` は「同じ file の別
//        **mutation** handler が guard を通していないこと」まで要求する (片側だけ守る形を宣言で
//        握り潰せない)。
//   [P9] `requireChildScope` の **戻り値が service 関数の引数としてそのまま渡されている** こと。
//        この guard は呼ぶこと自体には意味が無く、戻り値を service へ渡して初めて効く。
//        **見ているのは「route が渡したか」までで、渡された service が実際に行の所有者を突合して
//        いるかは見ていない** (それは service の unit test と `id-only-child-scope.test.ts` が担う)。
//
// 候補 0 件は異常 (判定の綴りが変わった等) として fail する。

import * as fs from 'node:fs';
import * as path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { authorizeCognito } from '../../../src/lib/server/auth/authorization';
import { stripCommentsAndStrings } from './helpers/strip-comments-and-strings';

// #4085: 走査 test の区分は scripts/lib/ci/repo-scan-test-registry.mjs が SSOT。
// 本 test の走査は src/routes/api/v1 配下の単一サブツリーで有界 (scope: 'bounded') のため
// 明示 timeout は要求されないが、file 数の増加で unit lane の既定 5s を超えないよう置いておく
// (tests/CLAUDE.md §「repo 走査 test」)。
vi.setConfig({ testTimeout: 60_000 });

/** per-child API の実体ディレクトリ (母数の SSOT。literal 列挙は禁止) */
const API_V1_DIR = 'src/routes/api/v1';

/** per-child scope の単一強制点。ここを変えるときは guards.ts と同時に変える */
const CHILD_GUARDS = ['requireChildAccess', 'requireChildScope'] as const;

/**
 * 除外の根拠。宣言文だけでなく **実コードに当てて検証する** ため enum にしてある。
 *
 * - `admin-prefix`: `/api/v1/admin/**` は `ROUTE_RULES` が owner/parent に限定しており
 *   child ロールは認可層で 403 になる (route 到達前に閉じている)。
 * - `role-gate` : route 自身が `requireRole(locals, [...])` を呼び、許可ロールに child を
 *   含まない (export / import 系)。
 * - `context-only`: 要求から childId を受け取らず、自分の `context.childId` しか読まない。
 */
type ExemptionBasis = 'admin-prefix' | 'role-gate' | 'context-only';

interface Exemption {
	basis: ExemptionBasis;
	reason: string;
}

/**
 * guard を通さないことが正当な route。**理由と根拠を必ず書く**。
 *
 * ここに足すときは「child ロールがこの endpoint に到達しても per-child データに触れないこと」を
 * 説明できること。説明できないなら guard を足す側が正しい。
 */
const PER_CHILD_GUARD_EXEMPTIONS: Record<string, Exemption> = {
	'src/routes/api/v1/admin/cleanup-orphans/+server.ts': {
		basis: 'admin-prefix',
		reason:
			'孤児ファイルの storage key から childId を切り出すだけの運用 API。/api/v1/admin は ROUTE_RULES が owner/parent 限定',
	},
	'src/routes/api/v1/admin/downgrade-archive/+server.ts': {
		basis: 'admin-prefix',
		reason:
			'ダウングレード時に残す子供を親が選ぶ family scope の操作 (childIds 配列)。/api/v1/admin は owner/parent 限定',
	},
	'src/routes/api/v1/admin/invites/+server.ts': {
		basis: 'admin-prefix',
		reason:
			'子供アカウント招待の発行。/api/v1/admin は ROUTE_RULES が owner/parent 限定で child は到達しない',
	},
	'src/routes/api/v1/activities/export/+server.ts': {
		basis: 'role-gate',
		reason: '#3246 で owner/parent 限定済 (export-authz-symmetry-3246 が別途 gate を固定)',
	},
	'src/routes/api/v1/activities/import/+server.ts': {
		basis: 'role-gate',
		reason: '取込は親の操作。requireRole(owner/parent) 済',
	},
	'src/routes/api/v1/special-rewards/export/+server.ts': {
		basis: 'role-gate',
		reason: '#3246 で owner/parent 限定済 (家庭内 IDOR を role gate 側で塞いだ最初の 3 本)',
	},
	'src/routes/api/v1/export/+server.ts': {
		basis: 'role-gate',
		reason:
			'家族全体のバックアップ (childIds は対象children の絞り込み)。#3246 で owner/parent 限定済',
	},
	'src/routes/api/v1/import/cloud/+server.ts': {
		basis: 'role-gate',
		reason: 'クラウドバックアップの復元は親の操作。requireRole(owner/parent) 済',
	},
	'src/routes/api/v1/notifications/subscribe/+server.ts': {
		basis: 'context-only',
		reason: '要求から childId を受け取らず、購読ログに自分の context.childId を書くだけ',
	},
};

interface ApiEndpoint {
	/** repo root からの相対パス (POSIX 区切り) */
	file: string;
	/** コメント / 文字列リテラルを除去した実コード (guard の**呼び出し**検査用) */
	code: string;
	/**
	 * コメントだけを除去したソース (childId を**読んでいるか**の検査用)。
	 *
	 * 文字列リテラルまで潰すと `url.searchParams.get('childId')` が
	 * `url.searchParams.get( )` になり、受け側の変数名が `childIdRaw` のような綴りだと
	 * 候補から漏れる (実測: `activities/export` が候補にならなかった)。
	 * 読み取りの検出は「取りこぼすより広く取る」側に倒し、余分に拾ったものは
	 * 理由付きの除外宣言で落とす。
	 */
	detectSource: string;
	/** 元のソース (import 検査用) */
	source: string;
}

/** コメントだけを空白に潰す (文字列リテラルは残す)。 */
function stripCommentsOnly(source: string): string {
	return source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
}

/** `/api/v1` 配下の `+server.ts` を再帰的に集める (母数は公開範囲と一致させる)。 */
function collectApiEndpoints(dir: string, acc: ApiEndpoint[] = []): ApiEndpoint[] {
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			collectApiEndpoints(full, acc);
		} else if (entry.name === '+server.ts') {
			const source = fs.readFileSync(full, 'utf8');
			acc.push({
				file: full.split(path.sep).join('/'),
				code: stripCommentsAndStrings(source),
				detectSource: stripCommentsOnly(source),
				source,
			});
		}
	}
	return acc;
}

/**
 * 「要求由来の childId」に触れているか。
 *
 * `context.childId` (= 自分自身。要求が指定したものではない) だけを除いて、それ以外の
 * `childId` / `childIds` / `rawChildId` 等の綴りを **大小文字を無視して** 拾う。
 * 綴りの揺れで検査対象から漏れるより、拾いすぎて宣言を要求する側に倒している。
 */
function readsRequestChildId(detectSource: string): boolean {
	return /child_?id/i.test(detectSource.replace(/context\.childId\b/g, ' '));
}

/** guard を import し、かつ呼んでいるか (import だけの素通しを弾く)。 */
function callsChildGuard(endpoint: ApiEndpoint): boolean {
	return CHILD_GUARDS.some((guard) => {
		const imported = new RegExp(`import[\\s\\S]*?\\b${guard}\\b[\\s\\S]*?from`).test(
			endpoint.source,
		);
		const called = new RegExp(`\\b${guard}\\s*\\(`).test(endpoint.code);
		return imported && called;
	});
}

// ============================================================
// [P7]-[P9] mutation handler 単位の検査 (adversarial review M1 / M2、#4851)
//
// file 単位・「childId と綴られた route」母数の [P2]-[P6] では、以下 2 つが原理的に見えない:
//   M1: 多メソッド route で **片側だけ** guard する (実測: usage POST は塞いだが PATCH は無防備)
//   M2: **行 id しか受け取らない** per-child mutation (ソースに childId と綴られないので候補外)
//       / `requireChildScope` の **戻り値を捨てる** 書き方 (呼び出しの存在しか見ていない)
// ============================================================

/**
 * handler として扱う HTTP メソッド。
 *
 * **read (GET/HEAD) も母数に含める** (adversarial review should)。[P2]-[P6] の候補判定は
 * 「ソースに childId と綴るか」なので、`GET /<per-child-row>/[id]` のように **行 id だけで
 * per-child データを返す read** を拾えない。mutation だけを handler 単位で見ていると
 * 同じ穴が read 側に残るため、母数を全 handler に揃える。
 */
const HTTP_METHODS = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'] as const as string[];

/** 書き換えを行う HTTP メソッド ([P8] の `family-row` 兄弟判定に使う)。 */
const MUTATION_METHODS = ['POST', 'PUT', 'PATCH', 'DELETE'] as const as string[];

interface MutationHandler {
	/** repo root からの相対パス */
	file: string;
	/** HTTP メソッド */
	method: string;
	/** `<file>#<METHOD>` (宣言 key) */
	key: string;
	/** handler 本体のコード (コメント / 文字列は除去済) */
	body: string;
	/** 属する endpoint */
	endpoint: ApiEndpoint;
}

/**
 * mutation handler の除外根拠。
 *
 * - `role-gate`      : `requireRole(locals,[...])` に child を含まない
 * - `inline-role-gate`: route 内で直接 role を見て 403 を返す (`requireRole` seam 未移行の既存実装)
 * - `family-row`     : 扱う行が family 共通で child に属さない
 */
type MutationExemptionBasis = 'role-gate' | 'inline-role-gate' | 'family-row';

interface MutationExemption {
	basis: MutationExemptionBasis;
	reason: string;
}

/**
 * guard を通さないことが正当な mutation handler。key は `<file>#<METHOD>`。
 *
 * **`family-row` は「同じ file の他の handler が child guard を通していない」ことを機械検証する。**
 * 兄弟 handler が guard 済 = その file が扱う資源は per-child なので、`family-row` の主張は嘘になる
 * (これが M1「片側だけ守る」を宣言で握り潰せなくしている条件)。
 */
const MUTATION_GUARD_EXEMPTIONS: Record<string, MutationExemption> = {
	// --- 家族共通リソース (child に属する行を触らない) ---
	'src/routes/api/v1/activities/+server.ts#POST': {
		basis: 'family-row',
		reason:
			'活動マスタの新規作成。family 共通で child に属する行ではない (role 検査の欠落は別所見)',
	},
	'src/routes/api/v1/activities/[id]/+server.ts#PATCH': {
		basis: 'family-row',
		reason: '活動マスタの更新。family 共通で child に属する行ではない (role 検査の欠落は別所見)',
	},
	'src/routes/api/v1/activities/[id]/+server.ts#DELETE': {
		basis: 'family-row',
		reason:
			'活動マスタの非表示化。family 共通で child に属する行ではない (role 検査の欠落は別所見)',
	},
	'src/routes/api/v1/activities/[id]/visibility/+server.ts#PATCH': {
		basis: 'family-row',
		reason:
			'活動マスタの表示切替。family 共通で child に属する行ではない (role 検査の欠落は別所見)',
	},
	'src/routes/api/v1/activities/suggest/+server.ts#POST': {
		basis: 'family-row',
		reason: 'AI 提案の生成のみ。永続化せず child に属する行を触らない',
	},
	'src/routes/api/v1/checklists/suggest/+server.ts#POST': {
		basis: 'family-row',
		reason: 'AI 提案の生成のみ。永続化せず child に属する行を触らない',
	},
	'src/routes/api/v1/cheer/suggest/+server.ts#POST': {
		basis: 'family-row',
		reason: 'AI 提案の生成のみ。永続化せず child に属する行を触らない',
	},
	'src/routes/api/v1/special-rewards/suggest/+server.ts#POST': {
		basis: 'family-row',
		reason: 'AI 提案の生成のみ。永続化せず child に属する行を触らない',
	},
	'src/routes/api/v1/special-rewards/templates/+server.ts#PUT': {
		basis: 'family-row',
		reason: 'ごほうびテンプレート (family 共通の雛形) の更新。child に属する行ではない',
	},
	'src/routes/api/v1/points/ocr-receipt/+server.ts#POST': {
		basis: 'family-row',
		reason: '領収書 OCR の実行のみ。永続化せず child に属する行を触らない',
	},
	'src/routes/api/v1/settings/decay/+server.ts#PUT': {
		basis: 'family-row',
		reason: '家族設定 (ポイント減衰) の更新。child に属する行ではない',
	},
	'src/routes/api/v1/settings/tutorial/+server.ts#POST': {
		basis: 'family-row',
		reason: '家族設定 (チュートリアル進捗) の更新。child に属する行ではない',
	},
	'src/routes/api/v1/settings/pin-gate-onboarding/+server.ts#POST': {
		basis: 'family-row',
		reason: '家族設定 (親ゲート初回案内) の更新。child に属する行ではない',
	},
	'src/routes/api/v1/notifications/subscribe/+server.ts#POST': {
		basis: 'family-row',
		reason: 'push 購読の登録。行は購読者 (自分) に紐づき、要求から child を指定できない',
	},
	'src/routes/api/v1/notifications/unsubscribe/+server.ts#POST': {
		basis: 'family-row',
		reason: 'push 購読の解除。行は購読者 (自分) に紐づき、要求から child を指定できない',
	},
	'src/routes/api/v1/feedback/+server.ts#POST': {
		basis: 'family-row',
		reason: 'フィードバック送信。child に属する行を触らない',
	},
	'src/routes/api/v1/inquiry/founder/+server.ts#POST': {
		basis: 'family-row',
		reason: '問い合わせ送信。child に属する行を触らない',
	},
	'src/routes/api/v1/auth/login/+server.ts#POST': {
		basis: 'family-row',
		reason: '認証。child に属する行を触らない (認可の前段)',
	},
	'src/routes/api/v1/auth/logout/+server.ts#POST': {
		basis: 'family-row',
		reason: '認証解除。child に属する行を触らない',
	},
	'src/routes/api/v1/parent-gate/setup/+server.ts#POST': {
		basis: 'family-row',
		reason: '親ゲート PIN の初回設定。family 単位で child に属する行ではない',
	},
	'src/routes/api/v1/parent-gate/verify/+server.ts#POST': {
		basis: 'family-row',
		reason: '親ゲート PIN の検証。family 単位で child に属する行ではない',
	},
	'src/routes/api/v1/parent-gate/logout/+server.ts#POST': {
		basis: 'family-row',
		reason: '親ゲート session の破棄。family 単位で child に属する行ではない',
	},
	'src/routes/api/v1/parent-gate/reset-verified/+server.ts#POST': {
		basis: 'family-row',
		reason: '親ゲート PIN の再設定。family 単位で child に属する行ではない',
	},
	'src/routes/api/v1/parent-gate/reset-request-code/+server.ts#POST': {
		basis: 'family-row',
		reason: '親ゲート PIN 再設定コードの発行。family 単位で child に属する行ではない',
	},
	// --- read handler (adversarial review should: read も同じ母数で見る) ---
	'src/routes/api/v1/activities/[id]/+server.ts#GET': {
		basis: 'family-row',
		reason: '活動マスタ 1 件の取得。family 共通で child に属する行ではない',
	},
	'src/routes/api/v1/settings/decay/+server.ts#GET': {
		basis: 'family-row',
		reason: '家族設定 (ポイント減衰) の取得。child に属する行ではない',
	},
	'src/routes/api/v1/settings/vapid-key/+server.ts#GET': {
		basis: 'family-row',
		reason: 'push 公開鍵の取得。テナント固有ですらなく child に属する行ではない',
	},
	'src/routes/api/v1/special-rewards/templates/+server.ts#GET': {
		basis: 'family-row',
		reason: 'ごほうびテンプレート (family 共通の雛形) の取得。child に属する行ではない',
	},
	'src/routes/api/v1/images/+server.ts#GET': {
		basis: 'family-row',
		reason: 'テナントの favicon パス取得。child に属する行ではない (#4397 で生成経路は撤去済)',
	},
	'src/routes/api/v1/data/summary/+server.ts#GET': {
		basis: 'role-gate',
		reason: '全データ件数サマリー。requireRole(owner/parent) 済',
	},
	'src/routes/api/v1/export/+server.ts#GET': {
		basis: 'role-gate',
		reason: '家族全体のバックアップ取得。#3246 で owner/parent 限定済',
	},
	'src/routes/api/v1/export/cloud/+server.ts#GET': {
		basis: 'role-gate',
		reason: 'クラウド共有 export の一覧取得は親の操作。requireRole(owner/parent) 済',
	},
	'src/routes/api/v1/export/cloud/[id]/download/+server.ts#GET': {
		basis: 'role-gate',
		reason: 'クラウド共有 export のダウンロードは親の操作。requireRole(owner/parent) 済',
	},
	'src/routes/api/v1/activities/export/+server.ts#GET': {
		basis: 'role-gate',
		reason: '#3246 で owner/parent 限定済 (export-authz-symmetry-3246 が別途 gate を固定)',
	},
	'src/routes/api/v1/checklists/export/+server.ts#GET': {
		basis: 'role-gate',
		reason: '#3246 で owner/parent 限定済 (export-authz-symmetry-3246 が別途 gate を固定)',
	},
	'src/routes/api/v1/special-rewards/export/+server.ts#GET': {
		basis: 'role-gate',
		reason: '#3246 で owner/parent 限定済 (家庭内 IDOR を role gate 側で塞いだ最初の 3 本)',
	},
	'src/routes/api/v1/reward-redemption-requests/+server.ts#GET': {
		basis: 'inline-role-gate',
		reason: '交換申請の一覧取得。route 内で owner/parent 以外を 403 にしている (#1337)',
	},
	// --- role gate 済 ---
	'src/routes/api/v1/activities/import/+server.ts#POST': {
		basis: 'role-gate',
		reason: '取込は親の操作。requireRole(owner/parent) 済',
	},
	'src/routes/api/v1/import/+server.ts#POST': {
		basis: 'role-gate',
		reason: 'バックアップ復元は親の操作。requireRole(owner/parent) 済',
	},
	'src/routes/api/v1/import/cloud/+server.ts#POST': {
		basis: 'role-gate',
		reason: 'クラウドバックアップ復元は親の操作。requireRole(owner/parent) 済',
	},
	'src/routes/api/v1/export/cloud/+server.ts#POST': {
		basis: 'role-gate',
		reason: 'クラウド共有 export の発行は親の操作。requireRole(owner/parent) 済',
	},
	'src/routes/api/v1/export/cloud/[id]/+server.ts#DELETE': {
		basis: 'role-gate',
		reason: 'クラウド共有 export の削除は親の操作。requireRole(owner/parent) 済',
	},
	'src/routes/api/v1/data/clear/+server.ts#POST': {
		basis: 'role-gate',
		reason: '全データ削除は owner 限定。requireRole(owner) 済',
	},
	// --- inline role gate (requireRole seam 未移行の既存実装) ---
	'src/routes/api/v1/reward-redemption-requests/[id]/+server.ts#PATCH': {
		basis: 'inline-role-gate',
		reason: '交換申請の承認 / 却下。route 内で owner/parent 以外を 403 にしている (#1337)',
	},
};

/**
 * SvelteKit の handler 宣言を拾う正規表現。
 *
 * **2 つの書き方を両方見る**: `export const GET = …` と `export (async) function GET(…)`。
 * 片方しか見ないと、**書き方を変えるだけで母数から落ちる**（= 装置が黙って効かなくなる）。
 * 現時点で `export function` 形式の route は 0 本だが、この fitness は「次に per-child route を
 * 足す人」を守るための装置なので、綴りの違いで素通りさせない (adversarial review M3)。
 */
const HANDLER_DECL_RE = /export\s+(?:const\s+([A-Z]+)\b|(?:async\s+)?function\s+([A-Z]+)\s*\()/g;

/** 1 つの handler 宣言にマッチしたものから METHOD 名を取り出す。 */
function methodOfMatch(m: RegExpMatchArray): string {
	return (m[1] ?? m[2]) as string;
}

/**
 * `/api/v1/**` の handler を列挙する（read / mutation の両方）。
 *
 * `/api/v1/admin/**` は `ROUTE_RULES` が owner/parent 限定で child が認可層に到達できないため
 * 構造的に対象外 ([P7] の it 内でその前提自体を assert する)。
 */
function collectHandlers(): MutationHandler[] {
	const out: MutationHandler[] = [];
	for (const endpoint of endpoints) {
		if (endpoint.file.startsWith('src/routes/api/v1/admin/')) continue;
		// 全 handler 宣言の位置を取り、次の宣言までを body とする。
		const decls = [...endpoint.code.matchAll(HANDLER_DECL_RE)]
			.map((m) => ({ method: methodOfMatch(m), index: m.index ?? -1 }))
			.filter((d) => d.index >= 0 && HTTP_METHODS.includes(d.method))
			.sort((a, b) => a.index - b.index);
		for (let i = 0; i < decls.length; i += 1) {
			const decl = decls[i] as { method: string; index: number };
			const next = decls[i + 1];
			out.push({
				file: endpoint.file,
				method: decl.method,
				key: `${endpoint.file}#${decl.method}`,
				body: endpoint.code.slice(decl.index, next?.index ?? endpoint.code.length),
				endpoint,
			});
		}
	}
	return out;
}

/**
 * `$lib/server/services/**` から import している名前を集める ([P9] の「渡す先」候補)。
 *
 * route から DB を直接触るのは `route-db-boundary` fitness が禁じているので、行の所有者を
 * 突合できるのは service 層しかない。したがって scope の渡し先も service 関数に限定できる。
 */
function serviceImportNames(source: string): string[] {
	const names: string[] = [];
	for (const m of source.matchAll(
		/import\s*\{([^}]*)\}\s*from\s*['"]\$lib\/server\/services\/[^'"]+['"]/g,
	)) {
		for (const raw of (m[1] ?? '').split(',')) {
			const name = raw
				.trim()
				.split(/\s+as\s+/)
				.pop()
				?.trim();
			if (name && /^[A-Za-z0-9_$]+$/.test(name) && !name.startsWith('type ')) names.push(name);
		}
	}
	return names;
}

/** file 内の local 関数のうち、本体に child guard を含むものの名前。 */
function guardedHelperNames(code: string): string[] {
	const names: string[] = [];
	for (const m of code.matchAll(/(?:async\s+)?function\s+([A-Za-z0-9_$]+)\s*\(/g)) {
		const start = m.index ?? 0;
		// 関数本体の終端は「行頭の `}`」まで (prettier/biome 整形済ソース前提)
		const rest = code.slice(start);
		const endRel = rest.search(/\n\}/);
		const body = endRel === -1 ? rest : rest.slice(0, endRel);
		if (CHILD_GUARDS.some((g) => new RegExp(`\\b${g}\\s*\\(`).test(body))) {
			names.push(m[1] as string);
		}
	}
	return names;
}

/** その handler が child guard に到達するか (自分の body、または guard 済 helper 呼び出し経由)。 */
function handlerReachesGuard(handler: MutationHandler): boolean {
	if (CHILD_GUARDS.some((g) => new RegExp(`\\b${g}\\s*\\(`).test(handler.body))) return true;
	const helpers = guardedHelperNames(handler.endpoint.code);
	return helpers.some((name) => new RegExp(`\\b${name}\\s*\\(`).test(handler.body));
}

/** mutation handler の除外根拠が実コードで今も成り立つか。成り立たなければ違反理由を返す。 */
function checkMutationExemptionBasis(
	handler: MutationHandler,
	basis: MutationExemptionBasis,
	allHandlers: MutationHandler[],
): string | null {
	if (basis === 'role-gate') {
		const m = handler.endpoint.code.match(/requireRole\s*\(\s*locals\s*,\s*\[([^\]]*)\]/);
		if (!m) return 'role-gate を主張しているが requireRole(locals, [...]) が無い';
		return /child/.test(m[1] ?? '') ? 'requireRole の許可ロールに child が含まれている' : null;
	}
	if (basis === 'inline-role-gate') {
		const hasRoleCheck = /\brole\s*!==\s*/.test(handler.body);
		const hasForbidden = /403/.test(handler.body);
		return hasRoleCheck && hasForbidden
			? null
			: 'inline-role-gate を主張しているが route 内の role 判定 + 403 が見つからない';
	}
	// family-row: 同じ file の**別の mutation handler**が child guard を通していたら、その file が
	// 書き換える行は per-child なので `family-row` の主張は嘘になる。「片側だけ守る」(M1 = usage の
	// POST だけ塞いで PATCH を開ける形) を宣言で握り潰せなくするための条件。
	//
	// 比較対象を mutation に限るのは、**read の guard は「行の所有者」ではなく「絞り込み条件」を
	// 見ていることがある**ため (実測: `GET /api/v1/activities?childId=` は年齢での出し分けに使う
	// query を guard しているだけで、`POST /api/v1/activities` が作る行は family 共通)。read まで
	// 含めると、この正当な組み合わせを誤検出して `family-row` が使えなくなる。M1 の形 (mutation 同士)
	// は引き続き検出される。
	const siblingMutationGuarded = allHandlers.some(
		(h) =>
			h.file === handler.file &&
			h.key !== handler.key &&
			MUTATION_METHODS.includes(h.method) &&
			handlerReachesGuard(h),
	);
	return siblingMutationGuarded
		? 'family-row を主張しているが、同じ file の別 mutation handler は child guard を通している (= その資源は per-child)'
		: null;
}

/** 除外の根拠が実コードで今も成り立つかを検証する。成り立たなければ違反理由を返す。 */
function checkExemptionBasis(endpoint: ApiEndpoint, basis: ExemptionBasis): string | null {
	if (basis === 'admin-prefix') {
		return endpoint.file.startsWith('src/routes/api/v1/admin/')
			? null
			: 'admin-prefix を主張しているが /api/v1/admin 配下ではない';
	}
	if (basis === 'role-gate') {
		const m = endpoint.code.match(/requireRole\s*\(\s*locals\s*,\s*\[([^\]]*)\]/);
		if (!m) return 'role-gate を主張しているが requireRole(locals, [...]) が無い';
		return /child/.test(m[1] ?? '') ? 'requireRole の許可ロールに child が含まれている' : null;
	}
	// context-only: `context.childId` と、その値を載せるオブジェクトキー (`childId:`) 以外の
	// 綴りが残っていたら「要求から受け取っている」= 主張が崩れている。
	const rest = endpoint.detectSource
		.replace(/context\.childId\b/g, ' ')
		.replace(/\bchildId\s*:/g, ' ');
	return /child_?id/i.test(rest)
		? 'context-only を主張しているが context 以外から childId を読んでいる'
		: null;
}

const endpoints = collectApiEndpoints(API_V1_DIR);
const candidates = endpoints.filter((e) => readsRequestChildId(e.detectSource));
const mutationHandlers = collectHandlers();

describe('per-child route 認可 fitness (/api/v1/** の家庭内 IDOR ガード)', () => {
	it('[P1] 母数: /api/v1 配下の +server.ts を実 FS から列挙できる', () => {
		expect(endpoints.length).toBeGreaterThan(50);
	});

	it('[P2] 候補: 要求由来の childId を読む route が検出できている', () => {
		// 0 件 = 判定の綴りが変わった等の異常。silent に「全部 OK」で通さない。
		expect(candidates.length).toBeGreaterThan(10);
	});

	it('[P3][P4] 要求由来の childId を読む route は guard を通す (未通過は理由付き宣言が必須)', () => {
		const offenders = candidates
			.filter((e) => !callsChildGuard(e))
			.map((e) => e.file)
			.filter((file) => !(file in PER_CHILD_GUARD_EXEMPTIONS));

		expect(
			offenders,
			`requireChildAccess / requireChildScope を通していない per-child route:\n  ${offenders.join('\n  ')}\n` +
				'child ロールは /api/v1 に到達できるため、childId を差し替えるだけで兄弟のデータに届く。\n' +
				'guard を足すか、PER_CHILD_GUARD_EXEMPTIONS に basis + reason を付けて宣言すること。',
		).toEqual([]);
	});

	it('[P5] 除外宣言は実コードで反証可能 (basis の主張が今も成り立つ)', () => {
		const broken: string[] = [];
		for (const [file, exemption] of Object.entries(PER_CHILD_GUARD_EXEMPTIONS)) {
			const endpoint = endpoints.find((e) => e.file === file);
			if (!endpoint) continue; // [P6] が stale として別途 fail させる

			if (exemption.reason.trim().length < 12) {
				broken.push(`${file}: reason が短すぎる (定型 stub 禁止)`);
			}
			const violation = checkExemptionBasis(endpoint, exemption.basis);
			if (violation) broken.push(`${file}: ${violation}`);
		}
		expect(broken, `除外宣言と実コードの食い違い:\n  ${broken.join('\n  ')}`).toEqual([]);
	});

	// --- [P7]-[P9]: mutation handler 単位 (adversarial review M1 / M2、#4851) ---

	it('[P7] 前提: /api/v1/admin は認可層が child を拒否する (構造的除外の根拠)', () => {
		const childContext = {
			tenantId: 't-1',
			role: 'child',
			licenseStatus: 'active',
		} as unknown as Parameters<typeof authorizeCognito>[2];
		const identity = { type: 'cognito', userId: 'u1' } as unknown as Parameters<
			typeof authorizeCognito
		>[1];
		const result = authorizeCognito('/api/v1/admin/account/export', identity, childContext);
		expect(
			result.allowed,
			'/api/v1/admin が child に開いたら mutation 母数の除外前提が崩れる',
		).toBe(false);
	});

	it('[P7] mutation handler は例外なく child guard を通す (片側だけ守る形を残さない)', () => {
		expect(mutationHandlers.length).toBeGreaterThan(20);

		const offenders = mutationHandlers
			.filter((h) => !handlerReachesGuard(h))
			.map((h) => h.key)
			.filter((key) => !(key in MUTATION_GUARD_EXEMPTIONS));

		expect(
			offenders,
			`child guard を通していない mutation handler:\n  ${offenders.join('\n  ')}\n` +
				'行 id しか受け取らない mutation も対象 (その行が誰のものかは route では分からないため\n' +
				'requireChildScope の戻り値を service まで引き回して突合する)。\n' +
				'guard を足すか、MUTATION_GUARD_EXEMPTIONS に basis + reason を付けて宣言すること。',
		).toEqual([]);
	});

	it('[P8] mutation 除外宣言は実コードで反証可能 / stale でない', () => {
		const broken: string[] = [];
		for (const [key, exemption] of Object.entries(MUTATION_GUARD_EXEMPTIONS)) {
			const handler = mutationHandlers.find((h) => h.key === key);
			if (!handler) {
				broken.push(`${key}: 該当 handler が存在しない (stale 宣言)`);
				continue;
			}
			if (handlerReachesGuard(handler)) {
				broken.push(`${key}: guard を通すようになった (除外を外すこと)`);
				continue;
			}
			if (exemption.reason.trim().length < 12) {
				broken.push(`${key}: reason が短すぎる (定型 stub 禁止)`);
			}
			const violation = checkMutationExemptionBasis(handler, exemption.basis, mutationHandlers);
			if (violation) broken.push(`${key}: ${violation}`);
		}
		expect(broken, `mutation 除外宣言と実コードの食い違い:\n  ${broken.join('\n  ')}`).toEqual([]);
	});

	it('[P9] requireChildScope の戻り値は捨てず、service 関数の引数として渡している', () => {
		const offenders: string[] = [];
		for (const endpoint of endpoints) {
			if (!/\brequireChildScope\s*\(/.test(endpoint.code)) continue;
			const decls = [
				...endpoint.code.matchAll(/const\s+([A-Za-z0-9_$]+)\s*=\s*requireChildScope\s*\(/g),
			];
			if (decls.length === 0) {
				offenders.push(`${endpoint.file}: 戻り値を変数に受けずに呼び出している`);
				continue;
			}
			// `$lib/server/services/**` から import した名前 = 突合を行う側の候補。
			const serviceFns = serviceImportNames(endpoint.source);
			if (serviceFns.length === 0) {
				offenders.push(`${endpoint.file}: service 関数を import していない (渡す先が無い)`);
				continue;
			}
			for (const decl of decls) {
				const name = decl[1] as string;
				const after = endpoint.code.slice((decl.index ?? 0) + decl[0].length);
				// **service 呼び出しの引数位置にそのまま置かれている**ことを要求する。
				// `f(a, b, scope ? null : null)` のような使ったふり (実測 M-d) は直前が `(`/`,`・
				// 直後が `,`/`)` の形にならないので弾かれる。
				const passedToService = serviceFns.some((fn) =>
					new RegExp(`\\b${fn}\\s*\\([^)]*[(,]\\s*${name}\\s*[,)]`).test(after),
				);
				if (!passedToService) {
					offenders.push(
						`${endpoint.file}: ${name} が service 関数 (${serviceFns.join(' / ')}) の引数としてそのまま渡されていない`,
					);
				}
			}
		}
		expect(
			offenders,
			'requireChildScope は「呼ぶ」ことではなく「戻り値を service へ渡す」ことに意味がある。\n' +
				'ただし本検査が見るのは **route が渡したか** までで、渡された service が実際に行の所有者を\n' +
				'突合しているかは見ていない (それは service の unit test が担う):\n  ' +
				offenders.join('\n  '),
		).toEqual([]);
	});

	it('[P6] stale な除外宣言が残っていない', () => {
		const stale: string[] = [];
		for (const file of Object.keys(PER_CHILD_GUARD_EXEMPTIONS)) {
			const endpoint = endpoints.find((e) => e.file === file);
			if (!endpoint) {
				stale.push(`${file}: file が存在しない`);
				continue;
			}
			if (!readsRequestChildId(endpoint.detectSource)) {
				stale.push(`${file}: もう要求由来の childId を読んでいない (除外不要)`);
			}
			if (callsChildGuard(endpoint)) {
				stale.push(`${file}: guard を通すようになった (除外を外すこと)`);
			}
		}
		expect(stale, `不要になった除外宣言:\n  ${stale.join('\n  ')}`).toEqual([]);
	});
});
