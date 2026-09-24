// Holdout suite for examples/minisheet. Never show it to the planner or solvers:
// it grades the final result independently of the tests graftree wrote.
// Every test checks a rule stated in PROBLEM.md.
import { test } from "node:test";
import assert from "node:assert/strict";
import { Sheet } from "../src/sheet.mjs";

const sheet = (cells = {}) => {
  const s = new Sheet();
  for (const [a, v] of Object.entries(cells)) s.set(a, v);
  return s;
};
/** Display of a one-off formula (optionally with other cells set). */
const show = (formula, cells = {}) => {
  const s = sheet(cells);
  s.set("ZZ9999", formula);
  return s.display("ZZ9999");
};

// --- API and input ----------------------------------------------------------

test("existing address helpers still work", async () => {
  const { parseAddress, numberToCol } = await import("../src/address.mjs");
  assert.deepEqual(parseAddress("zz9999"), { col: 702, row: 9999 });
  assert.equal(numberToCol(27), "AA");
});

test("input kinds: number, boolean, apostrophe text, untrimmed text, empty", () => {
  const s = sheet({ A1: " 12 ", A2: "1e3", A3: "true", A4: "'=1+1", A5: " hi ", A6: "-.5", A7: "1,000" });
  assert.deepEqual(s.get("A1"), { type: "number", value: 12 });
  assert.deepEqual(s.get("A2"), { type: "number", value: 1000 });
  assert.deepEqual(s.get("A3"), { type: "boolean", value: true });
  assert.deepEqual(s.get("A4"), { type: "string", value: "=1+1" });
  assert.deepEqual(s.get("A5"), { type: "string", value: " hi " });
  assert.equal(s.display("A6"), "-0.5");
  assert.deepEqual(s.get("A7"), { type: "string", value: "1,000" });
  s.set("A1", "");
  assert.deepEqual(s.get("A1"), { type: "empty" });
  assert.equal(s.display("A1"), "");
  assert.deepEqual(s.cells(), ["A2", "A3", "A4", "A5", "A6", "A7"]);
});

test("API validation: TypeError for non-string input, RangeError for bad addresses and counts", () => {
  const s = new Sheet();
  assert.throws(() => s.set("A1", 5), TypeError);
  for (const bad of ["A0", "AAA1", "A10000", "1A"]) assert.throws(() => s.get(bad), RangeError, bad);
  assert.throws(() => s.insertRows(0), RangeError);
  assert.throws(() => s.deleteRows(1, 0), RangeError);
  assert.throws(() => s.insertCols("AAA"), RangeError);
  assert.throws(() => s.deleteCols("B", 1.5), RangeError);
});

test("parse errors give #ERROR! and keep the input", () => {
  for (const f of ["=", "=1+", "=SUM(1,)", '="abc', "=A10000", "=ZZZ1", "=(1", "=1 2", "=A1:", "=AB"]) {
    const s = sheet({ A1: f });
    assert.deepEqual(s.get("A1"), { type: "error", value: "#ERROR!" }, f);
    assert.equal(s.formula("A1"), f);
  }
});

// --- operators, precedence ---------------------------------------------------

test("precedence: unary minus binds tighter than ^, ^ is left-associative, % before ^", () => {
  assert.equal(show("=-2^2"), "4");
  assert.equal(show("=2^3^2"), "64");
  assert.equal(show("=2^-1"), "0.5");
  assert.equal(show("=50%"), "0.5");
  assert.equal(show("=4^50%"), "2");
  assert.equal(show("=-50%"), "-0.5");
  assert.equal(show("=1+2*3-4/2"), "5");
  assert.equal(show("=(1+2)*3"), "9");
  assert.equal(show('=1+2&"x"'), "3x");
  assert.equal(show('=1&2=12'), "FALSE"); // "12" (string) vs 12 (number)
  assert.equal(show('="12"=1&2'), "TRUE");
});

test("whitespace, case-insensitive names, string escapes", () => {
  assert.equal(show('=  sum( 1 , 2 )  +  1 '), "4");
  assert.equal(show('="say ""hi"""'), 'say "hi"');
  assert.equal(show("=true"), "TRUE");
  assert.equal(show("=a1*2", { A1: "21" }), "42");
});

test("arithmetic coercion: booleans, empty, numeric strings; other strings are #VALUE!", () => {
  assert.equal(show("=TRUE+TRUE"), "2");
  assert.equal(show("=A1+1"), "1");
  assert.equal(show('=" 3 "+1'), "4");
  assert.equal(show('="1e2"*2'), "200");
  assert.equal(show('="abc"+1'), "#VALUE!");
  assert.equal(show('=""+1'), "#VALUE!");
  assert.equal(show("=-A1", { A1: "'5" }), "-5");
});

test("errors: #DIV/0!, #NUM!, left operand's error first", () => {
  assert.equal(show("=1/0"), "#DIV/0!");
  assert.equal(show("=0/0"), "#DIV/0!");
  assert.equal(show("=10^400"), "#NUM!");
  assert.equal(show("=(-1)^0.5"), "#NUM!");
  assert.equal(show("=1/0+FOO()"), "#DIV/0!");
  assert.equal(show("=FOO()+1/0"), "#NAME?");
  assert.equal(show('=(1/0)&"x"'), "#DIV/0!");
  assert.equal(show("=#REF!+1"), "#REF!");
});

test("a formula that refers to an empty cell is 0; ranges outside function args are #VALUE!", () => {
  const s = sheet({ B1: "=A1", B2: "=A1:A2", B3: "=A1:A2+1" });
  assert.deepEqual(s.get("B1"), { type: "number", value: 0 });
  assert.equal(s.display("B2"), "#VALUE!");
  assert.equal(s.display("B3"), "#VALUE!");
});

// --- display ------------------------------------------------------------------

test("number display: 15 significant digits, no trailing zeros", () => {
  assert.equal(show("=0.1+0.2"), "0.3");
  assert.equal(show("=1/3"), "0.333333333333333");
  assert.equal(show("=-2/3"), "-0.666666666666667");
  assert.equal(show("=123456789012345"), "123456789012345");
  assert.equal(show("=2.50"), "2.5");
  assert.equal(show("=0.000000001"), "0.000000001");
  assert.equal(show("=-0"), "0");
  assert.equal(show("=1-1"), "0");
});

test("number display: scientific form at >= 1e15 and < 1e-9", () => {
  assert.equal(show("=1e15"), "1E+15");
  assert.equal(show("=1.5e20"), "1.5E+20");
  assert.equal(show("=-2.25e15"), "-2.25E+15");
  assert.equal(show("=1e-10"), "1E-10");
  assert.equal(show("=999999999999999.9"), "1E+15");
  assert.equal(show("=1234567890123456789"), "1.23456789012346E+18");
});

test("get returns the unrounded number; display rounds", () => {
  const s = sheet({ A1: "=0.1+0.2" });
  assert.deepEqual(s.get("A1"), { type: "number", value: 0.1 + 0.2 });
  assert.equal(s.display("A1"), "0.3");
});

// --- comparison -----------------------------------------------------------------

test("comparison: type order, case-insensitive strings, 15-digit numbers", () => {
  assert.equal(show('=1<"a"'), "TRUE");
  assert.equal(show('="a"<TRUE'), "TRUE");
  assert.equal(show('=FALSE>999'), "TRUE");
  assert.equal(show('=1="1"'), "FALSE");
  assert.equal(show('="abc"="ABC"'), "TRUE");
  assert.equal(show('="a"<"B"'), "TRUE");
  assert.equal(show('="Z"<"a"'), "FALSE");
  assert.equal(show("=0.1+0.2=0.3"), "TRUE");
  assert.equal(show("=0.1+0.2<>0.3"), "FALSE");
  assert.equal(show("=1<>2"), "TRUE");
  assert.equal(show("=2>=2"), "TRUE");
});

test("comparison with empty cells adapts to the other side", () => {
  assert.equal(show("=A1=0"), "TRUE");
  assert.equal(show('=A1=""'), "TRUE");
  assert.equal(show("=A1=FALSE"), "TRUE");
  assert.equal(show("=A1=B1"), "TRUE");
  assert.equal(show('=A1<"a"'), "TRUE");
  assert.equal(show("=A1<1"), "TRUE");
});

// --- functions ------------------------------------------------------------------

test("SUM: references ignore text and booleans, expressions are converted", () => {
  const cells = { A1: "1", A2: "'2", A3: "TRUE", A4: "=3", B1: "'3" };
  assert.equal(show("=SUM(A1:A5)", cells), "4");
  assert.equal(show("=SUM(B1)", cells), "0");
  assert.equal(show('=SUM("3", TRUE, 1)'), "5");
  assert.equal(show("=SUM(B1+0)", cells), "3");
  assert.equal(show('=SUM("x")'), "#VALUE!");
  assert.equal(show("=SUM(A1:B2, 10)", cells), "11");
  assert.equal(show("=SUM(A1:A2, C1)", { ...cells, C1: "=1/0" }), "#DIV/0!");
  assert.equal(show("=SUM()"), "#VALUE!");
  assert.equal(show("=sum(A1:A4)", cells), "4");
});

test("MIN, MAX, AVERAGE", () => {
  const cells = { A1: "4", A2: "'x", A3: "-2", A4: "", B1: "'a" };
  assert.equal(show("=MIN(A1:A4)", cells), "-2");
  assert.equal(show("=MAX(A1:A4, 7)", cells), "7");
  assert.equal(show("=AVERAGE(A1:A4)", cells), "1");
  assert.equal(show("=MIN(B1:B3)", cells), "0");
  assert.equal(show("=MAX(B1)", cells), "0");
  assert.equal(show("=AVERAGE(B1:B3)", cells), "#DIV/0!");
  assert.equal(show('=AVERAGE("2", 4)'), "3");
});

test("COUNT never errors", () => {
  const cells = { A1: "1", A2: "'2", A3: "TRUE", A4: "=1/0", A5: "=2" };
  assert.equal(show("=COUNT(A1:A6)", cells), "2");
  assert.equal(show('=COUNT("3", "x", TRUE, 1/0, 5)'), "3");
  assert.equal(show("=COUNT(A4)", cells), "0");
});

test("IF evaluates only the chosen branch; default else is FALSE", () => {
  assert.equal(show("=IF(TRUE, 1, 1/0)"), "1");
  assert.equal(show("=IF(0, 1/0, 2)"), "2");
  assert.equal(show("=IF(FALSE, 1)"), "FALSE");
  assert.equal(show('=IF("true", "y", "n")'), "y");
  assert.equal(show('=IF("yes", 1, 2)'), "#VALUE!");
  assert.equal(show("=IF(1/0, 1, 2)"), "#DIV/0!");
  assert.equal(show("=IF(A1, 1, 2)"), "2");
  assert.equal(show("=IF(1)"), "#VALUE!");
});

test("AND, OR, NOT", () => {
  const cells = { A1: "TRUE", A2: "'hello", A3: "0", B1: "'x", C1: "=1/0" };
  assert.equal(show("=AND(A1:A4)", cells), "FALSE");
  assert.equal(show("=OR(A1:A4)", cells), "TRUE");
  assert.equal(show("=AND(B1:B2)", cells), "#VALUE!");
  assert.equal(show("=AND(1, 2)"), "TRUE");
  assert.equal(show('=OR("false", 0)'), "FALSE");
  assert.equal(show('=AND("x")'), "#VALUE!");
  assert.equal(show("=OR(TRUE, C1)", cells), "#DIV/0!");
  assert.equal(show("=NOT(0)"), "TRUE");
  assert.equal(show("=NOT(A1)", cells), "FALSE");
});

test("CONCAT and LEN", () => {
  const cells = { A1: "a", A2: "", A3: "=1/4", B1: "TRUE", B3: "x" };
  assert.equal(show("=CONCAT(A1:B3)", cells), "aTRUE0.25x");
  assert.equal(show('=CONCAT("n=", 0.1+0.2)'), "n=0.3");
  assert.equal(show("=LEN(A3)", cells), "4");
  assert.equal(show("=LEN(A1:A2)", cells), "#VALUE!");
  assert.equal(show("=LEN(12.50)"), "4");
  assert.equal(show("=LEN(A2)", cells), "0");
});

test("ABS and ROUND (decimal, halves away from zero)", () => {
  assert.equal(show("=ABS(-3.5)"), "3.5");
  assert.equal(show("=ROUND(1.005, 2)"), "1.01");
  assert.equal(show("=ROUND(2.5, 0)"), "3");
  assert.equal(show("=ROUND(-2.5, 0)"), "-3");
  assert.equal(show("=ROUND(1234.5, -2)"), "1200");
  assert.equal(show("=ROUND(2.675, 2)"), "2.68");
  assert.equal(show("=ROUND(1.2345, 2.9)"), "1.23");
  assert.equal(show("=ROUND(0.1+0.2, 1)=0.3"), "TRUE");
  assert.equal(show("=ROUND(1)"), "#VALUE!");
});

test("unknown functions are #NAME? without evaluating arguments, even if the name looks like a reference", () => {
  assert.equal(show("=NOPE(1/0)"), "#NAME?");
  assert.equal(show("=AB12(1)"), "#NAME?");
  assert.equal(show("=LEN(1, 2, 1/0)"), "#VALUE!");
});

// --- dependencies, cycles, recalculation --------------------------------------------

test("recalculation follows every change", () => {
  const s = sheet({ A1: "1", A2: "=A1*2", A3: "=A2+A1", B1: "=SUM(A1:A3)" });
  assert.equal(s.display("B1"), "6");
  s.set("A1", "10");
  assert.equal(s.display("A3"), "30");
  assert.equal(s.display("B1"), "60");
  s.set("A4", "5"); // outside the range: no effect
  s.set("A2", "7");
  assert.equal(s.display("B1"), "34"); // 10 + 7 + 17
});

test("cycles: every cell on the cycle is #CYCLE!, dependents get the error, and it recovers", () => {
  const s = sheet({ A1: "=B1+1", B1: "=C1", C1: "=A1", D1: "=A1+1", E1: "=COUNT(A1)", F1: "=F1" });
  for (const c of ["A1", "B1", "C1", "D1", "F1"]) assert.equal(s.display(c), "#CYCLE!", c);
  assert.equal(s.display("E1"), "0");
  s.set("C1", "5");
  assert.equal(s.display("A1"), "6");
  assert.equal(s.display("B1"), "5");
  assert.equal(s.display("D1"), "7");
  assert.equal(s.display("E1"), "1");
});

test("cycles count references in untaken IF branches and in ranges", () => {
  const s = sheet({ A1: "=IF(TRUE, 1, B1)", B1: "=A1", C1: "=SUM(C2:C3)", C3: "=C1" });
  assert.equal(s.display("A1"), "#CYCLE!");
  assert.equal(s.display("B1"), "#CYCLE!");
  assert.equal(s.display("C1"), "#CYCLE!");
  assert.equal(s.display("C3"), "#CYCLE!");
});

test("a 9,999-cell chain works in any build order, fast", () => {
  const t0 = Date.now();
  const s = new Sheet();
  for (let r = 9999; r >= 2; r--) s.set(`A${r}`, `=A${r - 1}+1`);
  s.set("A1", "1");
  for (let r = 1; r <= 9999; r++) s.display(`A${r}`);
  assert.equal(s.display("A9999"), "9999");
  s.set("A1", "0");
  assert.equal(s.display("A9999"), "9998");
  assert.ok(Date.now() - t0 < 5000, `took ${Date.now() - t0} ms`);
});

test("a 9,999-cell cycle is detected without a stack overflow", () => {
  const s = new Sheet();
  for (let r = 2; r <= 9999; r++) s.set(`A${r}`, `=A${r - 1}`);
  s.set("A1", "=A9999");
  assert.equal(s.display("A5000"), "#CYCLE!");
  s.set("A1", "7");
  assert.equal(s.display("A9999"), "7");
});

// --- insert / delete -------------------------------------------------------------------

test("insertRows moves cells and rewrites single references, relative and absolute", () => {
  const s = sheet({ A1: "1", A2: "2", A3: "3", B1: "=A1+A2 + $A$3", C5: "=a2*2" });
  s.insertRows(2, 2);
  assert.equal(s.formula("B1"), "=A1+A4 + $A$5");
  assert.equal(s.display("B1"), "6");
  assert.equal(s.display("A4"), "2");
  assert.equal(s.formula("C7"), "=A4*2");
  assert.equal(s.display("C7"), "4");
  assert.equal(s.formula("C5"), "");
  assert.deepEqual(s.cells(), ["A1", "B1", "A4", "A5", "C7"]);
});

test("insertRows: ranges grow when inserting inside, shift when above", () => {
  const s = sheet({ A2: "1", A3: "2", A4: "3", B1: "=SUM(A2:A4)", C1: "=SUM(A2:A4)", D1: "=SUM($A$2:A4)" });
  s.insertRows(3); // inside
  assert.equal(s.formula("B1"), "=SUM(A2:A5)");
  s.set("A3", "10");
  assert.equal(s.display("B1"), "16");
  s.insertRows(2); // at the top row: both ends move
  assert.equal(s.formula("C1"), "=SUM(A3:A6)");
  assert.equal(s.formula("D1"), "=SUM($A$3:A6)");
  s.insertRows(7); // below: unchanged
  assert.equal(s.formula("C1"), "=SUM(A3:A6)");
  assert.equal(s.display("C1"), "16");
});

test("deleteRows: deleted single references become #REF!, ranges shrink or become #REF!", () => {
  const s = sheet({ A1: "1", A2: "2", A3: "3", A4: "4", A5: "5", B1: "=A3*2", C1: "=SUM(A2:A4)", D1: "=SUM(A3:A3)", E1: "=A5-A1", F3: "=1", F5: "=SUM(A1:A5)" });
  s.deleteRows(3);
  assert.equal(s.formula("B1"), "=#REF!*2");
  assert.equal(s.display("B1"), "#REF!");
  assert.equal(s.formula("C1"), "=SUM(A2:A3)");
  assert.equal(s.display("C1"), "6");
  assert.equal(s.formula("D1"), "=SUM(#REF!)");
  assert.equal(s.display("D1"), "#REF!");
  assert.equal(s.formula("E1"), "=A4-A1");
  assert.equal(s.display("E1"), "4");
  assert.equal(s.formula("F3"), "");
  assert.equal(s.formula("F4"), "=SUM(A1:A4)");
  assert.equal(s.display("F4"), "12");
});

test("deleteRows: a range losing its top rows closes up", () => {
  const s = sheet({ A2: "2", A3: "3", A4: "4", A5: "5", C9: "=SUM(A3:A5)", D9: "=SUM(A1:A2)" });
  s.deleteRows(2, 2); // rows 2..3
  assert.equal(s.formula("C7"), "=SUM(A2:A3)");
  assert.equal(s.display("C7"), "9");
  assert.equal(s.formula("D7"), "=SUM(A1:A1)");
});

test("columns behave like rows", () => {
  const s = sheet({ A1: "1", B1: "2", C1: "3", A2: "=SUM(A1:C1)", B2: "=C1", C2: "=$B$1" });
  s.insertCols("B");
  assert.equal(s.formula("A2"), "=SUM(A1:D1)");
  assert.equal(s.formula("C2"), "=D1");
  assert.equal(s.formula("D2"), "=$C$1");
  s.deleteCols("C", 2); // the old B and C
  assert.equal(s.formula("A2"), "=SUM(A1:B1)");
  assert.equal(s.display("A2"), "1");
  assert.deepEqual(s.cells(), ["A1", "A2"]);
});

test("rewriting only touches reference text: strings, function-name case and spacing stay", () => {
  const s = sheet({ A5: "7", B1: '=concat( "A5 is ", A5 )  &  "!"', B2: "=sum(A1:A2)" });
  s.insertRows(1);
  assert.equal(s.formula("B2"), '=concat( "A5 is ", A6 )  &  "!"');
  assert.equal(s.display("B2"), "A5 is 7!");
  assert.equal(s.formula("B3"), "=sum(A2:A3)");
});

test("rewritten references are upper case; a reversed range is written top-left first", () => {
  const s = sheet({ C1: "=a$4+SUM(b5:$a2)" });
  s.insertRows(3);
  assert.equal(s.formula("C1"), "=A$5+SUM($A2:B6)");
});

test("cells pushed past row 9999 are dropped and references to them become #REF!", () => {
  const s = sheet({ A9998: "1", A9999: "2", B1: "=A9999", C1: "=SUM(A9990:A9999)", D1: "=A9998" });
  s.insertRows(9999);
  assert.equal(s.formula("B1"), "=#REF!");
  assert.equal(s.formula("C1"), "=SUM(#REF!)");
  assert.equal(s.formula("D1"), "=A9998");
  assert.deepEqual(s.cells(), ["B1", "C1", "D1", "A9998"]);
});

test("formulas that do not parse are left alone by structural edits", () => {
  const s = sheet({ B1: "=A3+", B2: "=A3" });
  s.insertRows(1);
  assert.equal(s.formula("B2"), "=A3+");
  assert.equal(s.formula("B3"), "=A4");
});

// --- copy -------------------------------------------------------------------------------

test("copy moves relative coordinates only", () => {
  const s = sheet({ A1: "1", A2: "2", B1: "10", B2: "20", C1: "=A1+$B$1+A$2+$B1" });
  s.copy("C1", "D2");
  assert.equal(s.formula("D2"), "=B2+$B$1+B$2+$B2");
  assert.equal(s.display("D2"), "70"); // 20 + 10 + 20 + 20
  assert.equal(s.formula("C1"), "=A1+$B$1+A$2+$B1");
});

test("copy: references leaving the sheet become #REF!, strings and text stay, case is normalized", () => {
  const s = sheet({ B2: '=sum(a1:b1) & "A1" & a1', C3: "hello", D4: "=1+" });
  s.copy("B2", "A1");
  assert.equal(s.formula("A1"), '=sum(#REF!) & "A1" & #REF!');
  s.copy("B2", "C3");
  assert.equal(s.formula("C3"), '=sum(B2:C2) & "A1" & B2');
  s.copy("D4", "E5");
  assert.equal(s.formula("E5"), "=1+");
  s.copy("Z1", "C3");
  assert.equal(s.formula("C3"), "");
  s.set("F1", "plain A1");
  s.copy("F1", "G2");
  assert.equal(s.formula("G2"), "plain A1");
});
