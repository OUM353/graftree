/** A1-style addresses. Columns A..ZZ (1..702), rows 1..9999. */
export const MAX_COL = 702;
export const MAX_ROW = 9999;

/** "A" -> 1, "Z" -> 26, "AA" -> 27, "ZZ" -> 702. Throws RangeError when invalid. */
export function colToNumber(letters) {
  if (typeof letters !== "string" || !/^[A-Za-z]{1,2}$/.test(letters)) throw new RangeError(`invalid column: ${letters}`);
  let n = 0;
  for (const ch of letters.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}

/** 1 -> "A", 27 -> "AA". Throws RangeError when out of range. */
export function numberToCol(n) {
  if (!Number.isInteger(n) || n < 1 || n > MAX_COL) throw new RangeError(`invalid column number: ${n}`);
  let s = "";
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = (n - 1 - r) / 26;
  }
  return s;
}

/** "b7" -> { col: 2, row: 7 }. Throws RangeError when invalid or out of range. */
export function parseAddress(addr) {
  const m = typeof addr === "string" ? /^([A-Za-z]{1,2})([1-9][0-9]{0,3})$/.exec(addr) : null;
  if (!m) throw new RangeError(`invalid address: ${addr}`);
  return { col: colToNumber(m[1]), row: Number(m[2]) };
}

/** { col: 2, row: 7 } -> "B7". */
export function formatAddress({ col, row }) {
  if (!Number.isInteger(row) || row < 1 || row > MAX_ROW) throw new RangeError(`invalid row: ${row}`);
  return `${numberToCol(col)}${row}`;
}
