export type UserErrorKey =
  | "userEmptyPatch"
  | "userEnabledInvalid"
  | "userNotFound"
  | "userPasswordInvalid"
  | "userUsernameInvalid"
  | "userUsernameReserved"
  | "userUsernameTaken";

export class UserValidationError extends Error {
  readonly errorKey: UserErrorKey;

  constructor(message: string, errorKey: UserErrorKey) {
    super(message);
    this.name = "UserValidationError";
    this.errorKey = errorKey;
  }
}

export class UserConflictError extends Error {
  readonly errorKey = "userUsernameTaken" as const;

  constructor(message = "Username is already taken.") {
    super(message);
    this.name = "UserConflictError";
  }
}

export class UserNotFoundError extends Error {
  readonly errorKey = "userNotFound" as const;

  constructor(message = "User not found.") {
    super(message);
    this.name = "UserNotFoundError";
  }
}
