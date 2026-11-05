# Issue tracker: Local Markdown

Issues and specs for this repo live as markdown files in `.scratch/`. No GitHub issue creation is required.

## Conventions

- One feature or roadmap effort per directory: `.scratch/<feature-slug>/`
- The repo-level product spec is `docs/现状与下一步开发方向.md`; a feature-specific spec may live at `.scratch/<feature-slug>/spec.md`
- Implementation issues are one file per ticket at `.scratch/<feature-slug>/issues/<NN>-<slug>.md`, numbered from `01`, never a single combined tickets file
- Triage state is recorded as a `Status:` line near the top of each issue file; see `triage-labels.md` for the role strings
- Comments and conversation history append to the bottom of the file under a `## Comments` heading
- Blocking edges use a `**Blocked by:**` line naming ticket numbers and titles; a ticket is ready when all listed tickets are complete

## When a skill says "publish to the issue tracker"

Create one new file under `.scratch/<feature-slug>/issues/`, creating the directory if needed. Number it after the highest existing ticket and put its blockers in the `Blocked by` line.

## When a skill says "fetch the relevant ticket"

Read the file at the referenced path. The user will normally pass the path or the issue number directly.
