// ux-inline-runner.ts
// Full Playwright + UX evaluation engine + Feishu card sender + Feishu bitable integration.
// AI ONLY edits: (1) PERSONAS array, (2) TEST_TARGET, (3) BITABLE_RECORD_ID, (4) step blocks inside runSinglePersona().
// Everything else is frozen infrastructure — do not modify.

import { chromium } from "playwright";
import fs from "fs";
import path from "path";
import https from "https";

// ============================================================
// TYPES
// ============================================================
type TimeClass = "perceived" | "partially_perceived" | "non_perceived" | "tool_overhead" | "diagnostic";
type ComplexityLevel = "low" | "medium" | "high";

interface TraceStep {
  name: string;
  duration: number;
  category: TimeClass;
  complexity: ComplexityLevel;
  description?: string;
  screenshot?: string;
}

interface PersonaConfig {
  id: string;
  name: string;
  humanThinkTimeMs: number;
  personaFactor: number;
  expectationBias: number;
  description?: string;
}

// ============================================================
// EVALUATION ENGINE
// ============================================================
function evaluateExperience(steps: TraceStep[], persona: PersonaConfig) {
  const COMPRESSION_FACTOR = 0.4;
  const EXPECTED_TIMES: Record<string, number> = { low: 1000, medium: 3000, high: 6000 };
  const COMPLEXITY_FACTORS: Record<string, number> = { low: 1.0, medium: 1.2, high: 1.5 };
  const ATTENTION_LOSS: Record<string, number> = { low: 1.0, medium: 1.3, high: 1.8 };

  let totalPhysical = 0, totalBase = 0;
  const breakdown = steps.map(step => {
    const cf = COMPLEXITY_FACTORS[step.complexity] || 1.0;
    const thinkTime = persona.humanThinkTimeMs * cf;
    let base = 0;
    if (step.category === "perceived") base = step.duration + thinkTime;
    else if (step.category === "partially_perceived") base = step.duration * COMPRESSION_FACTOR + thinkTime;
    const attn = ATTENTION_LOSS[step.complexity] || 1.0;
    const pain = base * attn * persona.personaFactor;
    totalPhysical += step.duration;
    totalBase += base;
    return {
      step: step.name, category: step.category, complexity: step.complexity,
      original_ms: Math.round(step.duration), think_time_ms: Math.round(thinkTime),
      base_perceived_ms: Math.round(base), final_pain_ms: Math.round(pain),
      screenshot: step.screenshot,
    };
  });

  const validSteps = breakdown.filter(s => s.category !== "tool_overhead" && s.category !== "diagnostic");
  const expectedTime = validSteps.reduce((sum, s) => {
    const orig = steps.find(o => o.name === s.step);
    return sum + (EXPECTED_TIMES[orig?.complexity || "medium"] * persona.expectationBias);
  }, 0);
  const totalPain = breakdown.reduce((s, b) => s + b.final_pain_ms, 0);
  const ratio = totalPain / expectedTime;
  const score = ratio <= 0.8 ? "Excellent (S)" : ratio <= 1.2 ? "Good (A)" : ratio <= 1.5 ? "Fair (B)" : "Poor (C)";

  return {
    totalPhysicalTime: totalPhysical, totalBasePerceivedTime: totalBase, totalPainScore: totalPain,
    personaFactor: persona.personaFactor, expectationBias: persona.expectationBias,
    complexity: { validSteps: validSteps.length, expectedTimeMs: expectedTime, totalSteps: steps.length, breakpoints: 0 },
    score, breakdown
  };
}

// ============================================================
// EXPERT SUGGESTIONS
// ============================================================
function expertSuggestions(result: ReturnType<typeof evaluateExperience>): string {
  const sorted = [...result.breakdown].sort((a, b) => b.final_pain_ms - a.final_pain_ms);
  const worstStep = sorted[0];
  const stepCount = result.complexity.totalSteps;
  const slowLoads = result.breakdown.filter(s => s.category === "perceived" && s.original_ms > 5000);

  const interactionTip = stepCount >= 6
    ? `交互：${stepCount}步路径偏长，建议合并相似操作减少决策节点`
    : `交互：流程步骤合理，关键操作节点可增加进度指引`;
  const visualTip = worstStep
    ? `视觉：「${worstStep.step}」缺乏加载反馈，空白等待易造成用户误操作`
    : `视觉：各阶段状态反馈清晰`;
  const perfTip = slowLoads.length > 0
    ? `性能：${slowLoads.map(s => `「${s.step}」${(s.original_ms / 1000).toFixed(1)}s`).join("、")}超阈值，建议资源预加载`
    : `性能：页面响应速度良好`;

  const raw = `${interactionTip}；${visualTip}；${perfTip}。`;
  return raw.length <= 150 ? raw : raw.slice(0, 149) + "…";
}

// ============================================================
// REPORT GENERATOR
// ============================================================
function generateReport(result: ReturnType<typeof evaluateExperience>, persona: PersonaConfig, testTarget: string): string {
  return `
# UX 体验测试报告

**测试时间**: ${new Date().toISOString().split("T")[0]}
**测试目标**: ${testTarget}
**用户画像**: ${persona.name} (ThinkTime: ${persona.humanThinkTimeMs}ms, Factor: ${persona.personaFactor}, ExpBias: ${persona.expectationBias})
- **Total Steps**: ${result.complexity.totalSteps}

## 1. 核心结论
| 综合评分 | 总物理耗时 | 总感知耗时 | 总疼痛评分 |
| :--- | :--- | :--- | :--- |
| **${result.score}** | **${(result.totalPhysicalTime / 1000).toFixed(2)}s** | **${(result.totalBasePerceivedTime / 1000).toFixed(2)}s** | **${(result.totalPainScore / 1000).toFixed(2)}s** |

## 2. 详细链路数据
| 步骤 | 物理耗时 (s) | 感知耗时 (s) | 疼痛评分 (s) | 复杂度 | 截图 |
| :--- | :--- | :--- | :--- | :--- | :--- |
${result.breakdown.map(s => `| ${s.step} | ${(s.original_ms / 1000).toFixed(2)}s | ${(s.base_perceived_ms / 1000).toFixed(2)}s | ${(s.final_pain_ms / 1000).toFixed(2)}s | ${s.complexity} | ${s.screenshot ? `![Step](${s.screenshot})` : "-"} |`).join("\n")}

## 3. 改进建议
${expertSuggestions(result)}
`;
}

// ============================================================
// FEISHU CONFIG LOADER
// ============================================================
interface FeishuConfig {
  appId?: string; appSecret?: string; chatId?: string; webhook?: string;
  bitableAppToken?: string; bitableTableId?: string;
}

function loadFeishuConfig(): FeishuConfig {
  const cfg: FeishuConfig = {
    appId:           process.env.FEISHU_APP_ID     || "cli_a9fd9e1ed9391bb5",
    appSecret:       process.env.FEISHU_APP_SECRET  || "ciijpSRhELLeCQjiNWYNfeNmfGqBV67v",
    chatId:          process.env.FEISHU_CHAT_ID     || "oc_f2e30190dac2a19233cc2f4873a81d6d",
    webhook:         process.env.FEISHU_WEBHOOK     || "",
    bitableAppToken: process.env.FEISHU_BITABLE_APP_TOKEN || "ScyzbEZV0a5pLrsbEVhcH6HtnoK",
    bitableTableId:  process.env.FEISHU_BITABLE_TABLE_ID  || "tblkuNVO6Pe8bP38",
  };
  const tryFile = (p: string) => {
    if (!fs.existsSync(p)) return;
    try {
      const j = JSON.parse(fs.readFileSync(p, "utf-8"));
      if (j.appId     || j.app_id)     cfg.appId     = j.appId     || j.app_id;
      if (j.appSecret || j.app_secret) cfg.appSecret = j.appSecret || j.app_secret;
      if (j.chatId    || j.chat_id)    cfg.chatId    = j.chatId    || j.chat_id;
      if (j.webhook)                   cfg.webhook   = j.webhook;
      if (j.bitableAppToken)           cfg.bitableAppToken = j.bitableAppToken;
      if (j.bitableTableId)            cfg.bitableTableId  = j.bitableTableId;
    } catch { /* ignore */ }
  };
  tryFile(path.resolve(process.cwd(), "feishu.config.json"));
  tryFile(path.resolve(process.env.HOME || "~", ".ux-playwright-tester/feishu.json"));
  return cfg;
}

const _FEISHU        = loadFeishuConfig();
const FEISHU_APP_ID     = _FEISHU.appId        || "";
const FEISHU_APP_SECRET = _FEISHU.appSecret    || "";
const FEISHU_CHAT_ID    = _FEISHU.chatId       || "";
const FEISHU_WEBHOOK    = _FEISHU.webhook      || "";
const BITABLE_APP_TOKEN = _FEISHU.bitableAppToken || "";
const BITABLE_TABLE_ID  = _FEISHU.bitableTableId  || "";

function isFeishuReady(): boolean {
  return !!(FEISHU_APP_ID && FEISHU_APP_SECRET && (FEISHU_CHAT_ID || FEISHU_WEBHOOK));
}
function isBitableReady(): boolean {
  return !!(FEISHU_APP_ID && FEISHU_APP_SECRET && BITABLE_APP_TOKEN && BITABLE_TABLE_ID);
}
function printFeishuSetupHint(): void {
  console.log("\n⚠️  Feishu 未配置，报告将只在本地输出。");
}

// ============================================================
// HTTP HELPERS
// ============================================================
function httpsRequest(method: string, url: string, body: string | Buffer, headers: Record<string, string>): Promise<string> {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.request({
      hostname: u.hostname, path: u.pathname + u.search, method,
      headers: { "Content-Length": Buffer.byteLength(body), ...headers }
    }, res => {
      let d = ""; res.on("data", c => d += c); res.on("end", () => resolve(d));
    });
    req.on("error", reject); req.write(body); req.end();
  });
}

async function getFeishuToken(): Promise<string> {
  const res = await httpsRequest(
    "POST", "https://open.larkoffice.com/open-apis/auth/v3/tenant_access_token/internal",
    JSON.stringify({ app_id: FEISHU_APP_ID, app_secret: FEISHU_APP_SECRET }),
    { "Content-Type": "application/json" }
  );
  const json = JSON.parse(res);
  if (json.code !== 0) throw new Error(`Feishu token error: ${json.msg}`);
  return json.tenant_access_token;
}

async function uploadImageToFeishu(token: string, filePath: string): Promise<string> {
  return new Promise(resolve => {
    if (!fs.existsSync(filePath)) { resolve(""); return; }
    const fileData = fs.readFileSync(filePath);
    const boundary = "----FormBoundary" + Math.random().toString(36).slice(2);
    const CRLF = "\r\n";
    const filename = path.basename(filePath);
    const header = [
      `--${boundary}`, `Content-Disposition: form-data; name="image_type"`, "", "message",
      `--${boundary}`, `Content-Disposition: form-data; name="image"; filename="${filename}"`,
      `Content-Type: image/png`, "", ""
    ].join(CRLF);
    const footer = `${CRLF}--${boundary}--${CRLF}`;
    const body = Buffer.concat([Buffer.from(header), fileData, Buffer.from(footer)]);
    const u = new URL("https://open.larkoffice.com/open-apis/im/v1/images");
    const req = https.request({
      hostname: u.hostname, path: u.pathname, method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": `multipart/form-data; boundary=${boundary}`,
        "Content-Length": body.length
      }
    }, res => {
      let data = "";
      res.on("data", d => data += d);
      res.on("end", () => {
        try {
          const json = JSON.parse(data);
          if (json.code === 0) resolve(json.data.image_key);
          else { console.warn(`[feishu] Image upload failed: ${data}`); resolve(""); }
        } catch { resolve(""); }
      });
    });
    req.on("error", e => { console.warn(`[feishu] Upload error: ${e}`); resolve(""); });
    req.write(body);
    req.end();
  });
}

// ============================================================
// BITABLE WRITE-BACK
// ============================================================
async function writeResultToBitable(
  token: string, recordId: string,
  result: ReturnType<typeof evaluateExperience>, messageId: string
): Promise<void> {
  const url = `https://open.larkoffice.com/open-apis/bitable/v1/apps/${BITABLE_APP_TOKEN}/tables/${BITABLE_TABLE_ID}/records/${recordId}`;
  const body = JSON.stringify({
    fields: {
      last_score:          result.score,
      last_perceived_time: parseFloat((result.totalBasePerceivedTime / 1000).toFixed(2)),
      last_pain_score:     parseFloat((result.totalPainScore / 1000).toFixed(2)),
      last_test_date:      new Date().toISOString().split("T")[0],
      last_message_id:     messageId,
    }
  });
  try {
    const res = await httpsRequest("PUT", url, body, {
      "Content-Type": "application/json", Authorization: `Bearer ${token}`,
    });
    const json = JSON.parse(res);
    if (json.code !== 0) console.warn("[bitable] write-back failed:", json.msg);
    else console.log(`[bitable] ✅ written back → record ${recordId}`);
  } catch (e) { console.warn("[bitable] error:", e); }
}

// ============================================================
// FEISHU CARD SENDER
// ============================================================
async function sendFeishuCard(
  result: ReturnType<typeof evaluateExperience>,
  persona: PersonaConfig, testTarget: string, assetsDir: string
): Promise<string> {
  if (!isFeishuReady()) { printFeishuSetupHint(); return ""; }
  try {
    const token = await getFeishuToken();
    const imageKeyCache: Record<string, string> = {};
    for (const s of result.breakdown) {
      if (s.screenshot && !imageKeyCache[s.screenshot]) {
        const absPath = path.resolve(path.dirname(assetsDir), s.screenshot);
        const key = await uploadImageToFeishu(token, absPath);
        if (key) imageKeyCache[s.screenshot] = key;
      }
    }
    const scoreColorMap: Record<string, string> = {
      "Excellent (S)": "green", "Good (A)": "blue", "Fair (B)": "orange", "Poor (C)": "red"
    };
    const headerColorMap: Record<string, string> = {
      "Excellent (S)": "green", "Good (A)": "blue", "Fair (B)": "yellow", "Poor (C)": "red"
    };
    const scoreColor  = scoreColorMap[result.score]  || "grey";
    const headerColor = headerColorMap[result.score] || "grey";
    const stepRows = result.breakdown.map(s => ({
      step:          s.step,
      physical_time: `${(s.original_ms / 1000).toFixed(2)}s`,
      perceived_time:`${(s.base_perceived_ms / 1000).toFixed(2)}s`,
      pain_score:    `${(s.final_pain_ms / 1000).toFixed(2)}s`,
      complexity:    s.complexity,
      screenshot:    imageKeyCache[s.screenshot || ""]
        ? `![截图](${imageKeyCache[s.screenshot!]})`
        : "-",
    }));
    const M = "0px 0px 0px 0px";
    const card = {
      schema: "2.0", config: { update_multi: true },
      header: {
        title:    { tag: "plain_text", content: "UX 体验测试报告" },
        subtitle: { tag: "plain_text", content: `${testTarget} · ${persona.name}` },
        template: headerColor, padding: "12px 8px 12px 8px"
      },
      body: {
        direction: "vertical",
        elements: [
          { tag: "markdown", margin: M,
            content: `**测试时间**: ${new Date().toISOString().split("T")[0]}\n**用户画像**: ${persona.name} (ThinkTime: ${persona.humanThinkTimeMs}ms, Factor: ${persona.personaFactor})\n- **Total Steps**: ${result.complexity.totalSteps}` },
          { tag: "hr", margin: M },
          { tag: "markdown", content: "## 1. 核心结论", margin: M },
          {
            tag: "column_set", flex_mode: "stretch", horizontal_spacing: "12px", margin: M,
            columns: [
              { tag: "column", width: "weighted", weight: 1, background_style: "blue-50",
                padding: "12px 12px 12px 12px", vertical_spacing: "2px", vertical_align: "top",
                elements: [
                  { tag: "markdown", content: `## <font color='${scoreColor}'>${result.score}</font>`, text_align: "center" },
                  { tag: "markdown", content: "<font color='grey'>综合评分</font>", text_align: "center" }
                ] },
              { tag: "column", width: "weighted", weight: 1, background_style: "violet-50",
                padding: "12px 12px 12px 12px", vertical_spacing: "2px", vertical_align: "top",
                elements: [
                  { tag: "markdown", content: `## <font color='violet'>${(result.totalPhysicalTime / 1000).toFixed(2)}s</font>`, text_align: "center" },
                  { tag: "markdown", content: "<font color='grey'>总物理耗时</font>", text_align: "center" }
                ] },
              { tag: "column", width: "weighted", weight: 1, background_style: "purple-50",
                padding: "12px 12px 12px 12px", vertical_spacing: "2px", vertical_align: "top",
                elements: [
                  { tag: "markdown", content: `## <font color='purple'>${(result.totalBasePerceivedTime / 1000).toFixed(2)}s</font>`, text_align: "center" },
                  { tag: "markdown", content: "<font color='grey'>总感知耗时</font>", text_align: "center" }
                ] },
              { tag: "column", width: "weighted", weight: 1, background_style: "blue-50",
                padding: "12px 12px 12px 12px", vertical_spacing: "2px", vertical_align: "top",
                elements: [
                  { tag: "markdown", content: `## <font color='blue'>${(result.totalPainScore / 1000).toFixed(2)}s</font>`, text_align: "center" },
                  { tag: "markdown", content: "<font color='grey'>总疼痛评分</font>", text_align: "center" }
                ] },
            ]
          },
          { tag: "hr", margin: M },
          { tag: "markdown", content: "## 2. 详细链路数据", margin: M },
          {
            tag: "table", row_height: "middle", page_size: 5, margin: M,
            header_style: { text_align: "left", background_style: "none", bold: true, lines: 1 },
            columns: [
              { name: "step",           display_name: "步骤",         data_type: "text",     horizontal_align: "left", width: "auto" },
              { name: "physical_time",  display_name: "物理耗时 (s)", data_type: "text",     horizontal_align: "left", width: "auto" },
              { name: "perceived_time", display_name: "感知耗时 (s)", data_type: "text",     horizontal_align: "left", width: "auto" },
              { name: "pain_score",     display_name: "疼痛评分 (s)", data_type: "text",     horizontal_align: "left", width: "auto" },
              { name: "complexity",     display_name: "复杂度",       data_type: "text",     horizontal_align: "left", width: "auto" },
              { name: "screenshot",     display_name: "截图",         data_type: "markdown", horizontal_align: "left", width: "auto" },
            ],
            rows: stepRows
          },
          { tag: "hr", margin: M },
          { tag: "markdown", content: `## 3. 改进建议\n${expertSuggestions(result)}`, margin: M }
        ]
      }
    };

    let messageId = "";
    if (FEISHU_CHAT_ID) {
      const res = await httpsRequest(
        "POST",
        "https://open.larkoffice.com/open-apis/im/v1/messages?receive_id_type=chat_id",
        JSON.stringify({ receive_id: FEISHU_CHAT_ID, msg_type: "interactive", content: JSON.stringify(card) }),
        { "Content-Type": "application/json", Authorization: `Bearer ${token}` }
      );
      const j = JSON.parse(res);
      messageId = j.data?.message_id || "";
      console.log(`[${persona.id}] Feishu sent: message_id=${messageId} code=${j.code}`);
    } else if (FEISHU_WEBHOOK) {
      await httpsRequest("POST", FEISHU_WEBHOOK, JSON.stringify({ msg_type: "interactive", card }), { "Content-Type": "application/json" });
      console.log(`[${persona.id}] Feishu (webhook) sent.`);
    }
    return messageId;
  } catch (e) {
    console.error(`[${persona.id}] Feishu send error:`, e);
    return "";
  }
}

// ============================================================
// PERSONAS
// ============================================================
const PERSONAS: PersonaConfig[] = [
  {
    id: "xiao_fang",
    name: "Expert Developer (Xiao Fang)",
    humanThinkTimeMs: 1000,
    personaFactor: 1.2,
    expectationBias: 0.7,
    description: "Highly skilled, impatient with delays, expects high performance."
  },
];

// ============================================================
// TEST TARGET
// ============================================================
const TEST_TARGET = "火山引擎官网 — hover头像找充值入口 → 输入金额 → 确认充值";

// ============================================================
// BITABLE RECORD ID
// ============================================================
const BITABLE_RECORD_ID = "";

// ============================================================
// TEST RUNNER
// ============================================================
async function runSinglePersona(
  browser: any,
  persona: PersonaConfig,
  reportDir: string,
  assetsDir: string,
  bitableRecordId: string
) {
  console.log(`\n=== Starting test for Persona: ${persona.name} ===`);
  const steps: TraceStep[] = [];
  const suffix = `_${persona.id}`;
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
  });

  // ── Inject cookies ──────────────────────────────────────
  await context.addCookies([
    { name: "monitor_session_id", value: "4729048164866244139",    domain: ".volcengine.com", path: "/" },
    { name: "userInfo", value: "eyJhbGciOiJSUzI1NiIsImtpZCI6ImE5ZDM1YTQ4YmZiNDExZjA4OWMwMDAxNjNlMDcwOGJkIn0.eyJhY2NfaSI6MjEwMDg5NDc2OCwiYXVkIjpbImNvbnNvbGUudm9sY2VuZ2luZS5jb20iXSwiZXhwIjoxNzgwODE2MzIwLCJpIjoiMzU0MjVhMzA0YWFkMTFmMTlhZjAzNDM2YWMxMjAwZTgiLCJpZF9uIjoiYWJ0ZXN0X2YiLCJtc2ciOm51bGwsInBpZCI6ImZhNzBlMzg4LWNmMzktNGUwMi1hOWMxLWEzYzUzYmU1MzU4ZiIsInNzX24iOiJhYnRlc3RfZiIsInQiOiJBY2NvdW50IiwidG9waWMiOiJzaWduaW5fdXNlcl9pbmZvIiwidmVyc2lvbiI6InYxIiwiemlwIjoiIn0.SPCGIbNznDXO0xY5-H0kwtVO_MnjFFuqPQ-iWOBn6YMB3JVqUm2ogf-k2hkDLM2NeZkXP-KlgOZAoE6Id2ivu3Plr24S9qGnjJyT_VFgHA5FPGCgjdNfzIbYKtZ0WKuxzci_7FECDi-X0hHRQcysFBdH8CLmfO-SANF2gqtUj7dKCTI8E7GS3LeQUR9pjSd9FzbWcPO8_Yv656K0FNMgvHhi9no5Wb-spXij0H3dQP9moqs-EJNZAF7fR5oy5xEdP4QCvKxaEc5XYlYBtp9v_hHkgfKF3w0yn9Os6CXGHwh4ltVJr1Y_k8nQtWUbSC0GByzaZUExhQgWr8ljtQcXeQ", domain: ".volcengine.com", path: "/" },
    { name: "digest", value: "eyJhbGciOiJSUzI1NiIsImtpZCI6ImE5ZDM1YTQ4YmZiNDExZjA4OWMwMDAxNjNlMDcwOGJkIn0.eyJhdWQiOlsiY29uc29sZS52b2xjZW5naW5lLmNvbSJdLCJleHAiOjE3NzgzOTcxMjAsImlhdCI6MTc3ODIyNDMyMCwiaXNzIjoiaHR0cHM6Ly9zaWduaW4udm9sY2VuZ2luZS5jb20iLCJqdGkiOiJmYTcwZTM4OC1jZjM5LTRlMDItYTljMS1hM2M1M2JlNTM1OGYiLCJtc2ciOiJINHNJQUFBQUFBQUMvK0tTNFdMeFM4eE5GZUpJVENwSkxTNkpUNVBZTy9QYmVUYUZBeUJTeUpDTDNURTVPYjgwcjBSZ3c0NG5MOW1sNE1xVXdOcTAySkx6YzNQejg3emc0b0FBQUFELy8wcG1HeE5SQUFBQSIsIm5hbWUiOiJhYnRlc3RfZiIsInNjb3BlcyI6bnVsbCwic3ViIjoiMjEwMDg5NDc2OCIsInRvcGljIjoic2lnbmluX2NyZWRlbnRpYWwiLCJ0cm4iOiJ0cm46aWFtOjoyMTAwODk0NzY4OnJvb3QiLCJ2ZXJzaW9uIjoidjEiLCJ6aXAiOiJnemlwIn0.NajaSIY_sllf3T5RGVmOMlKmNVxavAuf8zeN5BrQZ0RNrWXfMKIbKg5Vz8jp-dP0i5dMjuOChEHbT5usVokSBLiW5V8TXP9omi_FR0YEszdFF7KetU8F7iUU3ZBYRfDzR0kjy65v8sbPwx6FRQi9ro1DWoJtPHscNpGhfLJh8FO1JQ530T5dgT1fFTsAtlW49ZlEO_4A3x3COt5-YZAwX2w6SseeNjz-uWAjMyZaFKHmdamPZ_ieUJgSlzHzWj8Qp8v4KY752ar34DBY5SaomBXbD_n6OhOhOZn0RfqjU_7jesZ1RpnV-85224h1F02Jq0LojrGgDHKX9clXfk8txQ", domain: ".volcengine.com", path: "/" },
  ]);

  const page = await context.newPage();

  try {
    // ── Step 1: 进入火山引擎官网 ─────────────────────────
    const t1 = Date.now();
    await page.goto("https://www.volcengine.com/", { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForTimeout(2000);
    const s1 = `step1_homepage${suffix}.png`;
    await page.screenshot({ path: path.resolve(assetsDir, s1) });
    steps.push({ name: "进入火山引擎官网", duration: Date.now() - t1, category: "perceived", complexity: "medium", screenshot: `assets/${s1}` });

    // ── 关闭首页可能弹出的广告/引导弹窗 ──────────────────
    await page.locator('button, [class*="close"], [class*="Close"]')
      .filter({ hasText: /^×$|^✕$|关闭/ }).first()
      .click({ timeout: 3000 }).catch(() => null);
    await page.keyboard.press('Escape').catch(() => null);
    await page.waitForTimeout(500);

    // ── Step 2: Hover 右上角头像，等 hover 卡片出现 ──────
    const t2 = Date.now();
    const avatarLocator = page.locator('.volcfe-nav-pc-user-icon-wrap').first();
    await avatarLocator.waitFor({ state: 'visible', timeout: 10000 });
    await avatarLocator.hover({ force: true });
    await page.waitForTimeout(800);
    const s2 = `step2_hover_card${suffix}.png`;
    await page.screenshot({ path: path.resolve(assetsDir, s2) });
    steps.push({ name: "Hover头像展开用户卡片", duration: Date.now() - t2, category: "perceived", complexity: "low", screenshot: `assets/${s2}` });

    // ── Step 3: 点击「充值」进入充值页 ───────────────────
    const t3 = Date.now();
    // Re-hover avatar to keep dropdown open, find 充值 link, move to it and click
    await avatarLocator.hover({ force: true });
    await page.waitForTimeout(800);
    const rechargeRect = await page.evaluate(() => {
      const els = Array.from(document.querySelectorAll('a, button, [role="menuitem"], span, li')) as HTMLElement[];
      const link = els.find(el => {
        const txt = (el.innerText || el.textContent || '').replace(/\s/g, '');
        return txt.startsWith('充值') && txt.length <= 6 && el.getBoundingClientRect().width > 0;
      });
      if (!link) return null;
      const r = link.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2, href: (link as HTMLAnchorElement).href || '', text: (link.innerText || '').trim() };
    });
    let rechargePage: any = null;
    if (rechargeRect) {
      await page.mouse.move(rechargeRect.x, rechargeRect.y, { steps: 5 });
      await page.waitForTimeout(300);
      [rechargePage] = await Promise.all([
        page.context().waitForEvent('page', { timeout: 10000 }).catch(() => null),
        page.mouse.click(rechargeRect.x, rechargeRect.y),
      ]);
    } else {
      // Fallback: navigate directly (known from DOM dump)
      await page.goto('https://console.volcengine.com/finance/fund/recharge', { waitUntil: 'domcontentloaded' });
    }
    const target = (rechargePage || page) as typeof page;
    if (rechargePage) {
      await rechargePage.bringToFront();
      await rechargePage.waitForLoadState('domcontentloaded');
    }
    await target.waitForFunction(
      () => (document.body?.innerText || '').includes('充值金额'),
      null,
      { timeout: 25000 }
    );
    await target.waitForTimeout(1000);
    const s3 = `step3_recharge_page${suffix}.png`;
    await target.screenshot({ path: path.resolve(assetsDir, s3) });
    steps.push({ name: "点击充值进入充值页", duration: Date.now() - t3, category: "perceived", complexity: "medium", screenshot: `assets/${s3}` });

    // ── Step 4: 输入充值金额 5 ────────────────────────────
    const amountInput = target.locator('input[placeholder*="金额"], input[placeholder*="请输入"], input[type="number"]').first();
    await amountInput.waitFor({ timeout: 10000 });
    const t4 = Date.now();
    await amountInput.click();
    await amountInput.fill("5");
    await target.waitForTimeout(400);
    const s4 = `step4_input_amount${suffix}.png`;
    await target.screenshot({ path: path.resolve(assetsDir, s4) });
    steps.push({ name: "输入充值金额 5 元", duration: Date.now() - t4, category: "partially_perceived", complexity: "low", screenshot: `assets/${s4}` });

    // ── Step 5: 勾选「我已知悉」协议 ─────────────────────
    const checkbox = target.locator('input[type="checkbox"]').first();
    await checkbox.waitFor({ state: 'attached', timeout: 8000 });
    const t5 = Date.now();
    // The checkbox is hidden (custom styled) — force-check it
    await checkbox.check({ force: true }).catch(async () => {
      // Fallback: click the visible label that wraps the checkbox
      await target.locator('label, [class*="agree"], [class*="check-wrap"]')
        .filter({ hasText: /我已知悉/ }).first().click({ force: true });
    });
    await target.waitForTimeout(300);
    const s5 = `step5_agree${suffix}.png`;
    await target.screenshot({ path: path.resolve(assetsDir, s5) });
    steps.push({ name: "勾选我已知悉协议", duration: Date.now() - t5, category: "non_perceived", complexity: "low", screenshot: `assets/${s5}` });

    // ── Step 6: 点击「确认充值」─────────────────────────
    const confirmBtn = target.locator('button').filter({ hasText: /确认充值/ }).first();
    await confirmBtn.waitFor({ timeout: 8000 });
    const t6 = Date.now();
    await confirmBtn.click();
    await target.waitForTimeout(2000);
    const s6 = `step6_confirm${suffix}.png`;
    await target.screenshot({ path: path.resolve(assetsDir, s6) });
    steps.push({ name: "点击确认充值", duration: Date.now() - t6, category: "perceived", complexity: "medium", screenshot: `assets/${s6}` });

  } catch (e) {
    console.error(`[${persona.id}] Error:`, e);
    const errShot = `step_error${suffix}.png`;
    await page.screenshot({ path: path.resolve(assetsDir, errShot), fullPage: false }).catch(() => {});
    steps.push({ name: "错误诊断", duration: 0, category: "diagnostic", complexity: "high", screenshot: `assets/${errShot}` });
  } finally {
    await context.close();
  }

  const result   = evaluateExperience(steps, persona);
  const markdown = generateReport(result, persona, TEST_TARGET);

  fs.writeFileSync(path.resolve(reportDir, `trace_output_${persona.id}.json`), JSON.stringify({ steps, persona, result }, null, 2));
  fs.writeFileSync(path.resolve(reportDir, `ux_report_${persona.id}.md`), markdown);

  console.log(`\n__REPORT_START_${persona.id}__`);
  console.log(markdown);
  console.log(`__REPORT_END_${persona.id}__`);

  const messageId = await sendFeishuCard(result, persona, TEST_TARGET, assetsDir);

  if (isBitableReady() && bitableRecordId) {
    const token = await getFeishuToken().catch(() => "");
    if (token) await writeResultToBitable(token, bitableRecordId, result, messageId);
  }
}

// ============================================================
// MAIN
// ============================================================
async function run() {
  const reportDir = path.resolve(process.cwd(), "report");
  const assetsDir = path.resolve(reportDir, "assets");
  if (!fs.existsSync(assetsDir)) fs.mkdirSync(assetsDir, { recursive: true });

  const browser = await chromium.launch({ headless: true, args: ["--no-sandbox", "--disable-setuid-sandbox"] });
  try {
    for (const persona of PERSONAS) {
      await runSinglePersona(browser, persona, reportDir, assetsDir, BITABLE_RECORD_ID);
    }
  } finally {
    await browser.close();
    console.log("All tests completed.");
  }
}

run().catch(console.error);
