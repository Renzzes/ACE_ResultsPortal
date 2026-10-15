import type { IResult, ISqlType, Transaction } from "mssql";
import { request as makeRequest, sql } from "./pool";

export function asDate(value: unknown): Date | null {
  if (value == null) return null;
  if (value instanceof Date) return value;
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function asRequiredDate(value: unknown): Date {
  const parsed = asDate(value);
  if (!parsed) throw new Error("Expected a datetime value from SQL Server.");
  return parsed;
}

export function asBool(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") return value === "true" || value === "1";
  return Boolean(value);
}

export function asString(value: unknown): string | null {
  if (value == null) return null;
  return String(value);
}

export function asRequiredString(value: unknown): string {
  const text = asString(value);
  if (text == null) throw new Error("Expected a string value from SQL Server.");
  return text;
}

export function asNumber(value: unknown): number | null {
  if (value == null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function asRequiredNumber(value: unknown): number {
  const parsed = asNumber(value);
  if (parsed == null) throw new Error("Expected a numeric value from SQL Server.");
  return parsed;
}

export function isoDateOnly(value: unknown): string {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  const text = String(value);
  return text.length >= 10 ? text.slice(0, 10) : text;
}

export function likeContains(term: string): string {
  const escaped = term.replace(/[\\%_[]/g, (ch) => `\\${ch}`);
  return `%${escaped}%`;
}

export function bindInInts(
  req: ReturnType<typeof makeRequest>,
  prefix: string,
  ids: number[],
): string {
  if (ids.length === 0) return "(NULL)";
  return ids
    .map((id, index) => {
      const name = `${prefix}${index}`;
      req.input(name, sql.Int, id);
      return `@${name}`;
    })
    .join(", ");
}

export function bindInStrings(
  req: ReturnType<typeof makeRequest>,
  prefix: string,
  values: string[],
): string {
  if (values.length === 0) return "(NULL)";
  return values
    .map((value, index) => {
      const name = `${prefix}${index}`;
      req.input(name, sql.NVarChar(32), value);
      return `@${name}`;
    })
    .join(", ");
}

export async function query<T extends object>(
  text: string,
  params: Array<{ name: string; type: ISqlType | (() => ISqlType); value: unknown }> = [],
  tx?: Transaction,
): Promise<IResult<T>> {
  const req = tx ? makeRequest(tx) : makeRequest();
  for (const param of params) {
    req.input(param.name, param.type as ISqlType, param.value);
  }
  return req.query<T>(text);
}

export { sql };
