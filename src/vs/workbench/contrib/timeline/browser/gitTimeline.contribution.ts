/*---------------------------------------------------------------------------------------------
 *  SideX: Git timeline provider.
 *  Feeds the native Timeline view with the commit history of the active file, using the
 *  Rust `sidex-git` crate instead of the (disabled) Node git extension.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../../base/common/cancellation.js';
import { Codicon } from '../../../../base/common/codicons.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { URI } from '../../../../base/common/uri.js';
import { localize } from '../../../../nls.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { CommandsRegistry, ICommandService } from '../../../../platform/commands/common/commands.js';
import { WorkbenchPhase, registerWorkbenchContribution2 } from '../../../common/contributions.js';
import {
	ITimelineService,
	Timeline,
	TimelineItem,
	TimelineOptions,
	TimelineProvider
} from '../common/timeline.js';

const OPEN_COMMIT_COMMAND_ID = 'sidex.gitTimeline.openCommit';

// The Timeline pane appends the tree's open event to item commands that use the built-in
// `_workbench.diff`/`_workbench.open` ids, which this fork's handlers do not accept, so
// item commands go through our own command instead.
CommandsRegistry.registerCommand(OPEN_COMMIT_COMMAND_ID, async (accessor, original: URI, modified: URI, label: string) => {
	const commandService = accessor.get(ICommandService);
	await commandService.executeCommand('vscode.diff', original, modified, label);
});

interface GitCommit {
	hash: string;
	message: string;
	author: string;
	date: string;
}

async function invokeGit<T>(cmd: string, args?: Record<string, unknown>): Promise<T | undefined> {
	try {
		const mod = await import('@tauri-apps/api/core');
		return (await mod.invoke(cmd, args)) as T;
	} catch {
		return undefined;
	}
}

function toRelativePath(root: string, file: string): string | undefined {
	const normalizedRoot = root.replace(/\\/g, '/').replace(/\/+$/, '');
	const normalizedFile = file.replace(/\\/g, '/');
	if (!normalizedFile.toLowerCase().startsWith(`${normalizedRoot.toLowerCase()}/`)) {
		return undefined;
	}
	return normalizedFile.slice(normalizedRoot.length + 1);
}

class GitTimelineProvider implements TimelineProvider {
	readonly id = 'git-history';
	readonly label = localize('gitTimeline.label', 'Git History');
	readonly scheme = 'file';

	private readonly onDidChange = undefined;

	constructor(private readonly workspaceContextService: IWorkspaceContextService) { }

	dispose(): void {
		// Nothing to clean up: the workspace service is owned by the workbench.
	}

	async provideTimeline(uri: URI, options: TimelineOptions, token: CancellationToken): Promise<Timeline | undefined> {
		if (uri.scheme !== 'file') {
			return undefined;
		}

		const filePath = uri.fsPath;
		const folder = this.workspaceContextService.getWorkspace().folders
			.find(candidate => toRelativePath(candidate.uri.fsPath, filePath) !== undefined);
		if (!folder) {
			return undefined;
		}

		const relativePath = toRelativePath(folder.uri.fsPath, filePath);
		if (!relativePath) {
			return undefined;
		}

		const limit = options.limit ?? 50;
		const offset = options.cursor ? Number(options.cursor) : 0;
		const commits = await invokeGit<GitCommit[]>('git_file_log', {
			path: folder.uri.fsPath,
			file: relativePath,
			limit,
			skip: offset
		});
		if (!commits || token.isCancellationRequested) {
			return undefined;
		}

		const items: TimelineItem[] = commits.map(commit => {
			const original = URI.from({ scheme: 'git-original', path: `/${relativePath}`, query: commit.hash });
			const name = relativePath.slice(relativePath.lastIndexOf('/') + 1);
			return {
				handle: commit.hash,
				source: this.id,
				label: commit.message,
				description: commit.author,
				timestamp: Date.parse(commit.date),
				themeIcon: Codicon.gitCommit,
				tooltip: `${commit.message}\n\n${commit.author}`,
				command: {
					id: OPEN_COMMIT_COMMAND_ID,
					title: localize('gitTimeline.openCommit', 'Open Commit'),
					arguments: [original, uri, `${name} (${commit.hash.slice(0, 7)})`]
				}
			};
		});

		return {
			source: this.id,
			items,
			cursor: commits.length >= limit ? String(offset + commits.length) : undefined
		};
	}
}

class GitTimelineContribution extends Disposable {

	constructor(
		@ITimelineService timelineService: ITimelineService,
		@IWorkspaceContextService workspaceContextService: IWorkspaceContextService
	) {
		super();
		this._register(timelineService.registerTimelineProvider(new GitTimelineProvider(workspaceContextService)));
	}
}

registerWorkbenchContribution2('workbench.contrib.gitTimeline', GitTimelineContribution, WorkbenchPhase.AfterRestored);
