import type { AuthenticatedRequest } from '@n8n/db';
import { Get, Param, ProjectScope, RestController } from '@n8n/decorators';
import type { Response } from 'express';
import { readFile } from 'node:fs/promises';

import { NotFoundError } from '@/errors/response-errors/not-found.error';

import { CodexCodingService } from './codex-coding.service';

@RestController('/codex-coding')
export class CodexCodingController {
	constructor(private readonly service: CodexCodingService) {}

	@Get('/repositories')
	async repositories() {
		return await this.service.listRepositories();
	}

	@Get('/health')
	async health() {
		return await this.service.health();
	}

	@Get('/:projectId/runs/:runId/diff/:artifactId')
	@ProjectScope('workflow:read')
	async diff(
		req: AuthenticatedRequest<{ projectId: string }>,
		res: Response,
		@Param('runId') runId: string,
		@Param('artifactId') artifactId: string,
	) {
		const filePath = await this.service.getDiffPath(runId, artifactId, req.params.projectId);
		if (!filePath) throw new NotFoundError('Codex diff artifact was not found');
		res.type('text/x-diff');
		return await readFile(filePath, 'utf8');
	}
}
