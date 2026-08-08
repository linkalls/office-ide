import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import chromium from "@sparticuz/chromium";
import { chromium as playwrightChromium, type Locator, type Page } from "playwright-core";

const FPS = 20;
const VIEWPORT = { width: 1600, height: 900 };
const DEVICE_SCALE_FACTOR = 1.5;
const APP_URL = "http://127.0.0.1:1420/";
const ROOT = resolve(import.meta.dir, "..");
const VIDEO_PATH = resolve(ROOT, "docs/media/office-ide-agent-demo.mp4");
const REVIEW_IMAGE_PATH = resolve(ROOT, "docs/images/office-ide-agent-review.png");
const APPLIED_IMAGE_PATH = resolve(ROOT, "docs/images/office-ide-agent-applied.png");

const frameDirectory = await mkdtemp(join(tmpdir(), "office-ide-demo-"));
let frame = 0;
let browser: Awaited<ReturnType<typeof playwrightChromium.launch>> | null = null;
let recordingCompleted = false;
let camera = { scale: 1, x: 0, y: 0 };

const server = Bun.spawn(
  [process.execPath, "run", "dev", "--", "--host", "127.0.0.1"],
  { cwd: ROOT, stdout: "pipe", stderr: "pipe" },
);

async function waitForServer(): Promise<void> {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      if ((await fetch(APP_URL)).ok) return;
    } catch {
      // Vite is still starting. Poll again after a short delay.
    }
    await Bun.sleep(100);
  }
  throw new Error(`Office IDE did not become available at ${APP_URL}`);
}

async function installPresentationLayer(page: Page): Promise<void> {
  await page.evaluate(() => {
    document.querySelector("#demo-presentation-layer")?.remove();
    const layer = document.createElement("div");
    layer.id = "demo-presentation-layer";
    layer.style.cssText = "position:fixed;inset:0;z-index:999990;pointer-events:none;font-family:'Noto Sans JP Variable',Inter,sans-serif";
    layer.innerHTML = `
      <style>
        #demo-hero{position:fixed;inset:0;display:grid;place-items:center;background:radial-gradient(circle at 50% 45%,rgba(26,66,111,.72),rgba(4,9,16,.93));opacity:1}
        #demo-hero-card{width:620px;padding:38px 44px;border:1px solid rgba(111,177,255,.6);border-radius:22px;background:rgba(8,17,29,.86);box-shadow:0 30px 90px rgba(0,0,0,.55);text-align:center;color:white}
        #demo-hero-eyebrow{color:#73b7ff;font-size:13px;font-weight:900;letter-spacing:.18em;text-transform:uppercase}
        #demo-hero-title{margin:12px 0 8px;font-size:38px;font-weight:850;letter-spacing:-.04em}
        #demo-hero-copy{color:#b9c9da;font-size:17px;line-height:1.55}
        #demo-caption{position:fixed;left:34px;top:68px;width:450px;padding:14px 17px;border:1px solid rgba(91,155,226,.65);border-radius:12px;background:rgba(5,13,24,.91);backdrop-filter:blur(16px);box-shadow:0 16px 48px rgba(0,0,0,.42),inset 4px 0 #2f81f7;color:#fff;opacity:0}
        #demo-caption-stage{display:block;margin-bottom:5px;color:#6eb1ff;font-size:11px;font-weight:900;letter-spacing:.16em}
        #demo-caption-title{font-size:21px;font-weight:850;letter-spacing:-.02em}
        #demo-caption-detail{display:block;margin-top:5px;color:#b7c8dc;font-size:13px;line-height:1.4}
        #demo-cursor{position:fixed;width:44px;height:53px;filter:drop-shadow(0 5px 5px rgba(0,0,0,.78));transform:translate(-7px,-6px)}
        #demo-cursor svg{width:100%;height:100%;overflow:visible}
        #demo-target{position:fixed;border:3px solid #ffb000;border-radius:10px;box-shadow:0 0 0 5px rgba(255,176,0,.18),0 0 28px rgba(255,176,0,.32);opacity:0}
        #demo-target-label{position:fixed;max-width:270px;padding:6px 10px;border-radius:7px;background:#ffb000;color:#171006;font-size:13px;font-weight:900;box-shadow:0 5px 18px rgba(0,0,0,.42);opacity:0;white-space:nowrap}
        #demo-state{position:fixed;left:50%;bottom:38px;transform:translateX(-50%);padding:11px 20px;border:1px solid #73b7ff;border-radius:999px;background:rgba(6,16,28,.94);color:white;font-size:15px;font-weight:850;box-shadow:0 14px 32px rgba(0,0,0,.5);opacity:0}
        .demo-trail{position:fixed;width:10px;height:10px;border-radius:50%;background:#62a7ff;transform:translate(-50%,-50%);box-shadow:0 0 14px #2f81f7}
        .demo-ripple{position:fixed;width:28px;height:28px;border:5px solid #ffb000;border-radius:50%;transform:translate(-50%,-50%);box-shadow:0 0 20px rgba(255,176,0,.8)}
      </style>
      <div id="demo-hero">
        <div id="demo-hero-card">
          <div id="demo-hero-eyebrow">Office IDE · Agent workflow</div>
          <div id="demo-hero-title">表を理解し、提案して、戻せる。</div>
          <div id="demo-hero-copy">自然言語から地域別集計sheetを生成。<br>すべての変更はreviewable transaction。</div>
        </div>
      </div>
      <div id="demo-caption">
        <span id="demo-caption-stage">ASK</span>
        <span id="demo-caption-title">AIへ依頼</span>
        <span id="demo-caption-detail">現在のWorkbookをcontextとして渡す</span>
      </div>
      <div id="demo-target"></div>
      <div id="demo-target-label"></div>
      <div id="demo-state"></div>
      <div id="demo-cursor" aria-hidden="true" style="left:1460px;top:76px">
        <svg viewBox="0 0 48 58" xmlns="http://www.w3.org/2000/svg">
          <path d="M5 3L39 33L25 35L34 51L24 56L15 39L5 49Z" fill="#fff" stroke="#1478e8" stroke-width="5" stroke-linejoin="round"/>
        </svg>
      </div>
    `;
    document.body.append(layer);
    const root = document.querySelector<HTMLElement>("#root");
    if (root) {
      root.style.transformOrigin = "0 0";
      root.style.willChange = "transform";
    }
  });
}

async function captureFrame(page: Page): Promise<void> {
  frame += 1;
  await page.screenshot({
    path: join(frameDirectory, `frame-${String(frame).padStart(4, "0")}.png`),
    animations: "disabled",
  });
}

async function hold(page: Page, milliseconds: number): Promise<void> {
  const count = Math.max(1, Math.round(milliseconds / (1000 / FPS)));
  for (let index = 0; index < count; index += 1) await captureFrame(page);
}

function cameraPose(scale: number, focusX: number, focusY: number) {
  return {
    scale,
    x: Math.max(VIEWPORT.width - VIEWPORT.width * scale, Math.min(0, VIEWPORT.width / 2 - focusX * scale)),
    y: Math.max(VIEWPORT.height - VIEWPORT.height * scale, Math.min(0, VIEWPORT.height / 2 - focusY * scale)),
  };
}

async function moveCamera(
  page: Page,
  next: { scale: number; x: number; y: number },
  milliseconds = 650,
): Promise<void> {
  const start = camera;
  const count = Math.max(4, Math.round(milliseconds / (1000 / FPS)));
  for (let index = 1; index <= count; index += 1) {
    const progress = index / count;
    const eased = progress < 0.5
      ? 4 * progress ** 3
      : 1 - (-2 * progress + 2) ** 3 / 2;
    const pose = {
      scale: start.scale + (next.scale - start.scale) * eased,
      x: start.x + (next.x - start.x) * eased,
      y: start.y + (next.y - start.y) * eased,
    };
    await page.evaluate((value) => {
      const root = document.querySelector<HTMLElement>("#root");
      if (root) root.style.transform = `translate3d(${value.x}px,${value.y}px,0) scale(${value.scale})`;
    }, pose);
    await captureFrame(page);
  }
  camera = next;
}

async function hideHero(page: Page): Promise<void> {
  for (let index = 0; index <= 8; index += 1) {
    await page.evaluate((opacity) => {
      const hero = document.querySelector<HTMLElement>("#demo-hero");
      if (hero) hero.style.opacity = String(opacity);
    }, 1 - index / 8);
    await captureFrame(page);
  }
  await page.evaluate(() => document.querySelector("#demo-hero")?.remove());
}

async function setChapter(
  page: Page,
  stage: string,
  title: string,
  detail: string,
  milliseconds = 450,
): Promise<void> {
  await page.evaluate(({ stage, title, detail }) => {
    const caption = document.querySelector<HTMLElement>("#demo-caption");
    const stageElement = document.querySelector<HTMLElement>("#demo-caption-stage");
    const titleElement = document.querySelector<HTMLElement>("#demo-caption-title");
    const detailElement = document.querySelector<HTMLElement>("#demo-caption-detail");
    if (caption) caption.style.opacity = "1";
    if (stageElement) stageElement.textContent = stage;
    if (titleElement) titleElement.textContent = title;
    if (detailElement) detailElement.textContent = detail;
  }, { stage, title, detail });
  await hold(page, milliseconds);
}

async function showState(page: Page, text: string, milliseconds = 700): Promise<void> {
  await page.evaluate((message) => {
    const state = document.querySelector<HTMLElement>("#demo-state");
    if (!state) return;
    state.textContent = message;
    state.style.opacity = "1";
  }, text);
  await hold(page, milliseconds);
  await page.evaluate(() => {
    const state = document.querySelector<HTMLElement>("#demo-state");
    if (state) state.style.opacity = "0";
  });
}

async function moveCursor(
  page: Page,
  locator: Locator,
  label: string,
  milliseconds = 600,
): Promise<void> {
  const box = await locator.boundingBox();
  if (!box) throw new Error(`Demo target is not visible: ${label}`);
  const target = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  const start = await page.locator("#demo-cursor").evaluate((element) => ({
    x: Number.parseFloat(getComputedStyle(element).left),
    y: Number.parseFloat(getComputedStyle(element).top),
  }));

  await page.evaluate(({ box, label, viewport }) => {
    const targetBox = document.querySelector<HTMLElement>("#demo-target");
    const targetLabel = document.querySelector<HTMLElement>("#demo-target-label");
    if (!targetBox || !targetLabel) return;
    targetBox.style.cssText += `;left:${box.x - 5}px;top:${box.y - 5}px;width:${box.width + 10}px;height:${box.height + 10}px;opacity:1`;
    targetLabel.textContent = label;
    targetLabel.style.left = `${Math.max(12, Math.min(viewport.width - 280, box.x))}px`;
    targetLabel.style.top = `${box.y > 52 ? box.y - 40 : box.y + box.height + 10}px`;
    targetLabel.style.opacity = "1";
  }, { box, label, viewport: VIEWPORT });

  const count = Math.max(4, Math.round(milliseconds / (1000 / FPS)));
  for (let index = 1; index <= count; index += 1) {
    const progress = index / count;
    const eased = 1 - (1 - progress) ** 3;
    const position = {
      x: start.x + (target.x - start.x) * eased,
      y: start.y + (target.y - start.y) * eased,
    };
    await page.evaluate((nextPosition) => {
      const cursor = document.querySelector<HTMLElement>("#demo-cursor");
      const layer = document.querySelector<HTMLElement>("#demo-presentation-layer");
      if (!cursor || !layer) return;
      cursor.style.left = `${nextPosition.x}px`;
      cursor.style.top = `${nextPosition.y}px`;
      const trail = document.createElement("span");
      trail.className = "demo-trail";
      trail.style.left = `${nextPosition.x}px`;
      trail.style.top = `${nextPosition.y}px`;
      layer.insertBefore(trail, cursor);
      const trails = [...layer.querySelectorAll<HTMLElement>(".demo-trail")];
      trails.forEach((item, trailIndex) => {
        item.style.opacity = String((trailIndex + 1) / trails.length * 0.35);
      });
      while (trails.length > 6) trails.shift()?.remove();
    }, position);
    await captureFrame(page);
  }

  const reached = await page.locator("#demo-cursor").evaluate((element, expected) => {
    const style = getComputedStyle(element);
    return Math.hypot(
      Number.parseFloat(style.left) - expected.x,
      Number.parseFloat(style.top) - expected.y,
    ) < 2;
  }, target);
  if (!reached) throw new Error(`Demo cursor did not reach target: ${label}`);
}

async function clickWithRipple(page: Page, locator: Locator, label: string): Promise<void> {
  await moveCursor(page, locator, label);
  const position = await page.locator("#demo-cursor").evaluate((element) => ({
    x: Number.parseFloat(getComputedStyle(element).left),
    y: Number.parseFloat(getComputedStyle(element).top),
  }));
  await locator.click();
  for (let index = 0; index < 6; index += 1) {
    await page.evaluate(({ position, index }) => {
      document.querySelector("#demo-click-ripple")?.remove();
      const ripple = document.createElement("div");
      ripple.id = "demo-click-ripple";
      ripple.className = "demo-ripple";
      ripple.style.left = `${position.x}px`;
      ripple.style.top = `${position.y}px`;
      ripple.style.transform = `translate(-50%,-50%) scale(${1 + index * 0.34})`;
      ripple.style.opacity = String(1 - index * 0.16);
      document.querySelector("#demo-presentation-layer")?.append(ripple);
    }, { position, index });
    await captureFrame(page);
  }
  await page.evaluate(() => document.querySelector("#demo-click-ripple")?.remove());
  await page.evaluate(() => {
    const target = document.querySelector<HTMLElement>("#demo-target");
    const targetLabel = document.querySelector<HTMLElement>("#demo-target-label");
    if (target) target.style.opacity = "0";
    if (targetLabel) targetLabel.style.opacity = "0";
  });
  await hold(page, 250);
}

async function typeOneCharacterAtATime(page: Page, locator: Locator, text: string): Promise<void> {
  await locator.focus();
  let value = "";
  for (const character of text) {
    value += character;
    await locator.evaluate((element, nextValue) => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
      setter?.call(element, nextValue);
      element.dispatchEvent(new Event("input", { bubbles: true }));
    }, value);
    await captureFrame(page);
  }
}

async function hidePresentationLayer(page: Page): Promise<void> {
  await page.evaluate(() => {
    const layer = document.querySelector<HTMLElement>("#demo-presentation-layer");
    if (layer) layer.style.display = "none";
    const root = document.querySelector<HTMLElement>("#root");
    if (root) root.style.transform = "none";
  });
  camera = { scale: 1, x: 0, y: 0 };
}

try {
  await waitForServer();
  browser = await playwrightChromium.launch({
    executablePath: await chromium.executablePath(),
    headless: true,
    args: chromium.args,
  });
  const page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: DEVICE_SCALE_FACTOR });
  const messages: Array<{ type: string; text: string }> = [];
  page.on("console", (message) => {
    if (["warning", "error"].includes(message.type())) {
      messages.push({ type: message.type(), text: message.text() });
    }
  });
  page.on("pageerror", (error) => messages.push({ type: "pageerror", text: error.message }));

  await page.goto(APP_URL, { waitUntil: "networkidle" });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: "networkidle" });
  await installPresentationLayer(page);
  const title = await page.title();
  const bodyText = await page.locator("body").innerText();
  const overlayCount = await page.locator("vite-error-overlay").count();

  // Product-style opening: one promise, then one continuous Agent story.
  await hold(page, 900);
  await hideHero(page);
  await moveCamera(page, cameraPose(1.45, 1390, 620), 700);
  await setChapter(page, "ASK", "地域別の売上集計を依頼", "プロンプトは1文字ずつ入力。Workbook IRは自動でcontextに入る");
  const composer = page.getByLabel("Ask Codex");
  await clickWithRipple(page, composer, "Codexへ依頼");
  const agentPrompt = "地域別の売上集計シートを作って";
  await typeOneCharacterAtATime(page, composer, agentPrompt);
  await showState(page, "Enterで送信", 300);
  await composer.press("Enter");
  await page.waitForTimeout(300);
  await hold(page, 450);

  // Keep the camera on the proposal so the scope and operation count are readable.
  await setChapter(page, "REVIEW", "AIが14件を5地域へ集計", "適用前に対象範囲・上位地域・全operationsを確認する");
  const proposal = page.getByLabel("Agent change proposal");
  await proposal.waitFor();
  const proposalVisible = await proposal.isVisible();
  const proposalText = await proposal.innerText();
  const applyButton = page.getByRole("button", { name: "Apply 31 operations" });
  await moveCursor(page, applyButton, "31 operationsを適用", 650);
  await page.screenshot({ path: REVIEW_IMAGE_PATH, fullPage: false });
  await hold(page, 450);

  // Apply and move the camera to the generated sheet, not to a generic success message.
  await setChapter(page, "APPLY", "新しい集計sheetを生成", "地域ごとの売上合計・件数・総合計を1 transactionで作る", 350);
  await clickWithRipple(page, applyButton, "Apply proposal");
  await page.waitForTimeout(300);
  await moveCamera(page, cameraPose(1.42, 660, 310), 700);
  const topSales = page.getByLabel("Cell B2", { exact: true });
  await moveCursor(page, topSales, "東京 1,567,400円", 550);
  await showState(page, "地域別集計 sheetを作成 · 5地域 · 14件", 850);

  const summarySheet = page.getByRole("button", { name: "Open sheet 地域別集計" });
  const summarySheetCreated = await summarySheet.isVisible();
  const topRegion = await page.getByLabel("Cell A2", { exact: true }).inputValue();
  const topRegionSales = await topSales.inputValue();
  const grandTotal = await page.getByLabel("Cell B7", { exact: true }).inputValue();
  const sourceAfterApply = await page.locator(".source-editor").inputValue();
  const summarySerialized = sourceAfterApply.includes('sheet "地域別集計"')
    && sourceAfterApply.includes('cell "B7" value=5159900');

  // Show attribution, then prove that a whole generated sheet is one reversible change.
  await moveCamera(page, cameraPose(1.08, 800, 450), 550);
  await setChapter(page, "UNDO / REDO", "Agent変更をsheetごと戻す", "HistoryにはCodexの31 operationsとして記録される", 350);
  const historyTab = page.getByRole("tab", { name: "History", exact: true });
  await clickWithRipple(page, historyTab, "Historyを開く");
  await moveCamera(page, cameraPose(1.42, 650, 700), 550);
  const historyEntry = page.locator(".history-entry").first();
  await moveCursor(page, historyEntry, "Agent · Codex · 31 ops", 500);
  await hold(page, 500);
  const historyText = await page.locator(".history-list").innerText();
  const agentActorRecorded = historyText.includes("Agent · Codex local planner")
    && historyText.includes("31 ops");

  await moveCamera(page, cameraPose(1.35, 1480, 70), 550);
  const undoButton = page.locator('.title-actions button[aria-label="Undo"]');
  await clickWithRipple(page, undoButton, "Undo: 集計sheetを削除");
  await moveCamera(page, cameraPose(1.35, 620, 835), 600);
  await moveCursor(page, page.locator(".sheet-tabs"), "地域別集計が消えた", 500);
  const summaryAfterUndo = await page.getByRole("button", { name: "Open sheet 地域別集計" }).count();
  await showState(page, "Undo完了 · sheetは消えても履歴は残る", 650);
  await moveCursor(page, historyEntry, "REVERTED · 過去の実行記録", 500);
  const revertedHistoryText = await page.locator(".history-list").innerText();
  const historyMarkedReverted = revertedHistoryText.includes("REVERTED")
    && revertedHistoryText.includes("Create regional sales summary sheet");
  await hold(page, 450);

  await moveCamera(page, cameraPose(1.35, 1480, 70), 550);
  const redoButton = page.locator('.title-actions button[aria-label="Redo"]');
  await clickWithRipple(page, redoButton, "Redo: 集計sheetを復元");
  await moveCamera(page, cameraPose(1.42, 660, 310), 650);
  const restoredTopSales = page.getByLabel("Cell B2", { exact: true });
  await moveCursor(page, restoredTopSales, "集計sheetを完全復元", 500);
  const summaryAfterRedo = await page.getByRole("button", { name: "Open sheet 地域別集計" }).count();
  const historyAfterRedo = await page.locator(".history-list").innerText();
  const historyMarkedApplied = historyAfterRedo.includes("APPLIED")
    && !historyAfterRedo.includes("REVERTED");
  await showState(page, "Reviewable · Attributed · Reversible", 850);

  // End the recorded story here. Recovery and responsive checks continue off-camera.
  await page.waitForTimeout(400);
  const desktopOverflow = await page.evaluate(() => ({
    horizontal: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    vertical: document.documentElement.scrollHeight > document.documentElement.clientHeight,
  }));
  await hidePresentationLayer(page);
  await page.screenshot({ path: APPLIED_IMAGE_PATH, fullPage: false });
  await page.waitForTimeout(350);
  await page.reload({ waitUntil: "networkidle" });
  const recoveredSheet = await page.getByRole("button", { name: "Open sheet 地域別集計" }).count();
  const recoveredTotal = await page.getByLabel("Cell B7", { exact: true }).inputValue();
  await page.setViewportSize({ width: 980, height: 760 });
  await page.waitForTimeout(100);
  const compactOverflow = await page.evaluate(() => ({
    horizontal: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    vertical: document.documentElement.scrollHeight > document.documentElement.clientHeight,
  }));

  const ffmpeg = Bun.spawn([
    "ffmpeg",
    "-hide_banner", "-loglevel", "error", "-y",
    "-framerate", String(FPS),
    "-i", join(frameDirectory, "frame-%04d.png"),
    "-vf", "scale=1920:1080:flags=lanczos",
    "-c:v", "libx264",
    "-preset", "slow",
    "-crf", "17",
    "-profile:v", "high",
    "-pix_fmt", "yuv420p",
    "-movflags", "+faststart",
    VIDEO_PATH,
  ], { cwd: ROOT, stdout: "ignore", stderr: "inherit" });
  if (await ffmpeg.exited !== 0) throw new Error("ffmpeg encode failed");
  await Bun.sleep(250);

  const decoder = Bun.spawn([
    "ffmpeg", "-hide_banner", "-loglevel", "error",
    "-i", VIDEO_PATH, "-f", "null", "-",
  ], { cwd: ROOT, stdout: "ignore", stderr: "inherit" });
  if (await decoder.exited !== 0) throw new Error("Recorded MP4 validation failed");
  recordingCompleted = true;

  console.log(JSON.stringify({
    url: page.url(),
    title,
    meaningfulContent: bodyText.includes("Office IDE") && bodyText.includes("売上"),
    overlayCount,
    messages,
    frames: frame,
    durationSeconds: frame / FPS,
    sourceFrameSize: `${VIEWPORT.width * DEVICE_SCALE_FACTOR}x${VIEWPORT.height * DEVICE_SCALE_FACTOR}`,
    outputSize: "1920x1080",
    agentPrompt,
    proposalVisible,
    proposalHasTopTotals: proposalText.includes("東京 ¥1,567,400"),
    summarySheetCreated,
    topRegion,
    topRegionSales,
    grandTotal,
    summarySerialized,
    agentActorRecorded,
    historyMarkedReverted,
    historyMarkedApplied,
    summaryAfterUndo,
    summaryAfterRedo,
    recoveredSheet,
    recoveredTotal,
    desktopOverflow,
    compactOverflow,
    videoPath: VIDEO_PATH,
  }, null, 2));
} finally {
  await browser?.close();
  server.kill();
  await server.exited;
  if (recordingCompleted) {
    await rm(frameDirectory, { recursive: true, force: true });
  } else {
    console.error(`Recording frames preserved for recovery: ${frameDirectory}`);
  }
}
