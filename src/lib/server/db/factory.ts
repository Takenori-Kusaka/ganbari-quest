// src/lib/server/db/factory.ts
// DATA_SOURCE 環境変数による SQLite / DSQL / PGlite / Demo バックエンド切り替え。
// ADR-0048: DATA_SOURCE=demo は Multi-Lambda Demo Deployment (demo.ganbari-quest.com) で使用
// される stateless fixture provider。production DB / S3 / Cognito へのアクセス権を持たない。
// #3438 Phase 2B: DynamoDB backend (repo 層 33 本 + dynamodb 分岐) は cutover 完了により撤去済。

import * as demoAccountLockoutRepo from './demo/account-lockout-repo';
import * as demoActivationFunnelRepo from './demo/activation-funnel-repo';
import * as demoActivityMasteryRepo from './demo/activity-mastery-repo';
import * as demoActivityPrefRepo from './demo/activity-pref-repo';
import * as demoActivityRepo from './demo/activity-repo';
import * as demoAuthRepo from './demo/auth-repo';
import * as demoBattleRepo from './demo/battle-repo';
import * as demoCancellationReasonRepo from './demo/cancellation-reason-repo';
import * as demoCertificateRepo from './demo/certificate-repo';
import * as demoChecklistRepo from './demo/checklist-repo';
import * as demoChildActivityRepo from './demo/child-activity-repo';
import * as demoChildChallengeRepo from './demo/child-challenge-repo';
import * as demoChildRepo from './demo/child-repo';
import * as demoCloudExportRepo from './demo/cloud-export-repo';
import * as demoDailyMissionRepo from './demo/daily-mission-repo';
import * as demoEvaluationRepo from './demo/evaluation-repo';
import * as demoGraduationConsentRepo from './demo/graduation-consent-repo';
import * as demoImageRepo from './demo/image-repo';
import * as demoInquiryRepo from './demo/inquiry-repo';
import * as demoLoginBonusRepo from './demo/login-bonus-repo';
import * as demoMessageRepo from './demo/message-repo';
import * as demoPointRepo from './demo/point-repo';
import * as demoPushSubscriptionRepo from './demo/push-subscription-repo';
import * as demoReportDailySummaryRepo from './demo/report-daily-summary-repo';
import * as demoRewardRedemptionRepo from './demo/reward-redemption-repo';
// #2295 (EPIC #2294 ①): season-event-repo / tenant-event-repo 削除済 (2026-05-19)
import * as demoSettingsRepo from './demo/settings-repo';
// #2458 (Path B sibling drop): demoSiblingChallengeRepo 削除済 (2026-05-26)、child-challenge-repo へ完全移行
import * as demoSiblingCheerRepo from './demo/sibling-cheer-repo';
import * as demoSpecialRewardRepo from './demo/special-reward-repo';
import * as demoStampCardRepo from './demo/stamp-card-repo';
import * as demoStatusRepo from './demo/status-repo';
import * as demoStorageRepo from './demo/storage-repo';
import * as demoTrialHistoryRepo from './demo/trial-history-repo';
import * as demoUsageLogRepo from './demo/usage-log-repo';
import * as demoViewerTokenRepo from './demo/viewer-token-repo';
import * as demoVoiceRepo from './demo/voice-repo';
import { demoWebhookEventRepo } from './demo/webhook-event-repo';
import { createDsqlAccountLockoutRepo } from './dsql/account-lockout-repo';
import { createDsqlActivationFunnelRepo } from './dsql/activation-funnel-repo';
import { createDsqlActivityMasteryRepo } from './dsql/activity-mastery-repo';
import { createDsqlActivityPrefRepo } from './dsql/activity-pref-repo';
import { createDsqlActivityRepo } from './dsql/activity-repo';
import { createDsqlAuthRepo } from './dsql/auth-repo';
import { createDsqlBattleRepo } from './dsql/battle-repo';
import { createDsqlCancellationReasonRepo } from './dsql/cancellation-reason-repo';
import { createDsqlCertificateRepo } from './dsql/certificate-repo';
import { createDsqlChecklistRepo } from './dsql/checklist-repo';
import { createDsqlChildActivityRepo } from './dsql/child-activity-repo';
import { createDsqlChildChallengeRepo } from './dsql/child-challenge-repo';
import { createDsqlChildRepo } from './dsql/child-repo';
import { createDsqlCloudExportRepo } from './dsql/cloud-export-repo';
// connection の import 自体は side-effect free (pool/db/runner は getDsql* 呼び出し時に lazy 確立)。
// getDsqlDb() / getDsqlTransactionRunner() は dsql 分岐内でのみ呼ぶこと (sqlite/demo 環境で
// DSQL pool を作らせない)。
import { getDsqlDb, getDsqlTransactionRunner } from './dsql/connection';
import { createDsqlDailyMissionRepo } from './dsql/daily-mission-repo';
import { createDsqlEvaluationRepo } from './dsql/evaluation-repo';
import { createDsqlGraduationConsentRepo } from './dsql/graduation-consent-repo';
import { createDsqlImageRepo } from './dsql/image-repo';
import { createDsqlInquiryRepo } from './dsql/inquiry-repo';
import { createDsqlLoginBonusRepo } from './dsql/login-bonus-repo';
import { createDsqlMessageRepo } from './dsql/message-repo';
import { createDsqlPointRepo } from './dsql/point-repo';
import { createDsqlPushSubscriptionRepo } from './dsql/push-subscription-repo';
import { createDsqlReportDailySummaryRepo } from './dsql/report-daily-summary-repo';
import { createDsqlRewardRedemptionRepo } from './dsql/reward-redemption-repo';
import { createDsqlSettingsRepo } from './dsql/settings-repo';
import { createDsqlSiblingCheerRepo } from './dsql/sibling-cheer-repo';
import { createDsqlSpecialRewardRepo } from './dsql/special-reward-repo';
import type { SqlExecutor } from './dsql/sql-executor';
import { createDsqlStampCardRepo } from './dsql/stamp-card-repo';
import { createDsqlStatusRepo } from './dsql/status-repo';
import { createDsqlTrialHistoryRepo } from './dsql/trial-history-repo';
import { createDsqlUsageLogRepo } from './dsql/usage-log-repo';
import { createDsqlViewerTokenRepo } from './dsql/viewer-token-repo';
import { createDsqlVoiceRepo } from './dsql/voice-repo';
import { createDsqlWebhookEventRepo } from './dsql/webhook-event-repo';
// #3438 Phase 2B: dynamodb/*-repo は撤去 (storage は Phase 1 #3786 で s3/ へ移設済)。
import type { IAccountLockoutRepo } from './interfaces/account-lockout-repo.interface';
import type { IActivationFunnelRepo } from './interfaces/activation-funnel-repo.interface';
import type { IActivityMasteryRepo } from './interfaces/activity-mastery-repo.interface';
import type { IActivityPrefRepo } from './interfaces/activity-pref-repo.interface';
import type { IActivityRepo } from './interfaces/activity-repo.interface';
import type { IAuthRepo } from './interfaces/auth-repo.interface';
import type { IBattleRepo } from './interfaces/battle-repo.interface';
import type { ICancellationReasonRepo } from './interfaces/cancellation-reason-repo.interface';
import type { ICertificateRepo } from './interfaces/certificate-repo.interface';
import type { IChecklistRepo } from './interfaces/checklist-repo.interface';
import type { IChildActivityRepo } from './interfaces/child-activity-repo.interface';
import type { IChildChallengeRepo } from './interfaces/child-challenge-repo.interface';
import type { IChildRepo } from './interfaces/child-repo.interface';
import type { ICloudExportRepo } from './interfaces/cloud-export-repo.interface';
import type { IDailyMissionRepo } from './interfaces/daily-mission-repo.interface';
import type { IEvaluationRepo } from './interfaces/evaluation-repo.interface';
import type { IGraduationConsentRepo } from './interfaces/graduation-consent-repo.interface';
import type { IImageRepo } from './interfaces/image-repo.interface';
import type { IInquiryRepo } from './interfaces/inquiry-repo.interface';
import type { ILoginBonusRepo } from './interfaces/login-bonus-repo.interface';
import type { IMessageRepo } from './interfaces/message-repo.interface';
import type { IPointRepo } from './interfaces/point-repo.interface';
import type { IPushSubscriptionRepo } from './interfaces/push-subscription-repo.interface';
import type { IReportDailySummaryRepo } from './interfaces/report-daily-summary-repo.interface';
import type { IRewardRedemptionRepo } from './interfaces/reward-redemption-repo.interface';
// #2295 (EPIC #2294 ①): ISeasonEventRepo / ITenantEventRepo 削除済 (2026-05-19)
import type { ISettingsRepo } from './interfaces/settings-repo.interface';
// #2458 (Path B sibling drop): ISiblingChallengeRepo 削除済 (2026-05-26)、IChildChallengeRepo に統合
import type { ISiblingCheerRepo } from './interfaces/sibling-cheer-repo.interface';
import type { ISpecialRewardRepo } from './interfaces/special-reward-repo.interface';
import type { IStampCardRepo } from './interfaces/stamp-card-repo.interface';
import type { IStatusRepo } from './interfaces/status-repo.interface';
import type { IStorageRepo } from './interfaces/storage.interface';
import type { TransactionRunner } from './interfaces/transaction.interface';
import type { ITrialHistoryRepo } from './interfaces/trial-history-repo.interface';
import type { IUsageLogRepo } from './interfaces/usage-log-repo.interface';
import type { IViewerTokenRepo } from './interfaces/viewer-token-repo.interface';
import type { IVoiceRepo } from './interfaces/voice-repo.interface';
import type { IWebhookEventRepo } from './interfaces/webhook-event-repo.interface';
// #3620 AC-C2 (ADR-0064 案 C): NUC=PGlite は dsql (pg-core) repos を verbatim 再利用する。
// getPglite*Sync は init 済み前提の同期アクセサ (async init は hooks.server.ts の 1st-request
// guard で await 済み)。pglite 分岐内でのみ呼ぶこと (他 backend で PGlite を open させない)。
import { getPgliteDbSync, getPgliteTransactionRunnerSync } from './pglite/connection';
import * as s3StorageRepo from './s3/storage-repo';
import * as sqliteAccountLockoutRepo from './sqlite/account-lockout-repo';
import * as sqliteActivationFunnelRepo from './sqlite/activation-funnel-repo';
import * as sqliteActivityMasteryRepo from './sqlite/activity-mastery-repo';
import * as sqliteActivityPrefRepo from './sqlite/activity-pref-repo';
import * as sqliteActivityRepo from './sqlite/activity-repo';
import * as sqliteAuthRepo from './sqlite/auth-repo';
import * as sqliteBattleRepo from './sqlite/battle-repo';
import * as sqliteCancellationReasonRepo from './sqlite/cancellation-reason-repo';
import * as sqliteCertificateRepo from './sqlite/certificate-repo';
import * as sqliteChecklistRepo from './sqlite/checklist-repo';
import * as sqliteChildActivityRepo from './sqlite/child-activity-repo';
import * as sqliteChildChallengeRepo from './sqlite/child-challenge-repo';
import * as sqliteChildRepo from './sqlite/child-repo';
import * as sqliteCloudExportRepo from './sqlite/cloud-export-repo';
import * as sqliteDailyMissionRepo from './sqlite/daily-mission-repo';
import * as sqliteEvaluationRepo from './sqlite/evaluation-repo';
import * as sqliteGraduationConsentRepo from './sqlite/graduation-consent-repo';
import * as sqliteImageRepo from './sqlite/image-repo';
import * as sqliteInquiryRepo from './sqlite/inquiry-repo';
import * as sqliteLoginBonusRepo from './sqlite/login-bonus-repo';
import * as sqliteMessageRepo from './sqlite/message-repo';
import * as sqlitePointRepo from './sqlite/point-repo';
import * as sqlitePushSubscriptionRepo from './sqlite/push-subscription-repo';
import * as sqliteReportDailySummaryRepo from './sqlite/report-daily-summary-repo';
import * as sqliteRewardRedemptionRepo from './sqlite/reward-redemption-repo';
// #2295 (EPIC #2294 ①): season-event-repo / tenant-event-repo 削除済 (2026-05-19)
import * as sqliteSettingsRepo from './sqlite/settings-repo';
// #2458 (Path B sibling drop): sqliteSiblingChallengeRepo 削除済 (2026-05-26)、child-challenge-repo へ完全移行
import * as sqliteSiblingCheerRepo from './sqlite/sibling-cheer-repo';
import * as sqliteSpecialRewardRepo from './sqlite/special-reward-repo';
import * as sqliteStampCardRepo from './sqlite/stamp-card-repo';
import * as sqliteStatusRepo from './sqlite/status-repo';
import * as sqliteStorageRepo from './sqlite/storage-repo';
import * as sqliteTrialHistoryRepo from './sqlite/trial-history-repo';
import * as sqliteUsageLogRepo from './sqlite/usage-log-repo';
import * as sqliteViewerTokenRepo from './sqlite/viewer-token-repo';
import * as sqliteVoiceRepo from './sqlite/voice-repo';
import * as sqliteWebhookEventRepo from './sqlite/webhook-event-repo';

export interface Repositories {
	accountLockout: IAccountLockoutRepo;
	/**
	 * #3805: on-demand activation funnel (cross-tenant KPI)。DSQL / PGlite のみ実データ、
	 * sqlite / demo / dynamodb は単一テナント or 非分析 backend のため 0 件 stub。
	 */
	activationFunnel: IActivationFunnelRepo;
	battle: IBattleRepo;
	cancellationReason: ICancellationReasonRepo;
	certificate: ICertificateRepo;
	auth: IAuthRepo;
	activity: IActivityRepo;
	activityMastery: IActivityMasteryRepo;
	activityPref: IActivityPrefRepo;
	/**
	 * #2362 PR-3 (ADR-0055): per-child activity instance repo.
	 * 旧 `activity` (family master) と並存。Phase 6/7 で全 callsite 移行後に `activity` を削除。
	 */
	childActivity: IChildActivityRepo;
	/**
	 * #2362 PR-7 (ADR-0055、User §6): per-child challenge instance repo.
	 * 旧 `siblingChallenge` (family-wide + progress 別 table) は #2458 (Path B sibling drop) で
	 * 物理 drop 済 (2026-05-26)。本 repo が単一の challenge 経路。
	 */
	childChallenge: IChildChallengeRepo;
	checklist: IChecklistRepo;
	child: IChildRepo;
	cloudExport: ICloudExportRepo;
	dailyMission: IDailyMissionRepo;
	evaluation: IEvaluationRepo;
	graduationConsent: IGraduationConsentRepo;
	image: IImageRepo;
	inquiry: IInquiryRepo;
	loginBonus: ILoginBonusRepo;
	message: IMessageRepo;
	point: IPointRepo;
	pushSubscription: IPushSubscriptionRepo;
	reportDailySummary: IReportDailySummaryRepo;
	// #2295 (EPIC #2294 ①): seasonEvent / tenantEvent 削除済 (2026-05-19)
	// #2458 (Path B sibling drop): siblingChallenge 削除済 (2026-05-26)、childChallenge へ移行
	siblingCheer: ISiblingCheerRepo;
	settings: ISettingsRepo;
	rewardRedemption: IRewardRedemptionRepo;
	specialReward: ISpecialRewardRepo;
	stampCard: IStampCardRepo;
	status: IStatusRepo;
	storage: IStorageRepo;
	trialHistory: ITrialHistoryRepo;
	/** #4719: 使用時間ログ (#1292)。全 backend 実装 (demo は stub)。facade usage-log-repo.ts の唯一の経路 */
	usageLog: IUsageLogRepo;
	viewerToken: IViewerTokenRepo;
	/**
	 * #3985: Stripe webhook の event.id dedup (`stripe_webhook_events`)。
	 * `handleWebhookEvent` dispatcher 入口の単一 dedup 点が唯一の消費者
	 * (設計 SSOT: billing-redesign/phase5-webhook-idempotency-architecture.md §2 / §4.1)。
	 */
	webhookEvent: IWebhookEventRepo;
	voice: IVoiceRepo;
}

let _repos: Repositories | null = null;

/**
 * pg-core backend (Aurora DSQL / NUC PGlite 共通) の Repositories を組み立てる。
 * ADR-0064 案 C: DSQL(cloud) と PGlite(NUC) は同一 dsql repos を共有するため、db(SqlExecutor 面)
 * と runner を注入する 1 箇所に集約する (dsql/pglite 分岐の 35 repo 二重列挙を防ぐ)。
 * db は DsqlDatabase / PgliteDatabase いずれも SqlExecutor を構造的に満たす。
 */
function buildPgBackendRepos<TTx extends SqlExecutor>(
	db: SqlExecutor,
	runner: TransactionRunner<TTx>,
): Repositories {
	return {
		accountLockout: createDsqlAccountLockoutRepo(db),
		activationFunnel: createDsqlActivationFunnelRepo(db),
		battle: createDsqlBattleRepo(db, runner),
		cancellationReason: createDsqlCancellationReasonRepo(db),
		certificate: createDsqlCertificateRepo(db),
		auth: createDsqlAuthRepo(db, runner),
		activity: createDsqlActivityRepo(db, runner),
		activityMastery: createDsqlActivityMasteryRepo(db, runner),
		activityPref: createDsqlActivityPrefRepo(db, runner),
		childActivity: createDsqlChildActivityRepo(db, runner),
		childChallenge: createDsqlChildChallengeRepo(db, runner),
		checklist: createDsqlChecklistRepo(db, runner),
		child: createDsqlChildRepo(db, runner),
		cloudExport: createDsqlCloudExportRepo(db),
		dailyMission: createDsqlDailyMissionRepo(db),
		evaluation: createDsqlEvaluationRepo(db, runner),
		graduationConsent: createDsqlGraduationConsentRepo(db),
		image: createDsqlImageRepo(db),
		inquiry: createDsqlInquiryRepo(db),
		loginBonus: createDsqlLoginBonusRepo(db),
		message: createDsqlMessageRepo(db),
		point: createDsqlPointRepo(db, runner),
		pushSubscription: createDsqlPushSubscriptionRepo(db),
		// §7 compute-on-read (report_daily_summaries 表は pg-core に存在しない)
		reportDailySummary: createDsqlReportDailySummaryRepo(db),
		siblingCheer: createDsqlSiblingCheerRepo(db),
		settings: createDsqlSettingsRepo(db),
		rewardRedemption: createDsqlRewardRedemptionRepo(db, runner),
		specialReward: createDsqlSpecialRewardRepo(db, runner),
		stampCard: createDsqlStampCardRepo(db, runner),
		status: createDsqlStatusRepo(db, runner),
		// storage の実体は S3 (DB backend 非依存)。#3438 Phase 1 で dynamodb/ → s3/ へ移設済。
		storage: s3StorageRepo,
		trialHistory: createDsqlTrialHistoryRepo(db),
		usageLog: createDsqlUsageLogRepo(db),
		viewerToken: createDsqlViewerTokenRepo(db),
		webhookEvent: createDsqlWebhookEventRepo(db),
		voice: createDsqlVoiceRepo(db, runner),
	};
}

/**
 * #4720: pg 系 backend (Aurora DSQL / NUC PGlite) の TransactionRunner を返す。
 * record / cancel core (単一 txn 経路) 等の pg 専用 service は、`dsql/connection` を直 import せず
 * **本関数から runner の注入を受ける** (直 import は NUC PGlite でも DSQL pool を開こうとする)。
 * backend 判定は `isPgBackend()` (db/backend.ts) と対。sqlite / demo で呼ぶのは配線ミスなので throw。
 */
export function getPgTransactionRunner(): TransactionRunner<SqlExecutor> {
	const dataSource = process.env.DATA_SOURCE ?? 'sqlite';
	if (dataSource === 'dsql') {
		return getDsqlTransactionRunner() as unknown as TransactionRunner<SqlExecutor>;
	}
	if (dataSource === 'pglite') {
		return getPgliteTransactionRunnerSync() as unknown as TransactionRunner<SqlExecutor>;
	}
	throw new Error(
		`[factory] getPgTransactionRunner は pg 系 backend (dsql / pglite) 専用です (DATA_SOURCE=${dataSource})`,
	);
}

export function getRepos(): Repositories {
	if (_repos) return _repos;

	const dataSource = process.env.DATA_SOURCE ?? 'sqlite';
	if (dataSource === 'demo') {
		// ADR-0048: Multi-Lambda Demo Deployment
		// 全 Repository が stateless fixture provider (read = Fake / write = Stub no-op)。
		// AWS Lambda Best Practices 公式 anti-pattern (module-level user-specific mutable state) を
		// 物理的に発生不可能にする。
		const repos: Repositories = {
			accountLockout: demoAccountLockoutRepo,
			activationFunnel: demoActivationFunnelRepo,
			battle: demoBattleRepo,
			cancellationReason: demoCancellationReasonRepo,
			certificate: demoCertificateRepo,
			auth: demoAuthRepo,
			activity: demoActivityRepo,
			activityMastery: demoActivityMasteryRepo,
			activityPref: demoActivityPrefRepo,
			childActivity: demoChildActivityRepo,
			childChallenge: demoChildChallengeRepo,
			checklist: demoChecklistRepo,
			child: demoChildRepo,
			cloudExport: demoCloudExportRepo,
			dailyMission: demoDailyMissionRepo,
			evaluation: demoEvaluationRepo,
			graduationConsent: demoGraduationConsentRepo,
			image: demoImageRepo,
			inquiry: demoInquiryRepo,
			loginBonus: demoLoginBonusRepo,
			message: demoMessageRepo,
			point: demoPointRepo,
			pushSubscription: demoPushSubscriptionRepo,
			reportDailySummary: demoReportDailySummaryRepo,
			// #2295: seasonEvent / tenantEvent 削除済
			// #2458 (Path B sibling drop): siblingChallenge 削除済 (2026-05-26)
			siblingCheer: demoSiblingCheerRepo,
			settings: demoSettingsRepo,
			rewardRedemption: demoRewardRedemptionRepo,
			specialReward: demoSpecialRewardRepo,
			stampCard: demoStampCardRepo,
			status: demoStatusRepo,
			storage: demoStorageRepo,
			trialHistory: demoTrialHistoryRepo,
			usageLog: demoUsageLogRepo,
			viewerToken: demoViewerTokenRepo,
			webhookEvent: demoWebhookEventRepo,
			voice: demoVoiceRepo,
		};
		_repos = repos;
		return repos;
	}
	if (dataSource === 'dsql') {
		// EPIC #3424: Aurora DSQL backend。db / runner は connection.ts の lazy singleton から
		// この分岐内でのみ取得する (module-level 呼び出し禁止: sqlite/demo 環境で pool を作らせない)。
		_repos = buildPgBackendRepos(getDsqlDb(), getDsqlTransactionRunner());
		return _repos;
	}
	if (dataSource === 'pglite') {
		// EPIC #3620 (ADR-0064 案 C): NUC=PGlite backend。dsql (pg-core) repos を verbatim 再利用する。
		// PGlite init は非同期のため hooks.server.ts の 1st-request guard で await 済み前提。
		// getPglite*Sync は init 未完なら明示 throw する (この分岐内でのみ呼ぶ)。
		_repos = buildPgBackendRepos(getPgliteDbSync(), getPgliteTransactionRunnerSync());
		return _repos;
	}
	const repos: Repositories = {
		accountLockout: sqliteAccountLockoutRepo,
		activationFunnel: sqliteActivationFunnelRepo,
		battle: sqliteBattleRepo,
		cancellationReason: sqliteCancellationReasonRepo,
		certificate: sqliteCertificateRepo,
		auth: sqliteAuthRepo,
		activity: sqliteActivityRepo,
		activityMastery: sqliteActivityMasteryRepo,
		activityPref: sqliteActivityPrefRepo,
		childActivity: sqliteChildActivityRepo,
		childChallenge: sqliteChildChallengeRepo,
		checklist: sqliteChecklistRepo,
		child: sqliteChildRepo,
		cloudExport: sqliteCloudExportRepo,
		dailyMission: sqliteDailyMissionRepo,
		evaluation: sqliteEvaluationRepo,
		graduationConsent: sqliteGraduationConsentRepo,
		image: sqliteImageRepo,
		inquiry: sqliteInquiryRepo,
		loginBonus: sqliteLoginBonusRepo,
		message: sqliteMessageRepo,
		point: sqlitePointRepo,
		pushSubscription: sqlitePushSubscriptionRepo,
		reportDailySummary: sqliteReportDailySummaryRepo,
		// #2295: seasonEvent / tenantEvent 削除済
		// #2458 (Path B sibling drop): siblingChallenge 削除済 (2026-05-26)
		siblingCheer: sqliteSiblingCheerRepo,
		settings: sqliteSettingsRepo,
		rewardRedemption: sqliteRewardRedemptionRepo,
		specialReward: sqliteSpecialRewardRepo,
		stampCard: sqliteStampCardRepo,
		status: sqliteStatusRepo,
		storage: sqliteStorageRepo,
		trialHistory: sqliteTrialHistoryRepo,
		usageLog: sqliteUsageLogRepo,
		viewerToken: sqliteViewerTokenRepo,
		webhookEvent: sqliteWebhookEventRepo,
		voice: sqliteVoiceRepo,
	};
	_repos = repos;

	return repos;
}
