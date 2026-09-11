// Package concurrent provides a bounded, context-aware fan-out helper built
// on channels: jobs flow in, results come out in input order, and the first
// error (or context cancellation) stops the remaining work. Width caps the
// number of in-flight goroutines so callers cannot outrun the DB pool.
package concurrent

import (
	"context"
	"sync"
)

// Map runs fn over inputs with at most width goroutines and returns results
// aligned to inputs. The first error aborts the rest via cancellation; on
// success every element is non-nil in input order.
func Map[T any, R any](ctx context.Context, width int, inputs []T, fn func(context.Context, T) (R, error)) ([]R, error) {
	if width < 1 {
		width = 1
	}
	if len(inputs) == 0 {
		return nil, nil
	}
	ctx, cancel := context.WithCancel(ctx)
	defer cancel()

	type job struct {
		index int
		value T
	}
	type result struct {
		index int
		value R
		err   error
	}
	jobs := make(chan job)
	results := make(chan result)

	var wg sync.WaitGroup
	for w := 0; w < width && w < len(inputs); w++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for j := range jobs {
				v, err := fn(ctx, j.value)
				select {
				case results <- result{index: j.index, value: v, err: err}:
				case <-ctx.Done():
					return
				}
				if err != nil {
					cancel()
				}
			}
		}()
	}

	go func() {
		defer close(jobs)
		for i, in := range inputs {
			select {
			case jobs <- job{index: i, value: in}:
			case <-ctx.Done():
				return
			}
		}
	}()

	// Close results once every worker has exited, so the collector below
	// cannot block forever when cancellation drops in-flight reports.
	go func() {
		wg.Wait()
		close(results)
	}()

	out := make([]R, len(inputs))
	var firstErr error
	for r := range results {
		if r.err != nil {
			if firstErr == nil {
				firstErr = r.err
			}
			cancel()
			continue
		}
		out[r.index] = r.value
	}
	if firstErr != nil {
		return nil, firstErr
	}
	select {
	case <-ctx.Done():
		return nil, ctx.Err()
	default:
	}
	return out, nil
}

// Do runs fns concurrently with the same cancellation semantics, discarding
// results. Useful for independent fetches whose outputs merge afterwards.
func Do(ctx context.Context, fns ...func(context.Context) error) error {
	if len(fns) == 0 {
		return nil
	}
	ctx, cancel := context.WithCancel(ctx)
	defer cancel()

	errs := make(chan error, len(fns))
	// errs is buffered for exactly one report per fn, so sends never block
	// and every fetch is accounted for even under cancellation.
	var wg sync.WaitGroup
	for _, fn := range fns {
		wg.Add(1)
		go func(fn func(context.Context) error) {
			defer wg.Done()
			errs <- fn(ctx)
		}(fn)
	}
	wg.Wait()
	close(errs)
	for err := range errs {
		if err != nil {
			return err
		}
	}
	return nil
}
