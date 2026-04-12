/**
 * ProcessPool - 按模型分类的进程池
 * 
 * 管理一组 Worker 进程，支持：
 * - 预热（启动时初始化空闲进程）
 * - 动态扩容（根据负载创建新进程）
 * - LRU 回收（超过任务数限制后平滑替换）
 */

import { Worker, WorkerStatus } from './worker.js';

export class ProcessPool {
  constructor(options = {}) {
    this.model = options.model;
    this.minSize = options.minSize || 2;
    this.maxSize = options.maxSize || 5;
    this.timeout = options.timeout || 300000;
    this.maxTasksPerWorker = options.maxTasksPerWorker || 50;
    this.rootDir = options.rootDir || process.cwd();

    this.workers = new Map();  // workerId -> Worker
    this.idleQueue = [];       // 空闲 Worker 队列
    this.busyWorkers = new Set(); // 正在执行任务的 Worker
    this.waitingTasks = [];    // 等待队列

    this.stats = {
      totalTasks: 0,
      completedTasks: 0,
      failedTasks: 0,
      totalTime: 0,
      avgTime: 0,
      workerErrorsByCode: {},
      spawnFailuresByCode: {},
      lastError: null
    };
  }

  /**
   * 初始化进程池（预热）
   */
  async initialize() {
    console.log(`[Pool:${this.model}] Initializing with ${this.minSize} workers...`);
    
    const promises = [];
    for (let i = 0; i < this.minSize; i++) {
      promises.push(this._spawnWorker());
    }

    await Promise.all(promises);
    console.log(`[Pool:${this.model}] Initialized with ${this.workers.size} workers`);
  }

  /**
   * 创建新 Worker
   */
  async _spawnWorker() {
    if (this.workers.size >= this.maxSize) {
      console.warn(`[Pool:${this.model}] Max size reached (${this.maxSize})`);
      return null;
    }

    const worker = new Worker({
      model: this.model,
      timeout: this.timeout,
      maxTasks: this.maxTasksPerWorker,
      rootDir: this.rootDir
    });

    worker.on('error', (err) => {
      const code = err?.errorCode || 'UNKNOWN_WORKER_ERROR';
      this.stats.workerErrorsByCode[code] = (this.stats.workerErrorsByCode[code] || 0) + 1;
      this.stats.lastError = {
        source: 'worker',
        code,
        message: err?.message || 'unknown worker error',
        at: new Date().toISOString()
      };
      console.error(`[Pool:${this.model}] Worker ${worker.id} error [${code}]:`, err.message);
      this._handleWorkerError(worker);
    });

    try {
      await worker.initialize();
      this.workers.set(worker.id, worker);
      this.idleQueue.push(worker);
      console.log(`[Pool:${this.model}] Worker ${worker.id} spawned (total: ${this.workers.size})`);
      return worker;
    } catch (error) {
      const code = error?.errorCode || 'SPAWN_FAILED';
      this.stats.spawnFailuresByCode[code] = (this.stats.spawnFailuresByCode[code] || 0) + 1;
      this.stats.lastError = {
        source: 'spawn',
        code,
        message: error?.message || 'spawn failed',
        at: new Date().toISOString()
      };
      console.error(`[Pool:${this.model}] Failed to spawn worker [${code}]:`, error.message);
      return null;
    }
  }

  /**
   * 获取空闲 Worker
   */
  async acquire() {
    // 优先使用空闲 Worker
    if (this.idleQueue.length > 0) {
      const worker = this.idleQueue.shift();
      this.busyWorkers.add(worker.id);
      return worker;
    }

    // 尝试创建新 Worker
    if (this.workers.size < this.maxSize) {
      const worker = await this._spawnWorker();
      if (worker) {
        this.busyWorkers.add(worker.id);
        return worker;
      }
    }

    // 加入等待队列
    return new Promise((resolve) => {
      this.waitingTasks.push(resolve);
    });
  }

  /**
   * 释放 Worker 回池
   */
  release(worker, error = null) {
    this.busyWorkers.delete(worker.id);

    if (error) {
      this.stats.failedTasks++;
      this._handleWorkerError(worker);
      return;
    }

    this.stats.completedTasks++;

    // 检查是否需要回收
    if (worker.shouldRecycle()) {
      console.log(`[Pool:${this.model}] Worker ${worker.id} reached max tasks, recycling...`);
      this._recycleWorker(worker);
      return;
    }

    // 放回空闲队列
    worker.status = WorkerStatus.IDLE;
    this.idleQueue.push(worker);

    // 唤醒等待的任务
    if (this.waitingTasks.length > 0) {
      const resolve = this.waitingTasks.shift();
      this.busyWorkers.add(worker.id);
      resolve(worker);
    }
  }

  /**
   * 处理 Worker 错误
   */
  _handleWorkerError(worker) {
    this.workers.delete(worker.id);
    this.idleQueue = this.idleQueue.filter(w => w.id !== worker.id);

    // 尝试创建新 Worker 补充
    if (this.workers.size < this.minSize) {
      this._spawnWorker();
    }
  }

  /**
   * 回收 Worker（平滑替换）
   */
  async _recycleWorker(worker) {
    // 创建新 Worker
    const newWorker = await this._spawnWorker();

    // 终止旧 Worker
    await worker.terminate();
    this.workers.delete(worker.id);

    // 新 Worker 加入空闲队列
    if (newWorker) {
      this.idleQueue.push(newWorker);
    }
  }

  /**
   * 执行任务
   */
  async execute(task) {
    const startTime = Date.now();
    this.stats.totalTasks++;

    const worker = await this.acquire();

    try {
      const result = await worker.execute(task);
      const duration = Date.now() - startTime;
      this.stats.totalTime += duration;
      this.stats.avgTime = this.stats.totalTime / this.stats.completedTasks;
      
      this.release(worker);
      return result;
    } catch (error) {
      this.release(worker, error);
      throw error;
    }
  }

  /**
   * 获取池状态
   */
  getStats() {
    return {
      model: this.model,
      totalWorkers: this.workers.size,
      idleWorkers: this.idleQueue.length,
      busyWorkers: this.busyWorkers.size,
      waitingTasks: this.waitingTasks.length,
      ...this.stats
    };
  }

  /**
   * 健康检查
   */
  async healthCheck() {
    const healthy = [];
    const unhealthy = [];

    for (const [id, worker] of this.workers) {
      if (worker.status === WorkerStatus.ERROR || worker.status === WorkerStatus.TERMINATED) {
        unhealthy.push({ id, status: worker.status });
      } else {
        healthy.push({ id, status: worker.status });
      }
    }

    return {
      healthy: healthy.length,
      unhealthy: unhealthy.length,
      total: this.workers.size,
      isHealthy: unhealthy.length === 0
    };
  }

  /**
   * 关闭进程池
   */
  async shutdown() {
    console.log(`[Pool:${this.model}] Shutting down...`);

    for (const worker of this.workers.values()) {
      await worker.terminate();
    }

    this.workers.clear();
    this.idleQueue = [];
    this.waitingTasks = [];

    console.log(`[Pool:${this.model}] Shutdown complete`);
  }
}
