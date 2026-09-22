import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  InfiniteScroll,
  ScrollContainerProvider,
  type UseInfiniteScrollOptions,
  useInfiniteScroll,
} from '../src/index';

/**
 * happy-dom ships no IntersectionObserver, so the suite installs a controllable stub and drives the
 * observer directly: every instance records the `options` the hook passed (the resolved `root` and
 * the `rootMargin`) and exposes `trigger()` to fire the callback. Asserting on the stub is the point
 * — a polyfill would hide exactly the two things this primitive has to get right (Pitfall 8: the
 * root comes from ScrollContainerContext, never from a document lookup; and the re-entrancy guard).
 */
class MockIntersectionObserver {
  static instances: MockIntersectionObserver[] = [];

  readonly callback: IntersectionObserverCallback;
  readonly options: IntersectionObserverInit;
  readonly observed: Element[] = [];
  disconnected = false;

  constructor(callback: IntersectionObserverCallback, options: IntersectionObserverInit = {}) {
    this.callback = callback;
    this.options = options;
    MockIntersectionObserver.instances.push(this);
  }

  observe(element: Element) {
    this.observed.push(element);
  }

  unobserve() {}

  disconnect() {
    this.disconnected = true;
  }

  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }

  trigger(isIntersecting = true) {
    const entry = {
      isIntersecting,
      target: this.observed[0] ?? document.body,
    } as IntersectionObserverEntry;
    this.callback([entry], this as unknown as IntersectionObserver);
  }
}

const observers = () => MockIntersectionObserver.instances;
const latest = () => {
  const observer = observers().at(-1);
  if (!observer) throw new Error('no IntersectionObserver was constructed');
  return observer;
};

beforeEach(() => {
  MockIntersectionObserver.instances = [];
  vi.stubGlobal('IntersectionObserver', MockIntersectionObserver);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function Harness({
  onLoadMore,
  hasMore = true,
  ...rest
}: Partial<UseInfiniteScrollOptions> & { onLoadMore: () => void | Promise<void> }) {
  const { sentinelRef, isLoading } = useInfiniteScroll({ onLoadMore, hasMore, ...rest });
  return (
    <div>
      <div ref={sentinelRef} data-testid="sentinel" />
      <span data-testid="loading">{String(isLoading)}</span>
    </div>
  );
}

describe('useInfiniteScroll — paging trigger', () => {
  it('never observes and never loads while there is no next page', () => {
    const onLoadMore = vi.fn();
    render(<Harness onLoadMore={onLoadMore} hasMore={false} />);
    expect(observers()).toHaveLength(0);
    expect(onLoadMore).not.toHaveBeenCalled();
  });

  it('never observes while disabled', () => {
    const onLoadMore = vi.fn();
    render(<Harness onLoadMore={onLoadMore} enabled={false} />);
    expect(observers()).toHaveLength(0);
    expect(onLoadMore).not.toHaveBeenCalled();
  });

  it('ignores a non-intersecting entry', async () => {
    const onLoadMore = vi.fn();
    render(<Harness onLoadMore={onLoadMore} />);
    await act(async () => {
      latest().trigger(false);
    });
    expect(onLoadMore).not.toHaveBeenCalled();
  });

  it('calls onLoadMore exactly once across two intersections while the page is still in flight', async () => {
    let release: () => void = () => {};
    const onLoadMore = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    render(<Harness onLoadMore={onLoadMore} />);

    const observer = latest();
    await act(async () => {
      observer.trigger(true);
    });
    expect(onLoadMore).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('loading')).toHaveTextContent('true');

    await act(async () => {
      observer.trigger(true);
    });
    expect(onLoadMore).toHaveBeenCalledTimes(1);

    await act(async () => {
      release();
    });
    expect(screen.getByTestId('loading')).toHaveTextContent('false');

    await act(async () => {
      latest().trigger(true);
    });
    expect(onLoadMore).toHaveBeenCalledTimes(2);
  });

  it('clears the loading flag when onLoadMore rejects, without rethrowing into render', async () => {
    const onLoadMore = vi.fn(() => Promise.reject(new Error('rede indisponível')));
    render(<Harness onLoadMore={onLoadMore} />);

    await act(async () => {
      latest().trigger(true);
    });

    expect(onLoadMore).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('loading')).toHaveTextContent('false');
    // the content that was already loaded stays mounted — the consumer owns the retry line
    expect(screen.getByTestId('sentinel')).toBeInTheDocument();
  });
});

describe('useInfiniteScroll — observer root resolution (Pitfall 8)', () => {
  it('uses the shell scroll container from context as the observer root', () => {
    const element = document.createElement('div');
    const scrollRef = { current: element as HTMLElement | null };
    render(
      <ScrollContainerProvider scrollRef={scrollRef}>
        <Harness onLoadMore={vi.fn()} />
      </ScrollContainerProvider>,
    );
    expect(latest().options.root).toBe(element);
    expect(latest().options.rootMargin).toBe('200px');
    expect(latest().options.threshold).toBe(0);
  });

  it('falls back to the document (root null) when rendered outside the shell', () => {
    render(<Harness onLoadMore={vi.fn()} />);
    expect(latest().options.root).toBeNull();
  });

  it('lets an explicit root prop override both the context and the document', () => {
    const contextElement = document.createElement('div');
    const override = document.createElement('section');
    render(
      <ScrollContainerProvider scrollRef={{ current: contextElement }}>
        <Harness onLoadMore={vi.fn()} root={override} />
      </ScrollContainerProvider>,
    );
    expect(latest().options.root).toBe(override);
  });

  it('honours a custom rootMargin and disconnects the observer on unmount', () => {
    const { unmount } = render(<Harness onLoadMore={vi.fn()} rootMargin="50px" />);
    const observer = latest();
    expect(observer.options.rootMargin).toBe('50px');
    expect(observer.disconnected).toBe(false);
    unmount();
    expect(observer.disconnected).toBe(true);
  });
});

describe('InfiniteScroll', () => {
  it('renders no DOM node at all once there is no next page (no terminal spacer, no end-of-list copy)', () => {
    const { container } = render(<InfiniteScroll hasMore={false} onLoadMore={vi.fn()} />);
    expect(container.firstChild).toBeNull();
    expect(observers()).toHaveLength(0);
  });

  it('renders the sentinel and no skeleton while idle', () => {
    render(
      <InfiniteScroll
        hasMore
        onLoadMore={vi.fn()}
        skeleton={<div data-testid="skeleton">bloco</div>}
      />,
    );
    expect(screen.queryByTestId('skeleton')).not.toBeInTheDocument();
    expect(observers()).toHaveLength(1);
  });

  it('renders exactly one skeleton block while a page is in flight, never two', async () => {
    let release: () => void = () => {};
    const onLoadMore = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    render(
      <InfiniteScroll
        hasMore
        onLoadMore={onLoadMore}
        skeleton={<div data-testid="skeleton">bloco</div>}
      />,
    );

    const observer = latest();
    await act(async () => {
      observer.trigger(true);
    });
    await act(async () => {
      observer.trigger(true);
    });
    expect(screen.getAllByTestId('skeleton')).toHaveLength(1);

    await act(async () => {
      release();
    });
    expect(screen.queryByTestId('skeleton')).not.toBeInTheDocument();
  });

  it('renders a default fixed-height skeleton block that cannot exceed its container', async () => {
    let release: () => void = () => {};
    const onLoadMore = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          release = resolve;
        }),
    );
    const { container } = render(<InfiniteScroll hasMore onLoadMore={onLoadMore} />);
    await act(async () => {
      latest().trigger(true);
    });
    const block = container.querySelector('[data-infinite-scroll-skeleton]');
    expect(block).not.toBeNull();
    expect(block?.className).toContain('overflow-hidden');
    await act(async () => {
      release();
    });
  });
});
