// Central pipeline configuration: routes and role names

export const ROUTES = {
  CRITICAL: ['product', 'architect', 'creative', 'developer', 'tester', 'evolver'],
  BUILD: ['product', 'architect', 'tech_coach', 'developer', 'tester', 'ops', 'evolver'],
  REVIEW: ['creative', 'ghost', 'tester'],
  QUERY: ['tech_coach'],
  SECURITY: ['ghost', 'architect']
};

export const ROLE_NAMES = {
  gatekeeper: '守门人',
  product: '产品',
  architect: '架构师',
  tech_coach: '开发教练',
  developer: '开发',
  tester: '测试',
  ops: '运维',
  ghost: '幽灵',
  creative: '创意',
  evolver: '进化'
};

export const DEFAULT_ROLES = ['product', 'architect', 'tech_coach', 'developer', 'tester', 'ops', 'evolver'];
