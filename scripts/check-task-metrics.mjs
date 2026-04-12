#!/usr/bin/env node

import fs from 'fs/promises';
import path from 'path';

function parseTaskExecutionMetrics(outputText) {
  const text = String(outputText || '');
  if (!text) {
    return {
      total: 0,
      success: 0,
      warned: 0,
      failed: 0,
      highRisk: 0,
      noFileBlocks: 0,
      noFileBlocksNoChange: 0,
      consecutiveNoFileBlocks: 0,
      writeZero: 0,
      missingTests: 0,
      items: []
    };
  }

  const lines = text.split(/\r?\n/).filter(Boolean);
  const taskLines = lines.filter((line) => line.includes('[TASK_END]') || line.includes('[TASK_WARN]') || line.includes('[TASK_FAIL]'));
  const items = taskLines.map((line, index) => {
    const ok = line.includes('[TASK_END]');
    const warn = line.includes('[TASK_WARN]');
    const riskMatch = line.match(/risk=([^,\)\s]+)/i);
    const fileBlocksMatch = line.match(/fileBlocks=(\d+)/i);
    const writtenMatch = line.match(/written=(\d+)/i);
    const errorCodeMatch = line.match(/errorCode=([^,\)\s]+)/i);

    return {
      id: `${index}-${ok ? 'ok' : warn ? 'warn' : 'fail'}`,
      ok,
      warn,
      risk: (riskMatch?.[1] || 'unknown').toLowerCase(),
      fileBlocks: Number(fileBlocksMatch?.[1] || 0),
      written: Number(writtenMatch?.[1] || 0),
      errorCode: errorCodeMatch?.[1] || ''
    };
  });

  return {
    total: items.length,
    success: items.filter((i) => i.ok).length,
    warned: items.filter((i) => i.warn).length,
    failed: items.filter((i) => !i.ok && !i.warn).length,
    highRisk: items.filter((i) => i.risk === 'high' || i.risk === 'core').length,
    noFileBlocks: items.filter((i) => i.errorCode === 'NO_FILE_BLOCKS').length,
    noFileBlocksNoChange: items.filter((i) => i.errorCode === 'NO_FILE_BLOCKS_NO_CHANGE').length,
    consecutiveNoFileBlocks: items.filter((i) => i.errorCode === 'CONSECUTIVE_NO_FILE_BLOCKS').length,
    writeZero: items.filter((i) => i.errorCode === 'WRITE_ZERO').length,
    missingTests: items.filter((i) => i.errorCode === 'MISSING_TEST_FILE_BLOCKS').length,
    items
  };
}

async function readInput(inputArg) {
  if (!inputArg || inputArg === '-') {
    return await new Promise((resolve, reject) => {
      let data = '';
      process.stdin.setEncoding('utf8');
      process.stdin.on('data', (chunk) => {
        data += chunk;
      });
      process.stdin.on('end', () => resolve(data));
      process.stdin.on('error', reject);
    });
  }

  const full = path.resolve(inputArg);
  return fs.readFile(full, 'utf-8');
}

async function main() {
  const inputArg = process.argv[2];
  const text = await readInput(inputArg);
  const metrics = parseTaskExecutionMetrics(text);
  process.stdout.write(`${JSON.stringify(metrics, null, 2)}\n`);
}

main().catch((err) => {
  console.error('check-task-metrics failed:', err.message);
  process.exit(1);
});
