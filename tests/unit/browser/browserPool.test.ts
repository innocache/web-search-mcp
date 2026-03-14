/// <reference types="vitest/globals" />

import { Semaphore, Mutex } from '../../../src/browser/browserPool.js';

describe('Semaphore', () => {
  it('allows two concurrent acquires and blocks the third until release', async () => {
    const sem = new Semaphore(2);

    await sem.acquire();
    await sem.acquire();

    let thirdAcquired = false;
    const third = sem.acquire().then(() => {
      thirdAcquired = true;
    });

    await Promise.resolve();
    expect(thirdAcquired).toBe(false);

    sem.release();
    await third;
    expect(thirdAcquired).toBe(true);

    sem.release();
    sem.release();
  });

  it('with capacity 1 behaves like a mutex', async () => {
    const sem = new Semaphore(1);

    await sem.acquire();

    let secondAcquired = false;
    const second = sem.acquire().then(() => {
      secondAcquired = true;
    });

    await Promise.resolve();
    expect(secondAcquired).toBe(false);

    sem.release();
    await second;
    expect(secondAcquired).toBe(true);

    sem.release();
  });

  it('release unblocks one waiting acquirer', async () => {
    const sem = new Semaphore(1);

    await sem.acquire();
    let waiterResolved = false;
    const waiter = sem.acquire().then(() => {
      waiterResolved = true;
    });

    await Promise.resolve();
    expect(waiterResolved).toBe(false);

    sem.release();
    await waiter;
    expect(waiterResolved).toBe(true);

    sem.release();
  });

  it('serves waiting acquirers in FIFO order', async () => {
    const sem = new Semaphore(1);
    const order: string[] = [];

    await sem.acquire();

    const a = sem.acquire().then(() => {
      order.push('a');
    });
    const b = sem.acquire().then(() => {
      order.push('b');
    });
    const c = sem.acquire().then(() => {
      order.push('c');
    });

    sem.release();
    await a;
    sem.release();
    await b;
    sem.release();
    await c;

    expect(order).toEqual(['a', 'b', 'c']);

    sem.release();
  });
});

describe('Mutex', () => {
  it('allows only one holder at a time', async () => {
    const mutex = new Mutex();
    await mutex.acquire();

    let secondAcquired = false;
    const second = mutex.acquire().then(() => {
      secondAcquired = true;
    });

    await Promise.resolve();
    expect(secondAcquired).toBe(false);

    mutex.release();
    await second;
    expect(secondAcquired).toBe(true);

    mutex.release();
  });

  it('release transfers lock to next waiter', async () => {
    const mutex = new Mutex();
    const order: string[] = [];

    await mutex.acquire();
    const waiter = mutex.acquire().then(() => {
      order.push('waiter');
    });

    mutex.release();
    await waiter;

    expect(order).toEqual(['waiter']);

    mutex.release();
  });

  it('second acquire blocks until first holder releases', async () => {
    const mutex = new Mutex();

    await mutex.acquire();

    let secondAcquired = false;
    const second = mutex.acquire().then(() => {
      secondAcquired = true;
    });

    await Promise.resolve();
    expect(secondAcquired).toBe(false);

    mutex.release();
    await second;
    expect(secondAcquired).toBe(true);

    mutex.release();
  });

  it('queues multiple waiters in FIFO order', async () => {
    const mutex = new Mutex();
    const order: string[] = [];

    await mutex.acquire();
    const a = mutex.acquire().then(() => {
      order.push('a');
    });
    const b = mutex.acquire().then(() => {
      order.push('b');
    });

    mutex.release();
    await a;
    mutex.release();
    await b;

    expect(order).toEqual(['a', 'b']);

    mutex.release();
  });

  it('acquire after full release resolves immediately', async () => {
    const mutex = new Mutex();

    await mutex.acquire();
    mutex.release();

    await expect(mutex.acquire()).resolves.toBeUndefined();
    mutex.release();
  });
});
