# Domain Docs

How the engineering skills should consume SideX's domain documentation when exploring the codebase.

## Before exploring, read these

- `GLOSSARY.md` at the repo root: canonical product vocabulary and terms to avoid.
- `docs/adr/`: ADRs that touch the area you are about to work in. Current decisions cover product boundary, extension end state, and large-directory virtual scrolling.

If any of these files do not exist, proceed silently. Do not flag their absence or suggest creating them upfront; `/domain-modeling` creates them lazily when terms or decisions are actually resolved.

## File structure

Single-context repo:

```
/
├── GLOSSARY.md
├── docs/adr/
│   ├── 0001-产品边界.md
│   ├── 0002-扩展体系终态.md
│   └── 0003-大目录虚拟滚动.md
└── src/
```

## Use the glossary's vocabulary

When output names a domain concept (in an issue title, a refactor proposal, a hypothesis, or a test name), use the term as defined in `GLOSSARY.md`. Do not drift to synonyms the glossary explicitly avoids.

If a concept is missing from the glossary, either reconsider whether the project actually uses that language, or note the gap for `/domain-modeling`.

## Flag ADR conflicts

If proposed work contradicts an existing ADR, surface it explicitly instead of silently overriding it. Reopen the decision with a new ADR rather than editing the old rationale away.
