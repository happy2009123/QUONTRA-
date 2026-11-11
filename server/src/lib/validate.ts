/** Small dependency-free request validation helpers. */

import { validationError, type FieldIssue } from './errors.ts';

export class Validator {
  private readonly issues: FieldIssue[] = [];

  private readonly source: Record<string, unknown>;
  constructor(source: Record<string, unknown>) {
    this.source = source;
  }

  private raw(field: string): unknown {
    return this.source[field];
  }

  string(field: string, opts: { required?: boolean; maxLength?: number; pattern?: RegExp; patternMessage?: string } = {}): string | undefined {
    const value = this.raw(field);
    if (value === undefined || value === null || value === '') {
      if (opts.required) this.issues.push({ field, message: 'is required' });
      return undefined;
    }
    if (typeof value !== 'string') {
      this.issues.push({ field, message: 'must be a string' });
      return undefined;
    }
    if (opts.maxLength && value.length > opts.maxLength) {
      this.issues.push({ field, message: `must be at most ${opts.maxLength} characters` });
      return undefined;
    }
    if (opts.pattern && !opts.pattern.test(value)) {
      this.issues.push({ field, message: opts.patternMessage ?? 'has an invalid format' });
      return undefined;
    }
    return value;
  }

  enum<T extends string>(field: string, allowed: readonly T[], opts: { required?: boolean; fallback?: T } = {}): T | undefined {
    const value = this.string(field, { required: opts.required });
    if (value === undefined) return opts.fallback;
    if (!(allowed as readonly string[]).includes(value)) {
      this.issues.push({ field, message: `must be one of: ${allowed.join(', ')}` });
      return opts.fallback;
    }
    return value as T;
  }

  int(field: string, opts: { required?: boolean; min?: number; max?: number; fallback?: number } = {}): number | undefined {
    const raw = this.raw(field);
    if (raw === undefined || raw === null || raw === '') {
      if (opts.required) this.issues.push({ field, message: 'is required' });
      return opts.fallback;
    }
    const value = typeof raw === 'number' ? raw : Number(raw);
    if (!Number.isFinite(value) || !Number.isInteger(value)) {
      this.issues.push({ field, message: 'must be an integer' });
      return undefined;
    }
    if (opts.min !== undefined && value < opts.min) {
      this.issues.push({ field, message: `must be >= ${opts.min}` });
      return undefined;
    }
    if (opts.max !== undefined && value > opts.max) {
      this.issues.push({ field, message: `must be <= ${opts.max}` });
      return undefined;
    }
    return value;
  }

  number(field: string, opts: { required?: boolean; min?: number; max?: number; fallback?: number } = {}): number | undefined {
    const raw = this.raw(field);
    if (raw === undefined || raw === null || raw === '') {
      if (opts.required) this.issues.push({ field, message: 'is required' });
      return opts.fallback;
    }
    const value = typeof raw === 'number' ? raw : Number(raw);
    if (!Number.isFinite(value)) {
      this.issues.push({ field, message: 'must be a number' });
      return undefined;
    }
    if (opts.min !== undefined && value < opts.min) {
      this.issues.push({ field, message: `must be >= ${opts.min}` });
      return undefined;
    }
    if (opts.max !== undefined && value > opts.max) {
      this.issues.push({ field, message: `must be <= ${opts.max}` });
      return undefined;
    }
    return value;
  }

  boolean(field: string, opts: { fallback?: boolean } = {}): boolean | undefined {
    const raw = this.raw(field);
    if (raw === undefined || raw === null || raw === '') return opts.fallback;
    if (typeof raw === 'boolean') return raw;
    if (raw === 'true') return true;
    if (raw === 'false') return false;
    this.issues.push({ field, message: 'must be a boolean' });
    return undefined;
  }

  /** Comma-separated list of strings with an optional per-item cap. */
  list(field: string, opts: { required?: boolean; maxItems?: number; itemPattern?: RegExp } = {}): string[] | undefined {
    const value = this.string(field, { required: opts.required, maxLength: 4_096 });
    if (value === undefined) return undefined;
    const items = value
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    if (opts.maxItems && items.length > opts.maxItems) {
      this.issues.push({ field, message: `must contain at most ${opts.maxItems} items` });
      return undefined;
    }
    if (opts.itemPattern) {
      for (const item of items) {
        if (!opts.itemPattern.test(item)) {
          this.issues.push({ field, message: `contains an invalid item "${item}"` });
          return undefined;
        }
      }
    }
    return items;
  }

  /** ISO date (yyyy-mm-dd). */
  date(field: string, opts: { required?: boolean } = {}): string | undefined {
    return this.string(field, {
      required: opts.required,
      pattern: /^\d{4}-\d{2}-\d{2}$/,
      patternMessage: 'must be an ISO date (yyyy-mm-dd)',
    });
  }

  /** Adds a manual issue (for cross-field rules). */
  addIssue(field: string, message: string): void {
    this.issues.push({ field, message });
  }

  get valid(): boolean {
    return this.issues.length === 0;
  }

  /** Throws a VALIDATION_ERROR AppError when any issue was collected. */
  throwIfInvalid(): void {
    if (this.issues.length > 0) throw validationError(this.issues);
  }
}

/** Builds a Validator from URLSearchParams-compatible query input. */
export function queryValidator(query: URLSearchParams): Validator {
  const source: Record<string, unknown> = {};
  for (const [key, value] of query.entries()) source[key] = value;
  return new Validator(source);
}
