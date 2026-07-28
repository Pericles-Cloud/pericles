---
name: coolify-deploy
description: Deploy, host, and manage applications on a Coolify instance (self-hosted or Coolify Cloud) through the Coolify REST API. Use this skill whenever the user mentions Coolify, wants to deploy or redeploy an app to their Coolify server, trigger a remote deployment, check deployment status or build logs, manage Coolify environment variables, create a new application/resource on Coolify, or wire Coolify into CI/CD — even if they just say "deploy to my server" and Coolify is the known hosting platform. Also use for setups with a separate build server and application server. Requires a Coolify API token with the appropriate permissions.
---

# Coolify Deploy

Deploy and manage applications on Coolify via its REST API. Works with any reachable Coolify instance — self-hosted or Coolify Cloud (`https://app.coolify.io`) — including multi-server setups where a dedicated **build server** builds images and a separate **application server** runs them.

## Prerequisites and configuration

Two values are required. Read them from the environment (or a `.env` file the user points to) — never hardcode them, never echo the token back, and never commit it:

- `COOLIFY_URL` — base URL of the instance, e.g. `https://coolify.example.com` (no trailing slash, no `/api/v1` suffix)
- `COOLIFY_API_TOKEN` — API token created in the Coolify UI under **Keys & Tokens → API tokens**

All endpoints live under `{COOLIFY_URL}/api/v1` and use `Authorization: Bearer $COOLIFY_API_TOKEN`. The only exceptions are `/api/health` and `/api/feedback`.

If either value is missing, ask the user for it (or where their `.env` lives) before doing anything else. If they haven't created a token yet, tell them: Coolify UI → Keys & Tokens → API tokens → create token with the permissions listed below.

### Token permissions

Each endpoint requires a specific permission on the token: `read`, `write`, or `deploy`. A `403` response lists the missing permissions — surface that list to the user verbatim so they know exactly what to add.

- Deploy-only automation (CI/CD): `read` + `deploy` is the right scope
- Creating/updating apps, env vars, servers: also needs `write`
- `read:sensitive` controls whether secrets/keys/compose files come back redacted
- `root` bypasses everything — recommend against it unless the user is doing admin automation

Tokens are **bound to the team that was active when the token was created**. If an expected app/server doesn't appear in API responses, the most likely cause is that it belongs to a different team — say so before assuming it doesn't exist.

Rate limit: 200 requests/minute by default (`429` + `Retry-After` when exceeded). Poll deployment status at ~5s intervals, not in a tight loop.

## The helper script

`scripts/coolify.sh` wraps the common operations with curl + jq. Prefer it over hand-rolled curl for routine work; drop to raw curl for anything it doesn't cover (see `references/api-endpoints.md`).

```bash
scripts/coolify.sh check                     # verify URL, token, version, permissions
scripts/coolify.sh apps                      # list applications (uuid, name, status, fqdn)
scripts/coolify.sh app <uuid>                # application details
scripts/coolify.sh deploy <uuid> [--force]   # queue a deployment, prints deployment_uuid
scripts/coolify.sh deploy-tag <tag>          # deploy every resource carrying a tag
scripts/coolify.sh watch <deployment_uuid>   # poll until finished/failed, tail status
scripts/coolify.sh deployments [<app_uuid>]  # running deployments, or history for one app
scripts/coolify.sh logs <deployment_uuid>    # build/deploy logs for a deployment
scripts/coolify.sh cancel <deployment_uuid>  # cancel an in-progress deployment
scripts/coolify.sh servers                   # list servers (spot the build server here)
scripts/coolify.sh envs <app_uuid>           # list env vars for an app
scripts/coolify.sh tasks <app_uuid>          # list scheduled (cron) tasks
scripts/coolify.sh task-add <app_uuid> <name> <cron> <cmd...>  # add a scheduled task
scripts/coolify.sh task-rm <app_uuid> <task_uuid>              # delete one
```

## Standard deployment workflow

1. **Verify access first.** Run `check` (hits `/api/v1/version` and `/api/v1/teams/current`). A `401` means bad token; a connection failure means wrong URL or the API is disabled on the instance (Settings → API in the Coolify UI). Don't proceed until this passes.
2. **Resolve the target.** If the user gave a name, not a UUID, list applications and match by name/fqdn. If several apps share a name (staging vs production is common), show the candidates with their fqdn and server and ask which one — never guess on a deploy.
3. **Trigger the deploy.** `POST /deploy?uuid=<uuid>` queues it and returns `{deployments: [{message, resource_uuid, deployment_uuid}]}`. The call is asynchronous — a 200 means *queued*, not deployed.
4. **Watch it.** Poll `GET /deployments/{deployment_uuid}` until the status leaves `queued`/`in_progress`. On failure, pull the logs from the same response and diagnose the build error rather than just reporting "it failed."
5. **Confirm.** On success, report the app's fqdn and (optionally) hit it with a plain HTTP request to confirm it's serving.

Deploy several resources at once with comma-separated UUIDs (`uuid=a,b,c`) or by tag (`tag=production`). Tags are the cleanest way to model "deploy the whole stack."

### Force rebuild caveat

`force=true` rebuilds without Docker layer cache. **Omit the `force` parameter entirely for normal cached deploys** — several Coolify versions treat the mere presence of `force=false` in the query string as truthy and skip the cache anyway. The helper script already does this correctly.

## Build server + application server setups

When the user runs a dedicated build server, nothing changes about the API calls — the split is configuration, not a different deploy path:

- The build server is flagged at the **server** level (`is_build_server`) and enabled per-application (the "Use a build server" setting). Coolify orchestrates: clone + build on the build server, push the image, run it on the destination server.
- An application's `server_uuid` is always the **destination/application server**, never the build server. When creating apps via the API, point `server_uuid` at where it should *run*.
- The token's team must own **both** servers, or builds will fail with resources seemingly missing.
- Build failures in this setup surface in the deployment logs like any other — but if the error is about registry auth or image push, the problem is the build-server→registry→app-server pipeline, not the app itself. Check that both servers validate (`POST /servers/{uuid}/validate`) and share registry credentials.

## Creating a new application remotely

Needs `write` permission. Pick the creation endpoint by source type: `/applications/public` (public Git), `/applications/private-github-app`, `/applications/private-deploy-key`, `/applications/dockerfile` (inline Dockerfile), or `/applications/dockerimage` (pre-built image). Required fields for Git-based apps: `project_uuid`, `server_uuid`, `environment_name` or `environment_uuid`, `git_repository`, `git_branch`, `build_pack` (one of `nixpacks`, `static`, `dockerfile`, `dockercompose`). Discover the project/environment/server UUIDs via `GET /projects`, `GET /projects/{uuid}`, and `GET /servers` — don't ask the user to dig them out of the UI. Set `instant_deploy: true` in the body to deploy immediately on creation.

Note: `project_uuid`, `environment_*`, `server_uuid`, `destination_uuid`, and `build_pack` are **immutable after creation** — to change them, use the `/move` endpoint or recreate.

## Scheduled tasks (cron)

Coolify runs cron-style jobs **as a command inside an existing application's
container** — there is no separate "cron app" resource. This is the replacement
for a platform cron (Vercel Cron, GitHub Actions schedule) when the app already
runs as a container.

```bash
scripts/coolify.sh tasks <app_uuid>                                  # list
scripts/coolify.sh task-add <app_uuid> <name> <cron> <command...>    # create
scripts/coolify.sh task-rm <app_uuid> <task_uuid>                    # delete
```

Raw API (`W` permission to mutate):

| Method | Path | Notes |
|---|---|---|
| GET | `/applications/{uuid}/scheduled-tasks` | List; `[]` when none |
| POST | `/applications/{uuid}/scheduled-tasks` | Body: `{name, command, frequency}`; returns the task `uuid` |
| PATCH / DELETE | `/applications/{uuid}/scheduled-tasks/{task_uuid}` | Update / remove |

There is no show route — `GET …/scheduled-tasks/{task_uuid}` returns 404 on
4.2.0. To read one task, list them and filter on `uuid`.

`frequency` is a standard 5-field cron expression. The response also carries
`enabled` (defaults true), `timeout` (seconds, defaults 300), and `container`
(null = the app's default container). The same shape exists under
`/services/{uuid}/scheduled-tasks`.

Getting the command right matters more than the API call:

- **The command runs inside the container**, so it must resolve against the
  image's `WORKDIR` and use only what the image installs. Check the Dockerfile
  before choosing it — if the image runs TypeScript via `tsx`, schedule
  `npx tsx src/…/job.ts`, not `node dist/…/job.js`.
- **Avoid `npm run <script>`** when the script wraps `dotenv -e ../.env.local`
  or similar. Container config comes from env vars and `.env*` files are
  normally excluded from the image, so those wrappers fail. Invoke the runtime
  directly.
- **Exit code is the success signal** — a job that swallows errors and exits 0
  will look healthy while doing nothing. Make the entry point exit non-zero on
  failure.
- **`timeout` defaults to 300s and is not tied to `frequency`.** A job that can
  outrun its interval risks overlapping runs; either shorten the work, widen the
  schedule, or make the job idempotent.
- **A cron floor of one minute is a real constraint.** For sub-minute cadence,
  run a persistent service with its own internal loop instead of a scheduled
  task.

Report the cost of what you schedule: a per-minute task that fans out across
every tenant and calls a paid API is a materially different workload from the
same command run by hand, and the user may not have priced it.

## Environment variables

- List/create/update: `GET|POST|PATCH /applications/{uuid}/envs`
- Bulk sync (e.g. from a `.env` file): `PATCH /applications/{uuid}/envs/bulk` with `{"data": [{"key": "...", "value": "...", "is_preview": false, "is_build_time": true|false, "is_literal": ...}]}`
- Env var changes do **not** redeploy automatically — remind the user, and offer to trigger a deploy after syncing.
- When displaying env vars back to the user, show keys but mask values unless they explicitly ask for values.

## CI/CD integration

For "deploy on push" the simplest hook is a pipeline step calling the deploy endpoint:

```yaml
# GitHub Actions example
- name: Deploy to Coolify
  run: |
    curl --fail -X POST "$COOLIFY_URL/api/v1/deploy?uuid=${{ vars.COOLIFY_APP_UUID }}" \
      -H "Authorization: Bearer ${{ secrets.COOLIFY_API_TOKEN }}"
```

Store the token as a CI secret scoped to `read` + `deploy` only. Coolify also skips webhook deploys for commits whose message contains `[skip ci]` / `[skip cd]`. For PR preview deployments, pass `pr=<id>` to `/deploy` (cannot be combined with `tag`).

## Troubleshooting map

| Symptom | Likely cause | Action |
|---|---|---|
| 401 | Bad/expired token | Recreate token in Keys & Tokens |
| 403 with permission list | Token missing that permission | Add listed permission or new token |
| Resource not in list responses | Token bound to a different team | Recreate token with correct team active |
| Connection refused / 404 on `/api/v1/*` | Wrong URL or API disabled | Check `COOLIFY_URL`; enable API in instance settings |
| 429 | Rate limit (200/min) | Honor `Retry-After`, slow polling |
| Deploy queued but never runs | Server unreachable / another deploy holds the queue | `GET /deployments` for the queue; `POST /servers/{uuid}/validate` |
| Build fails only with build server enabled | Registry/push between servers | Validate both servers, check registry credentials |

For any endpoint detail not covered here (databases, services, storage, scheduled tasks, server provisioning), read `references/api-endpoints.md`. If behavior still doesn't match, the authoritative source is the instance itself — the spec ships in the Coolify repo as `openapi.json`, and version-specific docs are at https://coolify.io/docs/api-reference.
