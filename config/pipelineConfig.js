// Central pipeline configuration: routes and role names

export const ROUTES = {
  CRITICAL: ['product', 'architect', 'creative', 'developer', 'tester', 'evolver'],
  BUILD: ['product', 'architect', 'scout', 'developer', 'tester', 'ops', 'evolver'],
  REVIEW: ['creative', 'ghost', 'tester'],
  QUERY: ['scout'],
  SECURITY: ['ghost', 'architect']
};

export const ROLE_NAMES = {
  receptionist: '前台',
  gatekeeper: '守门人',
  product: '产品',
  architect: '架构师',
  scout: '侦察兵',
  developer: '开发',
  tester: '测试',
  ops: '运维',
  ghost: '幽灵',
  creative: '创意',
  evolver: '进化'
};
