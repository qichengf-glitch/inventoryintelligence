export type ScopedCopilot = "forecast" | "alerts";

export type ScopeGuardResult = {
  allowed: boolean;
  redirectTo: "/home";
  message: string;
};

const ALERT_ALLOWED_KEYWORDS = [
  "alert",
  "alerts",
  "库存预警",
  "预警",
  "oos",
  "out of stock",
  "缺货",
  "low stock",
  "低库存",
  "high stock",
  "高库存",
  "threshold",
  "thresholds",
  "阈值",
  "safety stock",
  "安全库存",
  "on hand",
  "库存",
  "sku",
  "补货",
  "replenish",
];

const OUT_OF_SCOPE_KEYWORDS = [
  "forecast",
  "预测",
  "demand",
  "销量趋势",
  "upload",
  "上传",
  "dataset",
  "数据集",
  "auth",
  "登录",
  "注册",
  "password",
  "middleware",
  "profile",
  "个人中心",
  "settings",
  "设置",
  "deployment",
  "部署",
  "vercel",
  "api key",
  "openai key",
  "system design",
];

function containsAny(text: string, words: string[]) {
  return words.some((w) => text.includes(w));
}

function normalize(input: string) {
  return input.toLowerCase().trim();
}

function outOfScopeMessage(scope: ScopedCopilot) {
  const scopeName = scope === "alerts" ? "Alerts" : "Forecast";
  return `当前问题超出 ${scopeName} 页面范围。我只能回答本页相关问题。请回到主页面（Dashboard/首页）或对应模块继续询问。可点击：/home`;
}

export function scopeGuard(scope: ScopedCopilot, userMessage: string): ScopeGuardResult {
  const normalized = normalize(userMessage);
  const redirectTo = "/home" as const;

  if (!normalized) {
    return { allowed: true, redirectTo, message: "" };
  }

  if (scope === "alerts") {
    if (containsAny(normalized, OUT_OF_SCOPE_KEYWORDS)) {
      return { allowed: false, redirectTo, message: outOfScopeMessage(scope) };
    }
    if (!containsAny(normalized, ALERT_ALLOWED_KEYWORDS)) {
      return { allowed: false, redirectTo, message: outOfScopeMessage(scope) };
    }
    return { allowed: true, redirectTo, message: "" };
  }

  if (containsAny(normalized, ["auth", "登录", "注册", "middleware", "profile", "设置"])) {
    return { allowed: false, redirectTo, message: outOfScopeMessage(scope) };
  }
  return { allowed: true, redirectTo, message: "" };
}
