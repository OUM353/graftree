/**
 * In-memory key-value store. Keys and values are strings.
 */
export class Store {
  #data = new Map();

  /** @returns {string | undefined} */
  get(key) {
    return this.#data.get(key);
  }

  set(key, value) {
    this.#data.set(key, String(value));
  }

  /** @returns {boolean} whether the key existed */
  del(key) {
    return this.#data.delete(key);
  }

  /** @returns {string[]} live keys, sorted */
  keys() {
    return [...this.#data.keys()].sort();
  }
}
