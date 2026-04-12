/**
 * 分层缓存策略
 * 
 * L1: Skill Cache - 全局共享，静态内容（可缓存）
 * L2: Template Cache - 全局共享，静态内容（可缓存）
 * L3: Role Output Cache - 按角色缓存产出
 * L4: Extracted Content Cache - 提炼后的内容
 */

import crypto from 'crypto';
import {
  SKILL_PATHS as DEFAULT_SKILL_PATHS,
  readSkillWithFallback
} from '../config/skillPaths.js';

// 缓存大小限制
const CACHE_LIMITS = {
  L1_SKILL_MAX: 5 * 1024 * 1024,     // 5MB - Skill 缓存
  L2_TEMPLATE_MAX: 2 * 1024 * 1024,  // 2MB - Template 缓存
  L3_OUTPUT_MAX: 50 * 1024 * 1024,    // 50MB - 输出缓存
  L4_EXTRACTED_MAX: 10 * 1024 * 1024, // 10MB - 提炼内容缓存
  SINGLE_SKILL_MAX: 100 * 1024,       // 100KB - 单个 Skill 最大
  SINGLE_EXTRACTED_MAX: 50 * 1024      // 50KB - 单次提炼内容最大
};

export class CacheStrategy {
  constructor(options = {}) {
    this.layers = {
      L1: new Map(),  // Skill 缓存
      L2: new Map(),  // Template 缓存
      L3: new Map(),  // 角色输出缓存
      L4: new Map()   // 提炼内容缓存
    };

    this.stats = {
      hits: 0,
      misses: 0,
      size: 0
    };

    this.skillPaths = options.skillPaths || DEFAULT_SKILL_PATHS;
  }

  // ===== L1: Skill 缓存（可全局共享）=====

  async getSkill(skillName) {
    const cached = this.layers.L1.get(skillName);
    if (cached) {
      this.stats.hits++;
      return cached.content;
    }

    const result = await readSkillWithFallback(skillName, this.skillPaths);
    if ('error' in result) {
      if (result.error === 'missing') {
        console.warn(
          `[Cache] Skill not found (set DEVFORGE_SUPERPOWERS_SKILLS or copy to ${result.fallback}): ${result.primary}`
        );
      }
      return null;
    }

    const content = result.content;

    // 跳过过大的 Skill
    if (content.length > CACHE_LIMITS.SINGLE_SKILL_MAX) {
      console.warn(`[Cache] Skill ${skillName} too large (${(content.length / 1024).toFixed(1)}KB), skipping cache`);
      return content;
    }

    this.layers.L1.set(skillName, {
      content,
      size: content.length,
      loadedAt: Date.now()
    });

    this.stats.misses++;
    return content;
  }

  hasSkill(skillName) {
    return this.layers.L1.has(skillName);
  }

  // ===== L2: Template 缓存 =====

  setTemplate(templateName, template) {
    const size = Buffer.byteLength(template, 'utf-8');
    
    // LRU 淘汰
    while (this.getLayerSize('L2') + size > CACHE_LIMITS.L2_TEMPLATE_MAX) {
      this.evictLRU('L2');
    }

    this.layers.L2.set(templateName, {
      content: template,
      size,
      loadedAt: Date.now()
    });
  }

  getTemplate(templateName) {
    const cached = this.layers.L2.get(templateName);
    if (cached) {
      this.stats.hits++;
      return cached.content;
    }
    this.stats.misses++;
    return null;
  }

  // ===== L3: 角色输出缓存（按 sprint/role）=====

  async getRoleOutput(sprintId, role) {
    const key = `${sprintId}/${role}`;
    const cached = this.layers.L3.get(key);
    
    if (cached) {
      this.stats.hits++;
      return cached;
    }

    this.stats.misses++;
    return null;
  }

  async setRoleOutput(sprintId, role, output) {
    const key = `${sprintId}/${role}`;
    const size = typeof output === 'string' 
      ? Buffer.byteLength(output, 'utf-8')
      : Buffer.byteLength(JSON.stringify(output), 'utf-8');

    // 大小限制
    if (size > CACHE_LIMITS.SINGLE_SKILL_MAX * 10) {
      console.warn(`[Cache] Role output too large (${(size / 1024).toFixed(1)}KB), not caching`);
      return;
    }

    // LRU 淘汰
    while (this.getLayerSize('L3') + size > CACHE_LIMITS.L3_OUTPUT_MAX) {
      this.evictLRU('L3');
    }

    this.layers.L3.set(key, {
      output,
      size,
      timestamp: Date.now()
    });
  }

  // ===== L4: 提炼内容缓存 =====

  async getExtracted(sourceRole, targetRole, sourceFile) {
    const key = this.makeExtractedKey(sourceRole, targetRole, sourceFile);
    const cached = this.layers.L4.get(key);
    
    if (cached) {
      this.stats.hits++;
      return cached.content;
    }

    this.stats.misses++;
    return null;
  }

  async setExtracted(sourceRole, targetRole, sourceFile, content) {
    const key = this.makeExtractedKey(sourceRole, targetRole, sourceFile);
    const size = Buffer.byteLength(JSON.stringify(content), 'utf-8');

    // 大小限制
    if (size > CACHE_LIMITS.SINGLE_EXTRACTED_MAX) {
      console.warn(`[Cache] Extracted content too large, not caching`);
      return;
    }

    // LRU 淘汰
    while (this.getLayerSize('L4') + size > CACHE_LIMITS.L4_EXTRACTED_MAX) {
      this.evictLRU('L4');
    }

    this.layers.L4.set(key, {
      content,
      size,
      timestamp: Date.now()
    });
  }

  makeExtractedKey(sourceRole, targetRole, sourceFile) {
    return `${sourceRole}:${targetRole}:${sourceFile}`;
  }

  // ===== 工具方法 =====

  getLayerSize(layer) {
    let size = 0;
    for (const entry of this.layers[layer].values()) {
      size += entry.size || 0;
    }
    return size;
  }

  evictLRU(layer) {
    let oldest = null;
    let oldestKey = null;

    for (const [key, entry] of this.layers[layer]) {
      if (!oldest || entry.loadedAt < oldest.loadedAt) {
        oldest = entry;
        oldestKey = key;
      }
    }

    if (oldestKey) {
      this.layers[layer].delete(oldestKey);
      this.stats.size -= oldest.size;
    }
  }

  getHitRate() {
    const total = this.stats.hits + this.stats.misses;
    return total > 0 ? (this.stats.hits / total * 100).toFixed(1) + '%' : '0%';
  }

  getStats() {
    return {
      ...this.stats,
      hitRate: this.getHitRate(),
      layers: {
        L1: { entries: this.layers.L1.size, size: this.getLayerSize('L1') },
        L2: { entries: this.layers.L2.size, size: this.getLayerSize('L2') },
        L3: { entries: this.layers.L3.size, size: this.getLayerSize('L3') },
        L4: { entries: this.layers.L4.size, size: this.getLayerSize('L4') }
      }
    };
  }

  clear() {
    for (const layer of Object.keys(this.layers)) {
      this.layers[layer].clear();
    }
    this.stats = { hits: 0, misses: 0, size: 0 };
  }

  clearLayer(layer) {
    if (this.layers[layer]) {
      this.layers[layer].clear();
    }
  }
}

// Skill 到文件路径的映射（供外部使用）
export { DEFAULT_SKILL_PATHS as SKILL_PATHS };

// 缓存限制常量
export { CACHE_LIMITS };
