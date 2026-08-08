import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import chromium from "@sparticuz/chromium";
import { chromium as playwrightChromium, type Locator, type Page } from "playwright-core";

const FPS = 10;
const APP_URL = "http://127.0.0.1:1420/";
const ROOT = resolve(import.meta.dir, "..");
const VIDEO_PATH = resolve(ROOT, "docs/media/office-ide-agent-demo.mp4");
const REVIEW_IMAGE_PATH = resolve(ROOT, "docs/images/office-ide-agent-review.png");
const APPLIED_IMAGE_PATH = resolve(ROOT, "docs/images/office-ide-agent-applied.png");

const frameDirectory = await mkdtemp(join(tmpdir(), "office-ide-demo-"));
let frame = 0;
let browser: Awaited<ReturnType<typeof playwrightChromium.launch>> | null = null;
let recordingCompleted = false;

const server = Bun.spawn(
  [process.execPath, "run", "dev", "--", "--host", "127.0.0.1"],
  {
    cwd: ROOT,
    stdout: "pipe",
    stderr: "pipe",
  },
);

async function waitForServer(): Promise<void> {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await fetch(APP_URL);
      if (response.ok) return;
    } catch {
      // Vite is still starting. The next short poll will try again.
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
        #demo-caption{position:fixed;left:258px;top:56px;width:520px;padding:12px 16px;border:1px solid #4b8fdc;border-radius:10px;background:rgba(5,13,24,.94);box-shadow:0 12px 34px rgba(0,0,0,.45),inset 4px 0 #2f81f7;color:#fff}
        #demo-caption-step{display:inline-flex;margin-right:9px;padding:3px 8px;border-radius:999px;background:#2f81f7;color:white;font-size:12px;font-weight:800;letter-spacing:.04em}
        #demo-caption-title{font-size:18px;font-weight:800}
        #demo-caption-detail{display:block;margin:6px 0 0 1px;color:#b7c8dc;font-size:13px;line-height:1.35}
        #demo-cursor{position:fixed;left:1160px;top:82px;width:48px;height:58px;filter:drop-shadow(0 4px 5px rgba(0,0,0,.75));transform:translate(-7px,-6px)}
        #demo-cursor svg{width:100%;height:100%;overflow:visible}
        #demo-target{position:fixed;border:4px solid #ffb000;border-radius:9px;box-shadow:0 0 0 5px rgba(255,176,0,.22),0 0 28px rgba(255,176,0,.35);opacity:0}
        #demo-target-label{position:fixed;padding:6px 10px;border-radius:7px;background:#ffb000;color:#161008;font-size:13px;font-weight:900;box-shadow:0 4px 12px rgba(0,0,0,.4);opacity:0;white-space:nowrap}
        #demo-state{position:fixed;left:50%;bottom:46px;transform:translateX(-50%);padding:10px 18px;border:2px solid #6eb1ff;border-radius:999px;background:rgba(7,17,29,.95);color:white;font-size:15px;font-weight:800;box-shadow:0 10px 25px rgba(0,0,0,.45);opacity:0}
        .demo-trail{position:fixed;width:12px;height:12px;border-radius:50%;background:#62a7ff;transform:translate(-50%,-50%);box-shadow:0 0 12px #2f81f7}
        .demo-ripple{position:fixed;width:26px;height:26px;border:5px solid #ffb000;border-radius:50%;transform:translate(-50%,-50%);box-shadow:0 0 18px rgba(255,176,0,.8)}
      </style>
      <div id="demo-caption">
        <span id="demo-caption-step">STEP 1</span><span id="demo-caption-title">Office IDE</span>
        <span id="demo-caption-detail">実際の操作を開始</span>
      </div>
      <div id="demo-target"></div>
      <div id="demo-target-label"></div>
      <div id="demo-state"></div>
      <div id="demo-cursor" aria-hidden="true" style="left:1160px;top:82px">
        <svg viewBox="0 0 48 58" xmlns="http://www.w3.org/2000/svg">
          <path d="M5 3L39 33L25 35L34 51L24 56L15 39L5 49Z" fill="#fff" stroke="#1478e8" stroke-width="5" stroke-linejoin="round"/>
        </svg>
      </div>
    `;
    document.body.append(layer);
  });
}

async function captureFrame(page: Page): Promise<void> {
  frame += 1;
  await page.screenshot({
    path: join(frameDirectory, `frame-${String(frame).padStart(4, "0")}.png`),
  });
}

async function hold(page: Page, milliseconds: number): Promise<void> {
  const count = Math.max(1, Math.round(milliseconds / (1000 / FPS)));
  for (let index = 0; index < count; index += 1) await captureFrame(page);
}

async function setChapter(
  page: Page,
  step: number,
  title: string,
  detail: string,
): Promise<void> {
  await page.evaluate(({ step, title, detail }) => {
    const stepElement = document.querySelector<HTMLElement>("#demo-caption-step");
    const titleElement = document.querySelector<HTMLElement>("#demo-caption-title");
    const detailElement = document.querySelector<HTMLElement>("#demo-caption-detail");
    if (stepElement) stepElement.textContent = `STEP ${step}`;
    if (titleElement) titleElement.textContent = title;
    if (detailElement) detailElement.textContent = detail;
  }, { step, title, detail });
  await hold(page, 700);
}

async function showState(page: Page, text: string, milliseconds = 900): Promise<void> {
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
  milliseconds = 900,
): Promise<void> {
  const box = await locator.boundingBox();
  if (!box) throw new Error(`Demo target is not visible: ${label}`);
  const target = { x: box.x + box.width / 2, y: box.y + box.height / 2 };

  const start = await page.locator("#demo-cursor").evaluate((element) => ({
    x: Number.parseFloat(getComputedStyle(element).left),
    y: Number.parseFloat(getComputedStyle(element).top),
  }));

  await page.evaluate(({ box, label }) => {
    const targetBox = document.querySelector<HTMLElement>("#demo-target");
    const targetLabel = document.querySelector<HTMLElement>("#demo-target-label");
    if (!targetBox || !targetLabel) return;
    targetBox.style.cssText += `;left:${box.x - 5}px;top:${box.y - 5}px;width:${box.width + 10}px;height:${box.height + 10}px;opacity:1`;
    targetLabel.textContent = label;
    targetLabel.style.cssText += `;left:${Math.max(8, box.x)}px;top:${Math.max(8, box.y - 37)}px;opacity:1`;
  }, { box, label });

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
      trail.style.opacity = "0.5";
      layer.insertBefore(trail, cursor);
      const trails = [...layer.querySelectorAll<HTMLElement>(".demo-trail")];
      trails.forEach((item, trailIndex) => {
        item.style.opacity = String((trailIndex + 1) / trails.length * 0.42);
      });
      while (trails.length > 7) trails.shift()?.remove();
    }, position);
    await captureFrame(page);
  }

  const reached = await page.locator("#demo-cursor").evaluate((element, expected) => {
    const style = getComputedStyle(element);
    const actual = {
      x: Number.parseFloat(style.left),
      y: Number.parseFloat(style.top),
    };
    return Math.hypot(actual.x - expected.x, actual.y - expected.y) < 2;
  }, target);
  if (!reached) throw new Error(`Demo cursor did not reach target: ${label}`);
}

async function clickWithRipple(
  page: Page,
  locator: Locator,
  label: string,
  options?: Parameters<Locator["click"]>[0],
): Promise<void> {
  await moveCursor(page, locator, label);
  const position = await page.locator("#demo-cursor").evaluate((element) => ({
    x: Number.parseFloat((element as HTMLElement).style.left),
    y: Number.parseFloat((element as HTMLElement).style.top),
  }));
  await locator.click(options);

  for (let index = 0; index < 5; index += 1) {
    await page.evaluate(({ position, index }) => {
      document.querySelector("#demo-click-ripple")?.remove();
      const ripple = document.createElement("div");
      ripple.id = "demo-click-ripple";
      ripple.className = "demo-ripple";
      ripple.style.left = `${position.x}px`;
      ripple.style.top = `${position.y}px`;
      ripple.style.transform = `translate(-50%,-50%) scale(${1 + index * 0.42})`;
      ripple.style.opacity = String(1 - index * 0.18);
      document.querySelector("#demo-presentation-layer")?.append(ripple);
    }, { position, index });
    await captureFrame(page);
  }
  await page.evaluate(() => document.querySelector("#demo-click-ripple")?.remove());
  await hold(page, 350);
}

async function typeOneCharacterAtATime(
  page: Page,
  locator: Locator,
  text: string,
): Promise<void> {
  await locator.focus();
  let value = "";
  for (const character of text) {
    value += character;
    await locator.evaluate((element, nextValue) => {
      const prototype = element instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
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
  });
}

try {
  await waitForServer();
  const executablePath = await chromium.executablePath();
  browser = await playwrightChromium.launch({
    executablePath,
    headless: true,
    args: chromium.args,
  });
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
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

  // Step 1: show that grid input is genuine character-by-character keyboard entry.
  await setChapter(page, 1, "セルへ直接入力", "G17へ数式を1文字ずつ入力し、Enterで確定する");
  const g17 = page.getByLabel("Cell G17", { exact: true });
  await clickWithRipple(page, g17, "セル G17 を選択");
  await typeOneCharacterAtATime(page, g17, "=ROUND(10/3,2)");
  const cellBeforeEnter = await g17.inputValue();
  await showState(page, "Enterで確定 → 次のセル G18へ移動", 700);
  await g17.press("Enter");
  await hold(page, 600);
  const typedFormulaResult = await page.getByLabel("Cell G17", { exact: true }).inputValue();
  const activeAfterEnter = await page.locator(".name-box").innerText();
  await page.keyboard.press("Control+z");

  // Step 2: type a natural-language request and review the proposed semantic operations.
  await setChapter(page, 2, "AIへ自然言語で依頼", "Workbook IRを渡し、平均単価列の変更案を作らせる");
  const composer = page.getByLabel("Ask Codex");
  await clickWithRipple(page, composer, "Codex入力欄");
  const agentPrompt = "Add an average unit price formula to column G";
  await typeOneCharacterAtATime(page, composer, agentPrompt);
  await showState(page, "Enterで送信", 500);
  await composer.press("Enter");
  await page.waitForTimeout(350);
  await hold(page, 900);

  const proposal = page.getByLabel("Agent change proposal");
  const proposalVisible = await proposal.isVisible();
  const proposalText = await proposal.innerText();
  const g1BeforeApply = await page.getByLabel("Cell G1", { exact: true }).inputValue();
  const applyButton = page.getByRole("button", { name: "Apply 4 operations" });
  await moveCursor(page, applyButton, "4操作をまとめて適用", 1_100);
  await page.screenshot({ path: REVIEW_IMAGE_PATH, fullPage: false });
  await hold(page, 900);

  // Step 3: apply, then point at the actual generated cells rather than leaving the cursor behind.
  await setChapter(page, 3, "提案をレビューして適用", "ヘッダー・式・相対フィルを1 transactionで反映する");
  await clickWithRipple(page, applyButton, "Apply 4 operations");
  await page.waitForTimeout(300);
  const g2 = page.getByLabel("Cell G2", { exact: true });
  await moveCursor(page, g2, "G1:G15へ式を生成", 1_000);
  await showState(page, "平均単価列を追加: G2 = 125,000円", 1_100);

  const headerAfterApply = await page.getByLabel("Cell G1", { exact: true }).inputValue();
  const firstFormulaValue = await g2.inputValue();
  const lastFormulaValue = await page.getByLabel("Cell G15", { exact: true }).inputValue();
  const sourceAfterApply = await page.locator(".source-editor").inputValue();
  const formulaSerialized = sourceAfterApply.includes('cell "G15" formula="ROUND(C15/D15,0)"');

  // Step 4: make Agent attribution visible in History.
  await setChapter(page, 4, "履歴で変更者を確認", "4 operationsがCodexの1 transactionとして記録される");
  const historyTab = page.getByRole("tab", { name: "History", exact: true });
  await clickWithRipple(page, historyTab, "Historyを開く");
  const historyEntry = page.locator(".history-entry").first();
  await moveCursor(page, historyEntry, "Agent · Codex local planner", 900);
  await hold(page, 1_000);
  const historyText = await page.locator(".history-list").innerText();
  const agentActorRecorded = historyText.includes("Agent · Codex local planner")
    && historyText.includes("4 ops");

  // Step 5: deliberately travel to Undo, click it, then travel back to the changed range.
  await setChapter(page, 5, "Agent変更をまとめてUndo", "大きいカーソルでUndoを押し、G列が消えることを確認する");
  const undoButton = page.locator('.title-actions button[aria-label="Undo"]');
  await clickWithRipple(page, undoButton, "Undo: Agentの4操作を戻す");
  const g1 = page.getByLabel("Cell G1", { exact: true });
  await moveCursor(page, g1, "G列が消えた", 1_100);
  const headerAfterUndo = await g1.inputValue();
  await showState(page, "Undo完了: 4操作すべてを一度に取消", 1_300);

  // Step 6: show the inverse path just as explicitly.
  await setChapter(page, 6, "Redoで丸ごと復元", "Redoを押し、同じAgent transactionを再適用する");
  const redoButton = page.locator('.title-actions button[aria-label="Redo"]');
  await clickWithRipple(page, redoButton, "Redo: Agentの4操作を復元");
  await moveCursor(page, g1, "平均単価列が戻った", 1_100);
  const headerAfterRedo = await g1.inputValue();
  await showState(page, "Redo完了: 平均単価列を復元", 1_300);

  // Step 7: prove the transaction survives a full reload through the versioned snapshot.
  await setChapter(page, 7, "Autosaveから再起動復元", "ページを再読み込みし、保存済みのKDLからWorkbookを復元する");
  await page.waitForTimeout(350);
  await page.reload({ waitUntil: "networkidle" });
  await installPresentationLayer(page);
  await setChapter(page, 7, "再起動後も復元済み", "G列のヘッダーと数式値がKDL snapshotから戻っている");
  const recoveredG1 = page.getByLabel("Cell G1", { exact: true });
  await moveCursor(page, recoveredG1, "Autosave recovery成功", 1_100);
  const recoveredHeader = await recoveredG1.inputValue();
  const recoveredFormula = await page.getByLabel("Cell G2", { exact: true }).inputValue();
  await showState(page, "AI変更・KDL・Gridが同期したまま復元", 1_300);

  const desktopOverflow = await page.evaluate(() => ({
    horizontal: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    vertical: document.documentElement.scrollHeight > document.documentElement.clientHeight,
  }));
  await hidePresentationLayer(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForTimeout(100);
  await page.screenshot({ path: APPLIED_IMAGE_PATH, fullPage: false });
  await page.setViewportSize({ width: 980, height: 760 });
  await page.waitForTimeout(100);
  const compactOverflow = await page.evaluate(() => ({
    horizontal: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    vertical: document.documentElement.scrollHeight > document.documentElement.clientHeight,
  }));

  const ffmpeg = Bun.spawn([
    "ffmpeg",
    "-hide_banner",
    "-loglevel", "error",
    "-y",
    "-framerate", String(FPS),
    "-i", join(frameDirectory, "frame-%04d.png"),
    "-c:v", "libx264",
    "-preset", "medium",
    "-crf", "23",
    "-pix_fmt", "yuv420p",
    "-movflags", "+faststart",
    VIDEO_PATH,
  ], { cwd: ROOT, stdout: "ignore", stderr: "inherit" });
  const ffmpegExitCode = await ffmpeg.exited;
  if (ffmpegExitCode !== 0) {
    throw new Error(`ffmpeg encode failed with exit code ${ffmpegExitCode}`);
  }
  await Bun.sleep(250);

  // A successful encoder exit is not enough: decode the whole MP4 so a missing
  // moov atom or truncated frame stream can never be committed as README media.
  const decoder = Bun.spawn([
    "ffmpeg",
    "-hide_banner",
    "-loglevel", "error",
    "-i", VIDEO_PATH,
    "-f", "null",
    "-",
  ], { cwd: ROOT, stdout: "ignore", stderr: "inherit" });
  const decoderExitCode = await decoder.exited;
  if (decoderExitCode !== 0) {
    throw new Error(`Recorded MP4 validation failed with exit code ${decoderExitCode}`);
  }
  recordingCompleted = true;

  console.log(JSON.stringify({
    url: page.url(),
    title,
    meaningfulContent: bodyText.includes("Office IDE") && bodyText.includes("売上"),
    overlayCount,
    messages,
    frames: frame,
    durationSeconds: frame / FPS,
    cellBeforeEnter,
    typedFormulaResult,
    activeAfterEnter,
    proposalVisible,
    proposalHasFormula: proposalText.includes("ROUND(C2/D2,0)"),
    g1BeforeApply,
    headerAfterApply,
    firstFormulaValue,
    lastFormulaValue,
    formulaSerialized,
    agentActorRecorded,
    headerAfterUndo,
    headerAfterRedo,
    recoveredHeader,
    recoveredFormula,
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
