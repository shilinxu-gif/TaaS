export const resources = {
  "zh-CN": {
    translation: {
      meta: {
        title: "算力无限 · 控制台",
      },
      common: {
        close: "关闭",
        cancel: "取消",
        save: "保存",
        loading: "加载中…",
        notAvailable: "—",
        language: "语言",
        chinese: "中文",
        english: "English",
      },
      layout: {
        tenantFallback: "—",
        platformAdmin: "平台管理员",
        logout: "退出",
        nav: "导航",
        expandNav: "展开导航",
        collapseNav: "收起导航",
        tenantLinks: {
          dashboard: "工作台",
          apiKeys: "API 密钥",
          usage: "用量",
          optimization: "成本优化",
          routing: "路由调度",
          ops: "运营与审计",
          billing: "计费中心",
          recharge: "在线充值",
          invoices: "自动化开票",
        },
        adminLinks: {
          dashboard: "平台概览",
          usage: "调用与充值",
          providers: "供应商与模型",
          users: "用户管理",
          ops: "运营与审计",
        },
      },
      auth: {
        loginFailed: "登录失败",
        registerFailed: "注册失败",
        login: {
          title: "登录",
          loginPlaceholder: "用户名或邮箱",
          passwordPlaceholder: "密码",
          trialHint: "企业试用默认 14 天，注册后自动创建租户、预算与路由策略。",
          createAccount: "创建账户",
          forgotPassword: "忘记密码？",
          heroLead: "AI 正在改变世界…",
          heroSub: "多模型路由 · 企业计费 · 可审计 AI 网关",
          forgotTitle: "找回密码",
          forgotBody1: "当前版本还没有接入自助找回密码流程。",
          forgotBody2:
            "请联系平台管理员或运维人员重置密码；如果你是平台管理员，请让运维检查当前部署环境中的管理员初始化配置。",
          forgotAcknowledge: "我知道了",
        },
        register: {
          title: "创建组织与账户",
          subtitle: "注册后自动开通 14 天企业试用、默认预算与多供应商路由策略",
          cardTitle: "注册",
          namePlaceholder: "显示名称",
          emailPlaceholder: "邮箱",
          passwordPlaceholder: "密码（至少 6 位）",
          submit: "创建账户",
          signInLink: "已有账户？去登录",
        },
      },
      app: {
        protectedLoading: "加载中…",
      },
      api: {
        backendUnavailable:
          "无法连接后端（请确认已启动 Java API：根目录执行 npm run dev:server，默认端口 3001）",
        serverHint: "请确认 Java API 已启动（端口 3001），且 PostgreSQL / Redis 可用。",
      },
    },
  },
  "en-US": {
    translation: {
      meta: {
        title: "TaaS Console",
      },
      common: {
        close: "Close",
        cancel: "Cancel",
        save: "Save",
        loading: "Loading…",
        notAvailable: "—",
        language: "Language",
        chinese: "中文",
        english: "English",
      },
      layout: {
        tenantFallback: "—",
        platformAdmin: "Platform Admin",
        logout: "Sign out",
        nav: "Navigation",
        expandNav: "Expand navigation",
        collapseNav: "Collapse navigation",
        tenantLinks: {
          dashboard: "Dashboard",
          apiKeys: "API Keys",
          usage: "Usage",
          optimization: "Cost Optimization",
          routing: "Routing",
          ops: "Operations & Audit",
          billing: "Billing",
          recharge: "Recharge",
          invoices: "Invoicing",
        },
        adminLinks: {
          dashboard: "Platform Overview",
          usage: "Calls & Recharge",
          providers: "Providers & Models",
          users: "User Management",
          ops: "Operations & Audit",
        },
      },
      auth: {
        loginFailed: "Sign-in failed",
        registerFailed: "Sign-up failed",
        login: {
          title: "Sign in",
          loginPlaceholder: "Username or email",
          passwordPlaceholder: "Password",
          trialHint:
            "The enterprise trial lasts 14 days by default. A tenant, budget, and routing strategy are created automatically after registration.",
          createAccount: "Create account",
          forgotPassword: "Forgot password?",
          heroLead: "AI is changing the world…",
          heroSub: "Multi-model routing · Enterprise billing · Auditable AI gateway",
          forgotTitle: "Reset password",
          forgotBody1: "Self-service password reset is not available in the current version.",
          forgotBody2:
            "Please contact your platform administrator or operations team to reset the password. If you are the platform administrator, ask ops to check the bootstrap admin settings in the current deployment environment.",
          forgotAcknowledge: "Got it",
        },
        register: {
          title: "Create your organization and account",
          subtitle:
            "Registration automatically enables a 14-day enterprise trial, default budget, and multi-provider routing strategy.",
          cardTitle: "Sign up",
          namePlaceholder: "Display name",
          emailPlaceholder: "Email",
          passwordPlaceholder: "Password (min 6 characters)",
          submit: "Create account",
          signInLink: "Already have an account? Sign in",
        },
      },
      app: {
        protectedLoading: "Loading…",
      },
      api: {
        backendUnavailable:
          "Cannot reach the backend. Make sure the Java API is running with `npm run dev:server` from the repo root on port 3001.",
        serverHint:
          "Please confirm the Java API is running on port 3001 and that PostgreSQL / Redis are available.",
      },
    },
  },
} as const;
