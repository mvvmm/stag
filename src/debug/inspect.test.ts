import { describe, expect, it } from "vitest";
import {
  describeField,
  entityLabel,
  formatValue,
  getPath,
  inspectEntity,
  setPath,
  shapeKey,
} from "@/debug/inspect";

const pawnEntity = () => ({
  transform: { position: { x: 1, y: 0.3, z: -2 }, rotation: { x: 0, y: 1.5, z: 0 } },
  prevTransform: { position: { x: 1, y: 0.3, z: -2 }, rotation: { x: 0, y: 1.5, z: 0 } },
  pawn: { target: null as { x: number; z: number } | null },
});

describe("inspectEntity", () => {
  it("describes components as editable leaves and nested folders, hiding prevTransform", () => {
    const fields = inspectEntity(pawnEntity());
    expect(fields.map((field) => field.key)).toEqual(["transform", "pawn"]);
    expect(fields[0]).toMatchObject({
      kind: "object",
      path: ["transform"],
      children: [
        {
          kind: "object",
          key: "position",
          children: [{ kind: "number", path: ["transform", "position", "x"] }, {}, {}],
        },
        { kind: "object", key: "rotation" },
      ],
    });
    expect(fields[1]).toMatchObject({
      kind: "object",
      children: [{ kind: "readonly", key: "target", path: ["pawn", "target"] }],
    });
  });

  it("marks arrays, functions and class instances read-only", () => {
    expect(describeField("a", [1, 2], ["a"]).kind).toBe("readonly");
    expect(describeField("f", () => 1, ["f"]).kind).toBe("readonly");
    expect(describeField("m", new Map(), ["m"]).kind).toBe("readonly");
    expect(describeField("b", true, ["b"]).kind).toBe("boolean");
    expect(describeField("s", "x", ["s"]).kind).toBe("string");
  });
});

describe("shapeKey", () => {
  it("changes when a value changes kind, not when it changes value", () => {
    const entity = pawnEntity();
    const before = shapeKey(inspectEntity(entity));
    entity.transform.position.x = 99;
    expect(shapeKey(inspectEntity(entity))).toBe(before);
    entity.pawn.target = { x: 1, z: 2 };
    expect(shapeKey(inspectEntity(entity))).not.toBe(before);
  });
});

describe("getPath / setPath", () => {
  it("reads and writes nested values", () => {
    const entity = pawnEntity();
    expect(getPath(entity, ["transform", "position", "z"])).toBe(-2);
    expect(setPath(entity, ["transform", "position", "z"], 4)).toBe(true);
    expect(entity.transform.position.z).toBe(4);
    expect(getPath(entity, ["pawn", "target", "x"])).toBeUndefined();
    expect(setPath(entity, ["pawn", "target", "x"], 1)).toBe(false);
  });
});

describe("formatValue", () => {
  it("rounds numbers and truncates long text", () => {
    expect(formatValue({ x: 1.23456, z: null })).toBe('{"x":1.235,"z":null}');
    expect(formatValue(null)).toBe("null");
    expect(formatValue(undefined)).toBe("undefined");
    expect(formatValue(Array.from({ length: 100 }, (_, i) => i)).length).toBe(80);
  });
});

describe("entityLabel", () => {
  it("names the telling components, or the common ones when there are no others", () => {
    expect(entityLabel(5, pawnEntity())).toBe("#5 pawn");
    expect(entityLabel(2, { transform: {}, prevTransform: {} })).toBe("#2 transform");
    expect(entityLabel(9, {})).toBe("#9");
  });
});
