/**
 * Skill 文件路径（可移植，不写死用户名）
 *
 * 环境变量（可选）：
 * - DEVFORGE_SUPERPOWERS_SKILLS — superpowers 包内 skills 根目录（未设置时自动探测 opencode 缓存或 Claude 插件缓存）
 * - DEVFORGE_AGENTS_SKILLS — ~/.agents/skills 替代根
 * - DEVFORGE_GSTACK_SKILLS — gstack 等技能根目录
 * - DEVFORGE_REPO_SKILLS — 仓库内技能副本根（默认 <repo>/skills/vendor）
 */
import fs from 'fs/promises';
import fsSync from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, '..');

const HOME = os.homedir();

/**
 * 默认曾指向 ~/.cache/opencode/.../superpowers/skills，多数环境未安装该路径。
 * 自动探测本机 Claude Code 插件缓存中的 superpowers（版本号取目录名降序第一个可用的）。
 */
function pickSuperpowersSkillsRoot() {
  if (process.env.DEVFORGE_SUPERPOWERS_SKILLS) {
    return process.env.DEVFORGE_SUPERPOWERS_SKILLS;
  }
  const opencode = path.join(HOME, '.cache/opencode/node_modules/superpowers/skills');
  const hasBrainstorming = (root) => {
    try {
      return fsSync.existsSync(path.join(root, 'brainstorming', 'SKILL.md'));
    } catch {
      return false;
    }
  };
  if (hasBrainstorming(opencode)) return opencode;

  const pluginBase = path.join(
    HOME,
    '.claude/plugins/cache/claude-plugins-official/superpowers'
  );
  try {
    const versions = fsSync
      .readdirSync(pluginBase, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
    for (const ver of versions) {
      const root = path.join(pluginBase, ver, 'skills');
      if (hasBrainstorming(root)) return root;
    }
  } catch (_e) {
    /* no plugin cache */
  }

  return opencode;
}

export const SKILL_ROOTS = {
  superpowers: pickSuperpowersSkillsRoot(),
  agents: process.env.DEVFORGE_AGENTS_SKILLS || path.join(HOME, '.agents/skills'),
  gstack: process.env.DEVFORGE_GSTACK_SKILLS || path.join(HOME, '.claude/skills/gstack'),
  vendor: process.env.DEVFORGE_REPO_SKILLS || path.join(REPO_ROOT, 'skills/vendor')
};

const sp = (rel) => path.join(SKILL_ROOTS.superpowers, rel);
const ag = (rel) => path.join(SKILL_ROOTS.agents, rel);
const gs = (rel) => path.join(SKILL_ROOTS.gstack, rel);
const vd = (rel) => path.join(SKILL_ROOTS.vendor, rel);

/**
 * 逻辑名 → 映射表中的键（磁盘上目录名常与逻辑名不一致）
 * 例如 ui-ux-designer 实际使用 tailwind-design-system 的 SKILL.md
 */
export const SKILL_ALIASES = {
  'ui-ux-designer': 'tailwind-design-system',
  /** 与 cso 同源，便于与界面 REVIEW/SECURITY 标签对齐 */
  'gstack-cso': 'cso'
};

/** 与 sprint-agent-executor / harness 使用的 skill 名一致 */
export const SKILL_PATHS = {
  brainstorming: sp('brainstorming/SKILL.md'),
  'plan-eng-review': gs('plan-eng-review/SKILL.md'),
  'office-hours': gs('office-hours/SKILL.md'),
  qa: gs('qa/SKILL.md'),
  'test-driven-development': sp('test-driven-development/SKILL.md'),
  ship: gs('ship/SKILL.md'),
  /** SprintDetail「测试」等节点展示的 gstack 总览（gstack 包根 SKILL.md） */
  gstack: gs('SKILL.md'),
  cso: gs('cso/SKILL.md'),
  'design-review': gs('design-review/SKILL.md'),
  retro: gs('retro/SKILL.md'),
  'user-story': ag('user-story/SKILL.md'),
  'product-spec-kit': ag('product-spec-kit/SKILL.md'),
  'tailwind-design-system': ag('tailwind-design-system/SKILL.md'),
  'user-journeys': ag('user-journeys/SKILL.md'),
  'system-design': ag('system-design/SKILL.md'),
  'database-design': ag('database-design/SKILL.md'),
  'api-design': ag('api-design-principles/SKILL.md'),
  'event-driven': ag('event-driven-architect/SKILL.md'),
  'systematic-debugging': ag('systematic-debugging/SKILL.md'),
  'unit-test-generator': ag('unit-test-generator/SKILL.md'),
  'log-analyzer': ag('ln-514-test-log-analyzer/SKILL.md'),
  'docker-helper': ag('docker-helper/SKILL.md'),
  'azure-deploy': ag('azure-deploy/SKILL.md'),
  /** product 步骤 4 / 界面「界面与交互」：与 tailwind 设计系统同源 */
  'ui-ux-designer': ag('tailwind-design-system/SKILL.md'),
  /** 性能与 SprintDetail「测试」节点展示 */
  benchmark: gs('benchmark/SKILL.md'),
  /** 迭代优化、演进场景 */
  'tech-debt': ag('tech-debt/SKILL.md'),
  'architecture-review': ag('architecture-review/SKILL.md')
};

/** 仓库内回退：<repo>/skills/vendor/<skillName>/SKILL.md */
export function getSkillVendorFallbackPath(skillName) {
  return vd(path.join(skillName, 'SKILL.md'));
}

function resolvePrimaryPath(rawName, pathMap) {
  const raw = String(rawName ?? '').trim();
  if (!raw) return null;
  if (pathMap[raw]) return { primary: pathMap[raw], canonical: raw };
  const altKey = SKILL_ALIASES[raw];
  if (altKey && pathMap[altKey]) return { primary: pathMap[altKey], canonical: altKey };
  return null;
}

/**
 * 先读主路径，不存在则读仓库 vendor 副本（含别名目录各试一次）。
 * @param {Record<string, string>} [pathMap] 默认使用 SKILL_PATHS（Harness 可传入自定义映射）
 */
export async function readSkillWithFallback(skillName, pathMap = SKILL_PATHS) {
  const raw = String(skillName ?? '').trim();
  if (!raw) {
    return { error: 'unconfigured', skillName: raw };
  }

  const resolved = resolvePrimaryPath(raw, pathMap);
  if (!resolved) {
    return { error: 'unconfigured', skillName: raw };
  }

  const { primary, canonical } = resolved;

  const vendorTry = [getSkillVendorFallbackPath(raw)];
  if (canonical !== raw) vendorTry.push(getSkillVendorFallbackPath(canonical));

  const seen = new Set();
  const vendorPaths = vendorTry.filter((p) => {
    if (seen.has(p)) return false;
    seen.add(p);
    return true;
  });

  try {
    const content = await fs.readFile(primary, 'utf-8');
    return { content, path: primary, usedFallback: false };
  } catch {
    /* try vendor */
  }

  for (const p of vendorPaths) {
    try {
      const content = await fs.readFile(p, 'utf-8');
      return { content, path: p, usedFallback: true };
    } catch {
      /* next */
    }
  }

  return {
    error: 'missing',
    skillName: raw,
    primary,
    fallback: vendorPaths[0] || getSkillVendorFallbackPath(raw)
  };
}
