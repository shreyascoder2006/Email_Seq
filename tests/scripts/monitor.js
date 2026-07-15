#!/usr/bin/env node

/**
 * tests/scripts/monitor.js
 *
 * MONITORING UTILITIES
 *
 * Collects system metrics (Queue depth, worker throughput, RAM, CPU) and 
 * outputs them as JSON and CSV reports.
 *
 * Usage:
 *   node tests/scripts/monitor.js --duration=60 --interval=2
 */

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const os = require('os');

const BASE_URL = process.env.BASE_URL || 'http://localhost:5000';
const TOKEN = process.env.TOKEN || '';

const args = process.argv.slice(2);
let durationSecs = 60;
let intervalSecs = 2;

args.forEach(arg => {
  if (arg.startsWith('--duration=')) durationSecs = parseInt(arg.split('=')[1]);
  if (arg.startsWith('--interval=')) intervalSecs = parseInt(arg.split('=')[1]);
});

function request(path) {
  return new Promise((resolve) => {
    const url = new URL(BASE_URL + path);
    const lib = url.protocol === 'https:' ? https : http;
    const req = lib.request({
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: url.pathname,
      method: 'GET',
      headers: TOKEN ? { 'Authorization': `Bearer ${TOKEN}` } : {}
    }, (res) => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch { resolve({}); }
      });
    });
    req.on('error', () => resolve({}));
    req.end();
  });
}

const metrics = [];
let prevCompleted = null;

async function collect() {
  const timestamp = new Date().toISOString();
  
  const health = await request('/api/system/health');
  const depths = health.scheduler?.queueDepths || {};
  
  let throughput = 0;
  if (prevCompleted !== null && depths.completed !== undefined) {
    throughput = Math.max(0, (depths.completed - prevCompleted) / intervalSecs);
  }
  prevCompleted = depths.completed;

  const mem = process.memoryUsage();
  
  const snapshot = {
    timestamp,
    cpu_load_1m: os.loadavg()[0].toFixed(2),
    sys_mem_free_mb: (os.freemem() / 1024 / 1024).toFixed(0),
    node_heap_mb: (mem.heapUsed / 1024 / 1024).toFixed(0),
    queue_delayed: depths.delayed || 0,
    queue_active: depths.active || 0,
    queue_completed: depths.completed || 0,
    queue_failed: depths.failed || 0,
    throughput_eps: throughput.toFixed(1)
  };
  
  metrics.push(snapshot);
  console.log(`[${timestamp}] CPU:${snapshot.cpu_load_1m} Heap:${snapshot.node_heap_mb}MB Delayed:${snapshot.queue_delayed} Active:${snapshot.queue_active} Throughput:${snapshot.throughput_eps}e/s`);
}

async function run() {
  console.log(`Starting monitoring for ${durationSecs}s at ${intervalSecs}s intervals...`);
  
  const end = Date.now() + durationSecs * 1000;
  while (Date.now() < end) {
    await collect();
    await new Promise(r => setTimeout(r, intervalSecs * 1000));
  }
  
  const reportsDir = path.join(__dirname, '..', 'reports');
  if (!fs.existsSync(reportsDir)) fs.mkdirSync(reportsDir);
  
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  
  // Save JSON
  const jsonPath = path.join(reportsDir, `monitor_${ts}.json`);
  fs.writeFileSync(jsonPath, JSON.stringify(metrics, null, 2));
  
  // Save CSV
  const csvPath = path.join(reportsDir, `monitor_${ts}.csv`);
  const headers = Object.keys(metrics[0]).join(',');
  const rows = metrics.map(m => Object.values(m).join(','));
  fs.writeFileSync(csvPath, [headers, ...rows].join('\n'));
  
  console.log(`\nMonitoring complete. Reports saved to tests/reports/`);
}

run();
