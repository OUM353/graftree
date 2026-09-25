// Strict holdout suite for examples/minisheet: rules of PROBLEM.md that the
// original 38 tests do not exercise. Written from the spec alone, without
// looking at any graded solution. Like the original suite, never show it to the
// planner or solvers. One test per rule, so a score counts rules, not files.
import { test } from "node:test";
import assert from "node:assert/strict";
import { Sheet } from "../src/sheet.mjs";

const sheet = (cells = {}) => {
  const s = new Sheet();
  for (const [a, v] of Object.entries(cells)) s.set(a, v);
  return s;
};
const show = (formula, cells = {}) => {
  const s = sheet(cells);
  s.set("ZZ9999", formula);
  return s.display("ZZ9999");
};

// [section, rule, formula, expected display, other cells]
const cases = [
  // §2 input
  // §3 syntax
  ["3", "number literal forms .5, 1., 1E+2", "=.5+1.+1E+2", "101.5"],
  ["3", "spaces around a range colon", "=SUM(A1 : A2)", "3", { A1: "1", A2: "2" }],
  ["3", "lower-case absolute references", "=$a$1+a$2", "3", { A1: "1", A2: "2" }],
  ["3", "a name followed by a space and ( is not a function call", "=SUM (1)", "#ERROR!"],
  ["3", "an empty argument in the middle is a parse error", "=IF(TRUE,,1)", "#ERROR!"],
  ["3", "function names may contain digits and dots", "=LOG10(1)+SUM.X(1)", "#NAME?"],
  ["3", "stacked unary operators", "=-+-2", "2"],
  ["3", "percent binds tighter than ^", "=2^300%", "8"],
  ["3", "repeated percent", "=50%%", "0.005"],
  ["3", "parenthesised negation before ^", "=(-3)^2-(-(3^2))", "18"],
  ["3", "unary minus binds tighter than ^ after *", "=2*-3^2", "18"],
  ["3", "subtraction and division are left-associative", "=2-3-4&\"|\"&16/4/2", "-5|2"],
  ["3", "& binds looser than +", "=1+2&3+4", "37"],
  ["3", "comparison binds looser than &", '="a"&"b"="AB"', "TRUE"],
  ["3", "comparisons are left-associative (TRUE<3 compares boolean to number)", "=1<2<3", "FALSE"],
  // §4 coercion and display
  ["4", "a string that is not a number literal is #VALUE! in arithmetic", '="TRUE"+1', "#VALUE!"],
  ["4", "unary minus converts booleans", "=-TRUE", "-1"],
  ["4", "numbers join as displayed", '=1e20&"|"&(0.1*3)&"|"&TRUE', "1E+20|0.3|TRUE"],
  ["4", "text-to-boolean does not trim", '=IF(" true ",1,2)', "#VALUE!"],
  ["4", "text-to-boolean accepts any case", '=IF("fAlSe",1,2)', "2"],
  ["4", "any non-zero number is TRUE", "=IF(-0.5,1,2)", "1"],
  ["4", "other strings are #VALUE! for NOT", '=NOT("x")', "#VALUE!"],
  ["4", "display rounds to 15 significant digits", "=123456789.123456789", "123456789.123457"],
  ["4", "small numbers above 1e-9 display in plain decimals", "=1/7*1e-5", "0.00000142857142857143"],
  ["4", "integers beyond 15 digits use scientific form", "=2^53+1", "9.00719925474099E+15"],
  ["4", "negative tiny numbers use scientific form", "=-1e-10", "-1E-10"],
  ["4", "an infinite power is #NUM!", "=0^-1", "#NUM!"],
  ["4", "overflowing multiplication is #NUM!", "=1e308*10", "#NUM!"],
  // §5 operators
  ["5", "the right operand's error wins over a left value that fails conversion", '="abc"+(1/0)', "#DIV/0!"],
  ["5", "a range in a comparison is #VALUE!", "=A1:A2=1", "#VALUE!"],
  ["5", "string comparison is case-insensitive in ordering too", '="abc"<"ABD"', "TRUE"],
  ["5", "trailing spaces make strings differ", '="a"="a "', "FALSE"],
  ["5", "15-digit comparison: 1/3*3 equals 1", "=1/3*3=1", "TRUE"],
  ["5", "TRUE is greater than FALSE", "=TRUE>FALSE", "TRUE"],
  ["5", "an error operand of a comparison is the result", "=1/0=1", "#DIV/0!"],
  // §6 functions
  ["6", "SUM ignores a boolean in a single-cell reference", "=SUM(A1)&\"|\"&SUM(A1+0)", "0|1", { A1: "TRUE" }],
  ["6", "SUM: the first error in argument order wins", '=SUM(1/0,"x")', "#DIV/0!"],
  ["6", "SUM: first error, other order", '=SUM("x",1/0)', "#VALUE!"],
  ["6", "MIN/MAX convert expression arguments", '=MIN("5",3)&"|"&MAX(TRUE)', "3|1"],
  ["6", "AVERAGE skips empty cells in a range", "=AVERAGE(A1:A3)", "2", { A1: "1", A3: "3" }],
  ["6", "COUNT: numeric text in cells is not counted, numeric text arguments are", '=COUNT(A1)&"|"&COUNT("7")&"|"&COUNT(B1)', "0|1|0", { A1: "'5" }],
  ["6", "IF returning an empty cell gives 0", "=IF(TRUE,A1)", "0"],
  ["6", "IF with too many arguments is #VALUE!", "=IF(TRUE,1,2,3)", "#VALUE!"],
  ["6", "IF condition from a cell holding the text TRUE", "=IF(A1,\"y\",\"n\")", "y", { A1: "'TRUE" }],
  ["6", "AND ignores text in reference arguments", "=AND(TRUE,A1)", "TRUE", { A1: "'x" }],
  ["6", "AND: an expression string is #VALUE!", '=AND(FALSE,"x")', "#VALUE!"],
  ["6", "OR evaluates every argument (no short-circuit)", "=OR(TRUE,1/0)", "#DIV/0!"],
  ["6", "NOT converts text", '=NOT("TRUE")', "FALSE"],
  ["6", "CONCAT: an error in a range is the result", "=CONCAT(A1:A2)", "#DIV/0!", { A1: "a", A2: "=1/0" }],
  ["6", "CONCAT converts booleans and numbers", "=CONCAT(TRUE,1,0.1+0.2)", "TRUE10.3"],
  ["6", "LEN of a one-cell range and of converted values", '=LEN(A1:A1)&"|"&LEN(TRUE)&"|"&LEN(1/3)', "3|4|17", { A1: "abc" }],
  ["6", "ABS of non-numeric text is #VALUE!", '=ABS("x")', "#VALUE!"],
  ["6", "ABS of numeric text", '=ABS("-2")', "2"],
  ["6", "ROUND converts its digits argument", '=ROUND(1.2345,"2")', "1.23"],
  ["6", "ROUND halves away from zero for negatives", "=ROUND(-1.005,2)", "-1.01"],
  ["6", "ROUND 1.45 to one place is 1.5 (decimal, not binary)", "=ROUND(1.45,1)", "1.5"],
  ["6", "ROUND to tens, halves away from zero", '=ROUND(5,-1)&"|"&ROUND(-5,-1)&"|"&ROUND(123.456,-1)', "10|-10|120"],
  ["6", "ROUND truncates negative fractional digits toward zero", "=ROUND(1.5,-0.5)", "2"],
  ["6", "function names are case-insensitive", "=Sum(1,2)", "3"],
  ["6", "wrong arity for NOT and ABS", '=NOT(1,2)&ABS()', "#VALUE!"],
];

for (const [section, name, formula, expected, cells] of cases) {
  test(`§${section} ${name}`, () => assert.equal(show(formula, cells), expected, formula));
}

// --- §1 / §2 API and input ------------------------------------------------------

test("§2 a lone apostrophe is an empty string, not an empty cell", () => {
  const s = sheet({ A1: "'" });
  assert.deepEqual(s.get("A1"), { type: "string", value: "" });
  assert.deepEqual(s.cells(), ["A1"]);
});

test("§2 spaces only is text, not a number or an empty cell", () => {
  const s = sheet({ A1: "   " });
  assert.deepEqual(s.get("A1"), { type: "string", value: "   " });
});

test("§2 near-numbers stay text", () => {
  const s = sheet({ A1: "1e", A2: "0x10", A3: "1 000", A4: "Infinity", A5: "+5", A6: "5.", A7: ".5e1" });
  for (const a of ["A1", "A2", "A3", "A4"]) assert.equal(s.get(a).type, "string", a);
  for (const a of ["A5", "A6", "A7"]) assert.deepEqual(s.get(a), { type: "number", value: 5 }, a);
});

test("§2 booleans in any case; display shows TRUE/FALSE", () => {
  const s = sheet({ A1: "FaLsE" });
  assert.deepEqual(s.get("A1"), { type: "boolean", value: false });
  assert.equal(s.display("A1"), "FALSE");
});

test("§2 input that starts with a space before = is not a formula", () => {
  const s = sheet({ A1: " =1" });
  assert.deepEqual(s.get("A1"), { type: "string", value: " =1" });
});

test("§1 every method accepts lower-case addresses", () => {
  const s = sheet({ a1: "=b1*2", b1: "4" });
  assert.equal(s.display("a1"), "8");
  assert.equal(s.formula("a1"), "=b1*2");
  s.copy("a1", "a2");
  assert.equal(s.formula("A2"), "=B2*2");
  s.insertCols("a");
  assert.equal(s.formula("B1"), "=C1*2");
  assert.equal(s.display("B1"), "8");
});

test("§1 get returns errors as { type: 'error', value }", () => {
  const s = sheet({ A1: "=1/0" });
  assert.deepEqual(s.get("A1"), { type: "error", value: "#DIV/0!" });
});

test("§1 RangeError for a row past 9999 and a non-string input TypeError for null", () => {
  const s = new Sheet();
  assert.throws(() => s.insertRows(10000), RangeError);
  assert.throws(() => s.set("A1", null), TypeError);
});

// --- §7 dependencies and cycles ------------------------------------------------------

test("§7 a range that includes its own cell is a cycle", () => {
  const s = sheet({ A1: "1", A3: "=SUM(A1:A3)" });
  assert.equal(s.display("A3"), "#CYCLE!");
});

test("§7 a cell outside a cycle that does not evaluate it keeps its value", () => {
  const s = sheet({ A1: "=A2", A2: "=A1", B1: "=IF(TRUE,1,A1)" });
  assert.equal(s.display("A1"), "#CYCLE!");
  assert.equal(s.display("B1"), "1");
});

test("§7 clearing a cell breaks the cycle", () => {
  const s = sheet({ A1: "=A2+1", A2: "=A1" });
  assert.equal(s.display("A1"), "#CYCLE!");
  s.set("A2", "");
  assert.equal(s.display("A1"), "1");
});

test("§7 deleting a row of a cycle leaves #REF!, not #CYCLE!", () => {
  const s = sheet({ A1: "=A2", A2: "=A1" });
  s.deleteRows(2);
  assert.equal(s.formula("A1"), "=#REF!");
  assert.equal(s.display("A1"), "#REF!");
});

test("§7 a formula that depends on an empty cell updates when it is set", () => {
  const s = sheet({ B1: "=A1*2" });
  assert.equal(s.display("B1"), "0");
  s.set("A1", "3");
  assert.equal(s.display("B1"), "6");
});

// --- §8 structural edits ------------------------------------------------------------------

test("§8 references an edit does not move keep their original text", () => {
  const s = sheet({ C1: "=a1+b9+sum(a1:a2)" });
  s.insertRows(5);
  assert.equal(s.formula("C1"), "=a1+B10+sum(a1:a2)");
});

test("§8 a reversed range is rewritten top-left first (columns)", () => {
  const s = sheet({ A5: "=SUM(C2:A1)" });
  s.insertCols("B");
  assert.equal(s.formula("A5"), "=SUM(A1:D2)");
});

test("§8 function names that look like references are not rewritten", () => {
  const s = sheet({ C1: "=AB12(A1)" });
  s.insertCols("A");
  assert.equal(s.formula("D1"), "=AB12(B1)");
});

test("§8 #REF! literals stay and neighbours are rewritten", () => {
  const s = sheet({ B1: "=#REF!+A1" });
  s.insertRows(1);
  assert.equal(s.formula("B2"), "=#REF!+A2");
});

test("§8 a range whose bottom is pushed past row 9999 becomes #REF!", () => {
  const s = sheet({ B1: "=SUM(A2:A9999)" });
  s.insertRows(1);
  assert.equal(s.formula("B2"), "=SUM(#REF!)");
});

test("§8 inserting exactly at a range's bottom row grows it; one row below does not", () => {
  const s = sheet({ C1: "=SUM(A2:A4)", D1: "=SUM(A2:A4)" });
  s.insertRows(4);
  assert.equal(s.formula("C1"), "=SUM(A2:A5)");
  s.insertRows(6);
  assert.equal(s.formula("D1"), "=SUM(A2:A5)");
});

test("§8 deleting rows across a range's bottom shrinks it", () => {
  const s = sheet({ C1: "=SUM(A2:A6)" });
  s.deleteRows(5, 4);
  assert.equal(s.formula("C1"), "=SUM(A2:A4)");
});

test("§8 columns pushed past ZZ are dropped and references to them become #REF!", () => {
  const s = sheet({ ZZ1: "5", A1: "=ZZ1", A2: "=SUM(ZY1:ZZ1)" });
  s.insertCols("ZZ");
  assert.equal(s.formula("A1"), "=#REF!");
  assert.equal(s.formula("A2"), "=SUM(#REF!)");
  assert.deepEqual(s.cells(), ["A1", "A2"]);
});

test("§8 deleting the columns a range starts in", () => {
  const s = sheet({ B1: "2", C1: "3", D1: "4", F9: "=SUM(B1:D1)" });
  s.deleteCols("A", 2);
  assert.equal(s.formula("D9"), "=SUM(A1:B1)");
  assert.equal(s.display("D9"), "7");
});

// --- §9 copy ---------------------------------------------------------------------------------

test("§9 copy keeps absolute columns and moves relative rows", () => {
  const s = sheet({ C3: "=$A1+A$1" });
  s.copy("C3", "E6");
  assert.equal(s.formula("E6"), "=$A4+C$1");
});

test("§9 copy moves both ends of a range", () => {
  const s = sheet({ C3: "=SUM(A1:B2)" });
  s.copy("C3", "D5");
  assert.equal(s.formula("D5"), "=SUM(B3:C4)");
});

test("§9 copy: a range with one end leaving the sheet becomes #REF!", () => {
  const s = sheet({ C3: "=SUM(B2:C3)" });
  s.copy("C3", "B3");
  assert.equal(s.formula("B3"), "=SUM(A2:B3)");
  s.copy("C3", "C2");
  assert.equal(s.formula("C2"), "=SUM(B1:C2)");
  s.copy("C3", "B1");
  assert.equal(s.formula("B1"), "=SUM(#REF!)");
});

test("§9 copy upper-cases every reference, absolute ones too, and keeps the rest", () => {
  const s = sheet({ B2: "=sum( $a$1 ,a1 )" });
  s.copy("B2", "B3");
  assert.equal(s.formula("B3"), "=sum( $A$1 ,A2 )");
});

test("§9 copying text input copies it exactly", () => {
  const s = sheet({ A1: "'=A1", A2: " 12 " });
  s.copy("A1", "B1");
  s.copy("A2", "B2");
  assert.equal(s.formula("B1"), "'=A1");
  assert.deepEqual(s.get("B1"), { type: "string", value: "=A1" });
  assert.deepEqual(s.get("B2"), { type: "number", value: 12 });
});

test("§9 copied formulas are evaluated", () => {
  const s = sheet({ A1: "2", A2: "5", B1: "=A1*10" });
  s.copy("B1", "B2");
  assert.equal(s.display("B2"), "50");
});
