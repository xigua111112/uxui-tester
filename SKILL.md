---
name: ux-playwright-tester-configurable
description: >
  Run automated UX experience tests using Playwright with pain-score evaluator + Feishu reporting.
  Use when: "测试一下这个页面", "帮我跑一下UX测试", "用Playwright测", "生成UX报告",
  "用户体验评分", "从底表读链路测试", "测完回写结果".
---

# UX Playwright Tester

**Your only job: write the `steps[]` block inside `runSinglePersona()`.** Everything else in `references/script-template.ts` is frozen — copy it, fill steps, run it.

---

## Step 0a — chatId（首次运行）

```bash
cat feishu.config.json 2>/dev/null
```

- `chatId` 已有 → 跳到 Step 0b
- 缺少 → 问用户：

> 请打开飞书找到「**体验监控助手**」，把我们的会话 Chat ID（格式 `oc_xxxxxxxx`）发给我。
> 找不到？飞书 PC 端 → 右上角「···」→「复制链接」→ 链接中的 openId 即为 chatId。

拿到后写入 `feishu.config.json`：
```json
{ "chatId": "oc_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" }
```

---

## Step 0b — 确定链路

**先看 prompt：**
- prompt 里已有链路名/URL + cookies → **直接进 Step 1，不问任何问题**
- prompt 里只有链路名（如 "volcengine_withdraw"）→ 跳过列表展示，直接匹配底表，进 Step 1
- 什么都没有 → 读底表，展示编号列表，等用户选一条
- 用户说"手动输入" → 询问 URL + 描述 + cookies

选好后记录：`record_id`、`targetUrl`、`flow_description`、`cookies`。

---

## Step 1 — Setup

- Persona 默认用 `xiao_fang`（专家）+ `xiao_diu`（新手），除非用户指定
- 确认 `targetUrl` 和测试名称
- 需要登录但没有 cookies → 先问 cookies，再往下走

---

## Step 2 — Execute

### 一次性安装（已装跳过）
```bash
npm i playwright --no-save && npx playwright install chromium --with-deps 2>/dev/null || npx playwright install chromium
```

### 生成 `ux-inline-runner.ts`

复制 `references/script-template.ts` → `ux-inline-runner.ts`，**只改这 4 处**：

1. `PERSONAS` — 保持或按需调整
2. `TEST_TARGET` — 填链路名
3. `BITABLE_RECORD_ID` — 填 `record_id`（手动链路留 `""`）
4. `runSinglePersona()` 里的 step blocks — 替换占位注释

有 cookies 时，在 `browser.newContext()` 后加：
```typescript
const FLOW_COOKIES = `[{"name":"...","value":"...","domain":".example.com","path":"/"}]`;
await context.addCookies(JSON.parse(FLOW_COOKIES));
```

### Step block 格式

```typescript
const el = page.locator("selector").first();
await el.waitFor({ timeout: 10000 });          // 计时前等元素就位
const tN = Date.now();                          // 计时开始
await el.click();
await page.waitForSelector("result-sel", { timeout: 15000 });
const sN = `stepN_label${suffix}.png`;
await page.screenshot({ path: path.resolve(assetsDir, sN) });
steps.push({
  name: "步骤名称",
  duration: Date.now() - tN,
  category: "perceived",    // perceived | partially_perceived | non_perceived
  complexity: "medium",     // low=1s基准 | medium=3s | high=6s
  screenshot: `assets/${sN}`,
});
```

### 运行
```bash
node --experimental-strip-types ux-inline-runner.ts
```

> Node v24+：只写 `import { chromium } from "playwright"`，不要 import TypeScript 类型（Browser/Page 等会报错）。
> 出现 esbuild Gatekeeper 错误：`codesign --sign - node_modules/@esbuild/darwin-arm64/bin/esbuild`

---

## Step 3 — 渲染报告

从 stdout 提取并直接渲染（不加代码块）：
```
__REPORT_START_{persona_id}__
...Markdown...
__REPORT_END_{persona_id}__
```

---

## 完成

脚本自动发飞书卡片、自动回写底表。报告渲染后说 **"报告已同步至飞书"**，停止。

---

## 出错时

| 情况 | 处理 |
|------|------|
| 选择器找不到 | 检查页面结构，修 selector，重试一次 |
| 需要登录 | 暂停，问用户要 cookies |
| networkidle 超时 | 换 `waitUntil: "domcontentloaded"` + 等具体 selector |
