import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import process from "node:process";

const { WEB_URL, API_URL, ARTIFACTS, TOOLS_DIR } = process.env;
const STEP_TIMEOUT_MS = 15_000;
const MS_PER_SECOND = 1000;
const EXIT_USAGE = 2;
/** Radar tiles are logged too, so a recipe can show an open page reloading them. */
const RADAR_TILE_PREFIX = "https://mesonet.agron.iastate.edu/cache/tile.py/";
const LOGGED_URL_PREFIXES = [API_URL, RADAR_TILE_PREFIX];
const STEP_ARGS = {
  goto: ["path"],
  click: ["role", "name"],
  expect: ["role", "name"],
  "expect-text": ["text"],
  "expect-focus": ["role", "name"],
  "expect-focus-text": ["text"],
  press: ["key"],
  wait: ["seconds"],
  "block-api": [],
  "unblock-api": [],
  fill: ["label", "text"],
  select: ["label", "option"],
  tab: ["name"],
  within: ["role", "name"],
  "within-page": [],
  snap: ["name"],
};

const { chromium } = createRequire(join(TOOLS_DIR, "package.json"))(
  "playwright",
);
mkdirSync(ARTIFACTS, { recursive: true });
const logFile = join(ARTIFACTS, "browser.log");

const steps = parseSteps(process.argv.slice(2));
const browser = await chromium.launch();
const pages = new Map();
let tabName = "main";
let page = await openTab(tabName);
/** Where `click`, `fill`, `select`, and `expect` look; the whole page unless `within` narrowed it. */
let scope = page;

try {
  for (const [verb, ...args] of steps) {
    log(`step ${verb} ${args.map((a) => JSON.stringify(a)).join(" ")}`);
    await runStep(verb, args);
    log(`  at ${page.url()}`);
  }
} catch (error) {
  const shot = join(ARTIFACTS, `failure-${Date.now()}.png`);
  await page.screenshot({ path: shot, fullPage: true });
  log(`FAILED ${error.message.split("\n")[0]} (screenshot ${shot})`);
  process.exitCode = 1;
} finally {
  await browser.close();
}

/**
 * @param {keyof typeof STEP_ARGS} verb
 * @param {string[]} args
 * @returns {Promise<void>}
 */
async function runStep(verb, args) {
  switch (verb) {
    case "goto":
      await goto(args[0]);
      return;
    case "click":
      await scope.getByRole(args[0], { name: args[1], exact: true }).click();
      return;
    case "expect":
      await scope.getByRole(args[0], { name: args[1], exact: true }).waitFor();
      return;
    case "expect-text":
      await page.getByText(args[0], { exact: true }).waitFor();
      return;
    case "press":
      await pressKey(args[0]);
      return;
    case "wait":
      await holdOpen(Number(args[0]));
      return;
    case "expect-focus":
    case "expect-focus-text":
      await expectFocus(verb, args);
      return;
    case "fill":
      await scope.getByLabel(args[0], { exact: true }).fill(args[1]);
      return;
    case "select":
      await scope
        .getByLabel(args[0], { exact: true })
        .selectOption({ label: args[1] });
      return;
    case "tab":
      await switchTab(args[0]);
      return;
    case "within":
      scope = page.getByRole(args[0], { name: args[1], exact: true });
      return;
    case "within-page":
      scope = page;
      return;
    case "block-api":
    case "unblock-api":
      await setApiBlocked(verb === "block-api");
      return;
    case "snap":
      await snap(args[0]);
      return;
    default:
      throw new Error(`unhandled step '${verb}'`);
  }
}

/**
 * Loads a web path and widens `within` back to the whole page.
 * @param {string} path
 */
async function goto(path) {
  await page.goto(new URL(path, WEB_URL).href, { waitUntil: "networkidle" });
  scope = page;
}

/** @param {string} key */
async function pressKey(key) {
  await page.keyboard.press(key);
  // Widgets such as Radix roving focus move focus in a timer queued by the key; let it run before the next key, as a person's typing would.
  await page.evaluate(() => new Promise((resolve) => setTimeout(resolve)));
}

/**
 * A real-time hold with the page open, so the app's own timers run as they would for a person.
 * @param {number} seconds
 */
async function holdOpen(seconds) {
  await new Promise((resolve) => setTimeout(resolve, seconds * MS_PER_SECOND));
}

/**
 * Makes the named tab current, opening it on first use; a second tab acts as a second person.
 * @param {string} name
 */
async function switchTab(name) {
  tabName = name;
  page = pages.get(tabName) ?? (await openTab(tabName));
  scope = page;
  await page.bringToFront();
}

/**
 * Drops the current tab's API requests as a refused connection, or lets them through again.
 * @param {boolean} blocked
 */
async function setApiBlocked(blocked) {
  const apiRequests = `${API_URL}/**`;
  if (blocked) {
    await page.route(apiRequests, (route) => route.abort("connectionrefused"));
    return;
  }
  await page.unroute(apiRequests);
}

/**
 * Waits for keyboard focus on an element by role and name, or on whatever element has exactly this text.
 * @param {"expect-focus" | "expect-focus-text"} verb
 * @param {string[]} args
 */
async function expectFocus(verb, args) {
  if (verb === "expect-focus-text") {
    await page.waitForFunction(
      (text) => document.activeElement?.textContent?.trim() === text,
      args[0],
    );
    return;
  }
  const target = await scope
    .getByRole(args[0], { name: args[1], exact: true })
    .elementHandle();
  await page.waitForFunction(
    (element) => element === document.activeElement,
    target,
  );
}

/** @param {string} name */
async function snap(name) {
  const aria = await page.locator("body").ariaSnapshot();
  const header = `# url: ${page.url()}\n# title: ${await page.title()}\n`;
  writeFileSync(join(ARTIFACTS, `${name}.aria.yml`), `${header}${aria}\n`);
  await page.screenshot({
    path: join(ARTIFACTS, `${name}.png`),
    fullPage: true,
  });
  log(`  saved ${name}.aria.yml ${name}.png`);
}

/**
 * @param {string[]} argv
 * @returns {[keyof typeof STEP_ARGS, ...string[]][]}
 */
function parseSteps(argv) {
  const parsed = [];
  for (let i = 0; i < argv.length; ) {
    const verb = argv[i];
    const names = STEP_ARGS[verb];
    if (names === undefined) {
      usageError(
        `unknown step '${verb}'; known: ${Object.keys(STEP_ARGS).join(", ")}`,
      );
    }
    const args = argv.slice(i + 1, i + 1 + names.length);
    if (args.length < names.length) {
      usageError(`usage: ${verb} ${names.map((n) => `<${n}>`).join(" ")}`);
    }
    parsed.push([verb, ...args]);
    i += 1 + names.length;
  }
  return parsed;
}

/**
 * A tab is a second person at another browser on the same app, so one run can stage a conflict.
 * @param {string} name
 */
async function openTab(name) {
  const tab = await browser.newPage();
  /** @param {string} line */
  function tabLog(line) {
    log(line, name);
  }
  tab.setDefaultTimeout(STEP_TIMEOUT_MS);
  tab.on("console", (message) => {
    if (message.type() === "error") {
      tabLog(`console.error ${message.text()}`);
    }
  });
  tab.on("requestfinished", async (request) => {
    if (
      !LOGGED_URL_PREFIXES.some((prefix) => request.url().startsWith(prefix))
    ) {
      return;
    }
    const response = await request.response();
    tabLog(`net ${request.method()} ${request.url()} -> ${response?.status()}`);
  });
  tab.on("requestfailed", (request) => {
    tabLog(
      `net ${request.method()} ${request.url()} -> FAILED ${request.failure()?.errorText}`,
    );
  });
  pages.set(name, tab);
  return tab;
}

/**
 * @param {string} line
 * @param {string} [tab] the tab the line is about; defaults to the one steps drive
 */
function log(line, tab = tabName) {
  let prefix = "";
  if (tab !== "main") {
    prefix = `[${tab}] `;
  }
  const entry = `${new Date().toISOString()} ${prefix}${line}`;
  console.log(entry);
  appendFileSync(logFile, `${entry}\n`);
}

/**
 * @param {string} message
 * @returns {never}
 */
function usageError(message) {
  console.error(`browser: ${message}`);
  process.exit(EXIT_USAGE);
}
