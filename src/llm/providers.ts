export type ProviderId = "deepseek" | "qwen" | "doubao" | "siliconflow" | "zhipu" | "commandcode" | "cerebras" | "custom"

export type Provider = {
  id: ProviderId
  name: string
  baseUrl: string
  model: string
  description: string
  docsUrl: string
  fastModeHint: string
  defaultFastMode: boolean
}

export const PROVIDERS: readonly Provider[] = [
  {
    id: "deepseek",
    name: "DeepSeek",
    baseUrl: "https://api.deepseek.com",
    model: "deepseek-flash",
    description: "使用 Flash 模型续写中文，可关闭深度思考。",
    docsUrl: "https://api-docs.deepseek.com/",
    fastModeHint: "关闭思考，优先输出正文。更换为其他型号时可取消。",
    defaultFastMode: true,
  },
  {
    id: "qwen",
    name: "通义千问 · 阿里云百炼",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    model: "qwen-flash",
    description: "默认使用北京地域；其他地域或专属工作空间请修改接口地址。",
    docsUrl: "https://www.alibabacloud.com/help/en/model-studio/qwen-api-via-openai-chat-completions",
    fastModeHint: "发送 enable_thinking=false；只适用于支持非思考模式的型号。",
    defaultFastMode: true,
  },
  {
    id: "doubao",
    name: "豆包 · 火山方舟",
    baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
    model: "doubao-seed-2-0-mini-260428",
    description: "默认 Mini LTS；也可填写已开通的模型 ID 或推理接入点 ID。",
    docsUrl: "https://docs.volcengine.com/docs/ark/quick-start",
    fastModeHint: "关闭深度思考；更换为仅支持思考的型号时请取消。",
    defaultFastMode: true,
  },
  {
    id: "siliconflow",
    name: "硅基流动",
    baseUrl: "https://api.siliconflow.cn/v1",
    model: "deepseek-ai/DeepSeek-V4-Flash",
    description: "模型名称包含组织前缀，请以账户模型列表为准。",
    docsUrl: "https://docs.siliconflow.cn/docs/api/chat-completions-post",
    fastModeHint: "发送 enable_thinking=false；部分模型不支持，请按模型文档调整。",
    defaultFastMode: true,
  },
  {
    id: "zhipu",
    name: "智谱 GLM",
    baseUrl: "https://open.bigmodel.cn/api/paas/v4",
    model: "glm-4.7-flash",
    description: "默认 Flash 型号；GLM 温度自动限制在 0–1。",
    docsUrl: "https://docs.bigmodel.cn/cn/guide/develop/openai/introduction",
    fastModeHint: "关闭深度思考。GLM-5.3 等仅思考型号需取消。",
    defaultFastMode: true,
  },
  {
    id: "commandcode",
    name: "Command Code",
    baseUrl: "https://api.commandcode.ai/provider/v1",
    model: "deepseek/deepseek-v4-flash",
    description: "使用 Command Code API Key；模型 ID 可修改。仅支持该平台的 Chat Completions 模型，不支持 Claude。",
    docsUrl: "https://commandcode.ai/docs/provider",
    fastModeHint: "不自动添加上游厂商的思考参数；请按平台和模型文档选择型号。",
    defaultFastMode: false,
  },
  {
    id: "cerebras",
    name: "Cerebras（原版）",
    baseUrl: "https://api.cerebras.ai/v1",
    model: "gpt-oss-120b",
    description: "保留原版生成接口；型号与可用额度以账户为准。",
    docsUrl: "https://inference-docs.cerebras.ai/api-reference/chat-completions",
    fastModeHint: "使用较低推理强度；仅适用于支持 reasoning_effort 的型号。",
    defaultFastMode: true,
  },
  {
    id: "custom",
    name: "自定义 OpenAI 兼容接口",
    baseUrl: "",
    model: "",
    description: "填写 Base URL 与模型名；不接受 Responses 或 Anthropic 原生协议。",
    docsUrl: "",
    fastModeHint: "自定义接口不自动添加厂商特有参数。",
    defaultFastMode: false,
  },
]

export function getProvider(id: string): Provider {
  return PROVIDERS.find((provider) => provider.id === id) ?? PROVIDERS[0]
}
