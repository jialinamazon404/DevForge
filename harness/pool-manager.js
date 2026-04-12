/**
 * PoolManager - 进程池管理器
 * 
 * 管理多个模型的进程池，提供统一的接口
 */

import { ProcessPool } from './process-pool.js';

// 默认模型配置
const DEFAULT_POOL_CONFIG = {
  'opencode/qwen3.6-plus-free': { min: 2, max: 5, timeout: 600000 },
  'opencode/gpt-5-nano': { min: 2, max: 5, timeout: 300000 }
};

export class PoolManager {
  constructor(options = {}) {
    this.pools = new Map();
    this.config = options.config || DEFAULT_POOL_CONFIG;
    this.rootDir = options.rootDir || process.cwd();
  }

  /**
   * 初始化所有进程池
   */
  async initialize() {
    console.log('[PoolManager] Initializing pools...');

    for (const [model, poolConfig] of Object.entries(this.config)) {
      const pool = new ProcessPool({
        model,
        minSize: poolConfig.min,
        maxSize: poolConfig.max,
        timeout: poolConfig.timeout,
        rootDir: this.rootDir
      });

      await pool.initialize();
      this.pools.set(model, pool);
    }

    console.log(`[PoolManager] Initialized ${this.pools.size} pools`);
  }

  /**
   * 获取指定模型的进程池
   */
  getPool(model) {
    return this.pools.get(model);
  }

  /**
   * 获取或创建进程池
   */
  async getOrCreatePool(model) {
    let pool = this.pools.get(model);
    
    if (!pool) {
      // 使用默认配置创建新池
      const config = this.config[model] || { min: 1, max: 3, timeout: 300000 };
      pool = new ProcessPool({
        model,
        ...config,
        rootDir: this.rootDir
      });
      await pool.initialize();
      this.pools.set(model, pool);
    }

    return pool;
  }

  /**
   * 执行任务（自动选择合适的池）
   */
  async execute(task) {
    const model = task.model || 'opencode/gpt-5-nano';
    const pool = await this.getOrCreatePool(model);
    return pool.execute(task);
  }

  /**
   * 获取所有池的状态
   */
  getAllStats() {
    const stats = {};
    
    for (const [model, pool] of this.pools) {
      stats[model] = pool.getStats();
    }

    return stats;
  }

  /**
   * 健康检查
   */
  async healthCheck() {
    const results = {};

    for (const [model, pool] of this.pools) {
      results[model] = await pool.healthCheck();
    }

    const allHealthy = Object.values(results).every(r => r.isHealthy);

    return {
      isHealthy: allHealthy,
      pools: results
    };
  }

  /**
   * 关闭所有池
   */
  async shutdown() {
    console.log('[PoolManager] Shutting down all pools...');

    for (const pool of this.pools.values()) {
      await pool.shutdown();
    }

    this.pools.clear();
    console.log('[PoolManager] All pools shutdown');
  }
}
