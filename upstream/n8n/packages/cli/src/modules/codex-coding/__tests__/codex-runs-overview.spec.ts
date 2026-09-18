vi.mock('@/permissions.ee/check-access', () => ({ userHasScopes: vi.fn() }));

import type { GlobalConfig } from '@n8n/config';
import type { User } from '@n8n/db';
import { ControllerRegistryMetadata } from '@n8n/decorators';
import { Container } from '@n8n/di';
import type { DataSource, SelectQueryBuilder } from '@n8n/typeorm';
import express from 'express';
import request from 'supertest';
import { mock, mockDeep } from 'vitest-mock-extended';

import type { AuthService } from '@/auth/auth.service';
import { ControllerRegistry } from '@/controller.registry';
import type { License } from '@/license';
import { userHasScopes } from '@/permissions.ee/check-access';
import type { LastActiveAtService } from '@/services/last-active-at.service';
import { RateLimitService } from '@/services/rate-limit.service';

import { CodexCodingController } from '../codex-coding.controller';
import { CodexCodingService } from '../codex-coding.service';
import { CodexCodingRun } from '../database/codex-coding-run.entity';
import { CodexCodingRunRepository } from '../database/codex-coding-run.repository';

type RawRow = Record<string, Date | null | number | string>;

function createQueryBuilder(rows: RawRow[]) {
	const builder = mockDeep<SelectQueryBuilder<CodexCodingRun>>();
	builder.select.mockReturnValue(builder);
	builder.addSelect.mockReturnValue(builder);
	builder.leftJoin.mockReturnValue(builder);
	builder.where.mockReturnValue(builder);
	builder.andWhere.mockReturnValue(builder);
	builder.groupBy.mockReturnValue(builder);
	builder.addGroupBy.mockReturnValue(builder);
	builder.orderBy.mockReturnValue(builder);
	builder.limit.mockReturnValue(builder);
	builder.getRawMany.mockResolvedValue(rows);
	return builder;
}

describe('GET /codex-coding/:projectId/runs', () => {
	const projectId = '62000000-0000-4000-8000-000000000010';
	const user = mock<User>({ id: 'user-id' });
	const service = mock<CodexCodingService>();
	const userHasScopesMock = vi.mocked(userHasScopes);
	let app: express.Express;

	beforeEach(() => {
		vi.clearAllMocks();
		Container.set(CodexCodingService, service);

		const authService = mock<AuthService>();
		authService.createAuthMiddleware.mockReturnValue(async (req, _res, next) => {
			req.user = user;
			next();
		});
		const lastActiveAtService = mock<LastActiveAtService>();
		lastActiveAtService.middleware.mockImplementation(async (_req, _res, next) => next());

		app = express();
		new ControllerRegistry(
			mock<License>(),
			authService,
			mock<GlobalConfig>({ endpoints: { rest: 'rest' } }),
			Container.get(ControllerRegistryMetadata),
			lastActiveAtService,
			new RateLimitService(),
		).activate(app);
	});

	test('is production-registered as a read-only workflow:read route', () => {
		const metadata = Container.get(ControllerRegistryMetadata).getControllerMetadata(
			CodexCodingController as never,
		);
		const route = metadata.routes.get('overview');

		expect(metadata.basePath).toBe('/codex-coding');
		expect(route).toMatchObject({ method: 'get', path: '/:projectId/runs' });
		expect(route?.accessScope).toEqual({
			scope: 'workflow:read',
			globalOnly: false,
		});
	});

	test('returns 403 without workflow:read access to the project', async () => {
		userHasScopesMock.mockResolvedValue(false);

		await request(app).get(`/rest/codex-coding/${projectId}/runs`).expect(403);

		expect(userHasScopesMock).toHaveBeenCalledWith(user, ['workflow:read'], false, {
			projectId,
		});
		expect(service.getRunsOverview).not.toHaveBeenCalled();
	});

	test('calculates the overview and returns only safe fields', async () => {
		userHasScopesMock.mockResolvedValue(true);
		const statusQuery = createQueryBuilder([
			{ status: 'completed', count: '1' },
			{ status: 'verification_failed', count: '1' },
			{ status: 'running', count: '1' },
		]);
		const durationQuery = createQueryBuilder([
			{
				startedAt: '2026-09-18T01:00:00.000Z',
				runUpdatedAt: '2026-09-18T01:00:02.000Z',
				latestTurnUpdatedAt: '2026-09-18T01:00:02.000Z',
			},
			{
				startedAt: '2026-09-18T02:00:00.000Z',
				runUpdatedAt: '2026-09-18T02:00:04.000Z',
				latestTurnUpdatedAt: '2026-09-18T02:00:04.000Z',
			},
		]);
		const recentQuery = createQueryBuilder([
			{
				id: 'running-run',
				workflowId: 'workflow-running',
				workflowExecutionId: 'execution-running',
				repositoryId: 'talent-ai',
				branchName: 'codex/running',
				status: 'running',
				startedAt: '2026-09-18T03:00:00.000Z',
				runUpdatedAt: '2026-09-18T03:00:00.000Z',
				latestTurnUpdatedAt: null,
				turnCount: '0',
				worktreePath: 'C:\\private\\running',
				codexSessionId: 'secret-session',
				prompt: 'secret prompt',
				error: 'secret stack trace',
			},
			{
				id: 'failed-run',
				workflowId: 'workflow-failed',
				workflowExecutionId: 'execution-failed',
				repositoryId: 'talent-ai',
				branchName: 'codex/failed',
				status: 'verification_failed',
				startedAt: '2026-09-18T02:00:00.000Z',
				runUpdatedAt: '2026-09-18T02:00:04.000Z',
				latestTurnUpdatedAt: '2026-09-18T02:00:04.000Z',
				turnCount: '1',
			},
			{
				id: 'completed-run',
				workflowId: 'workflow-completed',
				workflowExecutionId: 'execution-completed',
				repositoryId: 'talent-ai',
				branchName: 'codex/completed',
				status: 'completed',
				startedAt: '2026-09-18T01:00:00.000Z',
				runUpdatedAt: '2026-09-18T01:00:02.000Z',
				latestTurnUpdatedAt: '2026-09-18T01:00:02.000Z',
				turnCount: '1',
			},
		]);
		const repository = new CodexCodingRunRepository(mock<DataSource>());
		vi.spyOn(repository, 'createQueryBuilder')
			.mockReturnValueOnce(statusQuery)
			.mockReturnValueOnce(durationQuery)
			.mockReturnValueOnce(recentQuery);
		service.getRunsOverview.mockImplementation(
			async (requestedProjectId, limit, status) =>
				await repository.getOverview(requestedProjectId, { limit, status }),
		);

		const response = await request(app)
			.get(`/rest/codex-coding/${projectId}/runs`)
			.query({ limit: 3 })
			.expect(200);

		expect(response.body.data.stats).toEqual({
			total: 3,
			succeeded: 1,
			failed: 1,
			averageDurationMs: 3000,
		});
		expect(response.body.data.recentRuns.map((run: { id: string }) => run.id)).toEqual([
			'running-run',
			'failed-run',
			'completed-run',
		]);
		expect(response.body.data.recentRuns[1]).toMatchObject({
			id: 'failed-run',
			workflowId: 'workflow-failed',
			workflowExecutionId: 'execution-failed',
			repositoryId: 'talent-ai',
			branchName: 'codex/failed',
			status: 'verification_failed',
			durationMs: 4000,
			turnCount: 1,
		});
		expect(statusQuery.where).toHaveBeenCalledWith('run.projectId = :projectId', { projectId });
		expect(recentQuery.orderBy).toHaveBeenCalledWith('run.createdAt', 'DESC');
		expect(recentQuery.limit).toHaveBeenCalledWith(3);

		const serialized = JSON.stringify(response.body.data);
		expect(serialized).not.toContain('worktreePath');
		expect(serialized).not.toContain('codexSessionId');
		expect(serialized).not.toContain('secret prompt');
		expect(serialized).not.toContain('secret stack trace');
		expect(serialized).not.toContain('error');
	});

	test('passes the optional status filter only to the recent runs query', async () => {
		const statusQuery = createQueryBuilder([{ status: 'completed', count: '2' }]);
		const durationQuery = createQueryBuilder([]);
		const recentQuery = createQueryBuilder([]);
		const repository = new CodexCodingRunRepository(mock<DataSource>());
		vi.spyOn(repository, 'createQueryBuilder')
			.mockReturnValueOnce(statusQuery)
			.mockReturnValueOnce(durationQuery)
			.mockReturnValueOnce(recentQuery);

		const overview = await repository.getOverview(projectId, { limit: 1, status: 'completed' });

		expect(overview.stats.total).toBe(2);
		expect(recentQuery.andWhere).toHaveBeenCalledWith('run.status = :status', {
			status: 'completed',
		});
		expect(recentQuery.limit).toHaveBeenCalledWith(1);
	});
});
