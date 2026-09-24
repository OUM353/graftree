Extend the key-value store in `src/store.mjs` with key expiry and nested
transactions, and add a text command protocol with a stdin/stdout CLI. Keep the
existing API and tests working. No dependencies; Node >= 20; ES modules.

## 1. Expiry (src/store.mjs)

- `new Store({ now })`: `now` is an optional clock function returning
  milliseconds; the default is `Date.now`. All expiry uses this clock.
- `set(key, value, { ttlMs } = {})`: with `ttlMs`, the key expires at
  `now() + ttlMs`. Without it, any existing expiry on the key is cleared.
  `ttlMs` must be a positive integer, otherwise throw a `RangeError`.
- `expire(key, ms)`: sets the key to expire at `now() + ms`. Returns `true` if
  the key exists, `false` if not (and then changes nothing). `ms` must be a
  positive integer, otherwise throw a `RangeError`.
- `ttl(key)`: `-2` if the key does not exist, `-1` if it exists without expiry,
  otherwise the remaining milliseconds (`expiresAt - now()`, always > 0).
- A key whose expiry time is `<= now()` no longer exists for every operation:
  `get` returns `undefined`, `del` and `expire` return `false`, `ttl` returns
  `-2`, and `keys()` leaves it out.

## 2. Nested transactions (src/store.mjs)

- `begin()` opens a transaction. Transactions nest.
- `depth` (getter): the number of open transactions (0 when none).
- Inside a transaction, reads see the transaction's own writes immediately.
- `rollback()` undoes every write (`set`, `del`, `expire`) made since the
  matching `begin()`: each touched key gets back exactly its earlier value and
  absolute expiry time, or is removed again if it did not exist. If that earlier
  expiry time has passed by then, the key is expired.
- `commit()` closes the innermost transaction and keeps its writes. If an outer
  transaction is still open, a later `rollback()` of that outer transaction
  undoes them too.
- `commit()` or `rollback()` with no open transaction throws an `Error` whose
  message is exactly `NO TRANSACTION`.

## 3. Command protocol (src/protocol.mjs)

`execute(store, line)` runs one command line against a `Store` and returns the
response string. It never throws.

Tokenizing: tokens are separated by spaces or tabs. A token may be wrapped in
double quotes to contain spaces; inside quotes, `\"` means `"` and `\\` means
`\`. An unterminated quote returns `(error) SYNTAX`. A line with no tokens returns
`(error) EMPTY`. Command names are case-insensitive; keys and values are not.

| Command | Response |
|---|---|
| `SET key value` | `OK` (clears any expiry) |
| `SET key value PX ms` | `OK`, key expires in `ms` (`PX` is case-insensitive) |
| `GET key` | the value, or `(nil)` |
| `DEL key` | `(integer) 1` if it existed, else `(integer) 0` |
| `EXPIRE key ms` | `(integer) 1` if the key exists, else `(integer) 0` |
| `TTL key` | `(integer) N` with N from `ttl()` |
| `KEYS` | the live keys sorted, joined by single spaces, or `(empty)` |
| `BEGIN` | `OK` |
| `COMMIT` / `ROLLBACK` | `OK`, or `(error) NO TRANSACTION` |

- `ms` must be a positive integer written in decimal digits only; anything else
  returns `(error) WRONG ARGS`.
- A known command with the wrong number of arguments returns `(error) WRONG ARGS`.
  So does any `SET` that is neither of the two forms above.
- An unknown command returns `(error) UNKNOWN COMMAND`.

## 4. CLI (src/cli.mjs)

`node src/cli.mjs` reads commands from stdin, one per line, runs each through
`execute` against a single shared `Store`, and writes each response on its own
line to stdout. Skip lines that are empty after trimming (no output for them).
Handle `\r\n` line endings. Exit with code 0 when stdin ends.
