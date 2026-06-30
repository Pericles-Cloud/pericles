#!/usr/bin/env node
/**
 * Coolify deploy helper for the Pericles backend (Express API + WebSocket).
 *
 * RUN THIS FROM A MACHINE THAT CAN REACH YOUR COOLIFY INSTANCE (the Coolify
 * server itself, or a box on its LAN). It talks to the Coolify v4 REST API.
 *
 *   # 1. Introspect (safe, read-only) — prints servers/projects/apps + UUIDs.
 *   COOLIFY_URL=http://localhost:8000 COOLIFY_TOKEN=xxxxx node scripts/deploy-coolify.mjs
 *
 *   # 2. Apply — create/ensure project + app, sync env, deploy.
 *   COOLIFY_URL=... COOLIFY_TOKEN=... \
 *   COOLIFY_SERVER_UUID=<uuid> GIT_REPOSITORY=https://github.com/Pericles-Cloud/pericles \
 *   ENV_FILE=./coolify.env \
 *   node scripts/deploy-coolify.mjs --apply
 *
 * Config via env vars:
 *   COOLIFY_URL          (required) e.g. http://localhost:8000  (no trailing slash)
 *   COOLIFY_TOKEN        (required) Coolify API token (Keys & Tokens, read+write). Never logged.
 *   COOLIFY_PROJECT      project name to find-or-create        (default: pericles)
 *   COOLIFY_ENVIRONMENT  environment name                      (default: production)
 *   COOLIFY_SERVER_UUID  target server; auto-picked if exactly one exists
 *   APP_UUID             use an existing app (skip create) — recommended for a PRIVATE repo
 *                        you connected in the Coolify UI; the script then just syncs env + deploys
 *   COOLIFY_GITHUB_APP_UUID  for a private repo, the Coolify GitHub-App source uuid (from introspect)
 *   GIT_REPOSITORY       repo URL                              (default: https://github.com/Pericles-Cloud/pericles)
 *   GIT_BRANCH           branch to deploy                      (default: main)
 *   BASE_DIRECTORY       repo subdir holding the Dockerfile    (default: /backend)
 *   PORTS                exposed port                          (default: 4112)
 *   APP_NAME             application name                      (default: pericles-backend)
 *   ENV_FILE             path to a KEY=VALUE file of app env vars to sync (e.g. DATABASE_URL=...)
 *
 * Flags: --apply (do it; default is dry-run) · --no-deploy (create/sync but don't trigger a deploy)
 */

import { readFileSync } from 'node:fs';

const URL = (process.env.COOLIFY_URL || '').replace(/\/+$/, '');
const TOKEN = process.env.COOLIFY_TOKEN || '';
const APPLY = process.argv.includes('--apply');
const NO_DEPLOY = process.argv.includes('--no-deploy');

const cfg = {
  project: process.env.COOLIFY_PROJECT || 'pericles',
  environment: process.env.COOLIFY_ENVIRONMENT || 'production',
  serverUuid: process.env.COOLIFY_SERVER_UUID || '',
  appUuid: process.env.APP_UUID || '',
  githubAppUuid: process.env.COOLIFY_GITHUB_APP_UUID || '',
  gitRepository: process.env.GIT_REPOSITORY || 'https://github.com/Pericles-Cloud/pericles',
  gitBranch: process.env.GIT_BRANCH || 'main',
  baseDirectory: process.env.BASE_DIRECTORY || '/backend',
  ports: process.env.PORTS || '4112',
  appName: process.env.APP_NAME || 'pericles-backend',
  envFile: process.env.ENV_FILE || '',
};

if (!URL || !TOKEN) {
  console.error('ERROR: set COOLIFY_URL and COOLIFY_TOKEN.\nSee the header of this file for usage.');
  process.exit(1);
}

/** Minimal Coolify API client. Logs method+path (never the token); throws with status+body on error. */
async function api(method, path, body) {
  const res = await fetch(`${URL}/api/v1${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) {
    const err = new Error(`${method} ${path} -> ${res.status}`);
    err.status = res.status;
    err.body = data;
    throw err;
  }
  return data;
}

const pick = (arr, ...keys) =>
  (Array.isArray(arr) ? arr : []).map((o) =>
    Object.fromEntries(keys.map((k) => [k, o?.[k]])));

function parseEnvFile(path) {
  const out = [];
  for (const raw of readFileSync(path, 'utf8').split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 1) continue;
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    out.push({ key: line.slice(0, eq).trim(), value });
  }
  return out;
}

async function introspect() {
  console.log(`Coolify @ ${URL}`);
  const version = await api('GET', '/version').catch((e) => `(version error: ${e.status})`);
  console.log('version:', version);

  const servers = await api('GET', '/servers').catch(() => []);
  console.log('\nservers:', JSON.stringify(pick(servers, 'uuid', 'name', 'ip'), null, 2));

  const projects = await api('GET', '/projects').catch(() => []);
  console.log('\nprojects:', JSON.stringify(pick(projects, 'uuid', 'name'), null, 2));

  const apps = await api('GET', '/applications').catch(() => []);
  console.log('\napplications:', JSON.stringify(pick(apps, 'uuid', 'name', 'fqdn'), null, 2));

  return { servers, projects, apps };
}

async function ensureProject() {
  const projects = await api('GET', '/projects');
  const found = (projects || []).find((p) => p.name === cfg.project);
  if (found) {
    console.log(`project "${cfg.project}" exists: ${found.uuid}`);
    return found.uuid;
  }
  const created = await api('POST', '/projects', { name: cfg.project, description: 'Pericles backend' });
  console.log(`project "${cfg.project}" created: ${created.uuid}`);
  return created.uuid;
}

async function resolveServer() {
  if (cfg.serverUuid) return cfg.serverUuid;
  const servers = await api('GET', '/servers');
  if ((servers || []).length === 1) {
    console.log(`auto-selected the only server: ${servers[0].uuid} (${servers[0].name})`);
    return servers[0].uuid;
  }
  throw new Error('Multiple/zero servers — set COOLIFY_SERVER_UUID (see introspect output).');
}

async function createApp(projectUuid, serverUuid) {
  // Common fields for a Dockerfile build pack. The create endpoint differs for
  // public vs private (GitHub App) repos; pick based on COOLIFY_GITHUB_APP_UUID.
  const common = {
    project_uuid: projectUuid,
    server_uuid: serverUuid,
    environment_name: cfg.environment,
    git_repository: cfg.gitRepository,
    git_branch: cfg.gitBranch,
    build_pack: 'dockerfile',
    base_directory: cfg.baseDirectory,
    dockerfile_location: '/Dockerfile',
    ports_exposes: cfg.ports,
    name: cfg.appName,
    health_check_path: '/health',
    instant_deploy: false,
  };
  const [endpoint, payload] = cfg.githubAppUuid
    ? ['/applications/private-github-app', { ...common, github_app_uuid: cfg.githubAppUuid }]
    : ['/applications/public', common];
  console.log(`creating app via POST ${endpoint} …`);
  const created = await api('POST', endpoint, payload);
  console.log(`app created: ${created.uuid}`);
  return created.uuid;
}

async function syncEnv(appUuid) {
  if (!cfg.envFile) {
    console.log('no ENV_FILE set — skipping env sync (set app env vars in the Coolify UI, or pass ENV_FILE).');
    return;
  }
  const vars = parseEnvFile(cfg.envFile);
  console.log(`syncing ${vars.length} env vars from ${cfg.envFile} …`);
  for (const { key, value } of vars) {
    await api('POST', `/applications/${appUuid}/envs`, { key, value, is_preview: false }).catch(async (e) => {
      // Some versions require PATCH to update an existing key.
      if (e.status === 422 || e.status === 409) {
        await api('PATCH', `/applications/${appUuid}/envs`, { key, value, is_preview: false });
      } else throw e;
    });
    console.log(`  set ${key}`);
  }
}

async function deploy(appUuid) {
  if (NO_DEPLOY) { console.log('--no-deploy set; skipping deploy trigger.'); return; }
  console.log('triggering deploy …');
  const r = await api('GET', `/deploy?uuid=${appUuid}&force=false`);
  console.log('deploy queued:', JSON.stringify(r));
}

async function main() {
  await introspect();

  if (!APPLY) {
    console.log('\n--- DRY RUN: introspect only. Re-run with --apply to create/sync/deploy. ---');
    return;
  }

  console.log('\n=== APPLY ===');
  const serverUuid = await resolveServer();
  const projectUuid = await ensureProject();

  let appUuid = cfg.appUuid;
  if (appUuid) {
    console.log(`using existing app: ${appUuid}`);
  } else {
    appUuid = await createApp(projectUuid, serverUuid);
  }

  await syncEnv(appUuid);
  await deploy(appUuid);

  console.log('\nDone. Next: assign a domain to the app in Coolify (Traefik issues TLS + upgrades');
  console.log('WebSockets). Set the frontend NEXT_PUBLIC_API_URL to that URL, and add it to the');
  console.log('backend CORS_ORIGINS / FRONTEND_URL env vars.');
}

main().catch((e) => {
  console.error(`\nFAILED: ${e.message}`);
  if (e.body !== undefined) console.error('response:', JSON.stringify(e.body, null, 2));
  console.error('\nIf this is the create-app step on a PRIVATE repo: connect the repo once in the');
  console.error('Coolify UI (or set COOLIFY_GITHUB_APP_UUID from the introspect output), then re-run');
  console.error('with APP_UUID=<that app> to just sync env + deploy. Paste this error if an endpoint');
  console.error('shape differs by Coolify version and I will adjust.');
  process.exit(1);
});
