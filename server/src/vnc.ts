import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright-core";
import { pngDimensions } from "./png.ts";

export interface NoVncOptions {
  viewerUrl: string;
  password: string;
  executablePath?: string;
  timeoutMs?: number;
}

export interface DesktopFrame {
  png: Uint8Array;
  width: number;
  height: number;
}

/** Controls only the noVNC transport UI and its pixels, never the target app's DOM. */
export class NoVncDesktop {
  private constructor(
    private readonly browser: Browser,
    private readonly context: BrowserContext,
    private readonly page: Page,
  ) {}

  static async login(options: NoVncOptions): Promise<NoVncDesktop> {
    const browser = await chromium.launch({
      headless: true,
      ...(options.executablePath ? { executablePath: options.executablePath } : {}),
    });
    try {
      const context = await browser.newContext({
        viewport: { width: 1280, height: 800 },
        deviceScaleFactor: 1,
      });
      const page = await context.newPage();
      const timeout = options.timeoutMs ?? 20_000;
      await page.goto(options.viewerUrl, { waitUntil: "domcontentloaded", timeout });
      await page.locator("#noVNC_connect_button").click({ timeout });
      const password = page.locator("#noVNC_password_input");
      await password.waitFor({ state: "visible", timeout });
      await password.fill(options.password);
      await page.locator("#noVNC_credentials_button").click();
      await page.locator("html.noVNC_connected").waitFor({ state: "attached", timeout });
      await page.locator("#noVNC_container canvas").waitFor({ state: "visible", timeout });
      // Authentication is complete; allow the remote browser/application to paint.
      await page.waitForTimeout(2_000);
      return new NoVncDesktop(browser, context, page);
    } catch (error) {
      await browser.close();
      throw new Error("noVNC login failed", { cause: error });
    }
  }

  async capture(path?: string): Promise<DesktopFrame> {
    // Reading the transport canvas excludes noVNC's overlaid controls/status.
    // This is the remote screen itself, not access to the target application's DOM.
    const encoded = await this.page
      .locator("#noVNC_container canvas")
      .evaluate((canvas) => (canvas as HTMLCanvasElement).toDataURL("image/png").split(",")[1]);
    if (!encoded) throw new Error("Desktop canvas capture failed");
    const png = Buffer.from(encoded, "base64");
    if (path) {
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, png);
    }
    return { png, ...pngDimensions(png) };
  }

  async click(x: number, y: number): Promise<void> {
    const frame = await this.capture();
    if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0 || x >= frame.width || y >= frame.height) {
      throw new Error("Desktop click is outside the latest frame");
    }
    const canvas = this.page.locator("#noVNC_container canvas");
    const box = await canvas.boundingBox();
    if (!box) throw new Error("Desktop canvas is not visible");
    await this.page.mouse.move(
      box.x + (x * box.width) / frame.width,
      box.y + (y * box.height) / frame.height,
    );
    await this.page.mouse.down();
    await this.page.waitForTimeout(120);
    await this.page.mouse.up();
    await this.page.waitForTimeout(1_000);
  }

  async close(): Promise<void> {
    await this.context.close();
    await this.browser.close();
  }
}
