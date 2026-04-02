// src/lib/server/db/factory.ts
// DATA_SOURCE 環境変数による SQLite / DynamoDB バックエンド切り替え

import * as dynamoAccountLockoutRepo from './dynamodb/account-lockout-repo';
import * as dynamoAchievementRepo from './dynamodb/achievement-repo';
import * as dynamoActivityMasteryRepo from './dynamodb/activity-mastery-repo';
import * as dynamoActivityPrefRepo from './dynamodb/activity-pref-repo';
import * as dynamoActivityRepo from './dynamodb/activity-repo';
import * as dynamoAuthRepo from './dynamodb/auth-repo';
import * as dynamoChecklistRepo from './dynamodb/checklist-repo';
import * as dynamoChildRepo from './dynamodb/child-repo';
import * as dynamoDailyMissionRepo from './dynamodb/daily-mission-repo';
import * as dynamoEvaluationRepo from './dynamodb/evaluation-repo';
import * as dynamoImageRepo from './dynamodb/image-repo';
import * as dynamoInquiryRepo from './dynamodb/inquiry-repo';
import * as dynamoLevelTitleRepo from './dynamodb/level-title-repo';
import * as dynamoLoginBonusRepo from './dynamodb/login-bonus-repo';
import * as dynamoMessageRepo from './dynamodb/message-repo';
import * as dynamoPointRepo from './dynamodb/point-repo';
import * as dynamoSeasonEventRepo from './dynamodb/season-event-repo';
import * as dynamoSettingsRepo from './dynamodb/settings-repo';
import * as dynamoSpecialRewardRepo from './dynamodb/special-reward-repo';
import * as dynamoStampCardRepo from './dynamodb/stamp-card-repo';
import * as dynamoStatusRepo from './dynamodb/status-repo';
import * as dynamoStorageRepo from './dynamodb/storage-repo';
import * as dynamoTitleRepo from './dynamodb/title-repo';
import * as dynamoVoiceRepo from './dynamodb/voice-repo';
import type { IAccountLockoutRepo } from './interfaces/account-lockout-repo.interface';
import type { IAchievementRepo } from './interfaces/achievement-repo.interface';
import type { IActivityMasteryRepo } from './interfaces/activity-mastery-repo.interface';
import type { IActivityPrefRepo } from './interfaces/activity-pref-repo.interface';
import type { IActivityRepo } from './interfaces/activity-repo.interface';
import type { IAuthRepo } from './interfaces/auth-repo.interface';
import type { IChecklistRepo } from './interfaces/checklist-repo.interface';
import type { IChildRepo } from './interfaces/child-repo.interface';
import type { IDailyMissionRepo } from './interfaces/daily-mission-repo.interface';
import type { IEvaluationRepo } from './interfaces/evaluation-repo.interface';
import type { IImageRepo } from './interfaces/image-repo.interface';
import type { IInquiryRepo } from './interfaces/inquiry-repo.interface';
import type { ILevelTitleRepo } from './interfaces/level-title-repo.interface';
import type { ILoginBonusRepo } from './interfaces/login-bonus-repo.interface';
import type { IMessageRepo } from './interfaces/message-repo.interface';
import type { IPointRepo } from './interfaces/point-repo.interface';
import type { ISeasonEventRepo } from './interfaces/season-event-repo.interface';
import type { ISettingsRepo } from './interfaces/settings-repo.interface';
import type { ISpecialRewardRepo } from './interfaces/special-reward-repo.interface';
import type { IStampCardRepo } from './interfaces/stamp-card-repo.interface';
import type { IStatusRepo } from './interfaces/status-repo.interface';
import type { IStorageRepo } from './interfaces/storage.interface';
import type { ITitleRepo } from './interfaces/title-repo.interface';
import type { IVoiceRepo } from './interfaces/voice-repo.interface';
import * as sqliteAccountLockoutRepo from './sqlite/account-lockout-repo';
import * as sqliteAchievementRepo from './sqlite/achievement-repo';
import * as sqliteActivityMasteryRepo from './sqlite/activity-mastery-repo';
import * as sqliteActivityPrefRepo from './sqlite/activity-pref-repo';
import * as sqliteActivityRepo from './sqlite/activity-repo';
import * as sqliteAuthRepo from './sqlite/auth-repo';
import * as sqliteChecklistRepo from './sqlite/checklist-repo';
import * as sqliteChildRepo from './sqlite/child-repo';
import * as sqliteDailyMissionRepo from './sqlite/daily-mission-repo';
import * as sqliteEvaluationRepo from './sqlite/evaluation-repo';
import * as sqliteImageRepo from './sqlite/image-repo';
import * as sqliteInquiryRepo from './sqlite/inquiry-repo';
import * as sqliteLevelTitleRepo from './sqlite/level-title-repo';
import * as sqliteLoginBonusRepo from './sqlite/login-bonus-repo';
import * as sqliteMessageRepo from './sqlite/message-repo';
import * as sqlitePointRepo from './sqlite/point-repo';
import * as sqliteSeasonEventRepo from './sqlite/season-event-repo';
import * as sqliteSettingsRepo from './sqlite/settings-repo';
import * as sqliteSpecialRewardRepo from './sqlite/special-reward-repo';
import * as sqliteStampCardRepo from './sqlite/stamp-card-repo';
import * as sqliteStatusRepo from './sqlite/status-repo';
import * as sqliteStorageRepo from './sqlite/storage-repo';
import * as sqliteTitleRepo from './sqlite/title-repo';
import * as sqliteVoiceRepo from './sqlite/voice-repo';

export interface Repositories {
	accountLockout: IAccountLockoutRepo;
	auth: IAuthRepo;
	achievement: IAchievementRepo;
	activity: IActivityRepo;
	activityMastery: IActivityMasteryRepo;
	activityPref: IActivityPrefRepo;
	checklist: IChecklistRepo;
	child: IChildRepo;
	dailyMission: IDailyMissionRepo;
	evaluation: IEvaluationRepo;
	image: IImageRepo;
	inquiry: IInquiryRepo;
	loginBonus: ILoginBonusRepo;
	message: IMessageRepo;
	point: IPointRepo;
	seasonEvent: ISeasonEventRepo;
	settings: ISettingsRepo;
	specialReward: ISpecialRewardRepo;
	stampCard: IStampCardRepo;
	status: IStatusRepo;
	levelTitle: ILevelTitleRepo;
	storage: IStorageRepo;
	title: ITitleRepo;
	voice: IVoiceRepo;
}

let _repos: Repositories | null = null;

export function getRepos(): Repositories {
	if (_repos) return _repos;

	const dataSource = process.env.DATA_SOURCE ?? 'sqlite';
	if (dataSource === 'dynamodb') {
		const repos: Repositories = {
			accountLockout: dynamoAccountLockoutRepo,
			auth: dynamoAuthRepo,
			achievement: dynamoAchievementRepo,
			activity: dynamoActivityRepo,
			activityMastery: dynamoActivityMasteryRepo,
			activityPref: dynamoActivityPrefRepo,
			checklist: dynamoChecklistRepo,
			child: dynamoChildRepo,
			dailyMission: dynamoDailyMissionRepo,
			evaluation: dynamoEvaluationRepo,
			image: dynamoImageRepo,
			inquiry: dynamoInquiryRepo,
			loginBonus: dynamoLoginBonusRepo,
			message: dynamoMessageRepo,
			point: dynamoPointRepo,
			seasonEvent: dynamoSeasonEventRepo,
			settings: dynamoSettingsRepo,
			levelTitle: dynamoLevelTitleRepo,
			specialReward: dynamoSpecialRewardRepo,
			stampCard: dynamoStampCardRepo,
			status: dynamoStatusRepo,
			storage: dynamoStorageRepo,
			title: dynamoTitleRepo,
			voice: dynamoVoiceRepo,
		};
		_repos = repos;
		return repos;
	}

	const repos: Repositories = {
		accountLockout: sqliteAccountLockoutRepo,
		auth: sqliteAuthRepo,
		achievement: sqliteAchievementRepo,
		activity: sqliteActivityRepo,
		activityMastery: sqliteActivityMasteryRepo,
		activityPref: sqliteActivityPrefRepo,
		checklist: sqliteChecklistRepo,
		child: sqliteChildRepo,
		dailyMission: sqliteDailyMissionRepo,
		evaluation: sqliteEvaluationRepo,
		image: sqliteImageRepo,
		inquiry: sqliteInquiryRepo,
		loginBonus: sqliteLoginBonusRepo,
		message: sqliteMessageRepo,
		point: sqlitePointRepo,
		seasonEvent: sqliteSeasonEventRepo,
		settings: sqliteSettingsRepo,
		levelTitle: sqliteLevelTitleRepo,
		specialReward: sqliteSpecialRewardRepo,
		stampCard: sqliteStampCardRepo,
		status: sqliteStatusRepo,
		storage: sqliteStorageRepo,
		title: sqliteTitleRepo,
		voice: sqliteVoiceRepo,
	};
	_repos = repos;

	return repos;
}
