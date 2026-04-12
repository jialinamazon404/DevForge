/**
 * HarnessManager - Harness 总管理器
 * 
 * 整合所有组件，提供统一的对外接口
 */

import { PoolManager } from './pool-manager.js';
import { TaskScheduler } from './task-scheduler.js';
import { CacheStrategy, SKILL_PATHS } from './cache-strategy.js';
import { ContentExtractor } from './content-extractor.js';
import { OpenCodeBackend } from './opencode-backend.js';
import crypto from 'crypto';

/**
 * 与 dashboard/server 的 parseBoolEnv 语义一致：未设置时默认 true（不拉起 opencode serve）。
 * 需要 attach 时设置 DEVFORGE_DISABLE_OPENCODE_ATTACH=0 或 false。
 */
function opencodeAttachDisabled() {
  const raw = process.env.DEVFORGE_DISABLE_OPENCODE_ATTACH;
  if (raw === undefined || raw === null || raw === '') return true;
  const v = String(raw).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(v)) return true;
  if (['0', 'false', 'no', 'off'].includes(v)) return false;
  return true;
}

export class HarnessManager {
  constructor(options = {}) {
    this.rootDir = options.rootDir || process.cwd();
    this.mode = options.mode || process.env.DEVFORGE_HARNESS_MODE || 'attach';

    this.opencodeBackend = new OpenCodeBackend({
      rootDir: this.rootDir,
      hostname: process.env.DEVFORGE_OPENCODE_SERVE_HOST || '127.0.0.1',
      port: process.env.DEVFORGE_OPENCODE_SERVE_PORT || 4096
    });

    // pool 模式才需要初始化/持有进程池与调度器；attach 模式只负责 opencode serve 管理 + 观测
    this.poolManager =
      this.mode === 'pool'
        ? new PoolManager({
            rootDir: this.rootDir,
            config: options.poolConfig
          })
        : null;

    this.scheduler =
      this.mode === 'pool'
        ? new TaskScheduler(this.poolManager, {
            maxConcurrent: options.maxConcurrent || 3
          })
        : null;
    
    this.cache = new CacheStrategy({
      skillPaths: options.skillPaths || SKILL_PATHS
    });
    
    this.extractor = new ContentExtractor(this.cache);
    
    this.stats = {
      tasks: 0,
      errors: 0,
      totalTime: 0
    };

    this._initialized = false;
  }

  /**
   * 初始化 Harness
   */
  async initialize() {
    if (this._initialized) return this;

    console.log('[HarnessManager] Initializing...');

    // 默认 attach 模式：不初始化进程池（当前 pool/worker 基于 `opencode run` 的 stdin JSON 协议不成立）
    if (this.mode === 'pool') {
      await this.poolManager?.initialize();
    }

    // 预加载常用 Skills
    await this.preloadSkills();

    // 启动/探活 opencode serve（供 run --attach 复用后端）；禁用 attach 时不占用 4096、不 spawn
    if (opencodeAttachDisabled()) {
      console.log(
        '[HarnessManager] DEVFORGE_DISABLE_OPENCODE_ATTACH: 跳过 opencode serve（sprint-agent-executor 将使用纯 opencode run）'
      );
    } else {
      await this.opencodeBackend.ensureStarted();
    }

    this._initialized = true;
    console.log('[HarnessManager] Initialized');

    return this;
  }

  /**
   * 预加载常用 Skills
   */
  async preloadSkills() {
    const commonSkills = [
      'brainstorming',
      'api-design',
      'system-design',
      'database-design',
      'test-driven-development'
    ];

    console.log('[HarnessManager] Preloading skills...');

    let loaded = 0;
    for (const skill of commonSkills) {
      const content = await this.cache.getSkill(skill);
      if (content) loaded++;
    }

    console.log(
      `[HarnessManager] Skill cache: ${loaded}/${commonSkills.length} loaded (missing paths are OK; opencode may load skills elsewhere)`
    );
  }

  /**
   * 执行角色任务
   */
  async executeRole(role, context) {
    if (this.mode !== 'pool') {
      throw new Error('Harness is in attach mode; executeRole is disabled (use Sprint executor with opencode run --attach).');
    }
    const startTime = Date.now();

    try {
      // 1. 获取 Skill
      const skill = await this.cache.getSkill(role);

      // 2. 提取依赖内容（按需）
      const extracted = await this.extractor.extract(role, {
        workspace: context.workspace,
        sprintId: context.sprintId
      });

      // 3. 构建任务
      const task = {
        id: this.generateTaskId(),
        role,
        model: context.model,
        sprintId: context.sprintId,
        workspace: context.workspace,
        prompt: this.buildPrompt(role, context, extracted),
        skill,
        context: {
          rawInput: context.rawInput,
          extracted
        }
      };

      // 4. 调度执行
      const result = await this.scheduler.schedule(task);

      // 5. 缓存输出
      await this.cache.setRoleOutput(context.sprintId, role, result);

      // 6. 记录统计
      this.stats.tasks++;
      this.stats.totalTime += Date.now() - startTime;

      return result;
    } catch (error) {
      this.stats.errors++;
      throw error;
    }
  }

  /**
   * 执行角色任务（直接传入 prompt）
   */
  async executePrompt(role, prompt, options = {}) {
    if (this.mode !== 'pool') {
      throw new Error('Harness is in attach mode; executePrompt is disabled.');
    }
    const startTime = Date.now();

    try {
      const skill = await this.cache.getSkill(role);

      const task = {
        id: this.generateTaskId(),
        role,
        model: options.model,
        prompt,
        skill,
        context: options.context
      };

      const result = await this.poolManager.execute(task);

      this.stats.tasks++;
      this.stats.totalTime += Date.now() - startTime;

      return result;
    } catch (error) {
      this.stats.errors++;
      throw error;
    }
  }

  /**
   * 构建 Prompt
   */
  buildPrompt(role, context, extracted) {
    let prompt = context.prompt || '';

    // 注入提炼后的依赖内容
    if (extracted) {
      const contextSnippet = this.extractor.formatForPrompt(extracted);
      if (contextSnippet) {
        prompt = prompt + contextSnippet;
      }
    }

    return prompt;
  }

  /**
   * 生成任务 ID
   */
  generateTaskId() {
    return `h-${crypto.randomBytes(4).toString('hex')}`;
  }

  /**
   * 获取统计信息
   */
  getStats() {
    return {
      ...this.stats,
      avgTime: this.stats.tasks > 0 
        ? Math.round(this.stats.totalTime / this.stats.tasks) 
        : 0,
      pools: this.mode === 'pool' ? this.poolManager?.getAllStats?.() || {} : {},
      cache: this.cache.getStats(),
      scheduler: this.mode === 'pool' ? this.scheduler?.getStats?.() || {} : {},
      opencode: {
        mode: this.mode,
        attachUrl: this.opencodeBackend.getAttachUrl(),
        running: this.opencodeBackend.isRunning(),
        lastHealth: this.opencodeBackend.lastHealth
      }
    };
  }

  /**
   * 健康检查
   */
  async healthCheck() {
    const poolHealth = this.mode === 'pool' ? await this.poolManager?.healthCheck?.() : null;
    const opencode = await this.opencodeBackend.healthCheck();
    
    return {
      initialized: this._initialized,
      poolHealth,
      cacheHitRate: this.cache.getHitRate(),
      opencode
    };
  }

  /**
   * 清理 sprint 数据
   */
  clearSprint(sprintId) {
    if (this.mode === 'pool') {
      this.scheduler?.clearSprint?.(sprintId);
    }
  }

  /**
   * 关闭 Harness
   */
  async shutdown() {
    console.log('[HarnessManager] Shutting down...');
    if (this.mode === 'pool') {
      await this.poolManager?.shutdown?.();
    }
    await this.opencodeBackend.shutdown();
    this.cache.clear();
    console.log('[HarnessManager] Shutdown complete');
  }
}

/**
 * 创建 Harness 实例（便捷函数）
 */
export async function createHarness(options = {}) {
  const harness = new HarnessManager(options);
  await harness.initialize();
  return harness;
}
