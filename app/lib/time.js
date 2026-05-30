import { TimeoutError } from 'beaker-error-constants';

const relativeFormatter = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
const shortDateFormatter = new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', year: 'numeric' });
const downloadFormatter = new Intl.DateTimeFormat('en', {
  weekday: 'short', month: 'short', day: 'numeric',
  hour: 'numeric', minute: '2-digit', hour12: true,
});

function startOfDay(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function diffDays(a, b) {
  return Math.round((startOfDay(a).getTime() - startOfDay(b).getTime()) / 864e5);
}

export function niceDate(ts, opts) {
  const date = new Date(typeof ts === 'number' || typeof ts === 'string' ? ts : ts);
  const todayStart = startOfDay(new Date());
  const days = diffDays(date, todayStart);

  if (days === 0) {
    if (opts && opts.noTime) return 'today';
    const diffSec = Math.round((date.getTime() - Date.now()) / 1000);
    const diffMin = Math.round(diffSec / 60);
    const diffHr = Math.round(diffMin / 60);
    if (Math.abs(diffSec) < 60) return relativeFormatter.format(diffSec, 'second');
    if (Math.abs(diffMin) < 60) return relativeFormatter.format(diffMin, 'minute');
    return relativeFormatter.format(diffHr, 'hour');
  } else if (days === -1) {
    return 'yesterday';
  } else if (days > -30) {
    return relativeFormatter.format(days, 'day');
  }
  return shortDateFormatter.format(date);
}

export function downloadTimestamp(ts) {
  const date = new Date(typeof ts === 'string' ? Number(ts) : ts);
  return downloadFormatter.format(date);
}

// this is a wrapper for any behavior that needs to maintain a timeout
// you call it like this:
/*
timer(30e3, async (checkin, pause, resume) => {
  checkin('doing work')
  await work()

  checkin('doing other work')
  await otherWork()

  pause() // dont count this period against the timeout
  await askUserSomething()
  resume() // resume the timeout

  checkin('finishing')
  return finishing()
})
*/
// Rules of usage:
// - Call `checkin` after a period of async work to give the timer a chance to
//   abort further work. If the timer has expired, checkin() will stop running.
// - Give `checkin` a description of the task if you want the timeouterror to be
//   descriptive.
export function timer(ms, fn) {
  var currentAction;
  var isTimedOut = false;

  // no timeout?
  if (!ms) return fn(noop, noop, noop);

  return new Promise((resolve, reject) => {
    var timerHandle;
    var remaining = ms;
    var start;

    const checkin = (action) => {
      if (isTimedOut) throw new TimeoutError(); // this will abort action, but the wrapping promise is already rejected
      if (action) currentAction = action;
    };
    const pause = () => {
      clearTimeout(timerHandle);
      remaining -= Date.now() - start;
    };
    const resume = () => {
      if (isTimedOut) return;
      clearTimeout(timerHandle);
      start = Date.now();
      timerHandle = setTimeout(onTimeout, remaining);
    };
    const onTimeout = () => {
      isTimedOut = true;
      reject(
        new TimeoutError(
          currentAction ? `Timed out while ${currentAction}` : undefined
        )
      );
    };

    // call the fn to get the promise
    var promise = fn(checkin, pause, resume);

    // start the timer
    resume();

    // wrap the promise
    promise.then(
      (val) => {
        clearTimeout(timerHandle);
        resolve(val);
      },
      (err) => {
        clearTimeout(timerHandle);
        reject(err);
      }
    );
  });
}

function noop() {}
