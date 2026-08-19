import { Context, Next } from 'hono';

export interface Env {
  DB: D1Database;
  ENVIRONMENT?: string;
}

export type AppContext = {
  Bindings: Env;
  Variables: {
    userEmail: string;
  };
};

export const DEFAULT_USER = 'admin@default.user';

/**
 * 从 CF Access JWT 或相关 Header 中解析用户 Email，未登录时自动降级到默认公共用户
 */
export function getUserEmail(req: Request): string {
  // 1. 尝试从 Cloudflare Access 注入的 Cf-Access-Jwt-Assertion 读取
  const jwt = req.headers.get('Cf-Access-Jwt-Assertion');
  if (jwt) {
    try {
      const parts = jwt.split('.');
      if (parts.length >= 2) {
        const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
        const jsonPayload = decodeURIComponent(
          atob(base64)
            .split('')
            .map((c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
            .join('')
        );
        const payload = JSON.parse(jsonPayload);
        if (payload.email) return payload.email;
      }
    } catch {
      // ignore jwt decode errors
    }
  }

  // 2. 尝试从 Cloudflare Access 直接注入的 user-email header 读取
  const cfUserEmail = req.headers.get('cf-access-authenticated-user-email');
  if (cfUserEmail) return cfUserEmail;

  // 3. 开发环境/测试辅助 Header
  const devEmail = req.headers.get('x-user-email');
  if (devEmail) return devEmail;

  // 4. 免登录模式：自动兜底为默认管理账号
  return DEFAULT_USER;
}

/**
 * Hono 认证中间件：注入当前用户（未配置 Access 时自动使用默认用户）
 */
export async function authMiddleware(c: Context<AppContext>, next: Next) {
  const email = getUserEmail(c.req.raw);

  // 确保用户记录存在于 users 表中
  try {
    await c.env.DB.prepare(
      'INSERT INTO users (email) VALUES (?) ON CONFLICT(email) DO NOTHING'
    ).bind(email).run();
  } catch (e) {
    console.error('Failed to ensure user in DB:', e);
  }

  c.set('userEmail', email);
  return next();
}
