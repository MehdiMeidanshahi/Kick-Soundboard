const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');

let customLogDir = null;

function setLogDirectory(dir) {
  customLogDir = dir;
}

function getLogDirectory() {
  if (customLogDir) return customLogDir;
  try {
    const { app } = require('electron');
    if (app?.getPath) {
      return path.join(app.getPath('userData'), 'logs');
    }
  } catch {
    // Electron not available or in non-electron context
  }
  return path.join(process.cwd(), 'logs');
}

function getLogPath() {
  return path.join(getLogDirectory(), 'error.log');
}

function ensureLogDirectory() {
  const dir = getLogDirectory();
  try {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  } catch (err) {
    console.error('Failed to create log directory:', err);
  }
}

function formatErrorEntry(context, error, metadata = {}) {
  const now = new Date();
  const isoTime = now.toISOString();
  const localTime = now.toLocaleString();
  const errorObj = error instanceof Error ? error : new Error(String(error ?? 'Unknown error'));

  const memory = process.memoryUsage ? process.memoryUsage() : null;
  const memoryInfo = memory
    ? `RSS ${(memory.rss / (1024 * 1024)).toFixed(1)} MB, Heap ${(memory.heapUsed / (1024 * 1024)).toFixed(1)} / ${(memory.heapTotal / (1024 * 1024)).toFixed(1)} MB`
    : 'N/A';

  const lines = [
    '================================================================================',
    `TIMESTAMP: ${isoTime} (Local: ${localTime})`,
    `SEVERITY:  ERROR`,
    `CONTEXT:   ${context || 'Application Error'}`,
    `MESSAGE:   ${errorObj.message}`,
    `ERROR TYPE: ${errorObj.name || 'Error'}`,
    `ERROR CODE: ${errorObj.code || metadata.code || 'N/A'}`,
    '',
    'HOW & WHEN IT HAPPENED:',
    `  Trigger Context: ${context || 'General application runtime'}`,
    `  Timestamp:       ${isoTime}`,
  ];

  if (metadata && Object.keys(metadata).length > 0) {
    lines.push('  Additional Metadata:');
    try {
      lines.push(JSON.stringify(metadata, null, 4).replace(/^/gm, '    '));
    } catch {
      lines.push(`    [Unserializable metadata: ${String(metadata)}]`);
    }
  }

  lines.push('');
  lines.push('STACK TRACE:');
  lines.push(errorObj.stack || '  No stack trace available');
  lines.push('');
  lines.push('SYSTEM & ENVIRONMENT:');
  lines.push(`  Platform:   ${os.platform()} (${os.arch()}) ${os.release()}`);
  lines.push(`  Node:       ${process.version}`);
  lines.push(`  Electron:   ${process.versions?.electron || 'N/A'}`);
  lines.push(`  Memory:     ${memoryInfo}`);
  lines.push('================================================================================');
  lines.push('');

  return lines.join('\n');
}

function logError(context, error, metadata = {}) {
  try {
    ensureLogDirectory();
    const filePath = getLogPath();
    const entry = formatErrorEntry(context, error, metadata);

    // Rotate log if it exceeds 5 MB
    try {
      if (fs.existsSync(filePath)) {
        const stats = fs.statSync(filePath);
        if (stats.size > 5 * 1024 * 1024) {
          const oldPath = path.join(getLogDirectory(), 'error.old.log');
          if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
          fs.renameSync(filePath, oldPath);
        }
      }
    } catch {
      // Rotation failure is non-fatal
    }

    fs.appendFileSync(filePath, entry, 'utf8');
    return { ok: true, path: filePath };
  } catch (logErr) {
    console.error('Failed to write to error log file:', logErr);
    return { ok: false, error: logErr.message };
  }
}

function readRecentLogs(maxLines = 100) {
  try {
    const filePath = getLogPath();
    if (!fs.existsSync(filePath)) return '';
    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split('\n');
    return lines.slice(-maxLines).join('\n');
  } catch (err) {
    return `Failed to read error log: ${err.message}`;
  }
}

function clearLogs() {
  try {
    const filePath = getLogPath();
    if (fs.existsSync(filePath)) {
      fs.writeFileSync(filePath, '', 'utf8');
    }
    return true;
  } catch {
    return false;
  }
}

module.exports = {
  getLogPath,
  getLogDirectory,
  setLogDirectory,
  logError,
  readRecentLogs,
  clearLogs,
  formatErrorEntry,
};
