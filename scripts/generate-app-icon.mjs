import { chromium } from "playwright";
import path from "node:path";
import fs from "node:fs/promises";

const output = path.resolve(import.meta.dirname, "..", "build", "icon.png");
await fs.mkdir(path.dirname(output), { recursive: true });

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1024, height: 1024 }, deviceScaleFactor: 1 });
await page.setContent(`<!doctype html><style>
  *{box-sizing:border-box}html,body{margin:0;width:1024px;height:1024px;overflow:hidden;background:transparent}
  .icon{position:relative;width:1024px;height:1024px;border-radius:224px;background:#111512;box-shadow:inset 0 0 0 28px #29332c;overflow:hidden}
  .grid{position:absolute;inset:0;opacity:.18;background-image:linear-gradient(#65c18c 2px,transparent 2px),linear-gradient(90deg,#65c18c 2px,transparent 2px);background-size:72px 72px}
  .terminal{position:absolute;inset:210px 155px;border:24px solid #65c18c;border-radius:54px;background:#0b0d0c;box-shadow:0 32px 70px #0008}
  .prompt{position:absolute;left:88px;top:112px;color:#65c18c;font:900 220px/1 Arial,sans-serif}
  .cursor{position:absolute;right:78px;bottom:105px;width:210px;height:28px;border-radius:14px;background:#f7c948}
</style><div class="icon"><div class="grid"></div><div class="terminal"><span class="prompt">›</span><i class="cursor"></i></div></div>`);
await page.screenshot({ path: output, omitBackground: true });
await browser.close();
console.log(`Generated ${output}`);
