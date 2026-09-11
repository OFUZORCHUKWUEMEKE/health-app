package concurrent

import (
	"context"
	"errors"
	"sync/atomic"
	"testing"
	"time"
)

func TestMapOrderAndWidth(t *testing.T) {
	inputs := []int{0, 1, 2, 3, 4, 5, 6, 7}
	var live, peak int64
	out, err := Map(context.Background(), 3, inputs, func(_ context.Context, v int) (int, error) {
		cur := atomic.AddInt64(&live, 1)
		for {
			p := atomic.LoadInt64(&peak)
			if cur <= p || atomic.CompareAndSwapInt64(&peak, p, cur) {
				break
			}
		}
		time.Sleep(5 * time.Millisecond)
		atomic.AddInt64(&live, -1)
		return v * 2, nil
	})
	if err != nil {
		t.Fatalf("Map: %v", err)
	}
	for i, v := range out {
		if v != inputs[i]*2 {
			t.Fatalf("out[%d] = %d, want order preserved", i, v)
		}
	}
	if peak > 3 {
		t.Errorf("peak concurrency %d exceeds width 3", peak)
	}
}

func TestMapFirstErrorAborts(t *testing.T) {
	inputs := []int{0, 1, 2, 3, 4, 5, 6, 7}
	start := time.Now()
	_, err := Map(context.Background(), 2, inputs, func(ctx context.Context, v int) (int, error) {
		if v == 0 {
			return 0, errors.New("boom")
		}
		select {
		case <-time.After(2 * time.Second):
			return v, nil
		case <-ctx.Done():
			return 0, ctx.Err()
		}
	})
	if err == nil || err.Error() != "boom" {
		t.Fatalf("err = %v, want boom", err)
	}
	if time.Since(start) > 1500*time.Millisecond {
		t.Error("cancellation did not abort remaining work")
	}
}

func TestMapEmpty(t *testing.T) {
	out, err := Map(context.Background(), 4, []int{}, func(_ context.Context, v int) (int, error) {
		return v, nil
	})
	if err != nil || out != nil {
		t.Errorf("empty = %v, %v", out, err)
	}
}

func TestDoAllErrors(t *testing.T) {
	err := Do(context.Background(),
		func(_ context.Context) error { return nil },
		func(_ context.Context) error { return errors.New("x") },
		func(_ context.Context) error { return nil },
	)
	if err == nil || err.Error() != "x" {
		t.Errorf("Do err = %v", err)
	}
	if err := Do(context.Background()); err != nil {
		t.Errorf("Do() = %v", err)
	}
}

func TestMapContextCancel(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	_, err := Map(ctx, 2, []int{1, 2, 3}, func(ctx context.Context, v int) (int, error) {
		<-ctx.Done()
		return 0, ctx.Err()
	})
	if err == nil {
		t.Error("cancelled context should error, not hang")
	}
}
