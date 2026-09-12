/** An error whose message is safe to show the client, with the HTTP status to send. */
export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
