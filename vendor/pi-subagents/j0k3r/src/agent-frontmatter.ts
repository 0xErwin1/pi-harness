import { readFileSync, realpathSync, writeFileSync } from 'node:fs';
import type { ModelRef, ThinkingEffort } from './types.ts';

function newlineFor(text: string): string {
  return text.includes('\r\n') ? '\r\n' : '\n';
}

function serializeModel(model?: ModelRef): string | undefined {
  if (!model) return undefined;
  return `${model.provider}/${model.id}`;
}

function normalizeValue(value: string | undefined): string | undefined {
  if (value == null) return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function keyPattern(key: string): RegExp {
  return new RegExp(`^${key}:\\s*.*$`);
}

export function patchAgentFrontmatter(input: {
  markdown: string;
  model?: string;
  thinking?: ThinkingEffort;
}): string {
  const newline = newlineFor(input.markdown);
  const nextValues = {
    model: normalizeValue(input.model),
    thinking: normalizeValue(input.thinking),
  };
  const entries = [
    ['model', nextValues.model],
    ['thinking', nextValues.thinking],
  ] as const;

  const hasFrontmatter = input.markdown.startsWith(`---${newline}`) || input.markdown.startsWith('---\n');
  if (!hasFrontmatter) {
    const frontmatterLines = entries
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => `${key}: ${value}`);
    if (!frontmatterLines.length) return input.markdown;
    return `---${newline}${frontmatterLines.join(newline)}${newline}---${newline}${newline}${input.markdown}`;
  }

  const endMatch = input.markdown.match(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/);
  if (!endMatch) {
    const frontmatterLines = entries
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => `${key}: ${value}`);
    if (!frontmatterLines.length) return input.markdown;
    return `---${newline}${frontmatterLines.join(newline)}${newline}---${newline}${newline}${input.markdown}`;
  }

  const frontmatterBlock = endMatch[0];
  const body = input.markdown.slice(frontmatterBlock.length);
  const bodyWithoutLeadingBlank = body.replace(/^\r?\n/, '');
  const normalizedBlock = frontmatterBlock.replace(/\r\n/g, '\n');
  const raw = normalizedBlock.slice(4, normalizedBlock.lastIndexOf('\n---'));
  let lines = raw.length ? raw.split('\n') : [];

  for (const [key, value] of entries) {
    lines = lines.filter((line) => !keyPattern(key).test(line.trim()));
    if (value !== undefined) lines.push(`${key}: ${value}`);
  }

  const keptLines = lines.filter((line) => line.trim().length > 0);
  if (!keptLines.length) return bodyWithoutLeadingBlank;
  return `---${newline}${keptLines.join(newline)}${newline}---${newline}${body}`;
}

export function resolveWritableAgentMarkdownPath(filePath: string): string {
  return realpathSync(filePath);
}

export function writeAgentFrontmatterProfile(input: {
  filePath: string;
  model?: ModelRef;
  thinking?: ThinkingEffort;
}): string {
  const writablePath = resolveWritableAgentMarkdownPath(input.filePath);
  const current = readFileSync(writablePath, 'utf8');
  const next = patchAgentFrontmatter({
    markdown: current,
    model: serializeModel(input.model),
    thinking: input.thinking,
  });
  if (next !== current) writeFileSync(writablePath, next, 'utf8');
  return writablePath;
}
