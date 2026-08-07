export class ReadTimeoutError extends Error {
  constructor(label: string, timeoutMs: number) {
    super(`${label} did not respond within ${Math.ceil(timeoutMs / 1_000)} seconds.`);
    this.name = "ReadTimeoutError";
  }
}

export function withReadTimeout<T>(read: Promise<T>, label: string, timeoutMs = 20_000): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new ReadTimeoutError(label, timeoutMs)), timeoutMs);
    read.then((value) => { clearTimeout(timer); resolve(value); }, (error) => { clearTimeout(timer); reject(error); });
  });
}
