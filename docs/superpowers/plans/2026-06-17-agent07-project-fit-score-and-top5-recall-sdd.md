# Agent07 Project Fit Score 与 Top5 Recall 增量系统设计

日期：2026-06-17
范围：Project Sentinel v3 / Agent07 Scout Stream / Artifacts Theater
阶段：SDD / TDD Red 前置设计

## 1. 问题定义

当前 Agent07 的运行态结果已经从 dummy 数据切换到真实 runtime shadow 候选，但业务判断仍然不可交付，核心原因不是页面渲染，而是评分语义错误：

1. 现有 `evidence score` 混合了来源质量、关键词命中、artifact 数量和 README 线索。它能说明“证据是否像真的”，但不能说明“这个技能是否符合 Agent07 的原始目标”。
2. 当前只召回 2 个 scout 结果，低于项目目标 Top 5。页面若不显式暴露 `PARTIAL_RECALL · 2/5`，用户会误以为结果已经完整。
3. `pdf2ppt` 这类 PDF -> PPT 转换工具因为命中 `pdf`、`pptx`、artifact 等词，可能获得比“Markdown/模板/布局 -> PPTX 生成技能”更高的分数。但从第一性原理看，它是旁路能力，不是主线能力。

Stage 目标不是直接增加 UI 装饰，而是把“能否批准深挖”的判断依据从通用 evidence score 升级为业务适配分与召回完整度合同。

## 2. 新评分语义

Agent07 后续必须拆分三类分数，严禁再用单一 `evidence score` 承担全部判断：

| 字段 | 语义 | 用途 |
| --- | --- | --- |
| `evidence_quality_score` | 来源证据质量、README 可读性、artifact 线索、仓库基础可信度 | 证明候选不是空壳或伪线索 |
| `project_fit_score` | 与 Agent07 原始目标的业务适配度 | 决定 Scout Stream 排序和是否值得深挖 |
| `integration_feasibility_score` | 本地可运行性、CLI/API 清晰度、依赖复杂度、许可风险 | 决定深挖优先级与后续接入成本 |

本阶段 TDD 只锁定 `project_fit_score` 与 Top5 recall contract；`integration_feasibility_score` 可先保留为后续扩展字段，不进入 Green 最小实现。

## 3. Project Fit 评分合同

Agent07 的原始业务目标是寻找可被接入本地工作流的 PPT 生成/编辑能力，尤其是“从 Markdown、结构化大纲、模板布局或 agent skill 输入生成可编辑 PPTX”的技能。评分必须优先奖励主线能力，显式降权旁路能力。

### 3.1 主线加权信号

候选命中以下信号时提升 `project_fit_score`：

- `MAINLINE_MARKDOWN_TO_PPTX`：Markdown / outline / structured content -> PPTX deck。
- `TEMPLATE_LAYOUT_REUSE`：复用用户模板、slide master、layout、theme，不破坏排版。
- `CODEX_SKILL_COMPATIBLE`：以 Codex/Claude/OpenAI agent skill 或本地脚本形式可接入。
- `EDITABLE_PPTX_OUTPUT`：输出原生可编辑 `.pptx`，不是图片或 PDF。
- `LOCAL_AUTOMATION_SURFACE`：具备 CLI、Node/Python API、明确入口或示例。

### 3.2 旁路降权信号

候选命中以下信号时降低 `project_fit_score`，不能仅凭 evidence quality 反超主线技能：

- `SIDE_PATH_PDF_CONVERSION`：PDF -> PPT/PPTX 转换。它对“已有 PDF 转稿”有用，但不解决从 Markdown/模板生成 PPT 的主目标。
- `STATIC_CONVERTER_ONLY`：只做格式转换，缺少布局生成或模板复用逻辑。
- `TELEGRAM_OR_SERVICE_WRAPPER`：主要是 Bot 或远程服务包装，缺少本地可控接口。
- `NO_TEMPLATE_CONTROL`：无法证明支持模板、slide master 或布局保真。
- `WEAK_MAINTENANCE_SIGNAL`：低维护、低 README 密度或缺少最小运行说明。

### 3.3 必须满足的排序红线

当输入包含：

- `pptx-from-layouts-skill`：Markdown outline + template actual layouts + PPTX skill。
- `pdf2ppt`：PDF -> editable PowerPoint converter。

即使 `pdf2ppt` 的 `evidence_quality_score` 更高，`pptx-from-layouts-skill` 的 `project_fit_score` 也必须更高。

TDD 红线：

- 主线 PPTX skill 的 `project_fit_score >= 88`。
- PDF 转 PPT 旁路工具的 `project_fit_score <= 78`。
- 主线候选必须包含 `MAINLINE_MARKDOWN_TO_PPTX`、`TEMPLATE_LAYOUT_REUSE`、`CODEX_SKILL_COMPATIBLE` 等正向原因码。
- 旁路候选必须包含 `SIDE_PATH_PDF_CONVERSION` 风险码。

## 4. Top5 Recall 合同

Agent07 的 Scout Stream 目标是 Top 5 候选，而不是“找到多少显示多少且默认可交付”。

运行态候选少于 5 时，系统必须返回并展示：

```json
{
  "status": "PARTIAL_RECALL",
  "displayed_count": 2,
  "target_count": 5,
  "blocks_final_approval": true
}
```

含义：

- `PARTIAL_RECALL`：当前结果可审阅，但不能视为完整 Top5。
- `blocks_final_approval: true`：用户可以查看证据，但系统必须提示“继续 scouting 后再做最终批准/流放判断”。
- Web 页面必须在 Scout Stream 或 Artifacts Theater 附近显示 `PARTIAL_RECALL · 2/5`，避免用户把 2 个结果误认为全量结果。

当 `displayed_count >= target_count` 时，状态切换为：

```json
{
  "status": "READY_FOR_REVIEW",
  "displayed_count": 5,
  "target_count": 5,
  "blocks_final_approval": false
}
```

## 5. Web 展示合同

Artifacts Theater 不再只展示通用 evidence score。选中候选后，决策区必须至少呈现：

- `Project Fit Score`：是否贴合 Agent07 主目标。
- `Evidence Quality Score`：真实证据质量。
- `Fit Reasons`：主线原因码，例如 `[MAINLINE_MARKDOWN_TO_PPTX]`。
- `Fit Risks`：旁路或集成风险，例如 `[SIDE_PATH_PDF_CONVERSION]`。
- `Recall Status`：当少于 Top5 时显示 `PARTIAL_RECALL · 2/5`。

在 Green 之前，TDD 先要求服务端状态接口暴露 recall 合同，并要求页面 HTML 可以渲染该状态。业务代码暂时不实现，因此测试必须报红。

## 6. TDD Matrix

| 测试文件 | 断言 | 当前预期 |
| --- | --- | --- |
| `Git-Scout/tests/sentinel/projectFitScorer.test.ts` | 主线 PPTX skill 必须凭 project fit 排在 pdf2ppt 前面 | Red |
| `Git-Scout/tests/sentinel/projectFitScorer.test.ts` | 2/5 返回 `PARTIAL_RECALL` 且阻断最终批准 | Red |
| `Git-Scout/tests/sentinel/projectFitScorer.test.ts` | 5/5 返回 `READY_FOR_REVIEW` | Red |
| `web/tests/agent07-service.test.mjs` | `/api/agent07/status` 暴露 recall 合同 | Red |
| `web/tests/agent07-service.test.mjs` | `/agent07` 页面显示 `PARTIAL_RECALL` 与 `2/5` | Red |

## 7. Git Guard

本阶段横跨根仓库与 Web QA worktree，必须继续执行 selective staging：

1. 根仓库已有大量非 Agent07 脏改动与 staged 项，提交 Git-Scout 文档/测试时必须使用显式 pathspec，不能提交全局 index。
2. Web QA worktree独立干净，只允许 stage `tests/agent07-service.test.mjs` 等本阶段测试文件。
3. 本阶段禁止改动 `src/`、`app/`、`server.mjs` 业务实现文件。
4. 提交前必须运行目标红灯测试，并在提交说明中标记这是 TDD Red 合同，不声明功能已完成。
