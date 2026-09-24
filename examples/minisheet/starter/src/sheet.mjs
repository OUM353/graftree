import { formatAddress, parseAddress } from "./address.mjs";

/**
 * A grid of cells. For now every input is stored as plain text.
 */
export class Sheet {
  #cells = new Map(); // "A1" -> input string

  #key(addr) {
    return formatAddress(parseAddress(addr));
  }

  set(addr, input) {
    if (typeof input !== "string") throw new TypeError("input must be a string");
    const key = this.#key(addr);
    if (input === "") this.#cells.delete(key);
    else this.#cells.set(key, input);
  }

  get(addr) {
    const input = this.#cells.get(this.#key(addr));
    return input === undefined ? { type: "empty" } : { type: "string", value: input };
  }

  display(addr) {
    return this.#cells.get(this.#key(addr)) ?? "";
  }

  formula(addr) {
    return this.#cells.get(this.#key(addr)) ?? "";
  }

  /** Non-empty cells, row by row. */
  cells() {
    return [...this.#cells.keys()]
      .map((k) => ({ k, ...parseAddress(k) }))
      .sort((a, b) => a.row - b.row || a.col - b.col)
      .map((c) => c.k);
  }
}
