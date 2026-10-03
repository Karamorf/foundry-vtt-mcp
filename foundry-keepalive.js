#!/usr/bin/env node
'use strict';

// Keeps a headless GM client joined to the Foundry world so the foundry-mcp-bridge
// module runs and connects out to the MCP backend on :31415 in this container.
// Relaunches with backoff when the page dies; it never exits on its own.

const { chromium } = require('playwright');

const FOUNDRY_URL = (process.env.FOUNDRY_URL || '').replace(/\/$/, '');
const FOUNDRY_USERNAME = process.env.FOUNDRY_MCP_USERNAME || 'Gamemaster';
const FOUNDRY_PASSWORD = process.env.FOUNDRY_MCP_PASSWORD;
// Opt-in: turn on the bridge's GM-only `evaluate` tool (full GM power) for this world.
const ENABLE_EVALUATE = process.env.FOUNDRY_MCP_ENABLE_EVALUATE === 'true';
const MODULE_ID = 'foundry-mcp-bridge';
const HEALTH_INTERVAL_MS = 30000;

if (!FOUNDRY_URL || !FOUNDRY_PASSWORD) {
  console.error('[keepalive] FOUNDRY_URL and FOUNDRY_MCP_PASSWORD are required');
  process.exit(1);
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function join(browser) {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });

  // Surface client-side failures (module query errors, dnd5e exceptions) in docker logs
  page.on('pageerror', err => console.error(`[browser] pageerror: ${err.message}`));
  page.on('console', msg => {
    if (msg.type() === 'error' || msg.type() === 'warning') {
      console.error(`[browser] ${msg.type()}: ${msg.text()}`);
    }
  });

  // Nobody watches this page. Software WebGL plus CSS animations cost ~5 cores idle;
  // disabling the canvas and animations brings it to ~1%.
  await page.addInitScript(() => {
    localStorage.setItem('core.noCanvas', 'true');
    document.addEventListener('DOMContentLoaded', () => {
      const style = document.createElement('style');
      style.textContent =
        '*,*::before,*::after{animation:none!important;transition:none!important}';
      document.head.append(style);
    });
  });

  await page.goto(`${FOUNDRY_URL}/join`, { waitUntil: 'networkidle', timeout: 30000 });
  await page.fill('input[name="username"]', FOUNDRY_USERNAME);
  await page.fill('input[name="password"]', FOUNDRY_PASSWORD);
  await page.click('button[type="submit"]');

  // With the canvas disabled #board may never render, so wait on the game itself
  await page.waitForFunction(() => globalThis.game?.ready === true, undefined, {
    timeout: 120000,
  });
  console.log(`[keepalive] Joined Foundry as ${FOUNDRY_USERNAME}; game ready`);

  // The browser and the backend share this container, so the module must use a plain
  // WebSocket to localhost. These are world settings; only change them when they differ.
  const state = await page.evaluate(
    async ({ moduleId, enableEvaluate }) => {
      const module = game.modules.get(moduleId);
      if (!module?.active) return { active: false };
      const wanted = { enabled: true, connectionType: 'websocket', serverHost: 'localhost' };
      // Older bridge builds don't register this setting; only manage it when it exists.
      if (game.settings.settings.has(`${moduleId}.enableEvaluate`)) {
        wanted.enableEvaluate = enableEvaluate;
      }
      const changed = [];
      for (const [key, value] of Object.entries(wanted)) {
        if (game.settings.get(moduleId, key) !== value) {
          await game.settings.set(moduleId, key, value);
          changed.push(key);
        }
      }
      return { active: true, version: module.version, changed };
    },
    { moduleId: MODULE_ID, enableEvaluate: ENABLE_EVALUATE }
  );

  // Nobody can click a dialog here, so anything that renders one hangs. Log every
  // window that opens so those calls are easy to spot.
  await page.evaluate(() => {
    for (const hook of ['renderApplicationV2', 'renderApplication']) {
      Hooks.on(hook, app =>
        console.warn(
          `[window] ${app.constructor.name}: ${app.title ?? app.options?.window?.title ?? ''}`
        )
      );
    }
  });

  if (!state.active) {
    console.error(`[keepalive] Module ${MODULE_ID} is not active in this world; enable it`);
  } else {
    console.log(
      `[keepalive] Module ${MODULE_ID} ${state.version} active` +
        (state.changed.length ? `; updated settings: ${state.changed.join(', ')}` : '')
    );
  }

  return page;
}

async function run() {
  let backoff = 5000;
  for (;;) {
    let browser;
    try {
      browser = await chromium.launch({
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
      });
      const page = await join(browser);
      backoff = 5000;

      // Stay until the page closes, crashes, or the game stops being ready
      for (;;) {
        await sleep(HEALTH_INTERVAL_MS);
        const ready = await page
          .evaluate(() => globalThis.game?.ready === true && !!globalThis.game?.socket?.connected)
          .catch(() => false);
        if (!ready) throw new Error('page lost game.ready or its socket');
      }
    } catch (err) {
      console.error(`[keepalive] ${err.message}; relaunching in ${backoff / 1000}s`);
    }
    await browser?.close().catch(() => {});
    await sleep(backoff);
    backoff = Math.min(backoff * 2, 300000);
  }
}

run();
