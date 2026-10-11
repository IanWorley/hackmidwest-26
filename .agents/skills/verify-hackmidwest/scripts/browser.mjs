import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import process from "node:process";

const { WEB_URL, API_URL, ARTIFACTS, TOOLS_DIR } = process.env;
const STEP_TIMEOUT_MS = 15_000;
const EXIT_USAGE = 2;
const STEP_ARGS = {
  goto: ["path"],
  click: ["role", "name"],
  expect: ["role", "name"],
  "expect-text": ["text"],
  press: ["key"],
  "block-api": [],
  snap: ["name"],
};

const { chromium } = createRequire(join(TOOLS_DIR, "package.json"))(
  "playwright",
);
mkdirSync(ARTIFACTS, { recursive: true });
const logFile = join(ARTIFACTS, "browser.log");

const steps = parseSteps(process.argv.slice(2));
const browser = await chromium.launch();
const page = await browser.newPage();
page.setDefaultTimeout(STEP_TIMEOUT_MS);
page.on("console", (message) => {
  if (message.type() === "error") {
    log(`console.error ${message.text()}`);
  }
});
page.on("requestfinished", async (request) => {
  if (!request.url().startsWith(API_URL)) {
    return;
  }
  const response = await request.response();
  log(`net ${request.method()} ${request.url()} -> ${response?.status()}`);
});
page.on("requestfailed", (request) => {
  log(
    `net ${request.method()} ${request.url()} -> FAILED ${request.failure()?.errorText}`,
  );
});

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
      await page.goto(new URL(args[0], WEB_URL).href, {
        waitUntil: "networkidle",
      });
      return;
    case "click":
      await page.getByRole(args[0], { name: args[1], exact: true }).click();
      return;
    case "expect":
      await page.getByRole(args[0], { name: args[1], exact: true }).waitFor();
      return;
    case "expect-text":
      await page.getByText(args[0], { exact: true }).waitFor();
      return;
    case "press":
      await page.keyboard.press(args[0]);
      return;
    case "block-api":
      await page.route(`${API_URL}/**`, (route) =>
        route.abort("connectionrefused"),
      );
      return;
    case "snap": {
      const aria = await page.locator("body").ariaSnapshot();
      const header = `# url: ${page.url()}\n# title: ${await page.title()}\n`;
      writeFileSync(
        join(ARTIFACTS, `${args[0]}.aria.yml`),
        `${header}${aria}\n`,
      );
      await page.screenshot({
        path: join(ARTIFACTS, `${args[0]}.png`),
        fullPage: true,
      });
      log(`  saved ${args[0]}.aria.yml ${args[0]}.png`);
      return;
    }
    default:
      throw new Error(`unhandled step '${verb}'`);
  }
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

/** @param {string} line */
function log(line) {
  const entry = `${new Date().toISOString()} ${line}`;
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
