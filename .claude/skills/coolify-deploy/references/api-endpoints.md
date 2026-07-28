# Coolify API Endpoint Reference

Verified against the Coolify OpenAPI spec (`openapi.json` in the coollabsio/coolify repo). Base URL: `{COOLIFY_URL}/api/v1`. All requests: `Authorization: Bearer $COOLIFY_API_TOKEN` and `Accept: application/json` (add `Content-Type: application/json` on bodies).

Permission column: R = read, W = write, D = deploy.

## Deployments

| Method | Path | Perm | Notes |
|---|---|---|---|
| POST | `/deploy` | D | Query params: `uuid` (comma-separated ok), `tag` (comma-separated ok), `force` (bool — omit entirely for cached builds), `pr` / `pull_request_id` (int, PR preview; cannot combine with `tag`), `docker_tag` (image-tag previews, requires `pull_request_id`). Also accepts a JSON body with `uuid`/`tag`. Returns `{deployments:[{message, resource_uuid, deployment_uuid}]}` |
| GET | `/deployments` | D | Currently **running** deployments only |
| GET | `/deployments/{uuid}` | D | Deployment status + logs. Status values include `queued`, `in_progress`, `finished`, `failed`, `cancelled-by-user` |
| GET | `/deployments/applications/{uuid}` | D | Deployment **history** for an app. Query: `skip`, `take` |
| POST | `/deployments/{uuid}/cancel` | D | 400 if already finished/failed/cancelled |

## Applications

| Method | Path | Perm | Notes |
|---|---|---|---|
| GET | `/applications` | R | uuid, name, status, fqdn, git info |
| GET / PATCH / DELETE | `/applications/{uuid}` | R / W / W | PATCH is partial update; location + build_pack fields are immutable |
| POST | `/applications/public` | W | Public Git repo. Required: `project_uuid`, `server_uuid`, `environment_name` **or** `environment_uuid`, `git_repository`, `git_branch`, `build_pack` (`nixpacks`\|`static`\|`dockerfile`\|`dockercompose`). Useful: `ports_exposes`, `domains`, `name`, `instant_deploy`, `install_command`, `build_command`, `start_command`, `is_static` |
| POST | `/applications/private-github-app` | W | Private repo via GitHub App (`github_app_uuid`) |
| POST | `/applications/private-deploy-key` | W | Private repo via SSH deploy key (`private_key_uuid`) |
| POST | `/applications/dockerfile` | W | Inline Dockerfile, no Git |
| POST | `/applications/dockerimage` | W | Pre-built registry image (`docker_registry_image_name`, `docker_registry_image_tag`) |
| POST | `/applications/{uuid}/start` | D | Query: `force` (rebuild), `instant_deploy` (skip queue). Equivalent to UI Deploy button |
| POST | `/applications/{uuid}/stop` | D | Graceful stop, then kill |
| POST | `/applications/{uuid}/restart` | D | Rolling restart; git apps redeploy |
| GET | `/applications/{uuid}/logs` | R | Runtime container logs (query: `lines`) |
| POST | `/applications/{uuid}/move` | W | Move between projects/environments |
| GET/POST | `/applications/{uuid}/tags`, DELETE `/tags/{tag_uuid}` | R/W | Tag apps for group deploys |
| DELETE | `/applications/{uuid}/previews/{pull_request_id}` | W | Tear down a PR preview |

## Environment variables (same shape for `/databases/{uuid}/…` and `/services/{uuid}/…`)

| Method | Path | Perm |
|---|---|---|
| GET / POST / PATCH | `/applications/{uuid}/envs` | R / W / W |
| PATCH | `/applications/{uuid}/envs/bulk` | W — body `{"data":[{key, value, is_preview, is_build_time, is_literal, is_multiline, is_shown_once}]}` |
| DELETE | `/applications/{uuid}/envs/{env_uuid}` | W |

Env changes require a redeploy to take effect. `is_build_time: true` makes the var available during image build (relevant on build servers).

## Scheduled tasks (cron)

Cron jobs run as a command **inside an existing application's container** —
there is no standalone cron resource. Same shape under `/services/{uuid}/…`.

| Method | Path | Perm | Notes |
|---|---|---|---|
| GET | `/applications/{uuid}/scheduled-tasks` | R | Returns `[]` when none |
| POST | `/applications/{uuid}/scheduled-tasks` | W | Body `{name, command, frequency}` → 201 with the task `uuid` |
| PATCH | `/applications/{uuid}/scheduled-tasks/{task_uuid}` | W | Same body shape → 200 with the updated task |
| DELETE | `/applications/{uuid}/scheduled-tasks/{task_uuid}` | W | → 200 `{"message":"Scheduled task deleted."}` |

There is **no show route**: `GET /applications/{uuid}/scheduled-tasks/{task_uuid}`
returns 404 (verified on Coolify 4.2.0). Read a single task by listing and
filtering on `uuid`. The four rows above were each exercised against a live
4.2.0 instance.

Task fields: `frequency` (5-field cron), `command`, `enabled` (default `true`),
`timeout` (seconds, default `300`), `container` (`null` = the app's default
container).

`timeout` is independent of `frequency` — a job whose runtime can exceed its
interval may overlap with itself. Cron granularity bottoms out at one minute;
for anything faster run a persistent service with an internal loop.

## Servers & infrastructure

| Method | Path | Perm | Notes |
|---|---|---|---|
| GET / POST | `/servers` | R / W | Server objects include `is_build_server` / build-server settings |
| GET / PATCH / DELETE | `/servers/{uuid}` | R / W / W | |
| POST | `/servers/{uuid}/validate` | W | Synchronous SSH + Docker check — first stop for "deploy hangs" |
| GET | `/servers/{uuid}/resources` | R | What's deployed where |
| GET | `/servers/{uuid}/domains` | R | |
| GET / POST | `/servers/{server_uuid}/destinations` | R / W | Docker networks/destinations |
| POST | `/servers/hetzner`, `/servers/digitalocean`, `/servers/vultr` | W | Cloud provisioning (paired GET catalogs under `/hetzner/*`, `/digitalocean/*`, `/vultr/*`) |

## Projects, environments, teams, resources

| Method | Path | Perm |
|---|---|---|
| GET / POST | `/projects` | R / W |
| GET / PATCH / DELETE | `/projects/{uuid}` | R / W / W |
| GET | `/projects/{uuid}/{environment_name_or_uuid}` | R |
| GET / POST | `/projects/{uuid}/environments` (+ DELETE by name/uuid) | R / W |
| GET | `/resources` | R — everything across projects |
| GET | `/teams`, `/teams/current`, `/teams/{id}/members` | R |
| GET | `/tags` | R |

## Services (one-click / compose stacks)

CRUD at `/services` and `/services/{uuid}`; lifecycle `POST /services/{uuid}/start|stop|restart`; per-container control at `/services/{uuid}/applications/{app_uuid}/…` and `/services/{uuid}/databases/{db_uuid}/…` (get, patch, logs, start/stop/restart); envs/storages/tags mirror the application shape. Deploying a service = its `/start` endpoint or `/deploy?uuid=<service_uuid>`.

## Databases

Create via typed endpoints: `POST /databases/postgresql|mysql|mariadb|mongodb|redis|keydb|clickhouse|dragonfly`. CRUD at `/databases/{uuid}`, lifecycle `start|stop|restart`, logs, backups at `/databases/{uuid}/backups` (+ executions), storages, tags.

## Instance

| Method | Path | Notes |
|---|---|---|
| GET | `/version` | Cheap auth/connectivity check |
| GET | `{COOLIFY_URL}/api/health` | No auth, outside `/v1` |
| POST | `/enable` / `/disable` | Toggle API (root only) |
| POST | `/mcp/enable` / `/mcp/disable` | Instance MCP support |

## Response/error conventions

- 200 on `/deploy` means **queued**. Poll `/deployments/{deployment_uuid}`.
- 401 invalid token · 403 lists missing permissions · 404 wrong uuid **or** wrong team · 429 rate limit with `Retry-After` (default 200 req/min, `API_RATE_LIMIT` env on the instance).
- Sensitive fields (passwords, private keys, compose files) are redacted unless the token has `read:sensitive`.
