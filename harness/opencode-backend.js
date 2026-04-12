import { spawn } from 'child_process';
import http from 'http';
import https from 'https';

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/** 与 `opencode serve` 文档一致：OPENCODE_SERVER_PASSWORD 时 HTTP API 需 Basic 认证 */
function opencodeServerAuthHeader() {
  const pass = process.env.OPENCODE_SERVER_PASSWORD;
  if (!pass) return null;
  const user = process.env.OPENCODE_SERVER_USERNAME || 'opencode';
  const token = Buffer.from(`${user}:${pass}`, 'utf8').toString('base64');
  return `Basic ${token}`;
}

function httpGetJson(url, reqOptions = {}) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const lib = u.protocol === 'https:' ? https : http;
    const headers = { ...(reqOptions.headers || {}) };
    const auth = opencodeServerAuthHeader();
    if (auth && !headers.Authorization) headers.Authorization = auth;

    const req = lib.request(
      {
        method: 'GET',
        hostname: u.hostname,
        port: u.port,
        path: u.pathname + u.search,
        timeout: reqOptions.timeoutMs ?? 5000,
        headers
      },
      (res) => {
        let data = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => (data += chunk));
        res.on('end', () => {
          const code = res.statusCode || 0;
          if (code === 401 || code === 403) {
            resolve({
              status: code,
              json: { healthy: false },
              _bodyPreview: String(data).slice(0, 120)
            });
            return;
          }
          try {
            const parsed = JSON.parse(data || '{}');
            resolve({ status: code, json: parsed });
          } catch (e) {
            reject(
              new Error(`Invalid JSON response (${code}): ${String(data).slice(0, 200)}`)
            );
          }
        });
      }
    );
    req.on('error', reject);
    req.on('timeout', () => {
      try {
        req.destroy(new Error('timeout'));
      } catch {}
    });
    req.end();
  });
}

export class OpenCodeBackend {
  constructor(options = {}) {
    this.hostname = options.hostname || '127.0.0.1';
    this.port = Number(options.port) || 4096;
    this.rootDir = options.rootDir || process.cwd();
    this.proc = null;
    this.startedAt = null;
    this.lastHealth = null;
  }

  getAttachUrl() {
    return `http://${this.hostname}:${this.port}`;
  }

  async healthCheck() {
    const url = `${this.getAttachUrl()}/global/health`;
    try {
      const res = await httpGetJson(url);
      const unauthorized = res.status === 401 || res.status === 403;
      this.lastHealth = {
        ok: res.status >= 200 && res.status < 300 && !!res.json?.healthy,
        status: res.status,
        version: res.json?.version || null,
        checkedAt: new Date().toISOString(),
        ...(unauthorized && {
          error:
            'OpenCode 返回 401/403：已设置 OPENCODE_SERVER_PASSWORD 时请保证进程环境中有正确密码；' +
            '或临时取消该变量后重启 Dashboard / opencode serve。'
        })
      };
      return this.lastHealth;
    } catch (e) {
      const msg = e?.message || String(e);
      let hint = '';
      if (/ECONNREFUSED|connect ECONNREFUSED/i.test(msg)) {
        hint =
          ' 本机 ' +
          this.getAttachUrl() +
          ' 无服务监听。请用 curl 访问 /global/health（不是站点根路径 /）。' +
          ' 若手动运行 opencode serve，请加 --port ' +
          String(this.port) +
          ' 与 DevForge 一致。';
      } else if (/timeout/i.test(msg)) {
        hint = ' 连接超时：确认本机防火墙/代理未拦截 localhost，或 OpenCode 进程过载。';
      }
      this.lastHealth = {
        ok: false,
        status: 0,
        version: null,
        error: msg + hint,
        checkedAt: new Date().toISOString()
      };
      return this.lastHealth;
    }
  }

  isRunning() {
    return !!this.proc && this.proc.exitCode === null && !this.proc.killed;
  }

  async ensureStarted() {
    const h = await this.healthCheck();
    if (h.ok) return { started: false, attachUrl: this.getAttachUrl(), health: h };

    if (!this.isRunning()) {
      this.proc = spawn(
        'opencode',
        ['serve', '--port', String(this.port), '--hostname', this.hostname],
        {
          cwd: this.rootDir,
          env: { ...process.env },
          stdio: ['ignore', 'pipe', 'pipe']
        }
      );
      this.startedAt = new Date().toISOString();
      this.proc.stdout.on('data', (d) => {
        const s = d.toString();
        if (s.trim()) console.log(`[OpenCodeBackend] ${s.trim()}`);
      });
      this.proc.stderr.on('data', (d) => {
        const s = d.toString();
        if (s.trim()) console.warn(`[OpenCodeBackend] ${s.trim()}`);
      });
      this.proc.on('close', (code, signal) => {
        console.warn(`[OpenCodeBackend] exited code=${code} signal=${signal || 'none'}`);
      });
    }

    for (let i = 0; i < 30; i++) {
      const hh = await this.healthCheck();
      if (hh.ok) return { started: true, attachUrl: this.getAttachUrl(), health: hh };
      await sleep(200);
    }
    return { started: true, attachUrl: this.getAttachUrl(), health: this.lastHealth };
  }

  async shutdown() {
    if (!this.proc) return;
    try {
      this.proc.kill('SIGTERM');
    } catch {}
    this.proc = null;
  }
}
