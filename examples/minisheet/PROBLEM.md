Turn the cell store in `src/sheet.mjs` into a spreadsheet engine with formulas,
recalculation, cycle detection, and row/column insertion and deletion that
rewrites references. Keep `src/address.mjs` and its tests working. No
dependencies; Node >= 20; ES modules. Everything below is required; where it
differs from Excel, follow this document.

## 1. API (src/sheet.mjs)

```js
const s = new Sheet();
s.set("A1", "=1+2");       // input is always a string; anything else throws TypeError
s.get("A1");               // { type: "number", value: 3 }
s.display("A1");           // "3"
s.formula("A1");           // "=1+2"
s.insertRows(2, 3);        // insert 3 rows before row 2
s.deleteRows(2, 3);        // delete rows 2..4
s.insertCols("C", 2);      // insert 2 columns before column C
s.deleteCols("C", 2);      // delete columns C..D
s.copy("B1", "C3");        // copy B1's input to C3, adjusting relative references
s.cells();                 // addresses of non-empty cells, row by row: ["A1", "B1", "A2"]
```

- Addresses are case-insensitive (`"b7"` = `"B7"`). Columns are `A`..`ZZ` (1..702),
  rows are `1`..`9999`. An invalid address, row or column passed to any method
  throws a `RangeError`. `count` defaults to 1 and must be a positive integer
  (else `RangeError`).
- `get` returns one of `{ type: "empty" }`, `{ type: "number", value }`,
  `{ type: "string", value }`, `{ type: "boolean", value }`,
  `{ type: "error", value: "#DIV/0!" }` (value is the error code).
- `display` returns `""` for empty, the formatted number (section 4), `TRUE` or
  `FALSE`, the string itself, or the error code.
- `formula` returns the cell's stored input, `""` if empty. For formulas this is
  the text after any reference rewriting (section 7).
- Values are always current: after any `set`, `copy`, insert or delete, every
  `get`/`display` reflects all inputs.

## 2. Cell input (`set`)

The input string is interpreted as:

1. `""`: the cell becomes empty.
2. Starts with `=`: a formula (the rest is parsed, section 3). If it does not
   parse, the cell's value is the error `#ERROR!`; `formula` still returns the input.
3. Starts with `'`: a string, the rest of the input after the apostrophe.
4. `TRUE` or `FALSE` in any case: a boolean.
5. After trimming spaces, matches `^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$`: that
   number. (`" 12 "` is 12, `"1e3"` is 1000.)
6. Anything else: a string, exactly as given (not trimmed).

## 3. Formula syntax

Whitespace (spaces) may appear between any tokens.

- Number literals: `\d+(\.\d*)?([eE][+-]?\d+)?` or `\.\d+([eE][+-]?\d+)?`.
- String literals: `"..."`; a doubled `""` inside means one `"`.
- Booleans: `TRUE`, `FALSE` (any case).
- References: a column and a row, each optionally preceded by `$` (absolute):
  `A1`, `$A1`, `A$1`, `$A$1`, any case. Out-of-bounds references (e.g. `ZZZ1`,
  `A10000`, `A0`) are parse errors.
- Ranges: `ref:ref`, e.g. `A1:B3`. `B3:A1` means the same cells.
- The error literal `#REF!` (produced by reference rewriting, section 8).
- Function calls: `NAME(arg, ...)`: a name of letters, digits and dots starting
  with a letter, immediately followed by `(`. Case-insensitive. Zero or more
  arguments; an empty argument (`SUM(1,)`) is a parse error. A name followed by
  `(` is always a function call, even if it looks like a reference (`AB12(1)`
  calls a function named `AB12`).
- Parentheses for grouping.

Operators, from highest to lowest precedence:

| Precedence | Operator | Notes |
|---|---|---|
| 1 | `:` | range, only between two references |
| 2 | unary `-`, `+` | prefix; so `-2^2` is `4` |
| 3 | `%` | postfix, divides by 100: `50%` is `0.5` |
| 4 | `^` | power, **left**-associative: `2^3^2` is `64` |
| 5 | `*`, `/` | left-associative |
| 6 | `+`, `-` | left-associative |
| 7 | `&` | string concatenation, left-associative |
| 8 | `=`, `<>`, `<`, `>`, `<=`, `>=` | comparison, left-associative |

## 4. Values, coercion and display

A formula's value is a number, string, boolean or error. A formula whose
result is an empty cell (e.g. `=A1` with A1 empty) has the number value `0`.

Numbers are finite. Any operation or function that would produce `Infinity`,
`-Infinity` or `NaN` gives `#NUM!` (e.g. `10^400`, `(-1)^0.5`). Division by zero
gives `#DIV/0!`. `-0` is `0`.

**To number** (arithmetic, unary operators, `%`, `^`, and numeric function
arguments): numbers as is; `TRUE` is 1, `FALSE` is 0; empty is 0; a string is
trimmed and, if it matches the number pattern of section 2 rule 5, is that
number, else `#VALUE!` (so `""` is `#VALUE!`); an error stays that error.

**To string** (`&`, `CONCAT`, `LEN`): numbers as displayed; booleans `TRUE`/`FALSE`;
empty is `""`; an error stays that error.

**To boolean** (`IF` condition, `AND`, `OR`, `NOT`): booleans as is; numbers:
non-zero is `TRUE`; empty is `FALSE`; the strings `TRUE`/`FALSE` in any case are
booleans, any other string is `#VALUE!`; an error stays that error.

**Number display:** round to 15 significant digits. If the rounded value is 0,
show `0`. If its absolute value is `>= 1e15` or `< 1e-9`, use scientific form
`<mantissa>E<sign><exponent>`, the mantissa without trailing zeros and the
exponent without leading zeros: `1.5E+20`, `1E-10`, `-2.25E+15`. Otherwise
show plain decimal digits without trailing zeros after the point, and no point
when there are no decimals: `0.3` for `=0.1+0.2`, `0.333333333333333` for
`=1/3`, `123456789012345` for itself, `-0.5`.

## 5. Operators

- Operands are evaluated left to right. If the left operand is an error, that
  is the result; else if the right is an error, that is the result.
- A range (with `:`) used anywhere other than directly as a function argument
  gives `#VALUE!`.
- Comparison:
  - An empty operand is treated as `0`, `""` or `FALSE` to match the other
    operand's type (two empties are equal).
  - Values of different types are ordered numbers < strings < booleans,
    whatever their values: `=1<"a"` and `="a"<TRUE` are `TRUE`, `=1="1"` is `FALSE`.
  - Strings compare case-insensitively (compare the lower-cased strings by
    UTF-16 code units).
  - Numbers compare after rounding both to 15 significant digits, so
    `=0.1+0.2=0.3` is `TRUE`.
  - The result is a boolean.

## 6. Functions

An unknown function name gives `#NAME?` and a wrong number of arguments gives
`#VALUE!`; in both cases no argument is evaluated. Arguments are evaluated left to right and the first error found is
the result, unless a function below says otherwise.

A **reference argument** is an argument that is exactly a single reference
or a range (e.g. `A1`, `$B$2`, `A1:C3`). Its cells are visited row by row
(`A1, B1, A2, B2`). Any other argument is an **expression argument**.

| Function | Rules |
|---|---|
| `SUM(a, ...)` ≥1 arg | Reference args: add the numbers; ignore strings, booleans and empty cells; an error cell is the result. Expression args: converted to number. |
| `MIN`, `MAX` ≥1 arg | Same argument rules as `SUM`. No numbers at all gives `0`. |
| `AVERAGE` ≥1 arg | Same argument rules as `SUM`. No numbers at all gives `#DIV/0!`. |
| `COUNT` ≥1 arg | Never an error. Reference args: count cells holding numbers. Expression args: count 1 if the value is a number, a boolean, or a string matching the number pattern; else 0 (errors count 0). |
| `IF(c, a, [b])` 2–3 args | `c` to boolean (an error is the result). Only the chosen branch is evaluated, so `=IF(TRUE,1,1/0)` is `1`. A missing `b` is `FALSE`. |
| `AND`, `OR` ≥1 arg | Reference args: booleans and numbers in cells take part; strings and empty cells are ignored; an error cell is the result. Expression args: converted to boolean. All args are evaluated (no short-circuit). If nothing took part: `#VALUE!`. |
| `NOT(x)` | `x` to boolean, negated. |
| `CONCAT(a, ...)` ≥1 arg | Joins arguments converted to string; a reference arg contributes every cell of the range in order (empty cells as `""`). |
| `LEN(x)` | Length of `x` converted to string. A range of more than one cell gives `#VALUE!`. |
| `ABS(x)` | Absolute value of `x` converted to number. |
| `ROUND(x, d)` | Round `x` to `d` decimal places (`d` truncated toward zero; negative `d` rounds to tens, hundreds, …), halves away from zero. Round the **decimal** value shown by 15-significant-digit display, not the binary double: `ROUND(1.005,2)` is `1.01`, `ROUND(2.5,0)` is `3`, `ROUND(-2.5,0)` is `-3`, `ROUND(1234.5,-2)` is `1200`. |

## 7. Dependencies, cycles and recalculation

- A formula depends on every cell its references and ranges name, including
  empty cells and references inside branches `IF` does not take.
- A cell is **on a cycle** if following dependencies from it leads back to it
  (`=A1` in A1 is a cycle). Every cell on a cycle has the value `#CYCLE!`. A cell
  that is not on a cycle but uses one gets the error through the usual rules
  (`=A1+1` is `#CYCLE!`; `=COUNT(A1)` is `0`).
- When inputs change so that a cycle no longer exists, the affected cells get
  their normal values again.
- Dependency chains can be long: a whole column of 9,999 cells, each referring
  to the one above, must work, including when it becomes one big cycle (no
  stack overflow). Building such a chain by setting its cells in any order and
  then reading every value must take under 2 seconds on a typical laptop, and so
  must changing its first cell and reading the last.

## 8. Inserting and deleting rows and columns

Rows are described here; columns behave the same way with columns.

`insertRows(r, n)`: rows `r` and below move down by `n`. Cells that would move past
row 9999 are dropped. `deleteRows(r, n)`: rows `r..r+n-1` are removed and the rows
below move up by `n`.

Every reference in every formula is rewritten so it still points at the same
cells, whether it is relative or absolute (`$` only matters for `copy`):

- A single reference to a moved cell is updated; a reference to a deleted cell
  (or one pushed past row 9999) becomes `#REF!`.
- A range (with top row `t` and bottom row `b`):
  - insert at `r <= t`: both ends move down;
  - insert at `t < r <= b`: the bottom moves down (the range grows);
  - insert at `r > b`: unchanged;
  - delete: rows of the range that are deleted are removed from it and the
    rest closes up. If all of its rows are deleted, the whole range becomes
    `#REF!`.
  - If the range's bottom would move past row 9999, it becomes `#REF!`.
- Only the rewritten reference text changes; the rest of the formula (spacing,
  function-name case) is kept. A rewritten reference is written in upper case,
  keeping each coordinate's `$`. A rewritten range is written as
  `<top-left>:<bottom-right>`, each coordinate keeping the `$` it had.
- The error literal `#REF!` evaluates to the error `#REF!`.
- Text inside string literals is never treated as a reference.
- A formula that does not parse is left unchanged.

## 9. Copy

`copy(from, to)` sets `to` to `from`'s input. For a formula, every reference
moves by the offset from `from` to `to` in its relative coordinates; absolute
(`$`) coordinates stay. A reference or range that would leave the sheet
(row outside 1..9999 or column outside A..ZZ, either end of a range) becomes
`#REF!`. All references in the copied formula are written in upper case,
keeping their `$`; the rest of the text is kept. A formula that does not parse
is copied unchanged. Copying an empty cell empties `to`.
