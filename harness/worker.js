/**
 * Worker - 单个进程封装
 * 
 * 管理 OpenCode CLI 进程的启动、执行、生命周期
 */

import { spawn } from 'child_process';
import fs from 'fs/promises';
import crypto from 'crypto';

/**
 * Worker 状态
 */
export const WorkerStatus = {
  INITIALIZING: 'initializing',
  IDLE: 'idle',
  BUSY: 'busy',
  ERROR: 'error',
  TERMINATED: 'terminated'
};

/**
 * 生成 Worker ID
 */
function generateWorkerId() {
  return `w-${crypto.randomBytes(4).toString('hex')}`;
}

export class Worker {
  constructor(options = {}) {
    this.id = options.id || generateWorkerId();
    this.model = options.model;
    this.timeout = options.timeout || 300000; // 5分钟默认
    this.rootDir = options.rootDir || process.cwd();
    
    this.status = WorkerStatus.INITIALIZING;
    this.taskCount = 0;
    this.maxTasks = options.maxTasks || 50; // 最多处理 50 个任务后重启
    
    this.process = null;
    this.pendingResolve = null;
    this.pendingReject = null;
    this.outputBuffer = [];
    
    this.eventHandlers = {
      output: [],
      error: [],
      ready: []
    };

    // 内部状态
    this._initialized = false;
    this._closed = false;
    this._timeoutId = null;
    this._initFailureCode = null;
  }

  /**
   * 初始化 Worker（启动进程并等待就绪）
   */
  async initialize() {
    if (this._initialized) return this;

    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        const err = new Error(`Worker ${this.id} initialization timeout`);
        err.errorCode = 'INIT_TIMEOUT';
        this._initFailureCode = 'INIT_TIMEOUT';
        reject(err);
      }, 30000);

      this.once('ready', () => {
        clearTimeout(timeoutId);
        this._initialized = true;
        resolve(this);
      });

      this.once('error', (err) => {
        clearTimeout(timeoutId);
        reject(err);
      });

      this._startProcess();
    });
  }

  /**
   * 启动进程
   */
  _startProcess() {
    this.process = spawn('opencode', ['run', '--format', 'json', '--model', this.model], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env },
      cwd: this.rootDir
    });

    this.process.stdout.on('data', (data) => this._handleData(data));
    this.process.stderr.on('data', (data) => this._handleStderr(data));
    
    this.process.on('error', (err) => {
      this.status = WorkerStatus.ERROR;
      err.errorCode = err.errorCode || 'SPAWN_ERROR';
      this._initFailureCode = this._initFailureCode || err.errorCode;
      this.emit('error', err);
    });

    this.process.on('close', (code, signal) => {
      if (!this._closed) {
        this.status = WorkerStatus.ERROR;
        const err = this._buildExitError(code, signal);
        this._initFailureCode = this._initFailureCode || err.errorCode;
        this.emit('error', err);
      }
    });

    this.status = WorkerStatus.INITIALIZING;
  }

  /**
   * 处理 stdout 数据
   */
  _handleData(data) {
    const text = data.toString();
    this.outputBuffer.push(text);

    // 检测就绪信号
    if (!this._initialized && /\bready\b/i.test(text)) {
      this._markReady('ready_keyword');
    }

    // 解析 JSON 响应
    const lines = text.split('\n').filter(l => l.trim());
    for (const line of lines) {
      try {
        const event = JSON.parse(line);
        if (!this._initialized) {
          this._markReady('json_event');
        }
        this._handleEvent(event);
      } catch {
        // 非 JSON，当作流式输出
        this.emit('output', text);
      }
    }
  }

  /**
   * 处理 stderr 数据
   */
  _handleStderr(data) {
    const text = data.toString();
    console.warn(`[Worker ${this.id}] stderr: ${text}`);
    if (!this._initialized && /\bready\b/i.test(text)) {
      this._markReady('stderr_ready_keyword');
    }
  }

  _buildExitError(code, signal) {
    const isNullCode = code === null || code === undefined;
    const errorCode = isNullCode ? 'WORKER_EXIT_NULL' : 'WORKER_EXIT_CODE';
    const err = new Error(
      `Worker ${this.id} exited unexpectedly (code=${String(code)}, signal=${String(signal || 'none')})`
    );
    err.errorCode = errorCode;
    err.exitCode = code;
    err.signal = signal || null;
    return err;
  }

  _markReady(source) {
    if (this._initialized || this._closed) return;
    this.status = WorkerStatus.IDLE;
    this.emit('ready', { source });
  }

  /**
   * 处理事件
   */
  _handleEvent(event) {
    if (event.type === 'output' || event.part?.text) {
      const content = event.part?.text || event.content || '';
      this.emit('output', content);
    }

    if (event.type === 'done' || event.done) {
      this._complete(null, event);
    }

    if (event.type === 'error' || event.error) {
      this._complete(new Error(event.error), null);
    }
  }

  /**
   * 完成当前任务
   */
  _complete(error, result) {
    if (this._timeoutId) {
      clearTimeout(this._timeoutId);
      this._timeoutId = null;
    }

    if (error) {
      this.pendingReject?.(error);
    } else {
      this.pendingResolve?.({
        output: this.outputBuffer.join(''),
        result,
        workerId: this.id
      });
    }

    this.pendingResolve = null;
    this.pendingReject = null;
    this.outputBuffer = [];
    this.status = WorkerStatus.IDLE;
  }

  /**
   * 执行任务
   */
  async execute(task) {
    if (this.status !== WorkerStatus.IDLE) {
      throw new Error(`Worker ${this.id} is not idle (status: ${this.status})`);
    }

    this.status = WorkerStatus.BUSY;
    this.taskCount++;

    return new Promise((resolve, reject) => {
      this.pendingResolve = resolve;
      this.pendingReject = reject;
      this.outputBuffer = [];

      // 发送任务到 stdin
      const taskData = {
        type: 'execute',
        id: task.id,
        prompt: task.prompt,
        skill: task.skill,
        context: task.context
      };

      this.process.stdin.write(JSON.stringify(taskData) + '\n');

      // 设置超时
      this._timeoutId = setTimeout(() => {
        this._complete(new Error(`Task ${task.id} timeout after ${this.timeout}ms`), null);
      }, this.timeout);
    });
  }

  /**
   * 检查是否需要回收
   */
  shouldRecycle() {
    return this.taskCount >= this.maxTasks;
  }

  /**
   * 终止 Worker
   */
  async terminate() {
    this._closed = true;
    
    if (this._timeoutId) {
      clearTimeout(this._timeoutId);
    }

    if (this.process) {
      this.process.stdin.end();
      this.process.kill('SIGTERM');
      
      // 等待进程结束
      await new Promise(resolve => {
        this.process.once('close', resolve);
        setTimeout(resolve, 1000); // 超时 1 秒
      });
    }

    this.status = WorkerStatus.TERMINATED;
  }

  /**
   * 重启 Worker
   */
  async restart() {
    await this.terminate();
    this.taskCount = 0;
    this._initialized = false;
    this._closed = false;
    this.status = WorkerStatus.INITIALIZING;
    return this.initialize();
  }

  /**
   * 事件处理
   */
  on(event, handler) {
    if (this.eventHandlers[event]) {
      this.eventHandlers[event].push(handler);
    }
    return this;
  }

  once(event, handler) {
    const wrapped = (...args) => {
      this.off(event, wrapped);
      handler(...args);
    };
    return this.on(event, wrapped);
  }

  off(event, handler) {
    if (this.eventHandlers[event]) {
      this.eventHandlers[event] = this.eventHandlers[event].filter(h => h !== handler);
    }
    return this;
  }

  emit(event, ...args) {
    if (this.eventHandlers[event]) {
      for (const handler of this.eventHandlers[event]) {
        try {
          handler(...args);
        } catch (error) {
          console.error(`[Worker ${this.id}] Event handler error:`, error);
        }
      }
    }
  }

  /**
   * 获取状态摘要
   */
  getStatus() {
    return {
      id: this.id,
      model: this.model,
      status: this.status,
      taskCount: this.taskCount,
      maxTasks: this.maxTasks,
      shouldRecycle: this.shouldRecycle()
    };
  }
}
