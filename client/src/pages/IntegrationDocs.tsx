import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { api, type AppKeyAvailableModel } from "../api";
import { pickText } from "../i18n/inline";
import { copyText } from "../utils/clipboard";

type SdkTabId =
  | "openai-python"
  | "openai-node"
  | "anthropic-python"
  | "java-http"
  | "python-requests"
  | "node-fetch"
  | "anthropic-curl"
  | "curl";

type SupportStatus = "available" | "limited" | "planned";

function SpecItem({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="integration-spec-item">
      <span className="integration-spec-label">{label}</span>
      <span className="integration-spec-value">{value}</span>
    </div>
  );
}

function CapabilityCard({
  title,
  value,
  note,
}: {
  title: string;
  value: string;
  note: string;
}) {
  return (
    <article className="integration-capability-card">
      <span className="integration-capability-title">{title}</span>
      <strong className="integration-capability-value">{value}</strong>
      <p>{note}</p>
    </article>
  );
}

function EndpointCard({
  title,
  badge,
  endpoint,
  note,
  copyLabel,
  copiedLabel,
  isCopied,
  onCopy,
}: {
  title: string;
  badge: string;
  endpoint: string;
  note: string;
  copyLabel: string;
  copiedLabel: string;
  isCopied: boolean;
  onCopy: () => void;
}) {
  return (
    <article className="integration-endpoint-card">
      <div className="integration-endpoint-head">
        <strong>{title}</strong>
        <span className="integration-chip">{badge}</span>
      </div>
      <code className="integration-endpoint-code">{endpoint}</code>
      <button type="button" className="btn btn-ghost integration-endpoint-copy" onClick={onCopy}>
        {isCopied ? copiedLabel : copyLabel}
      </button>
      <p>{note}</p>
    </article>
  );
}

function SupportBadge({
  status,
  label,
}: {
  status: SupportStatus;
  label: string;
}) {
  return (
    <span className={`integration-support-badge integration-support-badge--${status}`}>
      {label}
    </span>
  );
}

function SupportRow({
  feature,
  status,
  statusLabel,
  detail,
}: {
  feature: string;
  status: SupportStatus;
  statusLabel: string;
  detail: string;
}) {
  return (
    <div className="integration-support-row">
      <div>
        <strong className="integration-support-feature">{feature}</strong>
        <p className="integration-support-detail">{detail}</p>
      </div>
      <SupportBadge status={status} label={statusLabel} />
    </div>
  );
}

function ErrorCodeRow({
  code,
  title,
  meaning,
  action,
}: {
  code: string;
  title: string;
  meaning: string;
  action: string;
}) {
  return (
    <div className="integration-error-row">
      <div className="integration-error-main">
        <div className="integration-error-head">
          <code>{code}</code>
          <strong>{title}</strong>
        </div>
        <p>{meaning}</p>
      </div>
      <div className="integration-error-action">{action}</div>
    </div>
  );
}

function FaqItem({
  question,
  answer,
}: {
  question: string;
  answer: string;
}) {
  return (
    <details className="integration-faq-item">
      <summary>{question}</summary>
      <p>{answer}</p>
    </details>
  );
}

function ChangelogItem({
  version,
  date,
  summary,
  items,
}: {
  version: string;
  date: string;
  summary: string;
  items: string[];
}) {
  return (
    <article className="integration-changelog-item">
      <div className="integration-changelog-meta">
        <span className="integration-chip">{version}</span>
        <span className="integration-changelog-date">{date}</span>
      </div>
      <strong className="integration-changelog-title">{summary}</strong>
      <ul className="integration-bullet-list integration-bullet-list--tight">
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </article>
  );
}

export function IntegrationDocs() {
  const { i18n } = useTranslation();
  const language = i18n.resolvedLanguage;
  const text = (zhCN: string, enUS: string) => pickText(language, zhCN, enUS);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<SdkTabId>("openai-python");

  const modelsQuery = useQuery({
    queryKey: ["app-keys", "available-models"],
    queryFn: () => api<AppKeyAvailableModel[]>("/app-keys/available-models"),
  });

  const modelList = modelsQuery.data ?? [];
  const exampleModel = modelList[0]?.model ?? "gpt-4o-mini";
  const openAiExampleModel =
    modelList.find((item) => !item.model.toLowerCase().includes("claude"))?.model ?? "gpt-4o-mini";
  const anthropicExampleModel =
    modelList.find((item) => item.model.toLowerCase().includes("claude"))?.model ??
    "claude-3-5-sonnet";
  const publicGatewayOrigin = "https://www.itoken.group";
  const sdkBaseUrl = publicGatewayOrigin;
  const chatEndpoint = `${publicGatewayOrigin}/gateway/v1/chat/completions`;
  const messagesEndpoint = `${publicGatewayOrigin}/gateway/v1/messages`;
  const futureApiFamily = `${publicGatewayOrigin}/gateway/v1/{images|video|audio|...}`;
  const systemPrompt = text(
    "你是一个企业 AI 助手，请简洁回答。",
    "You are an enterprise AI assistant. Answer concisely."
  );
  const userPrompt = text(
    "请返回一条接入联通测试成功消息。",
    "Return a connectivity test success message."
  );
  const idempotencyValue = "req_demo_20260421_001";

  const payloadJson = useMemo(
    () =>
      JSON.stringify(
        {
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
          temperature: 0.2,
        },
        null,
        2
      ),
    [exampleModel, systemPrompt, userPrompt]
  );

  const responseJson = useMemo(
    () =>
      JSON.stringify(
        {
          id: "chatcmpl_demo_01",
          object: "chat.completion",
          created: 1710000000,
          model: exampleModel,
          choices: [
            {
              index: 0,
              message: {
                role: "assistant",
                content: text(
                  "联通测试成功，网关调用正常。",
                  "Connectivity test succeeded. The gateway call is working normally."
                ),
              },
              finish_reason: "stop",
            },
          ],
          usage: {
            prompt_tokens: 23,
            completion_tokens: 13,
            total_tokens: 36,
          },
        },
        null,
        2
      ),
    [exampleModel, text]
  );

  const allowlistErrorJson = useMemo(
    () =>
      JSON.stringify(
        {
          error: text(
            "此 AppKey 未授权使用该 model",
            "This AppKey is not authorized for the requested model"
          ),
          allowedModels: [exampleModel],
        },
        null,
        2
      ),
    [exampleModel, text]
  );

  const rateLimitErrorJson = useMemo(
    () =>
      JSON.stringify(
        {
          error: "QPS limit exceeded",
        },
        null,
        2
      ),
    []
  );

  const snippets = useMemo<
    Record<
      SdkTabId,
      {
        label: string;
        title: string;
        summary: string;
        install: string | null;
        code: string;
      }
    >
  >(
    () => ({
      "openai-python": {
        label: "OpenAI Python",
        title: text("OpenAI Python SDK", "OpenAI Python SDK"),
        summary: text(
          "最推荐的迁移方式之一。对已经使用 OpenAI Python SDK 的项目，几乎只需要改 `base_url` 和 `api_key`。",
          "One of the most recommended migration paths. If you already use the OpenAI Python SDK, you mostly only need to change `base_url` and `api_key`."
        ),
        install: "pip install openai",
        code: `from openai import OpenAI

client = OpenAI(
    api_key="sk-your-app-key",
    base_url="${sdkBaseUrl}",
)

resp = client.chat.completions.create(
    model="${openAiExampleModel}",
    messages=[
        {"role": "system", "content": "${systemPrompt}"},
        {"role": "user", "content": "${userPrompt}"}
    ],
    temperature=0.2,
)

print(resp.model_dump_json(indent=2))`,
      },
      "openai-node": {
        label: "OpenAI Node.js",
        title: text("OpenAI Node.js SDK", "OpenAI Node.js SDK"),
        summary: text(
          "适合 Node.js 服务端或 BFF。你可以沿用现有 OpenAI 调用形态，只切换网关地址与密钥。",
          "Great for Node.js services or BFFs. Keep your existing OpenAI call shape and simply swap the gateway URL and API key."
        ),
        install: "npm install openai",
        code: `import OpenAI from "openai";

const client = new OpenAI({
  apiKey: "sk-your-app-key",
  baseURL: "${sdkBaseUrl}",
});

const completion = await client.chat.completions.create({
  model: "${openAiExampleModel}",
  messages: [
    { role: "system", content: "${systemPrompt}" },
    { role: "user", content: "${userPrompt}" },
  ],
  temperature: 0.2,
});

console.log(JSON.stringify(completion, null, 2));`,
      },
      "anthropic-python": {
        label: "Anthropic Python",
        title: text("Anthropic Python SDK", "Anthropic Python SDK"),
        summary: text(
          "如果你接入的是 Claude / Anthropic 模型，请直接使用 Messages 形态，不要再套 OpenAI 的 `chat.completions`。",
          "If you integrate Claude / Anthropic models, use the Messages shape directly instead of wrapping it in OpenAI `chat.completions`."
        ),
        install: "pip install anthropic",
        code: `from anthropic import Anthropic

client = Anthropic(
    api_key="sk-your-app-key",
    base_url="${sdkBaseUrl}",
)

resp = client.messages.create(
    model="${anthropicExampleModel}",
    system="${systemPrompt}",
    messages=[
        {"role": "user", "content": "${userPrompt}"}
    ],
    max_tokens=256,
    temperature=0.2,
)

print(resp.model_dump_json(indent=2))`,
      },
      "java-http": {
        label: "Java HttpClient",
        title: text("Java 直连示例", "Java direct HTTP example"),
        summary: text(
          "适合 Java 后端服务集成。若 AppKey 已绑定模型，可直接省略 `model`，由网关自动选择。",
          "A good fit for Java backend services. If the AppKey already binds model(s), you can omit `model` and let the gateway choose automatically."
        ),
        install: null,
        code: `import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;

HttpClient client = HttpClient.newHttpClient();
String body = """
{
  "messages": [
    { "role": "system", "content": "${systemPrompt}" },
    { "role": "user", "content": "${userPrompt}" }
  ],
  "temperature": 0.2
}
""";

HttpRequest request = HttpRequest.newBuilder()
    .uri(URI.create("${chatEndpoint}"))
    .header("Content-Type", "application/json")
    .header("Authorization", "Bearer sk-your-app-key")
    .header("Idempotency-Key", "${idempotencyValue}")
    .POST(HttpRequest.BodyPublishers.ofString(body))
    .build();

HttpResponse<String> response = client.send(request, HttpResponse.BodyHandlers.ofString());
System.out.println(response.body());`,
      },
      "python-requests": {
        label: "Python requests",
        title: text("Python requests 直连网关", "Python requests direct call"),
        summary: text(
          "当你不想额外引入 SDK 时，可以直接通过标准 HTTP 请求接入；若 AppKey 已绑定模型，可省略 `model`。",
          "Use plain HTTP when you do not want to add an SDK dependency; if the AppKey already binds model(s), you can omit `model`."
        ),
        install: "pip install requests",
        code: `import requests

url = "${chatEndpoint}"
headers = {
    "Content-Type": "application/json",
    "Authorization": "Bearer sk-your-app-key",
    "Accept-Language": "${language ?? "zh-CN"}",
    "Idempotency-Key": "${idempotencyValue}",
}
payload = {
    "messages": [
        {"role": "system", "content": "${systemPrompt}"},
        {"role": "user", "content": "${userPrompt}"}
    ],
    "temperature": 0.2
}

response = requests.post(url, headers=headers, json=payload, timeout=60)
response.raise_for_status()
print(response.json())`,
      },
      "node-fetch": {
        label: "Node fetch",
        title: text("Node.js fetch 直连网关", "Node.js fetch direct call"),
        summary: text(
          "适合网关、BFF 或任何后端服务；若 AppKey 已绑定模型，可省略 `model`，调试路径也最直接。",
          "A minimal option for gateways, BFFs, or any backend service; if the AppKey already binds model(s), you can omit `model` and keep the debugging path simple."
        ),
        install: null,
        code: `const response = await fetch("${chatEndpoint}", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "Authorization": "Bearer sk-your-app-key",
    "Accept-Language": "${language ?? "zh-CN"}",
    "Idempotency-Key": "${idempotencyValue}",
  },
  body: JSON.stringify({
    messages: [
      { role: "system", content: "${systemPrompt}" },
      { role: "user", content: "${userPrompt}" },
    ],
    temperature: 0.2,
  }),
});

if (!response.ok) {
  throw new Error(await response.text());
}

console.log(await response.json());`,
      },
      "anthropic-curl": {
        label: "Claude cURL",
        title: text("Claude Messages 快速联调", "Claude Messages quick smoke test"),
        summary: text(
          "如果你要按 Claude 原生格式联调，请直接调用 `/v1/messages`，并使用 `x-api-key` 与 `anthropic-version` 请求头。",
          "To test Claude in its native shape, call `/v1/messages` directly and use `x-api-key` plus the `anthropic-version` header."
        ),
        install: null,
        code: `curl "${messagesEndpoint}" \\
  -X POST \\
  -H "Content-Type: application/json" \\
  -H "x-api-key: sk-your-app-key" \\
  -H "anthropic-version: 2023-06-01" \\
  -H "Accept-Language: ${language ?? "zh-CN"}" \\
  -H "Idempotency-Key: ${idempotencyValue}" \\
  -d '{
  "model": "${anthropicExampleModel}",
  "system": "${systemPrompt.replace(/"/g, '\\"')}",
  "messages": [
    {
      "role": "user",
      "content": "${userPrompt.replace(/"/g, '\\"')}"
    }
  ],
  "max_tokens": 256,
  "temperature": 0.2
}'`,
      },
      curl: {
        label: "cURL",
        title: text("cURL 快速联调", "cURL quick smoke test"),
        summary: text(
          "最适合做上线前联调；如果 AppKey 已绑定模型，甚至可以不传 `model` 直接验证自动选模。",
          "Best for pre-launch smoke tests; if the AppKey already binds model(s), you can even omit `model` and validate auto-selection directly."
        ),
        install: null,
        code: `curl "${chatEndpoint}" \\
  -X POST \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer sk-your-app-key" \\
  -H "Accept-Language: ${language ?? "zh-CN"}" \\
  -H "Idempotency-Key: ${idempotencyValue}" \\
  -d '${payloadJson.replace(/'/g, "\\'")}'`,
      },
    }),
    [
      chatEndpoint,
      anthropicExampleModel,
      exampleModel,
      idempotencyValue,
      language,
      messagesEndpoint,
      openAiExampleModel,
      sdkBaseUrl,
      payloadJson,
      systemPrompt,
      text,
      userPrompt,
    ]
  );

  const activeSnippet = snippets[activeTab];

  const sectionLinks = [
    { id: "overview", label: text("概览", "Overview") },
    { id: "endpoints", label: text("地址体系", "Endpoints") },
    { id: "capabilities", label: text("能力边界", "Capabilities") },
    { id: "quickstart", label: text("快速开始", "Quickstart") },
    { id: "sdk-center", label: text("SDK 示例", "SDK Examples") },
    { id: "payload", label: text("请求与返回", "Payload & Response") },
    { id: "errors", label: text("错误与排查", "Errors") },
    { id: "rate-limit", label: text("限流策略", "Rate Limits") },
    { id: "faq", label: text("FAQ", "FAQ") },
    { id: "changelog", label: text("更新记录", "Changelog") },
    { id: "go-live", label: text("上线建议", "Go Live") },
  ];

  const errorCodeRows = [
    {
      code: "401",
      title: text("未授权", "Unauthorized"),
      meaning: text(
        "未传 Bearer AppKey、AppKey 无效，或密钥已撤销。",
        "The Bearer AppKey is missing, invalid, or revoked."
      ),
      action: text(
        "确认 `Authorization: Bearer <AppKey>` 是否完整，且当前密钥状态为启用。",
        "Verify `Authorization: Bearer <AppKey>` is complete and that the key is active."
      ),
    },
    {
      code: "402",
      title: text("预算受限", "Budget exceeded"),
      meaning: text(
        "命中 AppKey 日预算、月预算，或租户月预算上限。",
        "The request hit the AppKey daily budget, monthly budget, or tenant monthly budget."
      ),
      action: text(
        "检查预算策略、充值状态，以及是否需要切换到独立预算的生产密钥。",
        "Review budget rules, top-up status, and whether you should switch to a separate production key."
      ),
    },
    {
      code: "403",
      title: text("权限不足", "Forbidden"),
      meaning: text(
        "通常是缺少 `chat:complete` scope，或请求模型不在 AppKey 白名单中。",
        "Usually means the `chat:complete` scope is missing or the requested model is not in the AppKey allowlist."
      ),
      action: text(
        "检查密钥权限域与模型白名单，必要时重新创建更适合该业务线的 AppKey。",
        "Check key scopes and the model allowlist, and create a more appropriate AppKey if needed."
      ),
    },
    {
      code: "429",
      title: text("请求过快", "Too many requests"),
      meaning: text(
        "当前 AppKey 命中了 QPS 限制，响应头会返回 `Retry-After: 1`。",
        "The current AppKey hit its QPS limit and the response returns `Retry-After: 1`."
      ),
      action: text(
        "按 `Retry-After` 做退避重试，避免无脑并发放大抖动。",
        "Back off according to `Retry-After` instead of retrying with uncontrolled parallelism."
      ),
    },
    {
      code: "5xx",
      title: text("网关或上游异常", "Gateway or upstream error"),
      meaning: text(
        "通常与供应商 URL / API Key、上游模型状态，或当前平台网关健康度有关。",
        "Usually related to provider URL / API key, upstream model status, or current gateway health."
      ),
      action: text(
        "先验证可用模型与供应商配置，再决定是否切换重试策略或降级路径。",
        "Validate available models and provider configuration first, then decide whether to retry or degrade."
      ),
    },
  ];

  const faqItems = [
    {
      question: text(
        "为什么我已经有控制台登录态，还需要 AppKey？",
        "Why do I still need an AppKey if I already have a console login?"
      ),
      answer: text(
        "因为当前控制台 JWT 和网关调用是两套认证边界。JWT 用于控制台管理接口；AppKey 用于 SDK Base URL `https://www.itoken.group`，以及 OpenAI 的 `.../gateway/v1/chat/completions` / Claude 的 `.../gateway/v1/messages` 网关接口。",
        "Because console JWT and gateway calls are separate auth boundaries. JWT is for console management APIs, while AppKeys are used for the SDK Base URL `https://www.itoken.group` plus the OpenAI `.../gateway/v1/chat/completions` and Claude `.../gateway/v1/messages` gateway endpoints."
      ),
    },
    {
      question: text(
        "前端页面能不能直接使用 AppKey？",
        "Can I use the AppKey directly from a frontend page?"
      ),
      answer: text(
        "不建议。生产环境应通过你自己的服务端中转，以避免密钥暴露、预算失控和来源不可控。",
        "Not recommended. In production, proxy requests through your own backend to avoid key exposure, budget abuse, and uncontrolled origins."
      ),
    },
    {
      question: text(
        "为什么同一个请求要传 `Idempotency-Key`？",
        "Why should I send an `Idempotency-Key` for the same request?"
      ),
      answer: text(
        "当网络抖动或客户端超时重试时，幂等键可以帮助你避免重复计费、重复落库或重复触发业务动作。",
        "When network jitter or client timeouts trigger retries, idempotency keys help avoid double charging, duplicate writes, or repeated business actions."
      ),
    },
    {
      question: text(
        "为什么请求的 model 明明存在，却还是报错？",
        "Why does the request still fail even though the model exists?"
      ),
      answer: text(
        "模型存在不等于该 AppKey 有权限使用。请同时检查当前密钥的模型白名单、供应商配置是否完成，以及该模型是否处于可用状态。",
        "A model existing does not mean your AppKey is allowed to use it. Check the AppKey allowlist, provider configuration, and whether the model is actually available."
      ),
    },
    {
      question: text(
        "终端用户到底该用哪个地址？",
        "Which endpoint should end users actually use?"
      ),
      answer: text(
        "如果你接的是 OpenAI SDK 或 Anthropic SDK，就统一把 Base URL 配成 `https://www.itoken.group`。如果你自己发 HTTP 请求，OpenAI 模型调用 `https://www.itoken.group/gateway/v1/chat/completions`，Claude 模型调用 `https://www.itoken.group/gateway/v1/messages`。后续 Images、Video 等能力会继续放在 `https://www.itoken.group/gateway/v1/...` 下面。",
        "If you use the OpenAI or Anthropic SDK, point the Base URL to `https://www.itoken.group`. If you send HTTP yourself, OpenAI models should call `https://www.itoken.group/gateway/v1/chat/completions`, while Claude models should call `https://www.itoken.group/gateway/v1/messages`. Future Images, Video, and similar APIs will continue under `https://www.itoken.group/gateway/v1/...`."
      ),
    },
    {
      question: text(
        "我能不能完全不传 model，只靠 AppKey 调用？",
        "Can I omit model entirely and rely only on the AppKey?"
      ),
      answer: text(
        "可以。如果 AppKey 只绑定了一个模型，网关会自动使用该模型；如果 AppKey 绑定了多个允许模型，网关会在当前可用模型中随机选择。如果 AppKey 没有限定模型范围，仍建议显式传 model。",
        "Yes. If the AppKey binds a single model, the gateway uses it automatically. If the AppKey binds multiple allowed models, the gateway randomly chooses from currently available ones. If the AppKey does not restrict models, you should still send model explicitly."
      ),
    },
    {
      question: text(
        "`system` 和 `user` 有什么区别？",
        "What is the difference between `system` and `user`?"
      ),
      answer: text(
        "`system` 用来定义模型角色、回答风格和约束规则，例如“你是一个企业 AI 助手，请简洁回答”。`user` 用来承载用户真正的问题或任务，例如“请总结这段文本”。不要把提问内容写进 `system`，否则上游模型可能把它当成规则而不是待回答的问题。",
        "`system` defines the model role, response style, and constraints, for example 'You are an enterprise AI assistant. Answer concisely.' `user` carries the actual question or task, for example 'Summarize this text.' Do not put the real question into `system`, or upstream models may treat it as an instruction rather than something to answer."
      ),
    },
  ];

  const changelogItems = [
    {
      version: "v1.4",
      date: "2026-04-20",
      summary: text("重构文档中的地址体系展示", "Redesigned endpoint architecture guidance"),
      items: [
        text("明确区分 SDK Base URL、OpenAI `chat/completions` 直连接口、Claude `messages` 直连接口，以及未来多模态 API 家族。", "Clearly separated the SDK Base URL, the direct OpenAI `chat/completions` endpoint, the direct Claude `messages` endpoint, and the future multimodal API family."),
        text("新增 Claude 协议说明与地址卡片，避免把 Anthropic 的 Messages 误写成 OpenAI 格式。", "Added Claude protocol guidance and endpoint cards so Anthropic Messages are no longer documented as an OpenAI format."),
        text("示例同时覆盖 OpenAI SDK、Anthropic SDK 与两类原生 HTTP 接入。", "Examples now cover OpenAI SDK, Anthropic SDK, and both raw HTTP styles."),
      ],
    },
    {
      version: "v1.3",
      date: "2026-04-21",
      summary: text("支持按 AppKey 自动选模型", "Added AppKey-driven model auto-selection"),
      items: [
        text("当请求未传 model 且 AppKey 只绑定一个模型时，自动使用该模型。", "When model is omitted and the AppKey binds a single model, the gateway now uses it automatically."),
        text("当请求未传 model 且 AppKey 绑定多个模型时，会在当前可用模型中随机选择。", "When model is omitted and the AppKey binds multiple models, the gateway now randomly chooses from currently available ones."),
        text("更新了控制台 Playground 和 SDK 文档说明。", "Updated the console playground and SDK docs to reflect the new behavior."),
      ],
    },
    {
      version: "v1.2",
      date: "2026-04-21",
      summary: text("文档中心升级为正式 SDK 门户", "SDK docs upgraded into a formal portal"),
      items: [
        text("新增错误码表、限流策略、FAQ 与版本更新记录。", "Added error code table, rate limit policy, FAQ, and changelog."),
        text("新增 Java HttpClient 示例，并补充安装命令与顶部入口。", "Added a Java HttpClient example plus install commands and a top-level entrypoint."),
        text("明确当前正式支持为非流式对话接口，按协议分为 Chat Completions 与 Claude Messages。", "Clarified that the current GA capability is non-streaming chat, split between Chat Completions and Claude Messages by protocol."),
      ],
    },
    {
      version: "v1.1",
      date: "2026-04-21",
      summary: text("文档中心扩展为多技术栈示例", "Docs expanded into a multi-stack center"),
      items: [
        text("增加 OpenAI Python、OpenAI Node.js、requests、fetch、cURL 示例。", "Added OpenAI Python, OpenAI Node.js, requests, fetch, and cURL examples."),
        text("补充能力边界、认证边界、错误示例与上线建议。", "Added capability boundaries, auth boundaries, error examples, and go-live guidance."),
      ],
    },
    {
      version: "v1.0",
      date: "2026-04-21",
      summary: text("首次上线租户接入文档", "Initial tenant integration docs released"),
      items: [
        text("提供 API Keys 流程内跳转入口。", "Provided entrypoints from the API Keys flow."),
        text("给出最短路径接入说明与基础代码示例。", "Delivered quickstart integration guidance and base code samples."),
      ],
    },
  ];

  async function handleCopy(id: string, value: string) {
    const copied = await copyText(value);
    setCopiedId(copied ? id : null);
    if (copied) {
      window.setTimeout(() => {
        setCopiedId((current) => (current === id ? null : current));
      }, 1500);
    }
  }

  return (
    <div className="integration-page">
      <section id="overview" className="integration-hero">
        <div className="integration-hero-copy">
          <span className="integration-kicker">{text("SDK Docs Center", "SDK Docs Center")}</span>
          <h1>{text("SDK 文档中心", "SDK Docs Center")}</h1>
          <p>
            {text(
              "这是给租户开发者的一站式正式接入中心。当前版本同时支持 OpenAI 的 `chat completions` 与 Claude 的 `messages` 两种主流接入形态，示例会按协议分别展示，不再混用。",
              "This is the official one-stop integration hub for tenant developers. The current version supports both OpenAI `chat completions` and Claude `messages`, and the examples are now separated by protocol instead of mixing them together."
            )}
          </p>
          <div className="integration-hero-actions">
            <Link to="/model-hub" className="btn btn-ghost">
              {text("先看模型广场", "Browse model hub")}
            </Link>
            <Link to="/api-keys" className="btn btn-primary">
              {text("返回 API 密钥", "Back to API Keys")}
            </Link>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => void handleCopy("endpoint", chatEndpoint)}
            >
              {copiedId === "endpoint"
                ? text("OpenAI 地址已复制", "OpenAI API copied")
                : text("复制 OpenAI API", "Copy OpenAI API")}
            </button>
          </div>
        </div>
        <div className="integration-hero-panel">
          <div className="integration-mini-card">
            <span>{text("SDK Base URL", "SDK Base URL")}</span>
            <code>{sdkBaseUrl}</code>
          </div>
          <div className="integration-mini-card">
            <span>{text("OpenAI Chat API", "OpenAI Chat API")}</span>
            <code>{chatEndpoint}</code>
          </div>
          <div className="integration-mini-card">
            <span>{text("Claude Messages API", "Claude Messages API")}</span>
            <code>{messagesEndpoint}</code>
          </div>
          <div className="integration-mini-card">
            <span>{text("未来 API 家族", "Future API family")}</span>
            <code>{futureApiFamily}</code>
          </div>
          <div className="integration-mini-card">
            <span>{text("认证方式", "Authentication")}</span>
            <code>{text("Bearer 或 x-api-key", "Bearer or x-api-key")}</code>
          </div>
        </div>
      </section>

      <section id="endpoints" className="integration-endpoint-grid">
        <EndpointCard
          title={text("SDK Base URL", "SDK Base URL")}
          badge={text("推荐给 SDK", "For SDKs")}
          endpoint={sdkBaseUrl}
          copyLabel={text("复制 Base URL", "Copy Base URL")}
          copiedLabel={text("已复制", "Copied")}
          isCopied={copiedId === "sdk-base-url"}
          onCopy={() => void handleCopy("sdk-base-url", sdkBaseUrl)}
          note={text(
            "用于 OpenAI SDK 与 Anthropic SDK 的基础地址。当前统一填写根域名 `https://www.itoken.group`；如果你自己直接发 HTTP，请继续使用下面列出的网关完整路径。",
            "Use the root origin `https://www.itoken.group` as the base URL for both OpenAI and Anthropic SDKs. For raw HTTP requests, continue using the full gateway paths listed below."
          )}
        />
        <EndpointCard
          title={text("OpenAI Chat Completions 直连接口", "Direct OpenAI Chat Completions endpoint")}
          badge={text("OpenAI / 原生 HTTP", "OpenAI / raw HTTP")}
          endpoint={chatEndpoint}
          copyLabel={text("复制 Chat API", "Copy Chat API")}
          copiedLabel={text("已复制", "Copied")}
          isCopied={copiedId === "chat-api-url"}
          onCopy={() => void handleCopy("chat-api-url", chatEndpoint)}
          note={text(
            "用于 OpenAI 风格的原生 HTTP 调用，如 `fetch`、`requests`、`curl`、Java HttpClient 等。",
            "Use this for OpenAI-style raw HTTP calls such as `fetch`, `requests`, `curl`, or Java HttpClient."
          )}
        />
        <EndpointCard
          title={text("Claude Messages 直连接口", "Direct Claude Messages endpoint")}
          badge={text("Claude / 原生 HTTP", "Claude / raw HTTP")}
          endpoint={messagesEndpoint}
          copyLabel={text("复制 Claude API", "Copy Claude API")}
          copiedLabel={text("已复制", "Copied")}
          isCopied={copiedId === "messages-api-url"}
          onCopy={() => void handleCopy("messages-api-url", messagesEndpoint)}
          note={text(
            "用于 Claude / Anthropic 风格的原生 HTTP 调用。请求头建议使用 `x-api-key` 与 `anthropic-version`，请求体保持 Messages 结构。",
            "Use this for Claude / Anthropic-style raw HTTP calls. Prefer `x-api-key` plus `anthropic-version` headers and keep the Messages payload shape."
          )}
        />
        <EndpointCard
          title={text("未来多模态 API 地址族", "Future multimodal API family")}
          badge={text("规划中", "Planned")}
          endpoint={futureApiFamily}
          copyLabel={text("复制地址族", "Copy API family")}
          copiedLabel={text("已复制", "Copied")}
          isCopied={copiedId === "future-api-family"}
          onCopy={() => void handleCopy("future-api-family", futureApiFamily)}
          note={text(
            "后续 Images API、Video API 等会继续收敛在 `gateway/v1` 家族下统一管理，具体路径以上线公告和正式文档为准。",
            "Future Images API, Video API, and other multimodal capabilities will continue to live under the unified `gateway/v1` family. Exact paths will be announced when they are released."
          )}
        />
      </section>

      <nav
        className="integration-section-nav"
        aria-label={text("文档分区", "Documentation sections")}
      >
        {sectionLinks.map((section) => (
          <a key={section.id} href={`#${section.id}`} className="integration-section-link">
            {section.label}
          </a>
        ))}
      </nav>

      <section className="integration-capability-grid">
        <CapabilityCard
          title={text("协议兼容", "Protocol")}
          value={text("OpenAI + Claude", "OpenAI + Claude")}
          note={text(
            "同时支持 Chat Completions 与 Messages 两种主流协议，按模型类型分别接入。",
            "Supports both Chat Completions and Messages so you can integrate by model family."
          )}
        />
        <CapabilityCard
          title={text("当前可用模型", "Available models")}
          value={String(modelList.length)}
          note={text(
            "示例会优先使用当前控制台内第一条可用模型。",
            "Examples automatically prefer the first currently available model in the console."
          )}
        />
        <CapabilityCard
          title={text("当前交付形态", "Delivery mode")}
          value={text("非流式 Chat", "Non-streaming Chat")}
          note={text(
            "当前版本支持同步的 OpenAI `chat completions` 与 Claude `messages`；流式能力请以后续版本公告为准。",
            "The current version supports synchronous OpenAI `chat completions` and Claude `messages`; streaming support remains future roadmap unless announced otherwise."
          )}
        />
      </section>

      <section id="capabilities" className="integration-grid">
        <article className="integration-card integration-card--wide">
          <h2>{text("能力与边界", "Capabilities and boundaries")}</h2>
          <div className="integration-support-list">
            <SupportRow
              feature={text("地址体系已分层", "Layered endpoint design")}
              status="available"
              statusLabel={text("可用", "Available")}
              detail={text(
                "`https://www.itoken.group` 用于 SDK Base URL；OpenAI 原生 HTTP 走 `.../gateway/v1/chat/completions`，Claude 原生 HTTP 走 `.../gateway/v1/messages`。",
                "`https://www.itoken.group` is the SDK Base URL; OpenAI raw HTTP uses `.../gateway/v1/chat/completions`, while Claude raw HTTP uses `.../gateway/v1/messages`."
              )}
            />
            <SupportRow
              feature={text("OpenAI Chat Completions", "OpenAI Chat Completions")}
              status="available"
              statusLabel={text("可用", "Available")}
              detail={text(
                "OpenAI 系模型继续使用 `chat completions` 形态，适合现有 OpenAI SDK 与兼容客户端。",
                "OpenAI-family models continue to use the `chat completions` shape, ideal for existing OpenAI SDKs and compatible clients."
              )}
            />
            <SupportRow
              feature={text("Claude Messages", "Claude Messages")}
              status="available"
              statusLabel={text("可用", "Available")}
              detail={text(
                "Claude / Anthropic 模型现在支持独立的 `/v1/messages` 入口，不再共用 OpenAI 的请求格式。",
                "Claude / Anthropic models now expose a dedicated `/v1/messages` entrypoint instead of sharing the OpenAI request shape."
              )}
            />
            <SupportRow
              feature={text("幂等键与多语言 Header", "Idempotency and locale headers")}
              status="available"
              statusLabel={text("可用", "Available")}
              detail={text(
                "支持 `Idempotency-Key` 与 `Accept-Language` 请求头，便于重试控制和本地化错误提示。",
                "Supports `Idempotency-Key` and `Accept-Language` headers for retry control and localized error messages."
              )}
            />
            <SupportRow
              feature={text("模型白名单 / QPS / 预算控制", "Allowlists / QPS / budget controls")}
              status="available"
              statusLabel={text("可用", "Available")}
              detail={text(
                "如果 AppKey 配置了模型白名单、QPS 或预算限制，网关会直接在请求阶段进行约束。",
                "If your AppKey has model allowlists, QPS limits, or budget limits, the gateway enforces them at request time."
              )}
            />
            <SupportRow
              feature={text("按 AppKey 自动选模型", "Auto-select model by AppKey")}
              status="available"
              statusLabel={text("可用", "Available")}
              detail={text(
                "当请求未显式传入 model 时：若 AppKey 只绑定一个模型则自动使用该模型；若绑定多个允许模型则会在当前可用模型中随机选择。",
                "When a request omits model: if the AppKey binds a single model, the gateway uses it automatically; if the AppKey binds multiple allowed models, the gateway randomly chooses from currently available ones."
              )}
            />
            <SupportRow
              feature={text("控制台 API 的 AppKey 访问", "AppKey access to console APIs")}
              status="limited"
              statusLabel={text("不支持", "Not supported")}
              detail={text(
                "当前 AppKey 仅用于网关调用；控制台 API 仍需使用 JWT。",
                "AppKeys currently work only for gateway calls; console APIs still require JWT."
              )}
            />
            <SupportRow
              feature={text("流式 SSE / Streaming", "Streaming / SSE")}
              status="planned"
              statusLabel={text("规划中", "Planned")}
              detail={text(
                "当前正式文档请按非流式能力接入：OpenAI 走 `chat completions`，Claude 走 `messages`。",
                "For now, integrate against non-streaming capabilities only: `chat completions` for OpenAI and `messages` for Claude."
              )}
            />
          </div>
        </article>

        <article className="integration-card">
          <h2>{text("认证边界", "Auth boundary")}</h2>
          <ul className="integration-bullet-list">
            <li>
              {text(
                "OpenAI 风格请求使用 `Authorization: Bearer <AppKey>`；Claude 风格请求推荐使用 `x-api-key: <AppKey>`。",
                "Use `Authorization: Bearer <AppKey>` for OpenAI-style requests; for Claude-style requests, prefer `x-api-key: <AppKey>`."
              )}
            </li>
            <li>
              {text(
                "AppKey 至少需要包含 `chat:complete` scope。",
                "The AppKey must include the `chat:complete` scope."
              )}
            </li>
            <li>
              {text(
                "如果你访问控制台相关接口，请继续使用用户登录后的 JWT，而不是 AppKey。",
                "Use the user JWT for console-related APIs instead of AppKeys."
              )}
            </li>
          </ul>
        </article>
      </section>

      <section id="quickstart" className="integration-grid integration-grid--triple">
        <article className="integration-card">
          <h2>{text("5 分钟快速开始", "5-minute quickstart")}</h2>
          <ol className="integration-step-list">
            <li>
              <strong>{text("创建并保存 AppKey", "Create and save an AppKey")}</strong>
              <span>
                {text(
                  "在 API 密钥页创建密钥后立即保存完整值，后续列表里只保留前缀。",
                  "Save the full AppKey immediately after creation. The list view keeps only the prefix."
                )}
              </span>
            </li>
            <li>
              <strong>{text("优先走现有 SDK", "Prefer your existing SDK")}</strong>
              <span>
                {text(
                  "如果你已使用 OpenAI SDK 或 Anthropic SDK，通常只需切换 Base URL 与 AppKey；如果走原生 HTTP，请按模型协议选择 `chat/completions` 或 `messages`。",
                  "If you already use the OpenAI or Anthropic SDK, you usually only need to change the Base URL and AppKey; for raw HTTP, choose `chat/completions` or `messages` based on the model protocol."
                )}
              </span>
            </li>
            <li>
              <strong>{text("不要把两个地址混用", "Do not mix the two endpoint types")}</strong>
              <span>
                {text(
                  "`https://www.itoken.group` 是 SDK Base URL；如果你自己手写 HTTP 请求，OpenAI 模型走 `.../gateway/v1/chat/completions`，Claude 模型走 `.../gateway/v1/messages`。",
                  "`https://www.itoken.group` is the SDK Base URL; for handcrafted HTTP calls, use `.../gateway/v1/chat/completions` for OpenAI models and `.../gateway/v1/messages` for Claude models."
                )}
              </span>
            </li>
            <li>
              <strong>{text("先做烟雾测试再上线", "Smoke test before shipping")}</strong>
              <span>
                {text(
                  "建议先用 cURL 验证权限、模型、预算和 QPS，再接入业务代码。",
                  "Use cURL first to validate auth, model access, budget rules, and QPS before integrating into production code."
                )}
              </span>
            </li>
          </ol>
        </article>

        <article className="integration-card">
          <h2>{text("请求规范", "Request contract")}</h2>
          <div className="integration-spec-list">
            <SpecItem label={text("方法", "Method")} value="POST" />
            <SpecItem label={text("SDK Base URL", "SDK Base URL")} value={sdkBaseUrl} />
            <SpecItem label={text("Chat Completions API", "Chat Completions API")} value={chatEndpoint} />
            <SpecItem label={text("Claude Messages API", "Claude Messages API")} value={messagesEndpoint} />
            <SpecItem label={text("鉴权", "Auth")} value={text("Bearer AppKey 或 x-api-key", "Bearer AppKey or x-api-key")} />
            <SpecItem label={text("内容类型", "Content-Type")} value="application/json" />
            <SpecItem
              label={text("必填字段", "Required fields")}
              value={text("messages[]（建议至少包含一条 user）", "messages[] (include at least one user message)")}
            />
            <SpecItem
              label={text("model 字段", "model field")}
              value={text("可选（若 AppKey 已绑定模型）", "Optional when AppKey binds model(s)")}
            />
          </div>
          <div className="integration-role-box">
            <strong>{text("messages[].role 字段说明", "messages[].role guidance")}</strong>
            <ul className="integration-bullet-list integration-bullet-list--tight">
              <li>
                {text(
                  "`system`：定义模型角色、回答风格、格式要求和约束规则。",
                  "`system`: defines the model role, response style, output format, and guardrails."
                )}
              </li>
              <li>
                {text(
                  "`user`：用户真正的问题或任务，建议每次请求至少包含一条 `user` 消息。",
                  "`user`: the actual user question or task. Each request should generally include at least one `user` message."
                )}
              </li>
              <li>
                {text(
                  "`assistant`：模型历史回复，多轮上下文时才需要回传。",
                  "`assistant`: previous model responses, only needed when you send back multi-turn conversation history."
                )}
              </li>
              <li>
                {text(
                  "不要把“你是什么模型”这类问题写进 `system`；它应放在 `user` 里。",
                  "Do not put questions like 'What model are you?' into `system`; they belong in `user`."
                )}
              </li>
            </ul>
          </div>
        </article>

        <article className="integration-card">
          <h2>{text("环境变量参考", "Environment variables")}</h2>
          <pre className="integration-code-block">{`export TAAS_BASE_URL="${sdkBaseUrl}"
export TAAS_CHAT_URL="${chatEndpoint}"
export TAAS_MESSAGES_URL="${messagesEndpoint}"
export TAAS_APP_KEY="sk-your-app-key"
export TAAS_MODEL="${exampleModel}" # optional when AppKey binds model(s)`}</pre>
        </article>
      </section>

      <section id="sdk-center" className="integration-sdk-card">
        <div className="integration-section-head">
          <div>
            <h2>{text("SDK 示例中心", "SDK examples center")}</h2>
            <p className="muted">
              {text(
                "按你的技术栈直接复制可运行示例。OpenAI 和 Claude 现在分别提供独立协议示例，原生 HTTP 也按接口族拆开。",
                "Copy a working snippet for your stack. OpenAI and Claude now have separate protocol examples, and raw HTTP samples are split by endpoint family as well."
              )}
            </p>
          </div>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => void handleCopy(activeTab, activeSnippet.code)}
          >
            {copiedId === activeTab
              ? text("代码已复制", "Code copied")
              : text("复制当前示例", "Copy current snippet")}
          </button>
        </div>

        <div className="integration-sdk-shell">
          <div
            className="integration-sdk-tabs"
            role="tablist"
            aria-label={text("SDK 示例切换", "SDK snippet tabs")}
          >
            {(Object.entries(snippets) as [SdkTabId, (typeof snippets)[SdkTabId]][]).map(
              ([id, item]) => (
                <button
                  key={id}
                  type="button"
                  role="tab"
                  aria-selected={activeTab === id}
                  className={`integration-sdk-tab${
                    activeTab === id ? " integration-sdk-tab--active" : ""
                  }`}
                  onClick={() => setActiveTab(id)}
                >
                  <span>{item.label}</span>
                </button>
              )
            )}
          </div>

          <div className="integration-sdk-view">
            <div className="integration-sdk-meta">
              <div>
                <h3>{activeSnippet.title}</h3>
                <p>{activeSnippet.summary}</p>
              </div>
              <div className="integration-sdk-badges">
                <span className="integration-chip">
                  {text("示例模型", "Example model")}:{" "}
                  {activeTab === "anthropic-python" || activeTab === "anthropic-curl"
                    ? anthropicExampleModel
                    : openAiExampleModel}
                </span>
                <span className="integration-chip">
                  {text("调用方式", "Mode")}: {text("非流式", "Non-streaming")}
                </span>
                <span className="integration-chip">
                  {text("model", "model")}: {text("原生 HTTP 可省略", "Optional for raw HTTP")}
                </span>
              </div>
            </div>
            {activeSnippet.install ? (
              <div className="integration-install-box">
                <span className="integration-install-label">
                  {text("安装依赖", "Install dependency")}
                </span>
                <div className="integration-install-row">
                  <code>{activeSnippet.install}</code>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={() => void handleCopy(`${activeTab}-install`, activeSnippet.install ?? "")}
                  >
                    {copiedId === `${activeTab}-install`
                      ? text("已复制", "Copied")
                      : text("复制安装命令", "Copy install command")}
                  </button>
                </div>
              </div>
            ) : null}
            <pre className="integration-code-block">{activeSnippet.code}</pre>
          </div>
        </div>
      </section>

      <section id="payload" className="integration-grid">
        <article className="integration-card integration-card--wide">
          <div className="integration-section-head">
            <div>
              <h2>{text("示例请求体", "Sample payload")}</h2>
              <p className="muted">
                {modelList.length
                  ? text(
                      `当前示例默认演示“省略 model，由 AppKey 自动选模型”；若你仍想显式指定，可传 ${exampleModel}`,
                      `The default sample demonstrates omitting model so the AppKey can auto-select it. If you still want to pin one explicitly, you can pass ${exampleModel}`
                    )
                  : text(
                      "当前未读取到可用模型，示例里继续演示省略 model 的自动选模方式。",
                      "No available model could be loaded, so the example continues to demonstrate omitting model for AppKey-driven auto-selection."
                    )}
              </p>
              <p className="muted">
                {text(
                  "下面这一段展示的是 OpenAI `chat completions` 请求体；如果你接的是 Claude，请直接看上面的 Anthropic SDK / Claude cURL 示例，使用 `/v1/messages`。",
                  "The payload below shows the OpenAI `chat completions` shape. If you integrate Claude, use the Anthropic SDK / Claude cURL examples above and call `/v1/messages`."
                )}
              </p>
              <p className="muted">
                {text(
                  "`system` 负责描述模型扮演的角色与回答规则，`user` 才是真正的问题输入。若只有 `system` 没有 `user`，不同上游模型可能表现不一致。",
                  "`system` describes the role and answering rules, while `user` carries the actual question. If a request contains only `system` and no `user`, different upstream models may behave inconsistently."
                )}
              </p>
            </div>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => void handleCopy("payload", payloadJson)}
            >
              {copiedId === "payload"
                ? text("请求体已复制", "Payload copied")
                : text("复制请求体", "Copy payload")}
            </button>
          </div>
          <pre className="integration-code-block">{payloadJson}</pre>
        </article>

        <article className="integration-card">
          <div className="integration-section-head">
            <h2>{text("成功返回示例", "Successful response")}</h2>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => void handleCopy("response", responseJson)}
            >
              {copiedId === "response"
                ? text("返回已复制", "Response copied")
                : text("复制返回示例", "Copy response")}
            </button>
          </div>
          <pre className="integration-code-block">{responseJson}</pre>
        </article>
      </section>

      <section id="errors" className="integration-grid">
        <article className="integration-card">
          <h2>{text("常见错误矩阵", "Common error matrix")}</h2>
          <div className="integration-support-list">
            <SupportRow
              feature="401 Unauthorized"
              status="available"
              statusLabel={text("返回错误", "Error")}
              detail={text(
                "通常表示未传 Bearer AppKey、AppKey 无效，或密钥已撤销。",
                "Usually means the Bearer AppKey is missing, invalid, or revoked."
              )}
            />
            <SupportRow
              feature="402 Payment Required"
              status="available"
              statusLabel={text("返回错误", "Error")}
              detail={text(
                "通常表示日预算、月预算或租户预算已超限。",
                "Usually means daily, monthly, or tenant budget has been exceeded."
              )}
            />
            <SupportRow
              feature="403 Forbidden"
              status="available"
              statusLabel={text("返回错误", "Error")}
              detail={text(
                "`chat:complete` scope 缺失，或请求的模型不在 AppKey 白名单中。",
                "The `chat:complete` scope is missing, or the requested model is not in the AppKey allowlist."
              )}
            />
            <SupportRow
              feature="429 Too Many Requests"
              status="available"
              statusLabel={text("返回错误", "Error")}
              detail={text(
                "表示当前 AppKey 触发了 QPS 限制；响应头里会带 `Retry-After: 1`。",
                "Indicates the AppKey hit its QPS limit; the response includes `Retry-After: 1`."
              )}
            />
            <SupportRow
              feature="5xx Gateway / Upstream Error"
              status="available"
              statusLabel={text("返回错误", "Error")}
              detail={text(
                "优先确认供应商 URL、API Key、上游模型状态，以及当前平台网关健康度。",
                "First verify provider URL, provider API key, upstream model status, and current gateway health."
              )}
            />
          </div>
        </article>

        <article className="integration-card">
          <div className="integration-section-head">
            <div>
              <h2>{text("模型白名单错误示例", "Allowlist error example")}</h2>
              <p className="muted">
                {text(
                  "当请求模型不在 AppKey 白名单里时，网关会返回允许的模型列表。",
                  "When the requested model is not in the AppKey allowlist, the gateway returns the allowed model list."
                )}
              </p>
            </div>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => void handleCopy("allowlist-error", allowlistErrorJson)}
            >
              {copiedId === "allowlist-error"
                ? text("错误已复制", "Error copied")
                : text("复制错误示例", "Copy error")}
            </button>
          </div>
          <pre className="integration-code-block">{allowlistErrorJson}</pre>
          <div className="integration-section-head integration-section-head--subtle">
            <div>
              <h2>{text("速率限制错误示例", "Rate limit error example")}</h2>
            </div>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => void handleCopy("rate-limit-error", rateLimitErrorJson)}
            >
              {copiedId === "rate-limit-error"
                ? text("错误已复制", "Error copied")
                : text("复制错误示例", "Copy error")}
            </button>
          </div>
          <pre className="integration-code-block">{rateLimitErrorJson}</pre>
        </article>
      </section>

      <section id="rate-limit" className="integration-grid">
        <article className="integration-card integration-card--wide">
          <h2>{text("错误码表", "Error code table")}</h2>
          <div className="integration-error-list">
            {errorCodeRows.map((row) => (
              <ErrorCodeRow
                key={row.code}
                code={row.code}
                title={row.title}
                meaning={row.meaning}
                action={row.action}
              />
            ))}
          </div>
        </article>

        <article className="integration-card">
          <h2>{text("限流策略", "Rate limit policy")}</h2>
          <div className="integration-support-list">
            <SupportRow
              feature={text("限流维度", "Rate-limit dimension")}
              status="available"
              statusLabel={text("当前策略", "Current")}
              detail={text(
                "当前按 AppKey 维度执行 QPS 限制，而不是按单个 IP 或用户会话。",
                "Rate limits currently apply at the AppKey level rather than per IP or per end-user session."
              )}
            />
            <SupportRow
              feature={text("命中行为", "On limit hit")}
              status="available"
              statusLabel={text("429", "429")}
              detail={text(
                "命中后会返回 `429 Too Many Requests`，并带 `Retry-After: 1` 响应头。",
                "When hit, the gateway returns `429 Too Many Requests` with a `Retry-After: 1` response header."
              )}
            />
            <SupportRow
              feature={text("客户端建议", "Client guidance")}
              status="available"
              statusLabel={text("建议", "Recommended")}
              detail={text(
                "请使用指数退避、请求队列或本地并发整形，不要把失败请求立即并发重试。",
                "Use exponential backoff, client-side queuing, or concurrency shaping instead of immediately retrying failed requests in parallel."
              )}
            />
          </div>
        </article>
      </section>

      <section id="faq" className="integration-grid">
        <article className="integration-card integration-card--wide">
          <h2>{text("FAQ", "FAQ")}</h2>
          <div className="integration-faq-list">
            {faqItems.map((item) => (
              <FaqItem
                key={item.question}
                question={item.question}
                answer={item.answer}
              />
            ))}
          </div>
        </article>

        <article className="integration-card">
          <h2>{text("版本更新记录", "Version history")}</h2>
          <div className="integration-changelog-list">
            {changelogItems.map((item) => (
              <ChangelogItem
                key={item.version}
                version={item.version}
                date={item.date}
                summary={item.summary}
                items={item.items}
              />
            ))}
          </div>
        </article>
      </section>

      <section id="go-live" className="integration-grid">
        <article className="integration-card">
          <h2>{text("上线前建议", "Before you go live")}</h2>
          <ul className="integration-bullet-list">
            <li>
              {text(
                "把 AppKey 存放在服务端环境变量、KMS 或密钥管理系统，不要直接放进公开仓库或浏览器源码。",
                "Store the AppKey in backend environment variables, KMS, or a secrets manager. Never place it in a public repo or browser source."
              )}
            </li>
            <li>
              {text(
                "为生产、预发、开发环境拆分不同 AppKey，并明确预算、QPS 和模型白名单。",
                "Split AppKeys by production, staging, and development environments, and define budgets, QPS, and model allowlists explicitly."
              )}
            </li>
            <li>
              {text(
                "如果业务允许重试，请统一定义 `Idempotency-Key` 规则，并记录请求日志。",
                "If your business supports retries, define a consistent `Idempotency-Key` convention and record request logs."
              )}
            </li>
          </ul>
        </article>

        <article className="integration-card">
          <h2>{text("快速排查清单", "Troubleshooting checklist")}</h2>
          <ul className="integration-bullet-list">
            <li>
              {text(
                "先检查是否传了完整 `Bearer AppKey`，以及当前 AppKey 是否启用。",
                "First verify that a full `Bearer AppKey` was sent and that the key is active."
              )}
            </li>
            <li>
              {text(
                "确认 `model` 是否在允许列表中，且平台当前确实有可用供应商配置。",
                "Confirm the `model` is in the allowlist and that the platform has an available provider configured for it."
              )}
            </li>
            <li>
              {text(
                "如果出现 429，请按 `Retry-After` 做退避；如果出现 402，请检查预算策略。",
                "If you receive 429, back off according to `Retry-After`; if you receive 402, review your budget policy."
              )}
            </li>
          </ul>
        </article>
      </section>
    </div>
  );
}
