// src/lib/server/db/factory.ts
// DATA_SOURCE 環境変数による SQLite / DynamoDB / Demo バックエンド切り替え
// ADR-0048: DATA_SOURCE=demo は Multi-Lambda Demo Deployment (demo.ganbari-quest.com) で使用
// される stateless fixture provider。production DB / S3 / Cognito へのアクセス権を持たない。

import * as demoAccountLockoutRepo from './demo/account-lockout-repo';
import * as demoActivityMasteryRepo from './demo/activity-mastery-repo';
import * as demoActivityPrefRepo from './demo/activity-pref-repo';
import * as demoActivityRepo from './demo/activity-repo';
import * as demoAuthRepo from './demo/auth-repo';
import * as demoAutoChallengeRepo from './demo/auto-challenge-repo';
import * as demoBattleRepo from './demo/battle-repo';
import * as demoCancellationReasonRepo from './demo/cancellation-reason-repo';
import * as demoCertificateRepo from './demo/certificate-repo';
import * as demoChecklistRepo from './demo/checklist-repo';
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
import * as demoSeasonEventRepo from './demo/season-event-repo';
import * as demoSettingsRepo from './demo/settings-repo';
import * as demoSiblingChallengeRepo from './demo/sibling-challenge-repo';
import * as demoSiblingCheerRepo from './demo/sibling-cheer-repo';
import * as demoSpecialRewardRepo from './demo/special-reward-repo';
import * as demoStampCardRepo from './demo/stamp-card-repo';
import * as demoStatusRepo from './demo/status-repo';
import * as demoStorageRepo from './demo/storage-repo';
import * as demoTenantEventRepo from './demo/tenant-event-repo';
import * as demoTrialHistoryRepo from './demo/trial-history-repo';
import * as demoViewerTokenRepo from './demo/viewer-token-repo';
import * as demoVoiceRepo from './demo/voice-repo';
import * as dynamoAccountLockoutRepo from './dynamodb/account-lockout-repo';
import * as dynamoActivityMasteryRepo from './dynamodb/activity-mastery-repo';
import * as dynamoActivityPrefRepo from './dynamodb/activity-pref-repo';
import * as dynamoActivityRepo from './dynamodb/activity-repo';
import * as dynamoAuthRepo from './dynamodb/auth-repo';
import * as dynamoAutoChallengeRepo from './dynamodb/auto-challenge-repo';
import * as dynamoBattleRepo from './dynamodb/battle-repo';
import * as dynamoCancellationReasonRepo from './dynamodb/cancellation-reason-repo';
import * as dynamoCertificateRepo from './dynamodb/certificate-repo';
import * as dynamoChecklistRepo from './dynamodb/checklist-repo';
import * as dynamoChildRepo from './dynamodb/child-repo';
import * as dynamoCloudExportRepo from './dynamodb/cloud-export-repo';
import * as dynamoDailyMissionRepo from './dynamodb/daily-mission-repo';
import * as dynamoEvaluationRepo from './dynamodb/evaluation-repo';
import * as dynamoGraduationConsentRepo from './dynamodb/graduation-consent-repo';
import * as dynamoImageRepo from './dynamodb/image-repo';
import * as dynamoInquiryRepo from './dynamodb/inquiry-repo';
import * as dynamoLoginBonusRepo from './dynamodb/login-bonus-repo';
import * as dynamoMessageRepo from './dynamodb/message-repo';
import * as dynamoPointRepo from './dynamodb/point-repo';
import * as dynamoPushSubscriptionRepo from './dynamodb/push-subscription-repo';
import * as dynamoReportDailySummaryRepo from './dynamodb/report-daily-summary-repo';
import * as dynamoRewardRedemptionRepo from './dynamodb/reward-redemption-repo';
import * as dynamoSeasonEventRepo from './dynamodb/season-event-repo';
import * as dynamoSettingsRepo from './dynamodb/settings-repo';
import * as dynamoSiblingChallengeRepo from './dynamodb/sibling-challenge-repo';
import * as dynamoSiblingCheerRepo from './dynamodb/sibling-cheer-repo';
import * as dynamoSpecialRewardRepo from './dynamodb/special-reward-repo';
import * as dynamoStampCardRepo from './dynamodb/stamp-card-repo';
import * as dynamoStatusRepo from './dynamodb/status-repo';
import * as dynamoStorageRepo from './dynamodb/storage-repo';
import * as dynamoTenantEventRepo from './dynamodb/tenant-event-repo';
import * as dynamoTrialHistoryRepo from './dynamodb/trial-history-repo';
import * as dynamoViewerTokenRepo from './dynamodb/viewer-token-repo';
import * as dynamoVoiceRepo from './dynamodb/voice-repo';
import type { IAccountLockoutRepo } from './interfaces/account-lockout-repo.interface';
import type { IActivityMasteryRepo } from './interfaces/activity-mastery-repo.interface';
import type { IActivityPrefRepo } from './interfaces/activity-pref-repo.interface';
import type { IActivityRepo } from './interfaces/activity-repo.interface';
import type { IAuthRepo } from './interfaces/auth-repo.interface';
import type { IAutoChallengeRepo } from './interfaces/auto-challenge-repo.interface';
import type { IBattleRepo } from './interfaces/battle-repo.interface';
import type { ICancellationReasonRepo } from './interfaces/cancellation-reason-repo.interface';
import type { ICertificateRepo } from './interfaces/certificate-repo.interface';
import type { IChecklistRepo } from './interfaces/checklist-repo.interface';
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
import type { ISeasonEventRepo } from './interfaces/season-event-repo.interface';
import type { ISettingsRepo } from './interfaces/settings-repo.interface';
import type { ISiblingChallengeRepo } from './interfaces/sibling-challenge-repo.interface';
import type { ISiblingCheerRepo } from './interfaces/sibling-cheer-repo.interface';
import type { ISpecialRewardRepo } from './interfaces/special-reward-repo.interface';
import type { IStampCardRepo } from './interfaces/stamp-card-repo.interface';
import type { IStatusRepo } from './interfaces/status-repo.interface';
import type { IStorageRepo } from './interfaces/storage.interface';
import type { ITenantEventRepo } from './interfaces/tenant-event-repo.interface';
import type { ITrialHistoryRepo } from './interfaces/trial-history-repo.interface';
import type { IViewerTokenRepo } from './interfaces/viewer-token-repo.interface';
import type { IVoiceRepo } from './interfaces/voice-repo.interface';
import * as sqliteAccountLockoutRepo from './sqlite/account-lockout-repo';
import * as sqliteActivityMasteryRepo from './sqlite/activity-mastery-repo';
import * as sqliteActivityPrefRepo from './sqlite/activity-pref-repo';
import * as sqliteActivityRepo from './sqlite/activity-repo';
import * as sqliteAuthRepo from './sqlite/auth-repo';
import * as sqliteAutoChallengeRepo from './sqlite/auto-challenge-repo';
import * as sqliteBattleRepo from './sqlite/battle-repo';
import * as sqliteCancellationReasonRepo from './sqlite/cancellation-reason-repo';
import * as sqliteCertificateRepo from './sqlite/certificate-repo';
import * as sqliteChecklistRepo from './sqlite/checklist-repo';
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
import * as sqliteSeasonEventRepo from './sqlite/season-event-repo';
import * as sqliteSettingsRepo from './sqlite/settings-repo';
import * as sqliteSiblingChallengeRepo from './sqlite/sibling-challenge-repo';
import * as sqliteSiblingCheerRepo from './sqlite/sibling-cheer-repo';
import * as sqliteSpecialRewardRepo from './sqlite/special-reward-repo';
import * as sqliteStampCardRepo from './sqlite/stamp-card-repo';
import * as sqliteStatusRepo from './sqlite/status-repo';
import * as sqliteStorageRepo from './sqlite/storage-repo';
import * as sqliteTenantEventRepo from './sqlite/tenant-event-repo';
import * as sqliteTrialHistoryRepo from './sqlite/trial-history-repo';
import * as sqliteViewerTokenRepo from './sqlite/viewer-token-repo';
import * as sqliteVoiceRepo from './sqlite/voice-repo';

export interface Repositories {
	accountLockout: IAccountLockoutRepo;
	autoChallenge: IAutoChallengeRepo;
	battle: IBattleRepo;
	cancellationReason: ICancellationReasonRepo;
	certificate: ICertificateRepo;
	auth: IAuthRepo;
	activity: IActivityRepo;
	activityMastery: IActivityMasteryRepo;
	activityPref: IActivityPrefRepo;
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
	seasonEvent: ISeasonEventRepo;
	siblingChallenge: ISiblingChallengeRepo;
	siblingCheer: ISiblingCheerRepo;
	settings: ISettingsRepo;
	rewardRedemption: IRewardRedemptionRepo;
	specialReward: ISpecialRewardRepo;
	stampCard: IStampCardRepo;
	status: IStatusRepo;
	storage: IStorageRepo;
	tenantEvent: ITenantEventRepo;
	trialHistory: ITrialHistoryRepo;
	viewerToken: IViewerTokenRepo;
	voice: IVoiceRepo;
}

let _repos: Repositories | null = null;

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
			autoChallenge: demoAutoChallengeRepo,
			battle: demoBattleRepo,
			cancellationReason: demoCancellationReasonRepo,
			certificate: demoCertificateRepo,
			auth: demoAuthRepo,
			activity: demoActivityRepo,
			activityMastery: demoActivityMasteryRepo,
			activityPref: demoActivityPrefRepo,
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
			seasonEvent: demoSeasonEventRepo,
			siblingChallenge: demoSiblingChallengeRepo,
			siblingCheer: demoSiblingCheerRepo,
			settings: demoSettingsRepo,
			rewardRedemption: demoRewardRedemptionRepo,
			specialReward: demoSpecialRewardRepo,
			stampCard: demoStampCardRepo,
			status: demoStatusRepo,
			storage: demoStorageRepo,
			tenantEvent: demoTenantEventRepo,
			trialHistory: demoTrialHistoryRepo,
			viewerToken: demoViewerTokenRepo,
			voice: demoVoiceRepo,
		};
		_repos = repos;
		return repos;
	}
	if (dataSource === 'dynamodb') {
		const repos: Repositories = {
			accountLockout: dynamoAccountLockoutRepo,
			autoChallenge: dynamoAutoChallengeRepo,
			battle: dynamoBattleRepo,
			cancellationReason: dynamoCancellationReasonRepo,
			certificate: dynamoCertificateRepo,
			auth: dynamoAuthRepo,
			activity: dynamoActivityRepo,
			activityMastery: dynamoActivityMasteryRepo,
			activityPref: dynamoActivityPrefRepo,
			checklist: dynamoChecklistRepo,
			child: dynamoChildRepo,
			cloudExport: dynamoCloudExportRepo,
			dailyMission: dynamoDailyMissionRepo,
			evaluation: dynamoEvaluationRepo,
			graduationConsent: dynamoGraduationConsentRepo,
			image: dynamoImageRepo,
			inquiry: dynamoInquiryRepo,
			loginBonus: dynamoLoginBonusRepo,
			message: dynamoMessageRepo,
			point: dynamoPointRepo,
			pushSubscription: dynamoPushSubscriptionRepo,
			reportDailySummary: dynamoReportDailySummaryRepo,
			seasonEvent: dynamoSeasonEventRepo,
			siblingChallenge: dynamoSiblingChallengeRepo,
			siblingCheer: dynamoSiblingCheerRepo,
			settings: dynamoSettingsRepo,
			rewardRedemption: dynamoRewardRedemptionRepo,
			specialReward: dynamoSpecialRewardRepo,
			stampCard: dynamoStampCardRepo,
			status: dynamoStatusRepo,
			storage: dynamoStorageRepo,
			tenantEvent: dynamoTenantEventRepo,
			trialHistory: dynamoTrialHistoryRepo,
			viewerToken: dynamoViewerTokenRepo,
			voice: dynamoVoiceRepo,
		};
		_repos = repos;
		return repos;
	}

	const repos: Repositories = {
		accountLockout: sqliteAccountLockoutRepo,
		autoChallenge: sqliteAutoChallengeRepo,
		battle: sqliteBattleRepo,
		cancellationReason: sqliteCancellationReasonRepo,
		certificate: sqliteCertificateRepo,
		auth: sqliteAuthRepo,
		activity: sqliteActivityRepo,
		activityMastery: sqliteActivityMasteryRepo,
		activityPref: sqliteActivityPrefRepo,
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
		seasonEvent: sqliteSeasonEventRepo,
		siblingChallenge: sqliteSiblingChallengeRepo,
		siblingCheer: sqliteSiblingCheerRepo,
		settings: sqliteSettingsRepo,
		rewardRedemption: sqliteRewardRedemptionRepo,
		specialReward: sqliteSpecialRewardRepo,
		stampCard: sqliteStampCardRepo,
		status: sqliteStatusRepo,
		storage: sqliteStorageRepo,
		tenantEvent: sqliteTenantEventRepo,
		trialHistory: sqliteTrialHistoryRepo,
		viewerToken: sqliteViewerTokenRepo,
		voice: sqliteVoiceRepo,
	};
	_repos = repos;

	return repos;
}
