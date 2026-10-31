"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const { extract } = require("./helpers");

const toolSource = [
  `function codexPlusUsageText() {
    return {
      labels: {
        toolKinds: {
          memory: "记忆库",
          skills: "Skills",
          mcp: "MCP",
          hook: "Hook",
          command: "命令执行",
          file: "文件修改",
          imageView: "图像查看",
          imageGeneration: "图像生成",
          webSearch: "网页搜索",
          agent: "智能体",
          dynamic: "工具调用",
          review: "代码审查",
          sleep: "等待",
          contextCompaction: "上下文压缩",
          other: "其他工具",
        },
      },
    };
  }`,
  extract("codexPlusUsageItemType"),
  extract("codexPlusUsageFirstString"),
  extract("codexPlusUsageBaseName"),
  extract("codexPlusUsageSkillNamesFromText"),
  extract("codexPlusUsageCommandText"),
  extract("codexPlusUsageSkillNamesFromCommand"),
  extract("codexPlusUsageSkillNames"),
  extract("codexPlusUsageSkillKind"),
  extract("codexPlusUsageToolKind"),
  extract("codexPlusUsageToolLabel"),
  extract("codexPlusUsageAttributedToolKind"),
].join("\n");

const toolApi = new Function(
  toolSource + "\nreturn { codexPlusUsageAttributedToolKind };",
)();

test("读取 SKILL.md 后显示 Skill 名，后续工具归入同一 Skill", () => {
  const turn = { activeSkills: [] };
  const skillCommand = toolApi.codexPlusUsageAttributedToolKind(turn, {
    type: "CommandExecution",
    command: [
      "pwsh.exe",
      "-Command",
      "Get-Content -LiteralPath 'C:\\Users\\me\\.agents\\skills\\xunwen-openspec\\SKILL.md' -Raw",
    ],
  });

  assert.equal(skillCommand.key, "skills");
  assert.equal(skillCommand.label, "Skills · xunwen-openspec");
  assert.deepEqual(turn.activeSkills, ["xunwen-openspec"]);

  const fileChange = toolApi.codexPlusUsageAttributedToolKind(turn, {
    type: "FileChange",
    changes: { "C:\\private\\tmp-cdp.mjs": { type: "update" } },
  });
  assert.equal(fileChange.key, "skills");
  assert.equal(fileChange.label, "Skills · xunwen-openspec");
  assert.equal(fileChange.visible, undefined);
});

test("命令、文件、图像查看、智能体和动态调用统一归入其他工具", () => {
  const turn = { activeSkills: [] };
  const items = [
    {
      type: "CommandExecution",
      command: ["pwsh.exe", "-Command", "Get-Content C:\\private\\secret.txt"],
    },
    {
      type: "FileChange",
      changes: { "C:\\private\\secret.txt": { type: "update" } },
    },
    { type: "ImageView", path: "C:\\private\\secret.png" },
    { type: "CollabAgentToolCall", prompt: "private agent prompt" },
    { type: "DynamicToolCall", namespace: "browser", tool: "open_page" },
  ];

  for (const item of items) {
    const kind = toolApi.codexPlusUsageAttributedToolKind(turn, item);
    assert.equal(kind.key, "other");
    assert.equal(kind.label, "其他工具");
    assert.equal(kind.visible, undefined);
    assert.ok(!kind.label.includes("secret"));
    assert.ok(!kind.label.includes("open_page"));
  }

  const imageGeneration = toolApi.codexPlusUsageAttributedToolKind(turn, {
    type: "ImageGeneration",
    revisedPrompt: "private prompt",
  });
  assert.equal(imageGeneration.key, "imageGeneration");
  assert.equal(imageGeneration.label, "图像生成");
});

test("MCP 显示服务器名，记忆库保留独立分类", () => {
  const turn = { activeSkills: ["xunwen-openspec"] };
  const mcp = toolApi.codexPlusUsageAttributedToolKind(turn, {
    type: "McpToolCall",
    server: "browser",
    tool: "open_page",
  });
  assert.equal(mcp.key, "mcp");
  assert.equal(mcp.label, "MCP · browser");
  assert.ok(!mcp.label.includes("open_page"));

  const memory = toolApi.codexPlusUsageAttributedToolKind(turn, {
    type: "McpToolCall",
    server: "hindsight",
    tool: "hindsight_search_knowledge_pages",
  });
  assert.equal(memory.key, "memory");
  assert.equal(memory.label, "记忆库 · hindsight");
  assert.ok(!memory.label.includes("hindsight_search_knowledge_pages"));
});

test("进行中的工具沿用 key 分类并与已结束项合并", () => {
  const snapshotApi = new Function([
    "const codexPlusUsageMaxLiveSamples = 512;",
    "const codexPlusUsageState = { liveContextByThread: new Map() };",
    "function codexPlusUsageToolLabel(key) { return key === 'skills' ? 'Skills' : key; }",
    "function codexPlusUsageClamp(value, minimum, maximum) { return Math.min(maximum, Math.max(minimum, value)); }",
    extract("codexPlusUsageMergedDuration"),
    "function codexPlusUsageContextSnapshot() { return { percent: null, window: null }; }",
    "function codexPlusUsageModelWindowSpeed() { return null; }",
    "function codexPlusUsageAverageSpeed() { return null; }",
    extract("codexPlusUsageTurnSnapshot"),
    "return codexPlusUsageTurnSnapshot;",
  ].join("\n"))();
  const turn = {
    threadId: "thread",
    startedAt: 0,
    completedAt: 1000,
    decodeMs: 0,
    decodeStartedAt: null,
    firstTokenAt: 0,
    outputTokens: 0,
    toolIntervals: [[0, 400]],
    settledCalls: [],
    callSamples: [],
    usageSamples: 0,
    lastCallTokens: null,
    toolDetails: [{
      id: "done",
      categoryKey: "skills",
      fallback: "Skills",
      label: "Skills · ponytail",
      startedAt: 0,
      endedAt: 400,
    }],
    activeTools: new Map([[
      "active",
      {
        key: "skills",
        fallback: "Skills",
        label: "Skills · ponytail",
        startedAt: 400,
      },
    ]]),
  };

  const details = snapshotApi(turn, 1000).toolDetails;
  assert.equal(details.length, 1);
  assert.equal(details[0].categoryKey, "skills");
  assert.equal(details[0].count, 2);
});
