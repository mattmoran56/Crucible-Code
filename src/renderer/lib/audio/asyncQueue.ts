/**
 * A push-driven async iterable: producers `push` and `close`, one consumer
 * iterates with `for await`. Used to hand sentences to the engine as they
 * stream in, and audio back as it is generated.
 */
export class AsyncQueue<T> implements AsyncIterable<T> {
  private items: T[] = []
  private waiting: ((result: IteratorResult<T>) => void) | null = null
  private closed = false

  push(item: T): void {
    if (this.closed) return
    if (this.waiting) {
      const resolve = this.waiting
      this.waiting = null
      resolve({ value: item, done: false })
    } else {
      this.items.push(item)
    }
  }

  /** No more items; the consumer finishes once it has taken what is queued. */
  close(): void {
    if (this.closed) return
    this.closed = true
    if (this.waiting) {
      const resolve = this.waiting
      this.waiting = null
      resolve({ value: undefined, done: true })
    }
  }

  /** Close and drop anything not yet taken. */
  abort(): void {
    this.items = []
    this.close()
  }

  get isClosed(): boolean {
    return this.closed
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: () => {
        if (this.items.length > 0) return Promise.resolve({ value: this.items.shift() as T, done: false })
        if (this.closed) return Promise.resolve({ value: undefined, done: true })
        return new Promise((resolve) => (this.waiting = resolve))
      },
      return: () => {
        this.abort()
        return Promise.resolve({ value: undefined, done: true })
      },
    }
  }
}
