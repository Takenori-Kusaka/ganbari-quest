// src/lib/server/services/cloud-export-service.ts
// クラウドエクスポート共有サービス（PIN付きS3保管 + インポート）

import { randomInt } from 'node:crypto';
import {
	type CloudExportRowState,
	cloudExportDaysUntilAutoDelete,
	cloudRowStateLabel,
	isDisposableCloudExportRow,
	rankCloudExportDeleteCandidates,
	resolveCloudExportRowState,
} from '$lib/domain/cloud-export-quota';
import { MAX_SERVER_MESSAGE_LENGTH } from '$lib/domain/errors';
import type { CategoryId, ChildId } from '$lib/domain/ids';
import {
	FEATURE_LABELS,
	formatJstDate,
	PLAN_GATE_LABELS,
	SETTINGS_LABELS,
} from '$lib/domain/labels';
import { createTimeBudget, type TimeBudget } from '$lib/server/cron/time-budget';
import { getRepos } from '$lib/server/db/factory';
import type { CloudExportRecord, CloudExportType } from '$lib/server/db/types';
import { logger } from '$lib/server/logger';
import { BackupSizeLimitError, buildFullBackupZip } from '$lib/server/services/backup-archive';
import { exportFamilyDataForZip } from '$lib/server/services/export-service';
import {
	getPlanLimits,
	type PlanTier,
	resolveFullPlanTier,
} from '$lib/server/services/plan-limit-service';

// PIN生成用の文字セット（O/0/I/1を除外して誤読防止）
const PIN_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const PIN_LENGTH = 6;
const EXPIRY_DAYS = 7;

/** PIN コードを生成（6桁英数字） */
function generatePin(): string {
	// #1387: Math.random() は暗号論的に非安全で PIN が予測可能になる。
	// 家族データ共有エクスポートを保護する PIN のため crypto.randomInt で
	// 真に一様な乱数を使う。
	let pin = '';
	for (let i = 0; i < PIN_LENGTH; i++) {
		pin += PIN_CHARS[randomInt(0, PIN_CHARS.length)];
	}
	return pin;
}

/** ユニークな PIN を生成（衝突チェック） */
async function generateUniquePin(): Promise<string> {
	const repos = getRepos();
	for (let attempt = 0; attempt < 10; attempt++) {
		const pin = generatePin();
		const existing = await repos.cloudExport.findByPin(pin);
		if (!existing) return pin;
	}
	throw new Error('PIN生成に失敗しました（衝突回避不可）');
}

/** 有効期限を計算（7日後） */
function calculateExpiry(): string {
	const d = new Date();
	d.setDate(d.getDate() + EXPIRY_DAYS);
	return d.toISOString();
}

/**
 * テンプレートエクスポートデータを構築（活動セット + チェックリスト）
 *
 * #2362 PR-3 (ADR-0055) per-child instance 化に伴い、child 別 export shape を採用 (PO 判断 A 案、2026-05-24):
 *   - 旧: tenant-wide 1 集合 `{ activities: [...] }` で出力
 *   - 新: child 別 `{ activitiesByChild: [{ childId, childNickname, activities: [...] }] }` で出力
 * 取込側 (handleTemplateImport) は ChildSelectionDialog 経由で復元先 child を指定する。
 *
 * version 2.0.0 で per-child shape を採用。1.0.0 (旧 family-wide) は本 PR で完全廃止 (0 user)。
 */
/**
 * #3376: クラウド保管するバックアップアーティファクト。
 * template = JSON（data.json、テキスト共有用途）/ full = 画像込み ZIP（backup.zip、完全バックアップ）。
 */
interface CloudExportArtifact {
	bytes: Uint8Array;
	description: string;
	/** S3 オブジェクト名。fetch 側はこの拡張子で zip/json を判別せず、ZIP マジックバイトで判定する。 */
	filename: string;
	contentType: string;
}

async function buildTemplateExportData(tenantId: string): Promise<CloudExportArtifact> {
	const repos = getRepos();
	const children = await repos.child.findAllChildren(tenantId);

	// 子供別 activity 一覧 (per-child instance)
	const activitiesByChild: Array<{
		childId: ChildId;
		childNickname: string;
		activities: Array<{
			name: string;
			categoryId: CategoryId;
			icon: string;
			basePoints: number;
			triggerHint: string | null;
			isMainQuest: number;
			priority: string;
		}>;
	}> = [];
	let totalActivityCount = 0;
	for (const child of children) {
		const acts = await repos.childActivity.findActivitiesByChild(child.id, tenantId);
		activitiesByChild.push({
			childId: child.id,
			childNickname: child.nickname,
			activities: acts.map((a) => ({
				name: a.name,
				categoryId: a.categoryId,
				icon: a.icon,
				basePoints: a.basePoints,
				triggerHint: a.triggerHint,
				isMainQuest: a.isMainQuest,
				priority: a.priority,
			})),
		});
		totalActivityCount += acts.length;
	}

	// チェックリストテンプレート（子供ごとに紐づくテンプレートを収集）
	const checklistTemplates: Array<{
		name: string;
		items: Array<{ name: string; icon: string }>;
	}> = [];
	for (const child of children) {
		const templates = await repos.checklist.findTemplatesByChild(child.id, tenantId);
		for (const tpl of templates) {
			const items = await repos.checklist.findTemplateItems(tpl.id, tenantId);
			checklistTemplates.push({
				name: tpl.name,
				items: items.map((it) => ({ name: it.name, icon: it.icon })),
			});
		}
	}

	const templateData = {
		format: 'ganbari-quest-template' as const,
		version: '2.0.0',
		exportedAt: new Date().toISOString(),
		activitiesByChild,
		checklistTemplates,
	};

	const parts: string[] = [];
	if (totalActivityCount > 0) {
		parts.push(`活動${totalActivityCount}件（${activitiesByChild.length}人分）`);
	}
	if (checklistTemplates.length > 0) parts.push(`チェックリスト${checklistTemplates.length}件`);
	const description = parts.join('、') || 'データなし';

	return {
		bytes: new TextEncoder().encode(JSON.stringify(templateData)),
		description,
		filename: 'data.json',
		contentType: 'application/json',
	};
}

/**
 * フルバックアップを構築（#3376: 画像込み ZIP）。
 * ローカル DL と同一の backup-archive.buildFullBackupZip（data.json + 静的ファイル + manifest）を使い、
 * クラウド完全復元（画像込み）を可能にする。ブラウザ DL を介さないため Safe Browsing 警告も発生しない。
 */
async function buildFullExportData(tenantId: string): Promise<CloudExportArtifact> {
	// #3518-1: checksum 計算に使った直列化文字列を data.json に流用し二重 JSON.stringify を解消する。
	const { exportData, dataJson } = await exportFamilyDataForZip({ tenantId });
	const childCount = exportData.family.children.length;
	const logCount = exportData.data.activityLogs?.length ?? 0;
	const zipBytes = await buildFullBackupZip(tenantId, exportData, false, dataJson);
	const description = `フルバックアップ（子供${childCount}人、ログ${logCount}件、画像同梱）`;
	return {
		bytes: zipBytes,
		description,
		filename: 'backup.zip',
		contentType: 'application/zip',
	};
}

/**
 * クラウドエクスポートが **プラン未達**で使えない (#4710)。
 *
 * 「その tier には機能自体が無い」ことを表す。顧客の次の行動はアップグレード。
 * {@link CloudExportQuotaError} (機能は使えるが枠が埋まっている) とは別事象であり、
 * 呼び出し元が両者を同じ 403 文言に潰さないよう**型で区別できるようにする**。
 *
 * 旧実装は両方とも素の `Error` を throw し、route 側が message にプラン名や「上限」という語が
 * 含まれるかの部分一致で見分けていた。プラン名を変えた瞬間に判定が外れて 403 が 500 になるうえ、
 * 実際には見分けられておらず、契約済みの顧客にもプラン未達と同じ案内を返していた。
 */
export class CloudExportPlanGateError extends Error {
	/** この機能を使える最低 tier。route が案内文の出し分けに使う。 */
	readonly requiredTier = 'standard' as const;
	/** 機能名 (labels SSOT)。route が `planLimitError(requiredTier, feature)` に渡す。 */
	readonly feature = FEATURE_LABELS.cloudExport;
	constructor() {
		// 顧客向け文言は route が planLimitError で 1 本だけ組み立てる (#4767 PO 回答 #4)。
		// ここで別の文字列を持つと 2 チャネルに戻るため、message は機能名 + tier の同じ文にする。
		super(PLAN_GATE_LABELS.requiredTierWithUpgradeFor(FEATURE_LABELS.cloudExport, 'standard'));
		this.name = 'CloudExportPlanGateError';
	}
}

/** 上限到達 403 で名指しする「消す候補」1 件分 (顧客が一覧で見分けられる情報だけ)。 */
export interface CloudExportDeleteCandidate {
	pinCode: string;
	rowState: CloudExportRowState;
	/** UTC ISO (record.createdAt)。 */
	createdAt: string;
}

/** 403 文言に載せる候補の上限 (これ以上並べても読めない)。実際の件数は文字数予算でさらに減りうる。 */
const QUOTA_DELETE_CANDIDATE_LIMIT = 3;

/**
 * 予算 (`MAX_SERVER_MESSAGE_LENGTH`) に収まる **最大件数** の候補で文を組み立てる (#4767 QM)。
 *
 * `sanitizeServerMessage` は 200 字で切って `…` を付けるため、長い文を作ると末尾に置いた
 * 「削除の候補」が途中で切れる — この PR の中心的価値 (どれを消せばいいかの名指し) が落ちる。
 * PIN の長さや状態語の変化で偶然 199 字に収まっていた、という運任せにしないため、
 * **実際に組み立てた文字列を測って**入る件数まで減らす。1 件も入らなければ候補なしの文に落とす
 * (「候補を出すつもりで切れた文」より「候補を出さない完全な文」の方が読める)。
 */
function buildQuotaMessageWithinBudget(
	max: number,
	formatted: readonly string[],
	compose: (max: number, candidates: readonly string[]) => string,
): { message: string; namedCount: number } {
	for (let count = Math.min(formatted.length, QUOTA_DELETE_CANDIDATE_LIMIT); count > 0; count--) {
		const message = compose(max, formatted.slice(0, count));
		if (message.length <= MAX_SERVER_MESSAGE_LENGTH) return { message, namedCount: count };
	}
	return { message: PLAN_GATE_LABELS.cloudExportLimitReached(max), namedCount: 0 };
}

/** 候補 1 件を顧客向けの 1 句に整形する: "ABC123（ダウンロード回数を使い切りました・2026/08/28 作成）"。 */
function formatDeleteCandidate(c: CloudExportDeleteCandidate): string {
	return SETTINGS_LABELS.cloudDeleteCandidate(
		c.pinCode,
		cloudRowStateLabel(c.rowState),
		SETTINGS_LABELS.cloudStoredCreated(formatJstDate(c.createdAt)),
	);
}

/**
 * クラウド保管の **同時保管数上限**に達している (#4710)。
 *
 * free は maxCloudExports=0 で {@link CloudExportPlanGateError} 側に落ちるため、
 * ここに来るのは **契約中の顧客だけ** (standard=3 / family=10)。したがって
 * アップグレード案内は次の行動にならない。取れる行動は古いものを削除すること。
 *
 * #4767 PO 回答 #3: 「どれを消せばいいか」を名指しする。候補は失敗 → DL 使い切り → 作成日が
 * 古い順 (`rankCloudExportDeleteCandidates`) の先頭 {@link QUOTA_DELETE_CANDIDATE_LIMIT} 件。
 * 顧客向け文言は `message` の 1 本 (#4 単一チャネル)。
 */
export class CloudExportQuotaError extends Error {
	/** 現在の保管件数 (ログ用。顧客には出さない)。 */
	readonly current: number;
	/** プランが許す保管件数上限 (ログ用)。 */
	readonly max: number;
	/** 403 文言で名指しした候補 (順序どおり)。 */
	readonly candidates: readonly CloudExportDeleteCandidate[];
	/**
	 * 名指しした候補が **まだ取り出せる共有しか無い** か (#4767 QM must)。
	 * true のとき文言は「削除すると取り出せなくなる (元に戻せない)」ことを明示する。
	 */
	readonly namesLiveShares: boolean;
	constructor(
		current: number,
		max: number,
		candidates: readonly CloudExportDeleteCandidate[] = [],
	) {
		// #4767 QM must: 消しても損の無い行 (作成失敗 / 回数切れ) が 1 つでもあれば **それだけ** を候補に
		// する。1 つも無いときだけ、まだ取り出せる共有を古い順に挙げ、失われることを文言で明示する。
		// 「枠を空けたい顧客」を、まだ必要な共有のワンクリック削除へ誘導しないための出し分け。
		const disposable = candidates.filter((c) => isDisposableCloudExportRow(c.rowState));
		const pool = disposable.length > 0 ? disposable : candidates;
		const liveOnly = disposable.length === 0 && pool.length > 0;
		// 文字数予算 (#4767 QM): 実際に組み立てて測り、200 字に収まる件数まで候補を減らす。
		// 途中で切られた候補を出すより、少なく挙げて全部読める方がよい。
		const { message, namedCount } = buildQuotaMessageWithinBudget(
			max,
			pool.map(formatDeleteCandidate),
			liveOnly
				? PLAN_GATE_LABELS.cloudExportLimitReachedLiveOnly
				: PLAN_GATE_LABELS.cloudExportLimitReachedNaming,
		);
		super(message);
		this.name = 'CloudExportQuotaError';
		this.current = current;
		this.max = max;
		this.candidates = pool.slice(0, namedCount);
		this.namesLiveShares = liveOnly && namedCount > 0;
	}
}

export interface CloudExportOptions {
	tenantId: string;
	exportType: CloudExportType;
	label?: string;
	licenseStatus: string;
	planId?: string;
}

export interface CloudExportResult {
	pinCode: string;
	expiresAt: string;
	exportType: CloudExportType;
	/** 非同期 build (#3504)。起票直後は 0、build 完了 (ready) 後に確定する。 */
	fileSizeBytes: number;
	/** 非同期 build (#3504)。起票直後は null、build 完了 (ready) 後に確定する。 */
	description: string | null;
	/** 非同期 build 状態 (#3504)。起票直後は 'pending'。 */
	status: 'pending' | 'building' | 'ready' | 'failed';
}

/** exportType から S3/FS 上の filename を導出（build 前に s3Key を確定するため）。 */
function artifactFilename(exportType: CloudExportType): string {
	// template = JSON (data.json) / full = 画像込み ZIP (backup.zip、#3376)
	return exportType === 'template' ? 'data.json' : 'backup.zip';
}

/**
 * クラウドエクスポートを **起票** する（#3504 async-backup-export.md §3.2）。
 *
 * 同期 build → レスポンス直返しは AWS (Function URL BUFFERED 6MB / Lambda 30 秒) と NUC
 * (生成中の browser/proxy timeout) の双方で破綻するため、本関数は **ZIP を作らず**
 * `status='pending'` のレコードを insert して即返す。実 build は cron の
 * {@link drainPendingExports} が背景で行う。
 */
export async function createCloudExport(options: CloudExportOptions): Promise<CloudExportResult> {
	const { tenantId, exportType, label, licenseStatus, planId } = options;

	// プラン制限チェック (機能自体が無い tier)
	const tier: PlanTier = await resolveFullPlanTier(tenantId, licenseStatus, planId);
	const limits = getPlanLimits(tier);
	if (limits.maxCloudExports === 0) {
		throw new CloudExportPlanGateError();
	}

	// 保管数上限チェック (機能はあるが枠が埋まっている = 契約中の顧客に起きる)
	// 数えるのは **期限内の全行** (= 保管を占有しているもの、listCloudExports と同じ述語)。
	// DL 回数を使い切った行 / build 失敗行も期限内は S3 に残る (完全 PII の ZIP) ので枠として
	// 数え続け (PO 回答 #3: 天井を残す)、そのかわり一覧に出して削除できるようにし、
	// 上限のエラーでは「どれを消せばいいか」を名指しする。
	const repos = getRepos();
	const occupying = await listQuotaOccupyingCloudExports(tenantId);
	if (occupying.length >= limits.maxCloudExports) {
		const candidates = rankCloudExportDeleteCandidates(occupying).map((e) => ({
			pinCode: e.pinCode,
			rowState: resolveCloudExportRowState(e),
			createdAt: e.createdAt,
		}));
		throw new CloudExportQuotaError(occupying.length, limits.maxCloudExports, candidates);
	}

	// PIN生成 + s3Key を build 前に確定（filename は exportType から決まる）
	const pinCode = await generateUniquePin();
	const s3Key = `exports/${tenantId}/${pinCode}/${artifactFilename(exportType)}`;

	// DB記録（pending。fileSizeBytes / description は build 完了時に確定する）
	const expiresAt = calculateExpiry();
	await repos.cloudExport.insert({
		tenantId,
		exportType,
		pinCode,
		s3Key,
		fileSizeBytes: 0,
		label: label ?? null,
		description: null,
		expiresAt,
		status: 'pending',
	});

	logger.info('[cloud-export] エクスポート起票 (pending)', {
		context: { tenantId, exportType, pinCode },
	});

	return {
		pinCode,
		expiresAt,
		exportType,
		fileSizeBytes: 0,
		description: null,
		status: 'pending',
	};
}

/** #3509 QM 是正: 'building' 状態の stale 判定閾値 (cron drain 間隔の複数倍を見込んで 10 分)。 */
const STALE_BUILDING_THRESHOLD_MS = 10 * 60 * 1000;

/** {@link drainPendingExports} の実行結果。 */
export interface DrainResult {
	processed: number;
	ready: number;
	failed: number;
	/** #3509: stale 'building' から 'failed' へ reclaim (fail-closed) した件数。 */
	reclaimed: number;
	/** #3695: 時間予算超過で今回 build せず次回実行 (5 分毎) へ持ち越した件数。 */
	skipped: number;
}

/**
 * #3509 QM 是正 (async-backup-export.md §3.2-4): status='building' のまま
 * staleThresholdMs 以上経過したレコード (cron worker が build 中に kill/timeout し
 * 永久 stuck した行) を 'failed' へ fail-closed する。
 *
 * 設計書 §3.2-4 は「pending への差し戻し（自動再試行）は採用しない」と明記している。
 * ワーカーが low-level で kill された場合、対象 ZIP が不完全に S3/FS へ書き込まれている
 * 可能性があり、自動リトライは重複書込み・競合を生みうるため、fail-closed してユーザーに
 * 再エクスポートを促す方が安全 (Pre-PMF、ADR-0010 過剰実装回避)。
 */
export async function reclaimStaleBuildingExports(
	staleThresholdMs = STALE_BUILDING_THRESHOLD_MS,
): Promise<number> {
	const repos = getRepos();
	const stale = await repos.cloudExport.findStaleBuildingExports(staleThresholdMs);
	for (const record of stale) {
		await repos.cloudExport.updateStatus(record.id, record.tenantId, 'failed', {
			failureReason: 'ビルドがタイムアウトしました。再度エクスポートしてください',
		});
		logger.warn('[cloud-export] stale building を failed へ reclaim', {
			context: { id: record.id, tenantId: record.tenantId, exportType: record.exportType },
		});
	}
	return stale.length;
}

/**
 * pending なクラウドエクスポートを最大 limit 件 build する（#3504 async-backup-export.md §3.2）。
 * cron (`/api/cron/export-build`) が呼ぶ。AWS (cron-dispatcher) と NUC (scheduler container) の
 * 双方が同一コードパスを回す。1 件失敗しても他は継続し、失敗レコードは `status='failed'` +
 * `failureReason` を残す。
 *
 * #3509 QM 是正: build 開始前に {@link reclaimStaleBuildingExports} を呼び、cron worker が
 * kill/timeout して 'building' のまま永久 stuck したレコードを 'failed' へ fail-closed してから
 * 通常の pending drain を行う。
 *
 * #3695 (30 秒 self-limiting + 持ち越し規約、13-AWS設計書 §3.3): ZIP build は 1 件が重く
 * limit 件で 30 秒 (アプリ Lambda timeout) を超えうるため、build 間で時間予算を確認し、
 * 予算超過時は残りを build せず次回実行 (5 分毎 cron) に持ち越す (`skipped` で報告)。
 * 予算内に着手した build は完走させる (中断すると #3509 の stale 'building' を自ら量産するため)。
 *
 * #3522 (dual-cron 楽観ロック): pending → building は `claimForBuild` の CAS で掴む。dual-cron
 * (AWS cron-dispatcher + NUC scheduler) や同一 job の重複起動下で複数 worker が同一 pending を
 * `findPendingBuilds` で拾いうるため、claim に失敗した (別 worker が先取得済み) レコードは
 * 二重 build せず skip する (contended としてログ可視化)。従来の `updateStatus('building')` は
 * claim が兼ねるため撤去した (二重 write 回避 + building 遷移の単一化)。
 */
/**
 * #4373: dryRun (`POST /api/cron/export-build {"dryRun":true}` / `GET`) 用の**予測**。
 *
 * dryRun は「有効化してよいか / 今どれだけ滞留しているか」を build せずに確かめるモードなので、
 * 件数は定数ではなく実測から出す。定数を返すと pending が何件あっても同じ数字が返り、
 * 判断材料として嘘をつく (grace-period の `tenantsRemaining` と同 class)。
 *
 * write は一切行わない: stale reclaim (`reclaimStaleBuildingExports`) は status を書き換えるため
 * dryRun では呼ばない。`findPendingBuilds` は limit で頭打ちするので、返す値は
 * 「この 1 回の実行で build に着手する件数」であり滞留総数ではない。
 */
export async function previewPendingExports(
	limit = 5,
): Promise<{ processed: number; ready: number; failed: number }> {
	const repos = getRepos();
	const pending = await repos.cloudExport.findPendingBuilds(limit);
	// ready / failed は「build した結果」なので dryRun では 0 が事実
	// (予測値である processed とは意味が違う)。
	return { processed: pending.length, ready: 0, failed: 0 };
}

export async function drainPendingExports(
	limit = 5,
	budget: TimeBudget = createTimeBudget(),
): Promise<DrainResult> {
	const repos = getRepos();
	const reclaimed = await reclaimStaleBuildingExports();
	const pending = await repos.cloudExport.findPendingBuilds(limit);
	let ready = 0;
	let failed = 0;
	let attempted = 0;
	let contended = 0;

	for (const record of pending) {
		// #3695: 予算超過なら残りは次回 5 分毎 cron が拾う (pending のまま残す)。
		if (budget.exceeded()) break;
		const { id, tenantId, exportType, s3Key } = record;
		// #3522: pending → building を CAS で claim。別 worker が先に掴んでいれば false (二重 build 回避)。
		const claimed = await repos.cloudExport.claimForBuild(id, tenantId);
		if (!claimed) {
			contended++;
			logger.info('[cloud-export] pending を別 worker が先取得したため二重 build を回避 (skip)', {
				context: { id, tenantId, exportType },
			});
			continue;
		}
		attempted++;
		try {
			// claimForBuild が既に status='building' + buildStartedAt=now を確定済 (updateStatus('building') 不要)。
			const artifact =
				exportType === 'template'
					? await buildTemplateExportData(tenantId)
					: await buildFullExportData(tenantId);
			await repos.storage.saveFile(s3Key, Buffer.from(artifact.bytes), artifact.contentType);
			await repos.cloudExport.updateStatus(id, tenantId, 'ready', {
				fileSizeBytes: artifact.bytes.length,
				description: artifact.description,
			});
			ready++;
			logger.info('[cloud-export] build 完了 (ready)', {
				context: { tenantId, exportType, id, size: artifact.bytes.length },
			});
		} catch (err) {
			// #3376 fail-closed: サイズ上限超過は userMessage、その他は generic なエラーメッセージを残す。
			const failureReason =
				err instanceof BackupSizeLimitError
					? err.userMessage
					: err instanceof Error
						? err.message
						: String(err);
			await repos.cloudExport.updateStatus(id, tenantId, 'failed', { failureReason });
			failed++;
			logger.error('[cloud-export] build 失敗 (failed)', {
				context: { tenantId, exportType, id },
				error: failureReason,
			});
		}
	}

	// #3522: 予算超過による持ち越し (skipped) と claim 敗退 (contended) は別事象。
	// examined = attempted + contended。予算 break で未検査の残件が skipped (次回 cron が拾う)。
	const skipped = pending.length - attempted - contended;
	if (skipped > 0) {
		// #3695: silent 持ち越し禁止 (ADR-0006 整合) — 持ち越し発生を必ずログに残す。
		logger.warn('[cloud-export] drain 時間予算超過、残件を次回実行へ持ち越し', {
			context: { skipped, attempted, contended, limit, elapsedMs: budget.elapsedMs() },
		});
	}

	return { processed: attempted, ready, failed, reclaimed, skipped };
}

/**
 * 保管枠を占有している行 = **期限内の全行** (状態 / DL 回数を問わない、#4767 PO 回答 #3)。
 *
 * 上限判定 ({@link createCloudExport}) と一覧 ({@link listCloudExports}) は**必ずこの 1 つの述語**を
 * 使う。旧実装は一覧だけ DL 使い切り行を落としていたため、「保管枠 2 / 3」と見せながら 3 件目で
 * 403 になり、顧客には消す対象が見えなかった。失敗行 / 使い切り行も期限内は S3 に PII ZIP が
 * 残るので枠として数え続け、そのかわり一覧に出して削除できるようにする。
 */
async function listQuotaOccupyingCloudExports(
	tenantId: string,
	now: Date = new Date(),
): Promise<CloudExportRecord[]> {
	const nowIso = now.toISOString();
	const all = await getRepos().cloudExport.findByTenant(tenantId);
	return all.filter((e) => e.expiresAt > nowIso);
}

/** 一覧の 1 行 (#4767 PO 回答 #3): record + 表示状態 + 自動削除までの残日数 (JST 暦日)。 */
export interface CloudExportListItem extends CloudExportRecord {
	rowState: CloudExportRowState;
	daysUntilAutoDelete: number;
}

/**
 * 自テナントのクラウドエクスポート一覧 = 枠を占有している全行 (#4767 PO 回答 #3)。
 * 各行に表示状態 (ダウンロード可能 / 使い切り / 失敗 / 生成待ち / 生成中) と自動削除までの残日数を付ける。
 */
export async function listCloudExports(
	tenantId: string,
	now: Date = new Date(),
): Promise<CloudExportListItem[]> {
	const rows = await listQuotaOccupyingCloudExports(tenantId, now);
	return rows.map((e) => ({
		...e,
		rowState: resolveCloudExportRowState(e),
		daysUntilAutoDelete: cloudExportDaysUntilAutoDelete(e.expiresAt, now),
	}));
}

/**
 * 削除対象のクラウドエクスポートが (自 tenant に) 存在しない (#4767)。
 *
 * 旧実装は素の `Error('エクスポートが見つかりません')` を投げ、route が
 * `msg.includes('見つかりません')` で 404 に写像していた。**顧客向け文言を制御信号に使う形**であり、
 * 文言を 1 文字変えた瞬間に 404 が 500 (「システムに問題が発生しました」) に化ける。
 * 本 PR が 403 の文言で潰したのと同じ class なので、同じやり方 ({@link CloudExportFetchError} と同型の
 * 理由の型付け) で塞ぐ。
 */
export class CloudExportNotFoundError extends Error {
	constructor() {
		super(SETTINGS_LABELS.cloudDeleteAlreadyGone);
		this.name = 'CloudExportNotFoundError';
	}
}

/**
 * 保管実体 (S3) の削除に失敗し、削除を **中断** した (#4767 QM should)。
 *
 * DB 行は残してあるので、一覧・保管枠・実体は食い違わない。顧客の次の行動は再試行。
 */
export class CloudExportDeleteFailedError extends Error {
	constructor() {
		super(SETTINGS_LABELS.cloudDeleteFailed);
		this.name = 'CloudExportDeleteFailedError';
	}
}

/** クラウドエクスポートを削除 */
export async function deleteCloudExport(id: string, tenantId: string): Promise<void> {
	const repos = getRepos();
	// findById は tenantId 束縛なので、他 tenant の id は「無い」として扱われる (IDOR 遮断)。
	const record = await repos.cloudExport.findById(id, tenantId);
	if (!record) throw new CloudExportNotFoundError();

	// S3 からも削除。**全バージョンごと消す** (#4724) — この ZIP は子供名・アバター・音声を含む
	// 完全 PII で、delete marker を立てるだけだと非現行バージョンが lifecycle の 30 日まで残る
	// (#3868 が塞いだ「PII が滞留する」の再発)。顧客が明示的に消したものは戻せなくてよい。
	//
	// #4767 QM should: **失敗を握り潰して DB 行だけ消さない**。旧実装は purge 失敗を warn ログに
	// 落として行を削除していたため、顧客には「削除できました」と見えるのに S3 には完全 PII の ZIP が
	// 残る (誰も知らない孤児になり、以後どの画面からも消せない)。失敗したら行を残したまま失敗を返し、
	// 一覧・保管枠・実体の 3 つが食い違わない状態で顧客に再試行させる。
	try {
		await repos.storage.purgeByPrefix(record.s3Key);
	} catch (err) {
		logger.error('[cloud-export] S3 削除に失敗したため DB 行も残す (孤児 PII を作らない)', {
			context: { id, tenantId, s3Key: record.s3Key },
			error: err instanceof Error ? err.message : String(err),
		});
		throw new CloudExportDeleteFailedError();
	}

	await repos.cloudExport.deleteById(id, tenantId);
	logger.info('[cloud-export] エクスポート削除', { context: { id, tenantId } });
}

/**
 * PINコードでクラウドエクスポートデータを取得（インポート用）。
 * #3376: full export は ZIP（バイナリ）になり得るため、raw bytes を返す
 * （template=JSON は呼び出し側で utf-8 decode、full は ZIP マジックバイトで判定して解凍）。
 *
 * **DL カウントは本関数では消費しない**（#3376 adversarial 是正）。旧実装は parse/validate より前の
 * fetch 時点で常に increment していたため、preview や validate 失敗・リトライのたびに maxDownloads を
 * 食い潰し、本来の復元 (execute) ができなくなる恐れがあった。消費は validate 成功後の execute/replace で
 * {@link consumeCloudExportDownload} を明示的に呼ぶ責務に分離する（preview は非消費）。
 */
/**
 * PIN からクラウド共有データを引くときの失敗理由 (#4717)。
 *
 * route 側が **文字列 match で分類していた** ため、新しい失敗理由 (生成待ち) を足したときに
 * 分類から漏れて 500 になった。理由を型で運び、route は `reason` だけを見て HTTP 種別に写像する。
 */
export type CloudExportFetchFailure =
	| 'invalid-pin'
	| 'expired'
	| 'download-limit'
	| 'not-ready'
	| 'build-failed'
	| 'data-missing';

export class CloudExportFetchError extends Error {
	readonly reason: CloudExportFetchFailure;
	constructor(reason: CloudExportFetchFailure, message: string) {
		super(message);
		this.name = 'CloudExportFetchError';
		this.reason = reason;
	}
}

export async function fetchCloudExportByPin(pinCode: string): Promise<{
	record: CloudExportRecord;
	bytes: Uint8Array;
}> {
	const repos = getRepos();
	const record = await repos.cloudExport.findByPin(pinCode.toUpperCase());

	if (!record) throw new CloudExportFetchError('invalid-pin', 'PINコードが無効です');
	if (new Date(record.expiresAt) < new Date())
		throw new CloudExportFetchError('expired', 'このエクスポートは有効期限切れです');
	if (record.downloadCount >= record.maxDownloads)
		throw new CloudExportFetchError(
			'download-limit',
			'このエクスポートはダウンロード回数の上限に達しています',
		);

	// #4717: 非同期 build (#3504) の完了前 (pending / building) に取り込もうとした場合。
	// 旧実装は S3 read が空 → 「エクスポートデータが見つかりません」を投げ、route 側が
	// 文字列 match から漏れて 500 (INTERNAL_ERROR「システムに問題が発生しました」) を返していた。
	// AWS の build cron は 5 分毎のため、発行〜5 分は必ずこの窓に入る = 受け取る側が「障害」と誤認する。
	if (record.status === 'pending' || record.status === 'building') {
		throw new CloudExportFetchError('not-ready', SETTINGS_LABELS.cloudImportNotReady);
	}
	if (record.status === 'failed') {
		throw new CloudExportFetchError('build-failed', SETTINGS_LABELS.cloudImportBuildFailed);
	}

	// S3からデータ取得
	const fileData = await repos.storage.readFile(record.s3Key);
	if (!fileData)
		throw new CloudExportFetchError('data-missing', 'エクスポートデータが見つかりません');

	return { record, bytes: new Uint8Array(fileData.data) };
}

/**
 * クラウドエクスポートの DL カウントを 1 消費する（#3376 adversarial 是正）。
 * validate 成功後の実取込 (execute / replace) でのみ呼ぶ。preview では呼ばない。
 * (#2845 B1: record.tenantId で tenant 束縛して increment する)
 */
export async function consumeCloudExportDownload(record: CloudExportRecord): Promise<void> {
	const repos = getRepos();
	await repos.cloudExport.incrementDownloadCount(record.id, record.tenantId);
}

/** 期限切れエクスポートを一括削除（Cronジョブ用） */
export async function cleanupExpiredExports(): Promise<number> {
	const repos = getRepos();
	const now = new Date().toISOString();

	// 期限切れレコードを取得（S3削除用）
	// Note: findByTenant は全テナント横断できないので、deleteExpired で一括削除
	const deletedCount = await repos.cloudExport.deleteExpired(now);

	if (deletedCount > 0) {
		logger.info('[cloud-export] 期限切れエクスポート削除', { context: { deletedCount } });
	}

	return deletedCount;
}
