export class CliError extends Error {
  readonly _tag = "CliError";

  constructor(message: string) {
    super(message);
    this.name = "CliError";
  }
}
