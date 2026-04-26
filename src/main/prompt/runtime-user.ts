export function buildPlanningUserPrompt(args: {
  topic: string;
  totalPages: number;
  userMessage: string;
}): string {
  const hasExplicitPageHint = /第\s*\d+\s*页|(?:page|slide)\s*\d+/i.test(args.userMessage);
  return [
    `主题：${args.topic}`,
    `目标页数：${args.totalPages}`,
    `你必须严格返回 ${args.totalPages} 页，不多不少。`,
    hasExplicitPageHint ? "用户已给出页面线索，请优先沿用其分页意图。" : "",
    "",
    "请规划每页标题与关键点（短句，不写长段）。",
    "输出必须是 JSON 数组，且每项严格为 { title, keyPoints }；keyPoints 为 2-4 条字符串。",
    `数组长度必须恰好为 ${args.totalPages}。`,
    "用户需求：",
    args.userMessage,
  ].join("\n");
}

export function buildDesignContractUserPrompt(): string {
  return [
    "请只根据系统提示词里的风格规范生成整套演示的统一视觉契约。",
    "不要参考主题、页面大纲或用户需求；设计契约只负责统一视觉，不负责内容规划。",
    "注意：theme 字段必须描述视觉气质（例如 calm academic editorial / organic biophilic report），不要写成演示主题或页面标题。",
  ].join("\n");
}

export function buildEditUserPrompt(args: {
  userMessage: string;
  editScope?: "main" | "page";
  selectedPageId?: string;
  selectedPageNumber?: number;
  selectedSelector?: string;
  elementTag?: string;
  elementText?: string;
  existingPageIds?: string[];
}): string {
  const isMainScope = args.editScope === "main";
  const selector = args.selectedSelector?.trim();

  if (isMainScope) {
    return [
      "请根据以下修改指令，仅修改 index.html 总览壳（主会话）：",
      "",
      args.userMessage,
      "",
      "编辑范围：主会话（main）",
      "目标文件：index.html",
      "禁止修改任何 page-x.html 页面文件",
      "只允许通过 set_index_transition(type, durationMs) 设置页面切换动画",
      "可选 type：fade 或 none；durationMs 范围 120-1200",
      args.existingPageIds?.length ? `已有页面：${args.existingPageIds.join(", ")}` : "",
    ].join("\n");
  }

  const elementDesc =
    args.elementTag
      ? `目标元素：<${args.elementTag}>${args.elementText ? `「${args.elementText}」` : ""}`
      : "";

  return [
    "请根据以下修改指令，只修改指定的页面内容，不要改动其他页面：",
    "",
    args.userMessage,
    "",
    args.selectedPageId ? `目标页面：${args.selectedPageId}（第 ${args.selectedPageNumber ?? "?"} 页）` : "目标页面：所有页面",
    selector ? `目标元素 CSS 选择器：${selector}` : "",
    elementDesc ? `目标元素描述：${elementDesc}` : "",
    selector || elementDesc
      ? "定位与修改协议（必须遵守）："
      : "",
    selector || elementDesc
      ? "- 先用 read_file 读取目标页面 HTML 源码"
      : "",
    selector
      ? `- 在源码中用 grep 搜索选择器关键部分（类名、属性等）：${selector}`
      : "",
    elementDesc
      ? `- 在源码中用 grep 搜索元素文本内容：${elementDesc}`
      : "",
    selector || elementDesc
      ? "- 结合选择器和元素文本在源码中确认目标节点的确切位置"
      : "",
    selector || elementDesc
      ? "- 使用 edit_file(old_string, new_string) 直接修改目标节点的 HTML 字符串"
      : "",
    selector || elementDesc
      ? "- old_string 必须足够大以保证在文件中唯一，new_string 仅包含你修改的部分"
      : "",
    selector || elementDesc
      ? "- 仅修改目标节点的文本、类名或局部样式；禁止改动周围结构"
      : "",
    selector || elementDesc
      ? "- 禁止整页重写、禁止无关区域样式漂移、禁止批量全局替换"
      : "",
    args.existingPageIds?.length ? `已有页面：${args.existingPageIds.join(", ")}` : "",
  ].join("\n");
}
