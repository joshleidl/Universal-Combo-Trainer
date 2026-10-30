#!/usr/bin/env node
// Backs up a Claude Code session transcript (SPEC §10).
// Writes a readable Markdown transcript plus a raw copy of the session log to $TRANSCRIPT_DIR.
//
// Usage: node scripts/backup-transcript.mjs [--session <id>]
// Default session: the most recently updated one for this project.

import { execFileSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const projectDir = process.cwd();
const outDir = process.env.TRANSCRIPT_DIR;
if (!outDir) fail('TRANSCRIPT_DIR is not set (it is set in mise.toml; run via `mise run transcript`).');

// Claude Code stores sessions under ~/.claude/projects/<cwd with "/" and "." replaced by "-">.
const sessionsDir = join(homedir(), '.claude', 'projects', projectDir.replace(/[/.]/g, '-'));
if (!existsSync(sessionsDir)) fail(`No Claude Code sessions found in ${sessionsDir}`);

const args = process.argv.slice(2);
const sessionArg = args[args.indexOf('--session') + 1];
const sessionFile = args.includes('--session') ? join(sessionsDir, `${sessionArg}.jsonl`) : latestSession();
if (!existsSync(sessionFile)) fail(`Session file not found: ${sessionFile}`);

const records = readFileSync(sessionFile, 'utf8')
  .split('\n')
  .filter(Boolean)
  .flatMap((line) => {
    try {
      return [JSON.parse(line)];
    } catch {
      return [];
    }
  });

const STRIP = /<(system-reminder|ide_opened_file|ide_selection)>[\s\S]*?<\/\1>/g;
const blocks = [];
const times = [];
let actions = [];

const flush = () => {
  if (actions.length) blocks.push(`> *Actions:* ${actions.join(' · ')}\n`);
  actions = [];
};

const relative = (p) => String(p ?? '').replace(`${projectDir}/`, '');

function describeTool({ name, input = {} }) {
  if (name === 'Bash') return input.description || 'Ran a command';
  if (name === 'Write') return `Wrote \`${relative(input.file_path)}\``;
  if (name === 'Edit') return `Edited \`${relative(input.file_path)}\``;
  if (name === 'Read') return `Read \`${relative(input.file_path)}\``;
  return `Used ${name}`;
}

for (const r of records) {
  if (r.type !== 'user' && r.type !== 'assistant') continue;
  if (r.timestamp) times.push(r.timestamp);
  const content = r.message?.content;

  if (r.type === 'user') {
    let text;
    if (Array.isArray(content)) {
      const texts = content.filter((b) => b.type === 'text').map((b) => b.text);
      if (!texts.length) continue; // tool results
      text = texts.join('\n');
    } else {
      text = content ?? '';
    }
    text = text.replace(STRIP, '').trim();
    if (!text) continue;
    flush();
    blocks.push(`**Josh:** ${text}\n`);
    continue;
  }

  for (const b of content ?? []) {
    if (b.type === 'text' && b.text?.trim()) {
      flush();
      blocks.push(`**Claude:** ${b.text.trim()}\n`);
    } else if (b.type === 'tool_use') {
      actions.push(describeTool(b));
    }
  }
}
flush();
if (!times.length) fail('Session has no messages yet.');

const start = new Date(times[0]);
const end = new Date(times[times.length - 1]);
const sessionId = sessionFile.split('/').pop().replace('.jsonl', '');
const shortId = sessionId.slice(0, 8);
const ymd = localDate(start);
const clock = (d) => d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

const commits = git(['log', '--reverse', '--format=- `%h` %s', `--since=${start.toISOString()}`]);

const header = [
  '# Universal Combo Trainer: Claude Code Session Transcript',
  `**Date:** ${start.toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })} (${clock(start)}–${clock(end)})`,
  '**Assistant:** Claude Code',
  '**Project:** Universal Combo Trainer (github.com/joshleidl/Universal-Combo-Trainer)',
  `**Session:** ${sessionId}`,
  '',
  '**Commits during this session:**',
  commits || '- (none)',
  '',
  "Conversation text only. Claude's tool calls are summarized as *Actions* lines; command output and Claude's internal reasoning are omitted. The full raw session log is the matching (raw).jsonl file.",
  '',
  '---',
  '',
];

mkdirSync(outDir, { recursive: true });
const base = join(outDir, `${ymd} Claude Code session ${shortId}`);
writeFileSync(`${base}.md`, header.join('\n') + '\n' + blocks.join('\n'));
copyFileSync(sessionFile, `${base} (raw).jsonl`);
console.log(`Backed up session ${shortId} (${blocks.length} blocks) to:\n  ${base}.md\n  ${base} (raw).jsonl`);

// --- helpers -----------------------------------------------------------------

function latestSession() {
  const files = readdirSync(sessionsDir)
    .filter((f) => f.endsWith('.jsonl'))
    .map((f) => join(sessionsDir, f))
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);
  if (!files.length) fail(`No session logs in ${sessionsDir}`);
  return files[0];
}

function localDate(d) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function git(gitArgs) {
  try {
    return execFileSync('git', gitArgs, { encoding: 'utf8' }).trim();
  } catch {
    return '';
  }
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
