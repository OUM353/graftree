/** Bad input from the user: wrong flags, arguments or values. Exit code 2. */
export class UsageError extends Error {
  exitCode = 2;
}

/** The input was fine but refers to something that does not exist. Exit code 1. */
export class NotFoundError extends Error {
  exitCode = 1;
}
