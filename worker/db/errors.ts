/** Raised by the query layer when a write would break a rule the schema cannot express. */
export class AdminAuthorError extends Error {
  constructor(what: string) {
    super(
      `${what} cannot be attributed to the retired built-in Admin entry; it must name the person who made the change (BR-5).`,
    );
    this.name = 'AdminAuthorError';
  }
}
