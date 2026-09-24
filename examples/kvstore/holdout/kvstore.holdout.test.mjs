// Holdout suite for examples/kvstore. Never show it to the planner or solvers:
// it grades the final result independently of the tests graftree wrote.
// Copy it into the result checkout as holdout/ and run:
//   node --test holdout/kvstore.holdout.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { Store } from "../src/store.mjs";
import { execute } from "../src/protocol.mjs";

const clock = (t = 1000) => {
  const c = { t, now: () => c.t };
  return c;
};

// --- existing behavior ------------------------------------------------------

test("existing API still works", () => {
  const s = new Store();
  s.set("b", 2);
  s.set("a", "1");
  assert.equal(s.get("b"), "2");
  assert.deepEqual(s.keys(), ["a", "b"]);
  assert.equal(s.del("a"), true);
  assert.equal(s.del("a"), false);
  assert.equal(s.depth, 0);
});

// --- expiry -----------------------------------------------------------------

test("ttl codes and remaining time", () => {
  const c = clock();
  const s = new Store({ now: c.now });
  assert.equal(s.ttl("k"), -2);
  s.set("k", "v");
  assert.equal(s.ttl("k"), -1);
  s.set("k", "v", { ttlMs: 500 });
  assert.equal(s.ttl("k"), 500);
  c.t += 200;
  assert.equal(s.ttl("k"), 300);
});

test("a key is gone at exactly its expiry time, for every operation", () => {
  const c = clock();
  const s = new Store({ now: c.now });
  s.set("k", "v", { ttlMs: 100 });
  s.set("z", "keep");
  c.t += 99;
  assert.equal(s.get("k"), "v");
  c.t += 1;
  assert.equal(s.get("k"), undefined);
  assert.equal(s.ttl("k"), -2);
  assert.equal(s.expire("k", 10), false);
  assert.equal(s.del("k"), false);
  assert.deepEqual(s.keys(), ["z"]);
});

test("set without ttl clears an existing expiry", () => {
  const c = clock();
  const s = new Store({ now: c.now });
  s.set("k", "v", { ttlMs: 100 });
  s.set("k", "w");
  c.t += 1000;
  assert.equal(s.get("k"), "w");
  assert.equal(s.ttl("k"), -1);
});

test("expire only applies to existing keys", () => {
  const c = clock();
  const s = new Store({ now: c.now });
  assert.equal(s.expire("nope", 100), false);
  assert.equal(s.ttl("nope"), -2);
  s.set("k", "v");
  assert.equal(s.expire("k", 100), true);
  assert.equal(s.ttl("k"), 100);
});

test("invalid ttl values throw RangeError", () => {
  const s = new Store();
  s.set("k", "v");
  for (const bad of [0, -1, 1.5, NaN, Infinity, "10"]) {
    assert.throws(() => s.set("k", "v", { ttlMs: bad }), RangeError, `set ttlMs=${String(bad)}`);
    assert.throws(() => s.expire("k", bad), RangeError, `expire ms=${String(bad)}`);
  }
  assert.equal(s.get("k"), "v");
});

test("the default clock is Date.now", () => {
  const s = new Store();
  s.set("k", "v", { ttlMs: 60_000 });
  const t = s.ttl("k");
  assert.ok(t > 55_000 && t <= 60_000, String(t));
});

// --- transactions -----------------------------------------------------------

test("reads see uncommitted writes; rollback restores values and absence", () => {
  const s = new Store();
  s.set("a", "1");
  s.begin();
  assert.equal(s.depth, 1);
  s.set("a", "2");
  s.set("b", "new");
  s.del("a");
  assert.equal(s.get("a"), undefined);
  assert.equal(s.get("b"), "new");
  s.rollback();
  assert.equal(s.depth, 0);
  assert.equal(s.get("a"), "1");
  assert.equal(s.get("b"), undefined);
  assert.deepEqual(s.keys(), ["a"]);
});

test("commit keeps writes", () => {
  const s = new Store();
  s.begin();
  s.set("a", "1");
  s.commit();
  assert.equal(s.get("a"), "1");
  assert.equal(s.depth, 0);
});

test("nested: inner commit is undone by outer rollback", () => {
  const s = new Store();
  s.set("x", "0");
  s.begin();
  s.set("x", "1");
  s.begin();
  assert.equal(s.depth, 2);
  s.set("x", "2");
  s.set("y", "2");
  s.commit();
  assert.equal(s.get("x"), "2");
  s.rollback();
  assert.equal(s.get("x"), "0");
  assert.equal(s.get("y"), undefined);
});

test("nested: inner rollback keeps outer writes", () => {
  const s = new Store();
  s.begin();
  s.set("x", "1");
  s.begin();
  s.set("x", "2");
  s.del("x");
  s.rollback();
  assert.equal(s.get("x"), "1");
  s.commit();
  assert.equal(s.get("x"), "1");
});

test("rollback restores the earlier expiry, by absolute time", () => {
  const c = clock();
  const s = new Store({ now: c.now });
  s.set("k", "v", { ttlMs: 1000 });
  s.set("p", "v");
  s.begin();
  s.set("k", "w");
  s.expire("p", 50);
  c.t += 300;
  s.rollback();
  assert.equal(s.get("k"), "v");
  assert.equal(s.ttl("k"), 700);
  assert.equal(s.ttl("p"), -1);
});

test("a key whose earlier expiry passed during the transaction is gone after rollback", () => {
  const c = clock();
  const s = new Store({ now: c.now });
  s.set("k", "v", { ttlMs: 100 });
  s.begin();
  s.set("k", "forever");
  c.t += 500;
  assert.equal(s.get("k"), "forever");
  s.rollback();
  assert.equal(s.get("k"), undefined);
  assert.equal(s.ttl("k"), -2);
});

test("commit/rollback without a transaction throw NO TRANSACTION", () => {
  const s = new Store();
  assert.throws(() => s.commit(), { message: "NO TRANSACTION" });
  assert.throws(() => s.rollback(), { message: "NO TRANSACTION" });
  s.begin();
  s.commit();
  assert.throws(() => s.commit(), { message: "NO TRANSACTION" });
});

test("many keys and deep nesting roll back exactly", () => {
  const s = new Store();
  for (let i = 0; i < 50; i++) s.set(`k${i}`, `v${i}`);
  const before = s.keys().map((k) => [k, s.get(k)]);
  for (let d = 0; d < 10; d++) {
    s.begin();
    for (let i = 0; i < 50; i += d + 1) (i % 2 ? s.del(`k${i}`) : s.set(`k${i}`, `d${d}`));
    s.set(`new${d}`, "x");
  }
  for (let d = 0; d < 5; d++) s.commit();
  for (let d = 0; d < 5; d++) s.rollback();
  assert.equal(s.depth, 0);
  assert.deepEqual(s.keys().map((k) => [k, s.get(k)]), before);
});

// --- protocol ---------------------------------------------------------------

const run = (s, ...lines) => lines.map((l) => execute(s, l));

test("basic commands", () => {
  const s = new Store();
  assert.deepEqual(run(s, "SET a 1", "GET a", "GET b", "DEL a", "DEL a", "KEYS"), ["OK", "1", "(nil)", "(integer) 1", "(integer) 0", "(empty)"]);
});

test("command names are case-insensitive; keys and values are not", () => {
  const s = new Store();
  assert.deepEqual(run(s, "set Key Val", "get key", "gEt Key", "keys"), ["OK", "(nil)", "Val", "Key"]);
});

test("quoting and escapes", () => {
  const s = new Store();
  assert.deepEqual(run(s, 'SET "my key" "hello world"', 'GET "my key"'), ["OK", "hello world"]);
  assert.deepEqual(run(s, 'SET q "say \\"hi\\" \\\\ bye"', "GET q"), ["OK", 'say "hi" \\ bye']);
  assert.deepEqual(run(s, 'SET e ""', "GET e"), ["OK", ""]);
  assert.equal(execute(s, 'SET a "unterminated'), "(error) SYNTAX");
});

test("whitespace: tabs and repeated spaces separate tokens", () => {
  const s = new Store();
  assert.deepEqual(run(s, "  SET\ta    1  ", "GET a"), ["OK", "1"]);
});

test("expiry through the protocol", () => {
  const c = clock();
  const s = new Store({ now: c.now });
  assert.deepEqual(run(s, "SET k v PX 100", "TTL k", "TTL nope", "SET p v", "TTL p"), ["OK", "(integer) 100", "(integer) -2", "OK", "(integer) -1"]);
  assert.deepEqual(run(s, "EXPIRE p 50", "EXPIRE nope 50", "SET k v px 10"), ["(integer) 1", "(integer) 0", "OK"]);
  c.t += 10;
  assert.deepEqual(run(s, "GET k", "KEYS"), ["(nil)", "p"]);
});

test("bad ms and arity return WRONG ARGS", () => {
  const s = new Store();
  for (const l of ["SET k v PX 0", "SET k v PX -5", "SET k v PX 1.5", "SET k v PX abc", "SET k v PX", "SET k v EX 5", "SET k", "GET", "GET a b", "DEL", "EXPIRE k", "EXPIRE k 0", "TTL", "KEYS x", "BEGIN now"]) {
    assert.equal(execute(s, l), "(error) WRONG ARGS", l);
  }
  assert.deepEqual(s.keys(), []);
});

test("errors for unknown and empty commands; execute never throws", () => {
  const s = new Store();
  assert.equal(execute(s, "FLY away"), "(error) UNKNOWN COMMAND");
  assert.equal(execute(s, ""), "(error) EMPTY");
  assert.equal(execute(s, "   \t "), "(error) EMPTY");
  assert.equal(execute(s, "COMMIT"), "(error) NO TRANSACTION");
  assert.equal(execute(s, "rollback"), "(error) NO TRANSACTION");
});

test("transactions through the protocol", () => {
  const s = new Store();
  assert.deepEqual(
    run(s, "SET a 1", "BEGIN", "SET a 2", "BEGIN", "DEL a", "GET a", "ROLLBACK", "GET a", "ROLLBACK", "GET a", "ROLLBACK"),
    ["OK", "OK", "OK", "OK", "(integer) 1", "(nil)", "OK", "2", "OK", "1", "(error) NO TRANSACTION"],
  );
});

// --- CLI --------------------------------------------------------------------

const cli = fileURLToPath(new URL("../src/cli.mjs", import.meta.url));

test("cli: one response per non-empty line, CRLF tolerated, exit 0", () => {
  const input = 'SET a 1\r\nGET a\r\n\r\n   \nBEGIN\nSET a "x y"\nGET a\nROLLBACK\nGET a\nNOPE\n';
  const r = spawnSync(process.execPath, [cli], { input, encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(r.stdout.split(/\r?\n/).filter((l, i, a) => i < a.length - 1 || l !== ""), ["OK", "1", "OK", "OK", "x y", "OK", "1", "(error) UNKNOWN COMMAND"]);
});

test("cli: state is shared across lines and input without a final newline works", () => {
  const r = spawnSync(process.execPath, [cli], { input: "SET k v\nKEYS", encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual(r.stdout.trim().split(/\r?\n/), ["OK", "k"]);
});
