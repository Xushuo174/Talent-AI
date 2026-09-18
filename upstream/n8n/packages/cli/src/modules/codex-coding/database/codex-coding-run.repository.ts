import { Service } from '@n8n/di';
import { DataSource, Repository } from '@n8n/typeorm';
import type {
	CodexRunOverviewItem,
	CodexRunsOverview,
	CodexRunStatus,
	CodexRunStatusCount,
} from '@n8n/api-types';

import { CodexCodingRun } from './codex-coding-run.entity';
import { CodexCodingTurn } from './codex-coding-turn.entity';

const FAILED_STATUSES = new Set<CodexRunStatus>([
	'verification_failed',
	'policy_blocked',
	'timed_out',
	'cancelled',
	'runtime_failed',
]);

const ACTIVE_STATUSES = new Set<CodexRunStatus>(['preparing', 'running']);

type StatusCountRaw = { status: CodexRunStatus; count: string | number };

type DurationRaw = {
	startedAt: Date | string;
	runUpdatedAt: Date | string;
	latestTurnUpdatedAt: Date | string | null;
};

type RecentRunRaw = DurationRaw & {
	id: string;
	workflowId: string;
	workflowExecutionId: string;
	repositoryId: string;
	branchName: string;
	status: CodexRunStatus;
	turnCount: string | number;
};

function millisecondsBetween(start: Date | string, end: Date | string): number {
	return Math.max(0, new Date(end).getTime() - new Date(start).getTime());
}

function endTime(row: DurationRaw): Date | string {
	return row.latestTurnUpdatedAt ?? row.runUpdatedAt;
}

@Service()
export class CodexCodingRunRepository extends Repository<CodexCodingRun> {
	constructor(dataSource: DataSource) {
		super(CodexCodingRun, dataSource.manager);
	}

	async findForInvocation(workflowExecutionId: string, nodeId: string) {
		return await this.findOne({ where: { workflowExecutionId, nodeId } });
	}

	async findByIdAndProject(id: string, projectId: string) {
		return await this.findOne({ where: { id, projectId } });
	}

	async getOverview(
		projectId: string,
		options: { limit: number; status?: CodexRunStatus },
	): Promise<CodexRunsOverview> {
		const statusRows = await this.createQueryBuilder('run')
			.select('run.status', 'status')
			.addSelect('COUNT(run.id)', 'count')
			.where('run.projectId = :projectId', { projectId })
			.groupBy('run.status')
			.getRawMany<StatusCountRaw>();

		const durationRows = await this.createQueryBuilder('run')
			.leftJoin(CodexCodingTurn, 'turn', 'turn.runId = run.id')
			.select('run.createdAt', 'startedAt')
			.addSelect('run.updatedAt', 'runUpdatedAt')
			.addSelect('MAX(turn.updatedAt)', 'latestTurnUpdatedAt')
			.where('run.projectId = :projectId', { projectId })
			.andWhere('run.status NOT IN (:...activeStatuses)', {
				activeStatuses: [...ACTIVE_STATUSES],
			})
			.groupBy('run.id')
			.addGroupBy('run.createdAt')
			.addGroupBy('run.updatedAt')
			.getRawMany<DurationRaw>();

		const recentQuery = this.createQueryBuilder('run')
			.leftJoin(CodexCodingTurn, 'turn', 'turn.runId = run.id')
			.select('run.id', 'id')
			.addSelect('run.workflowId', 'workflowId')
			.addSelect('run.workflowExecutionId', 'workflowExecutionId')
			.addSelect('run.repositoryId', 'repositoryId')
			.addSelect('run.branchName', 'branchName')
			.addSelect('run.status', 'status')
			.addSelect('run.createdAt', 'startedAt')
			.addSelect('run.updatedAt', 'runUpdatedAt')
			.addSelect('MAX(turn.updatedAt)', 'latestTurnUpdatedAt')
			.addSelect('COUNT(turn.id)', 'turnCount')
			.where('run.projectId = :projectId', { projectId });

		if (options.status) {
			recentQuery.andWhere('run.status = :status', { status: options.status });
		}

		const recentRows = await recentQuery
			.groupBy('run.id')
			.addGroupBy('run.workflowId')
			.addGroupBy('run.workflowExecutionId')
			.addGroupBy('run.repositoryId')
			.addGroupBy('run.branchName')
			.addGroupBy('run.status')
			.addGroupBy('run.createdAt')
			.addGroupBy('run.updatedAt')
			.orderBy('run.createdAt', 'DESC')
			.limit(options.limit)
			.getRawMany<RecentRunRaw>();

		const statusCounts: CodexRunStatusCount[] = statusRows.map((row) => ({
			status: row.status,
			count: Number(row.count),
		}));
		const total = statusCounts.reduce((sum, item) => sum + item.count, 0);
		const succeeded = statusCounts.find((item) => item.status === 'completed')?.count ?? 0;
		const failed = statusCounts
			.filter((item) => FAILED_STATUSES.has(item.status))
			.reduce((sum, item) => sum + item.count, 0);
		const totalDurationMs = durationRows.reduce(
			(sum, row) => sum + millisecondsBetween(row.startedAt, endTime(row)),
			0,
		);

		const recentRuns: CodexRunOverviewItem[] = recentRows.map((row) => {
			const active = ACTIVE_STATUSES.has(row.status);
			const endedAt = active ? null : new Date(endTime(row)).toISOString();
			return {
				id: row.id,
				workflowId: row.workflowId,
				workflowExecutionId: row.workflowExecutionId,
				repositoryId: row.repositoryId,
				branchName: row.branchName,
				status: row.status,
				startedAt: new Date(row.startedAt).toISOString(),
				endedAt,
				durationMs: active ? null : millisecondsBetween(row.startedAt, endTime(row)),
				turnCount: Number(row.turnCount),
			};
		});

		return {
			stats: {
				total,
				succeeded,
				failed,
				averageDurationMs: durationRows.length
					? Math.round(totalDurationMs / durationRows.length)
					: 0,
			},
			statusCounts,
			recentRuns,
		};
	}
}
