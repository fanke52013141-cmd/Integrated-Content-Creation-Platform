import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PACKAGE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const DEFAULT_MATRIX_PATH = path.join(PACKAGE_DIR, 'rules', 'compatibility-v1.json');
export const SUPPORTED_TARGETS = Object.freeze(['preview', 'editor-paste', 'draft']);
const SEVERITIES = new Set(['block', 'degrade']);

export function validateMatrix(matrix) {
  if (!matrix || typeof matrix !== 'object' || Array.isArray(matrix)) {
    throw new TypeError('Compatibility matrix must be an object.');
  }
  if (matrix.schemaVersion !== 1) throw new Error('Unsupported matrix schemaVersion.');
  if (!/^\d+\.\d+\.\d+$/u.test(matrix.matrixVersion ?? '')) {
    throw new Error('matrixVersion must use semantic versioning.');
  }
  if (!SUPPORTED_TARGETS.includes(matrix.defaultTarget)) {
    throw new Error(`Invalid defaultTarget: ${matrix.defaultTarget}`);
  }
  for (const target of SUPPORTED_TARGETS) {
    const policy = matrix.targets?.[target];
    if (!policy) throw new Error(`Missing target policy: ${target}`);
    for (const key of ['localImageSeverity', 'externalImageSeverity', 'insecureImageSeverity']) {
      if (!SEVERITIES.has(policy[key])) throw new Error(`Invalid ${target}.${key}: ${policy[key]}`);
    }
  }
  if (!Array.isArray(matrix.allowedImageHosts) || matrix.allowedImageHosts.length === 0) {
    throw new Error('allowedImageHosts must be a non-empty array.');
  }
  for (const host of matrix.allowedImageHosts) {
    if (typeof host !== 'string' || !/^[a-z0-9.-]+$/u.test(host) || host.includes('..')) {
      throw new Error(`Invalid allowed image host: ${host}`);
    }
  }
  for (const key of ['dangerousTags', 'dangerousAttributes', 'blockLevelTags', 'nodeleafAllowedTags']) {
    if (!Array.isArray(matrix[key])) throw new Error(`${key} must be an array.`);
  }
  if (!matrix.nodeleafAllowedTags.includes('img')) {
    throw new Error('nodeleafAllowedTags must include img as the conservative baseline.');
  }
  if (!matrix.urlAttributes || typeof matrix.urlAttributes !== 'object') {
    throw new Error('urlAttributes must be an object.');
  }
  if (!Array.isArray(matrix.rules) || matrix.rules.length === 0) {
    throw new Error('rules must be a non-empty array.');
  }
  const ids = new Set();
  for (const rule of matrix.rules) {
    if (!rule?.id || ids.has(rule.id)) throw new Error(`Duplicate or missing rule id: ${rule?.id}`);
    ids.add(rule.id);
    if (!SEVERITIES.has(rule.severity)) throw new Error(`Invalid severity for ${rule.id}.`);
    if (!rule.message || !rule.recommendation || !rule.category || !rule.officialCoverage) {
      throw new Error(`Incomplete rule metadata for ${rule.id}.`);
    }
    for (const [target, severity] of Object.entries(rule.targetSeverity ?? {})) {
      if (!SUPPORTED_TARGETS.includes(target) || !SEVERITIES.has(severity)) {
        throw new Error(`Invalid targetSeverity for ${rule.id}.${target}.`);
      }
    }
  }
  for (const gap of matrix.officialCheckerGaps ?? []) {
    for (const ruleId of gap.ruleIds ?? []) {
      if (!ids.has(ruleId)) throw new Error(`Official gap ${gap.id} references unknown rule ${ruleId}.`);
    }
  }
  return matrix;
}

export function loadMatrix(filePath = DEFAULT_MATRIX_PATH) {
  const matrix = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  return validateMatrix(matrix);
}

export function getTargetPolicy(matrix, target) {
  if (!SUPPORTED_TARGETS.includes(target)) {
    throw new Error(`Unknown target "${target}". Expected ${SUPPORTED_TARGETS.join(', ')}.`);
  }
  return matrix.targets[target];
}

export function resolveRule(matrix, ruleId, target) {
  const rule = matrix.rules.find((entry) => entry.id === ruleId);
  if (!rule) throw new Error(`Rule ${ruleId} is missing from matrix ${matrix.matrixVersion}.`);
  return {
    ...rule,
    effectiveSeverity: rule.targetSeverity?.[target] ?? rule.severity,
  };
}
