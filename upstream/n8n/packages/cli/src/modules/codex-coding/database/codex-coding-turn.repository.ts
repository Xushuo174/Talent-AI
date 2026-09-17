import { Service } from '@n8n/di';
import { DataSource, Repository } from '@n8n/typeorm';

import { CodexCodingTurn } from './codex-coding-turn.entity';

@Service()
export class CodexCodingTurnRepository extends Repository<CodexCodingTurn> {
	constructor(dataSource: DataSource) {
		super(CodexCodingTurn, dataSource.manager);
	}

	async findArtifact(runId: string, artifactId: string) {
		return await this.findOne({ where: { runId, diffArtifactId: artifactId } });
	}
}
