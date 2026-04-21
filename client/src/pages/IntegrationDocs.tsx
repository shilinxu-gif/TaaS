import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { api, type AppKeyAvailableModel } from "../api";
import { pickText } from "../i18n/inline";
import { copyText } from "../utils/clipboard";

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

function SnippetCard({
  title,
  code,
  copied,
  copyLabel,
  copiedLabel,
  onCopy,
}: {
  title: string;
  code: string;
  copied: boolean;
  copyLabel: string;
  copiedLabel: string;
  onCopy: () => void;
}) {
  return (
    <section className="integration-snippet-card">
      <div className="integration-snippet-head">
        <h3>{title}</h3>
        <button type="button" className="btn btn-ghost" onClick={onCopy}>
          {copied ? copiedLabel : copyLabel}
        </button>
      </div>
      <pre className="integration-code-block">{code}</pre>
    </section>
  );
}

export function IntegrationDocs() {
  const { i18n } = useTranslation();
  const text = (zhCN: string, enUS: string) =>
    pickText(i18n.resolvedLanguage, zhCN, enUS);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const modelsQuery = useQuery({
    queryKey: ["app-keys", "available-models"],
    queryFn: () => api<AppKeyAvailableModel[]>("/app-keys/available-models"),
  });

  const exampleModel = modelsQuery.data?.[0]?.model ?? "gpt-4o-mini";
  const gatewayOrigin =
    typeof window !== "undefined" ? window.location.origin : "https://your-domain.com";
  const chatEndpoint = `${gatewayOrigin}/v1/chat/completions`;
  const openAiBaseUrl = `${gatewayOrigin}/v1`;

  const requestBody = useMemo(
    () =>
      JSON.stringify(
        {
          model: exampleModel,
          messages: [
            {
              role: "system",
              content: text(
                "你是一个企业 AI 助手，请简洁回答。",
                "You are an enterprise AI assistant. Answer concisely."
              ),
            },
            {
              role: "user",
              content: text("请返回一条接入联通测试成功消息。", "Return a connectivity test success message."),
            },
          ],
          temperature: 0.2,
        },
        null,
        2
      ),
    [exampleModel, text]
  );

  const curlSnippet = useMemo(
    () => `curl "${chatEndpoint}" \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer sk-your-app-key" \\
  -H "Accept-Language: ${i18n.resolvedLanguage ?? "zh-CN"}" \\
  -d '${requestBody.replace(/'/g, "\\'")}'`,
    [chatEndpoint, i18n.resolvedLanguage, requestBody]
  );

  const pythonSnippet = useMemo(
    () => `import requests

url = "${chatEndpoint}"
headers = {
    "Content-Type": "application/json",
    "Authorization": "Bearer sk-your-app-key",
}
payload = ${requestBody}

response = requests.post(url, headers=headers, json=payload, timeout=60)
response.raise_for_status()
print(response.json())`,
    [chatEndpoint, requestBody]
  );

  const nodeSnippet = useMemo(
    () => `const response = await fetch("${chatEndpoint}", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    Authorization: "Bearer sk-your-app-key",
  },
  body: JSON.stringify(${requestBody}),
});

if (!response.ok) {
  throw new Error(await response.text());
}

console.log(await response.json());`,
    [chatEndpoint, requestBody]
  );

  const openAiSnippet = useMemo(
    () => `from openai import OpenAI

client = OpenAI(
    api_key="sk-your-app-key",
    base_url="${openAiBaseUrl}",
)

resp = client.chat.completions.create(
    model="${exampleModel}",
    messages=[
        {"role": "user", "content": "Hello from TaaS gateway"}
    ],
)

print(resp.model_dump_json(indent=2))`,
    [exampleModel, openAiBaseUrl]
  );

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
      <section className="integration-hero">
        <div className="integration-hero-copy">
          <span className="integration-kicker">
            {text("Tenant Integration Guide", "Tenant Integration Guide")}
          </span>
          <h1>{text("接入文档", "Integration Docs")}</h1>
          <p>
            {text(
              "拿到 AppKey 后，只需要把它放进 Bearer Token，即可通过统一网关调用多模型能力。下面给你一份可直接落地的最短接入路径。",
              "Once you have an AppKey, put it into the Bearer token and call the unified gateway. This page gives you the shortest path to production integration."
            )}
          </p>
          <div className="integration-hero-actions">
            <Link to="/api-keys" className="btn btn-primary">
              {text("返回 API 密钥", "Back to API Keys")}
            </Link>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => void handleCopy("endpoint", chatEndpoint)}
            >
              {copiedId === "endpoint"
                ? text("端点已复制", "Endpoint copied")
                : text("复制请求地址", "Copy endpoint")}
            </button>
          </div>
        </div>
        <div className="integration-hero-panel">
          <div className="integration-mini-card">
            <span>{text("请求地址", "Endpoint")}</span>
            <code>{chatEndpoint}</code>
          </div>
          <div className="integration-mini-card">
            <span>{text("鉴权方式", "Auth")}</span>
            <code>Authorization: Bearer sk-...</code>
          </div>
          <div className="integration-mini-card">
            <span>{text("OpenAI 兼容基址", "OpenAI-compatible base URL")}</span>
            <code>{openAiBaseUrl}</code>
          </div>
        </div>
      </section>

      <section className="integration-grid">
        <article className="integration-card">
          <h2>{text("3 步完成接入", "Integrate in 3 steps")}</h2>
          <ol className="integration-step-list">
            <li>
              <strong>{text("创建 AppKey", "Create an AppKey")}</strong>
              <span>
                {text(
                  "在 API 密钥页创建并保存完整密钥；完整值只会展示一次。",
                  "Create a key on the API Keys page and save the full value; it is shown only once."
                )}
              </span>
            </li>
            <li>
              <strong>{text("设置请求头", "Set the headers")}</strong>
              <span>
                {text(
                  "必须传 Authorization: Bearer <AppKey>，同时建议带上 Content-Type: application/json。",
                  "Send Authorization: Bearer <AppKey>. Also send Content-Type: application/json."
                )}
              </span>
            </li>
            <li>
              <strong>{text("发起聊天请求", "Send a chat request")}</strong>
              <span>
                {text(
                  "向统一网关 POST 一个 OpenAI 兼容的 chat completions 请求体即可。",
                  "POST an OpenAI-compatible chat completions payload to the unified gateway."
                )}
              </span>
            </li>
          </ol>
        </article>

        <article className="integration-card">
          <h2>{text("请求规范", "Request contract")}</h2>
          <div className="integration-spec-list">
            <SpecItem label={text("方法", "Method")} value="POST" />
            <SpecItem
              label={text("路径", "Path")}
              value="/v1/chat/completions"
            />
            <SpecItem
              label={text("认证", "Auth")}
              value="Authorization: Bearer sk-..."
            />
            <SpecItem
              label={text("内容类型", "Content-Type")}
              value="application/json"
            />
            <SpecItem
              label={text("建议 Header", "Recommended header")}
              value="Accept-Language / Idempotency-Key"
            />
            <SpecItem
              label={text("必填字段", "Required fields")}
              value={`model, messages[]`}
            />
          </div>
        </article>
      </section>

      <section className="integration-card integration-card--wide">
        <div className="integration-section-head">
          <div>
            <h2>{text("示例请求体", "Sample payload")}</h2>
            <p className="muted">
              {modelsQuery.data?.length
                ? text(
                    `已自动带入当前可用模型示例：${exampleModel}`,
                    `Using the first currently available model as an example: ${exampleModel}`
                  )
                : text(
                    "当前未读取到可用模型，示例里使用默认模型名占位。",
                    "No available model could be loaded, so the examples use a default placeholder model."
                  )}
            </p>
          </div>
          <button
            type="button"
            className="btn btn-ghost"
            onClick={() => void handleCopy("payload", requestBody)}
          >
            {copiedId === "payload"
              ? text("请求体已复制", "Payload copied")
              : text("复制请求体", "Copy payload")}
          </button>
        </div>
        <pre className="integration-code-block">{requestBody}</pre>
      </section>

      <section className="integration-snippet-grid">
        <SnippetCard
          title="cURL"
          code={curlSnippet}
          copied={copiedId === "curl"}
          copyLabel={text("复制", "Copy")}
          copiedLabel={text("已复制", "Copied")}
          onCopy={() => void handleCopy("curl", curlSnippet)}
        />
        <SnippetCard
          title="Python requests"
          code={pythonSnippet}
          copied={copiedId === "python"}
          copyLabel={text("复制", "Copy")}
          copiedLabel={text("已复制", "Copied")}
          onCopy={() => void handleCopy("python", pythonSnippet)}
        />
        <SnippetCard
          title="Node.js fetch"
          code={nodeSnippet}
          copied={copiedId === "node"}
          copyLabel={text("复制", "Copy")}
          copiedLabel={text("已复制", "Copied")}
          onCopy={() => void handleCopy("node", nodeSnippet)}
        />
        <SnippetCard
          title="OpenAI SDK"
          code={openAiSnippet}
          copied={copiedId === "openai"}
          copyLabel={text("复制", "Copy")}
          copiedLabel={text("已复制", "Copied")}
          onCopy={() => void handleCopy("openai", openAiSnippet)}
        />
      </section>

      <section className="integration-grid">
        <article className="integration-card">
          <h2>{text("接入建议", "Integration tips")}</h2>
          <ul className="integration-bullet-list">
            <li>
              {text(
                "把 AppKey 保存在服务端或密钥管理系统，不要直接暴露在公开前端。",
                "Store the AppKey on your server or in a secrets manager instead of exposing it in a public frontend."
              )}
            </li>
            <li>
              {text(
                "如果需要防重复提交，可以带上 Idempotency-Key。",
                "Send an Idempotency-Key when you need protection against duplicate submissions."
              )}
            </li>
            <li>
              {text(
                "如密钥配置了模型白名单，请确保 model 在允许列表中。",
                "If the AppKey has a model allowlist, make sure the model is included."
              )}
            </li>
          </ul>
        </article>

        <article className="integration-card">
          <h2>{text("常见排查", "Common troubleshooting")}</h2>
          <ul className="integration-bullet-list">
            <li>
              {text(
                "401 / 403：先检查 Bearer Token 是否为完整 AppKey，且状态为启用。",
                "401 / 403: verify that the Bearer token is the full AppKey and that the key is active."
              )}
            </li>
            <li>
              {text(
                "400：检查请求体 JSON、model 字段以及 messages 数组结构。",
                "400: validate the JSON payload, the model field, and the messages array structure."
              )}
            </li>
            <li>
              {text(
                "模型不可用：通常是供应商未完成 URL / API Key 配置，需联系平台管理员。",
                "Model unavailable: usually the provider URL or provider API key is not configured yet. Contact the platform admin."
              )}
            </li>
          </ul>
        </article>
      </section>
    </div>
  );
}
