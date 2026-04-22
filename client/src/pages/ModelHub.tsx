import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { api, type ModelCatalogRow } from "../api";
import { pickText } from "../i18n/inline";
import { copyText } from "../utils/clipboard";

function CapabilityPill({
  value,
  language,
}: {
  value: string;
  language: string | undefined;
}) {
  const label =
    value === "chat"
      ? pickText(language, "对话", "Chat")
      : value === "streaming"
        ? pickText(language, "流式", "Streaming")
        : value;
  return <span className="model-hub-pill">{label}</span>;
}

export function ModelHub() {
  const { i18n } = useTranslation();
  const language = i18n.resolvedLanguage;
  const text = (zhCN: string, enUS: string) => pickText(language, zhCN, enUS);
  const gatewayOrigin =
    typeof window !== "undefined" ? window.location.origin : "http://www.itoken.group";
  const [providerFilter, setProviderFilter] = useState("all");
  const [capabilityFilter, setCapabilityFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const modelCatalogQuery = useQuery({
    queryKey: ["model-catalog"],
    queryFn: () => api<ModelCatalogRow[]>("/model-catalog"),
  });

  const rows = modelCatalogQuery.data ?? [];
  const providerOptions = useMemo(
    () =>
      Array.from(new Set(rows.map((row) => row.providerType))).map((providerType) => ({
        value: providerType,
        label:
          providerType === "anthropic"
            ? "Anthropic"
            : providerType === "google"
              ? "Google"
              : "OpenAI",
      })),
    [rows]
  );
  const capabilityOptions = useMemo(
    () => Array.from(new Set(rows.flatMap((row) => row.capabilityTags))),
    [rows]
  );
  const filteredRows = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    return rows.filter((row) => {
      if (providerFilter !== "all" && row.providerType !== providerFilter) {
        return false;
      }
      if (capabilityFilter !== "all" && !row.capabilityTags.includes(capabilityFilter)) {
        return false;
      }
      if (!keyword) {
        return true;
      }
      return (
        row.displayName.toLowerCase().includes(keyword) ||
        row.modelId.toLowerCase().includes(keyword) ||
        row.providerName.toLowerCase().includes(keyword)
      );
    });
  }, [capabilityFilter, providerFilter, rows, search]);

  const exampleUserPrompt = text(
    "请用一句话介绍这个模型的定位。",
    "Introduce this model in one sentence."
  );

  function buildCurlSnippet(row: ModelCatalogRow) {
    return `curl "${gatewayOrigin}${row.gatewayEndpoint}" \\
  -X POST \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer sk-your-app-key" \\
  -d '{
  "model": "${row.modelId}",
  "messages": [
    {
      "role": "user",
      "content": "${exampleUserPrompt}"
    }
  ],
  "temperature": 0.2
}'`;
  }

  function buildSdkSnippet(row: ModelCatalogRow) {
    return `from openai import OpenAI

client = OpenAI(
    api_key="sk-your-app-key",
    base_url="${gatewayOrigin}${row.gatewayBaseUrl}",
)

resp = client.chat.completions.create(
    model="${row.modelId}",
    messages=[
        {"role": "user", "content": "${exampleUserPrompt}"}
    ],
    temperature=0.2,
)

print(resp.model_dump_json(indent=2))`;
  }

  async function handleCopy(id: string, value: string) {
    const copied = await copyText(value);
    if (!copied) {
      setCopiedId(null);
      return;
    }
    setCopiedId(id);
    window.setTimeout(() => {
      setCopiedId((current) => (current === id ? null : current));
    }, 1500);
  }

  if (modelCatalogQuery.isLoading) {
    return <p className="muted keys-page-pad">{text("模型目录加载中…", "Loading model catalog…")}</p>;
  }
  if (modelCatalogQuery.error) {
    return <p className="error keys-page-pad">{(modelCatalogQuery.error as Error).message}</p>;
  }

  return (
    <div className="model-hub-page">
      <section className="model-hub-hero">
        <div className="model-hub-hero-copy">
          <span className="model-hub-kicker">{text("Model Hub", "Model Hub")}</span>
          <h1>{text("模型广场", "Model Hub")}</h1>
          <p>
            {text(
              "这里展示当前平台已配置且可用的模型目录。你可以快速查看模型 ID、输入/输出价格、流式能力、计费规则，以及平台统一网关与原生上游协议的差异说明。",
              "Browse every model currently configured and available on the platform. Compare model IDs, input/output pricing, streaming support, billing rules, and the difference between the unified TaaS gateway and each upstream protocol family."
            )}
          </p>
          <div className="model-hub-hero-actions">
            <Link to="/integration-docs" className="btn btn-primary">
              {text("查看 SDK 文档中心", "Open SDK docs")}
            </Link>
            <Link to="/api-keys" className="btn btn-ghost">
              {text("前往 API 密钥", "Go to API Keys")}
            </Link>
          </div>
        </div>
        <div className="model-hub-stats">
          <article className="model-hub-stat-card">
            <span>{text("当前可用模型", "Available models")}</span>
            <strong>{rows.length}</strong>
          </article>
          <article className="model-hub-stat-card">
            <span>{text("供应商类型", "Provider types")}</span>
            <strong>{providerOptions.length}</strong>
          </article>
          <article className="model-hub-stat-card">
            <span>{text("统一网关端点", "Gateway endpoint")}</span>
            <code>/v1/chat/completions</code>
          </article>
        </div>
      </section>

      <section className="model-hub-filter-bar">
        <div className="model-hub-filter-group">
          <label className="model-hub-filter-label" htmlFor="model-hub-search">
            {text("搜索", "Search")}
          </label>
          <input
            id="model-hub-search"
            className="input-plain"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={text("按模型名 / 模型 ID / 供应商搜索", "Search by model, model ID, or provider")}
          />
        </div>
        <div className="model-hub-filter-group">
          <label className="model-hub-filter-label" htmlFor="model-hub-provider">
            {text("供应商", "Provider")}
          </label>
          <select
            id="model-hub-provider"
            className="input-plain"
            value={providerFilter}
            onChange={(e) => setProviderFilter(e.target.value)}
          >
            <option value="all">{text("全部供应商", "All providers")}</option>
            {providerOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
        <div className="model-hub-filter-group">
          <label className="model-hub-filter-label" htmlFor="model-hub-capability">
            {text("能力标签", "Capability")}
          </label>
          <select
            id="model-hub-capability"
            className="input-plain"
            value={capabilityFilter}
            onChange={(e) => setCapabilityFilter(e.target.value)}
          >
            <option value="all">{text("全部能力", "All capabilities")}</option>
            {capabilityOptions.map((capability) => (
              <option key={capability} value={capability}>
                {capability === "chat"
                  ? text("对话", "Chat")
                  : capability === "streaming"
                    ? text("流式", "Streaming")
                    : capability}
              </option>
            ))}
          </select>
        </div>
      </section>

      <section className="model-hub-grid">
        {filteredRows.length === 0 ? (
          <article className="model-hub-empty">
            <h2>{text("暂无匹配模型", "No matching models")}</h2>
            <p className="muted">
              {text(
                "请调整筛选条件，或者先让管理员在供应商管理中完成模型与 API Key 配置。",
                "Adjust your filters, or ask an administrator to finish provider and API key setup first."
              )}
            </p>
          </article>
        ) : (
          filteredRows.map((row) => (
            <article key={row.modelId} className="model-hub-card">
              <div className="model-hub-card-head">
                <div>
                  <h2>{row.displayName}</h2>
                  <p className="muted">
                    {row.providerName} · {row.protocolLabel}
                  </p>
                </div>
                <span className="model-hub-provider-badge">{row.providerType}</span>
              </div>

              <div className="model-hub-model-id">
                <div>
                  <span className="model-hub-section-label">{text("模型 ID", "Model ID")}</span>
                  <code>{row.modelId}</code>
                </div>
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => void handleCopy(`model-${row.modelId}`, row.modelId)}
                >
                  {copiedId === `model-${row.modelId}`
                    ? text("已复制", "Copied")
                    : text("复制模型 ID", "Copy model ID")}
                </button>
              </div>

              <div className="model-hub-price-grid">
                <div className="model-hub-price-card">
                  <span>{text("输入价格", "Input price")}</span>
                  <strong>
                    {row.inputUsdPerMillion == null
                      ? text("未公布", "Not published")
                      : `$${row.inputUsdPerMillion}`}
                  </strong>
                  <small>{text("/ 百万 tokens", "/ 1M tokens")}</small>
                </div>
                <div className="model-hub-price-card">
                  <span>{text("输出价格", "Output price")}</span>
                  <strong>
                    {row.outputUsdPerMillion == null
                      ? text("未公布", "Not published")
                      : `$${row.outputUsdPerMillion}`}
                  </strong>
                  <small>{text("/ 百万 tokens", "/ 1M tokens")}</small>
                </div>
              </div>

              <div className="model-hub-pill-row">
                {row.capabilityTags.map((capability) => (
                  <CapabilityPill key={capability} value={capability} language={language} />
                ))}
                <span className="model-hub-pill model-hub-pill--subtle">{row.status}</span>
              </div>

              <div className="model-hub-section">
                <span className="model-hub-section-label">{text("计费规则", "Billing rule")}</span>
                <p>{row.billingRuleSummary}</p>
              </div>

              <div className="model-hub-endpoint-grid">
                <div className="model-hub-endpoint-card">
                  <span className="model-hub-section-label">{text("平台统一入口", "Unified gateway")}</span>
                  <code>{row.gatewayEndpoint}</code>
                  <p className="muted">
                    {text(
                      "通过 TaaS 接入时统一走该接口；SDK Base URL 为 `/v1`。",
                      "Use this endpoint when integrating through TaaS; the SDK Base URL is `/v1`."
                    )}
                  </p>
                </div>
                <div className="model-hub-endpoint-card">
                  <span className="model-hub-section-label">{text("原生上游格式参考", "Native upstream format")}</span>
                  <code>{row.upstreamEndpointPath}</code>
                  <p className="muted">{row.integrationFormatNote}</p>
                </div>
              </div>

              <div className="model-hub-card-actions">
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => void handleCopy(`curl-${row.modelId}`, buildCurlSnippet(row))}
                >
                  {copiedId === `curl-${row.modelId}`
                    ? text("cURL 已复制", "cURL copied")
                    : text("复制 cURL", "Copy cURL")}
                </button>
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => void handleCopy(`sdk-${row.modelId}`, buildSdkSnippet(row))}
                >
                  {copiedId === `sdk-${row.modelId}`
                    ? text("SDK 已复制", "SDK copied")
                    : text("复制 OpenAI SDK", "Copy OpenAI SDK")}
                </button>
                <Link to="/integration-docs" className="btn btn-ghost">
                  {text("查看接入文档", "View integration docs")}
                </Link>
              </div>
            </article>
          ))
        )}
      </section>

      <section className="model-hub-notes">
        <article className="model-hub-note-card">
          <h2>{text("如何理解协议差异", "How to interpret protocol differences")}</h2>
          <p>
            {text(
              "OpenAI、Anthropic、Google 的原生上游接口格式并不相同，但通过 TaaS 平台接入时，你仍然可以统一使用 `/v1/chat/completions`。模型广场展示原生格式差异，主要是帮助团队理解底层供应商能力与未来扩展方向。",
              "OpenAI, Anthropic, and Google use different native upstream formats, but through TaaS you can still integrate with a unified `/v1/chat/completions` entrypoint. The protocol notes here are meant to help your team understand the underlying provider differences and future extension paths."
            )}
          </p>
        </article>
        <article className="model-hub-note-card">
          <h2>{text("如何理解计费", "How billing works")}</h2>
          <p>
            {text(
              "目录价按输入 Token 与输出 Token 分开展示，并与当前网关实际计费口径保持一致。若后续某模型扩展为图像、视频等多模态能力，模型广场会继续补充对应规则。",
              "Catalog pricing is displayed separately for input and output tokens and is aligned with the gateway's current billing behavior. If a model later expands into multimodal capabilities such as image or video generation, this page can be extended with the matching rules."
            )}
          </p>
        </article>
      </section>
    </div>
  );
}
