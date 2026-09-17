import { Service } from '@n8n/di';
import { DataSource, Repository } from '@n8n/typeorm';

import { CodexCodingRun } from './codex-coding-run.entity';

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
}
