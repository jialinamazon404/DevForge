"use strict";
import fs from 'fs/promises';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';

// StateManager moved to its own module for cleaner separation
// and easier testing. This is a faithful extraction of the former
// internal class from dashboard/server/server.js.

export class StateManager {
  constructor() {
    this.pipelines = new Map();
  }

  async load() {
    const STATE_DIR = path.join(process.cwd(), 'state');
    try {
      const data = await fs.readFile(path.join(STATE_DIR, 'pipelines.json'), 'utf-8');
      const parsed = JSON.parse(data);
      for (const [id, pipeline] of Object.entries(parsed)) {
        this.pipelines.set(id, pipeline);
      }
    } catch (e) {
      // file not found: start fresh
    }
  }

  async save() {
    // determine STATE_DIR from runtime: assume dashboard folder ctx
    const STATE_DIR = path.join(process.cwd(), 'state');
    const data = {};
    for (const [id, pipeline] of this.pipelines) {
      data[id] = pipeline;
    }
    await fs.writeFile(path.join(STATE_DIR, 'pipelines.json'), JSON.stringify(data, null, 2));
  }

  async create(request) {
    const STATE_DIR = path.join(process.cwd(), 'state');
    const ROUTES = {
      CRITICAL: ['product', 'architect', 'creative', 'developer', 'tester', 'evolver'],
      BUILD: ['product', 'architect', 'tech_coach', 'developer', 'tester', 'ops', 'evolver'],
      REVIEW: ['creative', 'ghost', 'tester'],
      QUERY: ['tech_coach'],
      SECURITY: ['ghost', 'architect']
    };
    const id = uuidv4();
    const route = ROUTES[request.category] || ROUTES.BUILD;
    const pipeline = {
      id,
      status: 'pending',
      currentStage: 'pending',
      category: request.category,
      priority: request.priority || 'MEDIUM',
      rawInput: request.rawInput,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      context: {
        request,
        workspacePath: `workspace/${id}`,
        openSpec: null,
        findings: [],
        artifacts: {},
        testReport: null
      },
      stages: route.map(role => ({
        role,
        status: 'pending',
        startedAt: null,
        completedAt: null,
        output: null,
        error: null
      })),
      logs: []
    };

    this.pipelines.set(id, pipeline);
    // create directories
    await fs.mkdir(path.join(STATE_DIR, 'pipelines'), { recursive: true });
    await fs.mkdir(path.join(STATE_DIR, id), { recursive: true });
    return pipeline;
  }

  async get(id) {
    return this.pipelines.get(id);
  }

  async getAll() {
    return Array.from(this.pipelines.values());
  }

  async update(id, updates) {
    const pipeline = this.pipelines.get(id);
    if (!pipeline) return null;
    Object.assign(pipeline, updates, { updatedAt: new Date().toISOString() });
    await this.save();
    return pipeline;
  }

  async updateStage(id, role, updates) {
    const pipeline = this.pipelines.get(id);
    if (!pipeline) return null;
    const stage = pipeline.stages.find(s => s.role === role);
    if (stage) Object.assign(stage, updates);
    await this.save();
    return pipeline;
  }

  async addLog(id, log) {
    const pipeline = this.pipelines.get(id);
    if (!pipeline) return;
    pipeline.logs.push({ timestamp: new Date().toISOString(), ...log });
    await this.save();
  }

  async delete(id) {
    this.pipelines.delete(id);
    await this.save();
  }

  async getNextStage(id) {
    const pipeline = this.pipelines.get(id);
    if (!pipeline) return null;
    const pendingStage = pipeline.stages.find(s => s.status === 'pending');
    return pendingStage?.role || null;
  }
}
