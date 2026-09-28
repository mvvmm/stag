/**
 * Reflection over ECS entities for the pane's entity view: which fields a component has, which
 * are editable, and a shape key that changes when the view has to be rebuilt. DOM-free.
 */

export type Path = readonly string[];

export type Field =
  | { kind: "number" | "boolean" | "string"; key: string; path: Path }
  | { kind: "object"; key: string; path: Path; children: Field[] }
  /** Shown as text, not editable: null/undefined, arrays, functions, class instances, … */
  | { kind: "readonly"; key: string; path: Path };

/** Components that aren't shown (render bookkeeping). */
const HIDDEN = new Set(["prevTransform"]);
/** Components left out of entity labels because nearly everything has them. */
const COMMON = new Set(["transform", "prevTransform"]);
const MAX_TEXT = 80;

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
};

export function describeField(key: string, value: unknown, path: Path): Field {
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "string") {
    return { kind: typeof value as "number" | "boolean" | "string", key, path };
  }
  if (isPlainObject(value)) {
    const children = Object.entries(value).map(([k, v]) => describeField(k, v, [...path, k]));
    return { kind: "object", key, path, children };
  }
  return { kind: "readonly", key, path };
}

/** One field per shown component, in the entity's key order. */
export function inspectEntity(entity: object): Field[] {
  return Object.entries(entity)
    .filter(([key, value]) => !HIDDEN.has(key) && value !== undefined)
    .map(([key, value]) => describeField(key, value, [key]));
}

/** Changes whenever the field tree does (a component added, `target` going from null to a point, …). */
export function shapeKey(fields: readonly Field[]): string {
  const walk = (field: Field): string =>
    field.kind === "object"
      ? `${field.key}{${field.children.map(walk).join(",")}}`
      : `${field.key}:${field.kind}`;
  return fields.map(walk).join(";");
}

export function getPath(root: object, path: Path): unknown {
  let value: unknown = root;
  for (const key of path) {
    if (typeof value !== "object" || value === null) return undefined;
    value = (value as Record<string, unknown>)[key];
  }
  return value;
}

/** Sets the value at `path`; false if the parent is gone. */
export function setPath(root: object, path: Path, value: unknown): boolean {
  const parent = getPath(root, path.slice(0, -1));
  const key = path[path.length - 1];
  if (key === undefined || typeof parent !== "object" || parent === null) return false;
  (parent as Record<string, unknown>)[key] = value;
  return true;
}

/** Short text for a read-only value, numbers rounded to 3 decimals. */
export function formatValue(value: unknown): string {
  if (value === undefined) return "undefined";
  if (typeof value === "function") return "ƒ()";
  let text: string;
  try {
    text = JSON.stringify(value, (_key, v) =>
      typeof v === "number" ? Math.round(v * 1000) / 1000 : v,
    );
  } catch {
    text = String(value);
  }
  return text.length > MAX_TEXT ? `${text.slice(0, MAX_TEXT - 1)}…` : text;
}

/** `#17 mover player` or `#3 orbit`: the id and the components that say what the entity is. */
export function entityLabel(id: number, entity: object): string {
  const keys = Object.keys(entity).filter(
    (key) => (entity as Record<string, unknown>)[key] !== undefined,
  );
  const telling = keys.filter((key) => !COMMON.has(key));
  const shown = telling.length ? telling : keys.filter((key) => !HIDDEN.has(key));
  return `#${id} ${shown.join(" ")}`.trim();
}
