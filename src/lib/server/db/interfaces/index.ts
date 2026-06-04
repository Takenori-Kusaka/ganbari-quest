// src/lib/server/db/interfaces/index.ts
// All repository interfaces re-exported for factory pattern

export type { IActivityRepo } from './activity-repo.interface';
// Epic #2525 Phase 7 PR-L5 (#2860): LicenseKeyCountFilter / LicenseKeyPage 撤去 (license key 全廃)
export type { IAuthRepo } from './auth-repo.interface';
export type { IAutoChallengeRepo } from './auto-challenge-repo.interface';
export type { IBattleRepo } from './battle-repo.interface';
export type {
	CancellationReasonAggregation,
	CancellationReasonRecord,
	CreateCancellationReasonInput,
	ICancellationReasonRepo,
} from './cancellation-reason-repo.interface';
export type { ICertificateRepo } from './certificate-repo.interface';
export type { IChecklistRepo } from './checklist-repo.interface';
export type { IChildRepo } from './child-repo.interface';
export type { ICloudExportRepo } from './cloud-export-repo.interface';
export type { IDailyMissionRepo } from './daily-mission-repo.interface';
export type { IEvaluationRepo } from './evaluation-repo.interface';
export type { IImageRepo } from './image-repo.interface';
export type { ILoginBonusRepo } from './login-bonus-repo.interface';
export type { IMessageRepo } from './message-repo.interface';
export type { IPointRepo } from './point-repo.interface';
export type { ISettingsRepo } from './settings-repo.interface';
// #2458 (Path B sibling drop): ISiblingChallengeRepo 削除済 (2026-05-26)、IChildChallengeRepo へ統合
export type { ISiblingCheerRepo } from './sibling-cheer-repo.interface';
export type { ISpecialRewardRepo } from './special-reward-repo.interface';
export type { IStampCardRepo } from './stamp-card-repo.interface';
export type { IStatusRepo } from './status-repo.interface';
export type { IStorageRepo } from './storage.interface';
// #2295 (EPIC #2294 ①): ITenantEventRepo / ISeasonEventRepo 削除済 (2026-05-19)
export type { ITrialHistoryRepo } from './trial-history-repo.interface';
// #2641 / Phase 5 子 3 / Phase 7 PR-1: Stripe Webhook 冪等性 dedup interface (4 backend SSOT)
export type { IWebhookEventRepo, WebhookEventRecord } from './webhook-event-repo.interface';
