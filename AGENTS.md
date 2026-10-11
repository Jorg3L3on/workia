<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Design

- Never put a left accent or color bar on cards.

## Plan

The plan for this product lives in Plania (MCP server `plania`, project `workia`, key prefix `WRK`), not in this repo. Linear is no longer the source of the plan.
Follow the protocol in the Plania server's instructions (sent on connect, versioned) and the project's rules and settings (`get_project`). Do not copy the protocol here: it changes in Plania.

- Start: `get_context` with your branch and worktree when you are on a branch; otherwise `get_resume`, then `get_task`.
- Pinned decisions (`get_memory`) are binding; read the initiative's decisions before touching its code.
- Never mark Done or Won't do: `request_approval`, then pass the `approval_id` Jorge grants.
- Migration numbers come from Plania: `reserve_sequence` with `name: "migration"` before `npm run db:generate`.
- Put "Plania: <KEY>" in every PR body.

## Branches and deploys

- `main` is production and the only branch Vercel builds (`vercel.json`); nothing else gets a preview, so verify locally.
- `sandbox` is the integration branch. An initiative works on its `integration_branch` from Plania (`jl/<slug>` off `sandbox`) and opens one PR into `sandbox`; standalone fixes PR `jl/<slug>` → `sandbox`.
- Agents open PRs but never merge into `sandbox` or `main`, and never deploy: only Jorge merges `sandbox` → `main`.
- Before a PR: `npm run typecheck`, `npm run lint`, `npm run test`, `npm run build` (plus `npm run test:e2e` when the change touches a flow it covers).
