import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { chromium } from "playwright";

const baseUrl = process.env.UI_CHECK_URL ?? "http://127.0.0.1:4173/";
const outputDir = path.resolve("output/playwright");
const viewports = [320, 390, 768, 1024, 1440];
const axeViewports = new Set([390, 1440]);
const chromeExecutable =
  process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ??
  ["/usr/bin/google-chrome", "/usr/bin/google-chrome-stable", "/usr/bin/chromium"].find(
    (candidate) => existsSync(candidate),
  );

await mkdir(outputDir, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  executablePath: chromeExecutable,
  args: ["--no-sandbox"],
});
const report = {
  baseUrl,
  viewports: [],
  axe: [],
  keyboard: undefined,
  consoleErrors: [],
};

try {
  for (const width of viewports) {
    const context = await browser.newContext({
      viewport: { width, height: 1000 },
      reducedMotion: "reduce",
    });
    const page = await context.newPage();
    page.on("pageerror", (error) => report.consoleErrors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") {
        report.consoleErrors.push(message.text());
      }
    });

    await page.goto(baseUrl, { waitUntil: "networkidle" });
    await page.waitForSelector("#fileInput", { timeout: 30_000 });
    const emptyOverflow = await overflowPixels(page);

    await page
      .getByRole("button", { name: /electric baseboard example/i })
      .click();
    await page.waitForSelector("#resultsHeading", { timeout: 60_000 });
    await page.waitForLoadState("networkidle");
    const resultOverflow = await overflowPixels(page);
    const rateCardCount = await page.locator(".rate-card").count();
    const calculationCount = await page.locator(".rate-card .calculation-details").count();
    const openCalculationCount = await page
      .locator(".rate-card .calculation-details[open]")
      .count();
    const mobileCardsVisible = await page.locator(".results-table-mobile").first().isVisible();
    const tableScrollVisible = await page.locator(".table-scroll").first().isVisible();
    const bestOptionText = await page.locator(".rate-card.best h4").first().innerText();

    const screenshotPath = path.join(outputDir, `ui-${width}.png`);
    await page.screenshot({ path: screenshotPath, fullPage: true });

    report.viewports.push({
      width,
      emptyOverflow,
      resultOverflow,
      rateCardCount,
      calculationCount,
      openCalculationCount,
      mobileCardsVisible,
      tableScrollVisible,
      bestOptionText,
      screenshotPath,
    });

    if (axeViewports.has(width)) {
      const axeResult = await new AxeBuilder({ page })
        .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"])
        .analyze();
      const seriousOrCritical = axeResult.violations.filter((violation) =>
        ["serious", "critical"].includes(violation.impact ?? ""),
      );
      report.axe.push({
        width,
        violationCount: axeResult.violations.length,
        seriousOrCriticalCount: seriousOrCritical.length,
        seriousOrCritical: seriousOrCritical.map((violation) => ({
          id: violation.id,
          impact: violation.impact,
          help: violation.help,
          nodes: violation.nodes.map((node) => node.target),
        })),
      });
    }

    if (width === 390) {
      report.keyboard = await keyboardAudit(page);
    }

    await context.close();
  }

  const failures = [];
  for (const item of report.viewports) {
    if (item.emptyOverflow > 1 || item.resultOverflow > 1) {
      failures.push(
        `${item.width}px has horizontal overflow: empty ${item.emptyOverflow}px, result ${item.resultOverflow}px`,
      );
    }
    if (item.rateCardCount !== 4 || item.calculationCount !== 4 || item.openCalculationCount !== 4) {
      failures.push(
        `${item.width}px expected 4 visible open calculation cards; got cards=${item.rateCardCount}, details=${item.calculationCount}, open=${item.openCalculationCount}`,
      );
    }
    if (item.width <= 760 && !item.mobileCardsVisible) {
      failures.push(`${item.width}px does not show the mobile comparison-card alternative`);
    }
    if (item.width > 760 && !item.tableScrollVisible) {
      failures.push(`${item.width}px does not show the detailed comparison table`);
    }
  }

  for (const item of report.axe) {
    if (item.seriousOrCriticalCount > 0) {
      failures.push(
        `${item.width}px axe found ${item.seriousOrCriticalCount} serious/critical violations`,
      );
    }
  }

  if (!report.keyboard || report.keyboard.failures.length) {
    failures.push(
      `keyboard audit failed: ${report.keyboard?.failures.join("; ") ?? "not executed"}`,
    );
  }

  if (report.consoleErrors.length) {
    failures.push(`console/page errors: ${report.consoleErrors.join("; ")}`);
  }

  report.failures = failures;
  await writeFile(
    path.join(outputDir, "ui-check-report.json"),
    `${JSON.stringify(report, null, 2)}\n`,
  );

  if (failures.length) {
    console.error(failures.join("\n"));
    process.exitCode = 1;
  } else {
    console.log(`UI checks passed for ${viewports.join(", ")}px.`);
    console.log(`Report: ${path.join(outputDir, "ui-check-report.json")}`);
  }
} finally {
  await browser.close();
}

async function overflowPixels(page) {
  return page.evaluate(() => {
    const scrollWidth = Math.max(
      document.documentElement.scrollWidth,
      document.body.scrollWidth,
    );
    return Math.max(0, scrollWidth - window.innerWidth);
  });
}

async function keyboardAudit(page) {
  await page.locator("body").click({ position: { x: 1, y: 1 } });
  const focusableCount = await page.evaluate(() =>
    Array.from(
      document.querySelectorAll(
        "a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex='-1'])",
      ),
    ).filter((element) => {
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return (
        rect.width > 0 &&
        rect.height > 0 &&
        style.visibility !== "hidden" &&
        style.display !== "none"
      );
    }).length,
  );

  const seen = new Set();
  const failures = [];
  const samples = [];
  for (let index = 0; index < focusableCount + 2; index += 1) {
    await page.keyboard.press("Tab");
    await page.waitForTimeout(20);
    const focusState = await page.evaluate(() => {
      const active = document.activeElement;
      if (!active || active === document.body) {
        return { key: "body", visible: false, hasRing: false, label: "body" };
      }

      const candidate = active.closest(".drop-zone") ?? active;
      const rect = candidate.getBoundingClientRect();
      const style = window.getComputedStyle(candidate);
      const outlineWidth = Number.parseFloat(style.outlineWidth) || 0;
      const label =
        active.getAttribute("aria-label") ||
        active.textContent?.trim().replace(/\s+/g, " ").slice(0, 90) ||
        active.id ||
        active.tagName.toLowerCase();

      return {
        key: `${active.tagName.toLowerCase()}#${active.id}.${Array.from(active.classList).join(".")}`,
        visible: rect.width > 0 && rect.height > 0,
        hasRing:
          outlineWidth >= 2 ||
          style.outlineStyle !== "none" ||
          style.boxShadow !== "none",
        label,
      };
    });

    seen.add(focusState.key);
    if (focusState.key === "body" && seen.size >= Math.min(focusableCount, 12)) {
      break;
    }
    if (!focusState.visible) {
      failures.push(`focused element is not visible: ${focusState.label}`);
    }
    if (!focusState.hasRing) {
      failures.push(`focused element lacks visible focus style: ${focusState.label}`);
    }
    if (samples.length < 16) {
      samples.push(focusState);
    }
  }

  if (seen.size < Math.min(focusableCount, 12)) {
    failures.push(`only reached ${seen.size} of ${focusableCount} focusable controls`);
  }

  return {
    focusableCount,
    visitedCount: seen.size,
    samples,
    failures: [...new Set(failures)],
  };
}
