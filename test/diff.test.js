import { test } from "node:test";
import assert from "node:assert/strict";
import { diffKeys } from "../src/diff.js";

test("diffKeys separates enter/update/exit", () => {
  const oldKeys = ["a", "b", "c"];
  const newKeys = ["b", "c", "d"];
  const { enter, update, exit } = diffKeys(oldKeys, newKeys);
  assert.deepEqual(new Set(enter), new Set(["d"]));
  assert.deepEqual(new Set(update), new Set(["b", "c"]));
  assert.deepEqual(new Set(exit), new Set(["a"]));
});

test("diffKeys: everything enters when old is empty", () => {
  const { enter, update, exit } = diffKeys([], ["x", "y"]);
  assert.deepEqual(new Set(enter), new Set(["x", "y"]));
  assert.deepEqual(update, []);
  assert.deepEqual(exit, []);
});

test("diffKeys: everything exits when new is empty", () => {
  const { enter, update, exit } = diffKeys(["x", "y"], []);
  assert.deepEqual(enter, []);
  assert.deepEqual(update, []);
  assert.deepEqual(new Set(exit), new Set(["x", "y"]));
});

test("diffKeys accepts arbitrary iterables (Set, Map keys)", () => {
  const oldMap = new Map([["a", 1], ["b", 2]]);
  const newSet = new Set(["b", "c"]);
  const { enter, update, exit } = diffKeys(oldMap.keys(), newSet);
  assert.deepEqual(new Set(enter), new Set(["c"]));
  assert.deepEqual(new Set(update), new Set(["b"]));
  assert.deepEqual(new Set(exit), new Set(["a"]));
});

test("diffKeys de-dupes repeated keys within one iterable", () => {
  const { enter, update, exit } = diffKeys(["a", "a"], ["a", "a", "b"]);
  assert.deepEqual(update, ["a"]);
  assert.deepEqual(enter, ["b"]);
  assert.deepEqual(exit, []);
});
