// TODO:
// - an option to not patch $on, or show both where it got registered and invoked
// - find a way to bootstrap it early
// - detect blocklisted frames
// - expose more watch expressions

/**
 * USAGE:
 * 
 * After running this script, all newly-scheduled AngularJS calls get tracked.
 * You can call window.trace() at any point to print the current trace.
 */

// Ideally, this should be imported before AngularJS itself.
import('https://cdnjs.cloudflare.com/ajax/libs/zone.js/0.8.18/zone.js');


(function init() {
  const PATCH_$ON = false;
  const MAX_CALLS_TO_TRACK = 10;
  const BLACKLISTED_FRAMES = [
    // Standard stacktrace header.
    'Error',

    // Zone.js internals.
    'globalZoneAwareCallback',
    'at Zone.',
    'at ZoneDelegate.',
    'at ZoneTask.',
    'at invokeTask ',
    'at timer ',
    'at XMLHttpRequest.wrapFn ',

    // AngularJS internals.
    'at eval ',
    'at Object.invoke ',
    'at Object.link ',
    'at Object.ngTranscludePostLink ',
    'at Object.onInvokeTask ',
    'at completeOutstandingRequest',
    'at processQueue',
    'at invokeLinkFn ',
    'at nodeLinkFn ',
    'at compositeLinkFn ',
    'at publicLinkFn ',
    'at lazyCompilation ',
    'at boundTranscludeFn ',
    'at controllersBoundTransclude ',
    'at compileNodes ',
    'at Scope.',
    'at ChildScope.',

    // Instrumentation.
    '<anonymous>',
    'at wrapDeferred ',
    'at deferredWrapper ',
  ];

  let currentTrace = null;

  function getStack(source) {
    return {
      parent: currentTrace,
      scheduled: performance.now(),
      source,
      calls: null,
      callCount: 0,
      // perf: lazy-evaluate Error.stack
      error: new Error()
    };
  }

  function captureTrace(source) {
    const trace = getStack(source);
    let traceBefore = null;
    return {
      set: (scope, args) => {
        traceBefore = currentTrace;
        currentTrace = trace;

        // Keep track of the last N calls.
        trace.callCount++;
        if (!trace.calls) {
          trace.calls = [];
        }
        while (trace.calls.length > MAX_CALLS_TO_TRACK) trace.calls.pop();
        trace.calls.unshift({
          timestamp: performance.now(),
          scope,
          args
        });
      },
      restore: () => {
        currentTrace = traceBefore;
      }
    };
  }

  function trace() {
    let stack = getStack('Trace:');
    do {
      console.log(`%c${stack.source}`, 'font-weight:bold');

      if (stack.calls && stack.calls.length) {
        const lastCall = stack.calls[0];
        logCall(stack, lastCall);
        if (stack.calls.length > 1) {
          console.groupCollapsed(`Prev ${stack.calls.length - 1} call(s) (out of ${stack.callCount} total)`);
          for (let i = 1; i < stack.calls.length; i++) {
            logCall(stack, stack.calls[i]);
          }
          console.groupEnd();
        }
        logPerformanceEntries(stack.scheduled, lastCall.timestamp);
      }

      const frames = stack.error.stack;
      console.log(frames.split('\n')
        .filter(frame => !isFrameBlacklisted(frame))
        .join('\n'));

      console.log('┈');
    } while (stack = stack.parent);
  }

  function logCall(stack, call) {
    const delay = Math.round(100 * (call.timestamp - stack.scheduled)) / 100;
    console.log('Latency', delay);
    if (call.scope !== window) {
      console.log('scope', call.scope);
    }
    console.log('args', call.args);
  }

  function isFrameBlacklisted(frame) {
    if (!frame) {
      return true;
    }
    return BLACKLISTED_FRAMES.some(blacklisted => frame.includes(blacklisted));    
  }

  function logPerformanceEntries(from, to) {
    const entries = performance.getEntries().filter(
      entry => entry.startTime >= from && entry.startTime + entry.duration < to);

    if (entries.length) {
      console.groupCollapsed('perf entries');
      entries.forEach(entry => console.log(entry));
      console.groupEnd();
    }
  }

  function patchZoneJs() {
    const rootZone = window.Zone && Zone.root;
    if (rootZone) {
      const scheduleTask = rootZone.prototype.scheduleTask;
      rootZone.prototype.scheduleTask = function (task) {
        task.trace = captureTrace(`async (${task.source})`);
        return scheduleTask.call(this, task);
      }

      const runTask = rootZone.prototype.runTask;
      rootZone.prototype.runTask = function (task, applyThis, applyArgs) {
        const trace = task.trace;
        try {
          trace && trace.set(applyThis, applyArgs);
          return runTask.call(this, task, applyThis, applyArgs);
        } finally {
          trace && trace.restore();
        }
      }
    }
  }

  function wrapDeferred(fn, source) {
    if (!fn) return fn;

    const trace = captureTrace(source);

    return function deferredWrapper() {
      try {
        trace.set(this, arguments);
        return fn.apply(this, arguments);
      } finally {
        trace.restore();
      }
    };
  }

  function patchAngularJs() {
    if (!window.angular) return;
    const injector = angular.element(document).injector(); // || angular.injector(['ng']) || angular.element(document.body).injector();

    injector.invoke(['$rootScope', '$parse', '$q', '$browser', ($rootScope, $parse, $q, $browser) => {
      const defer = $browser.defer;
      $browser.defer = function (fn, delay) {
        return defer.call(this, wrapDeferred(fn, '$browser.defer'), delay);
      };
      $browser.defer.cancel = defer.cancel;
      $browser.defer.flush = defer.flush;


      const promise = Object.getPrototypeOf($q.defer().promise);
      const $then = promise.then;
      promise.then = function (success, error, notify) {
        return $then.call(this,
          wrapDeferred(success, '$promise.success'),
          wrapDeferred(error, '$promise.error'),
          wrapDeferred(notify, '$promise.notify'));
      };

      const scope = Object.getPrototypeOf($rootScope);

      const $evalAsync = scope.$evalAsync;
      scope.$evalAsync = function (exp) {
        $evalAsync.call(this, wrapDeferred($parse(exp), '$evalAsync'));
      };

      const $applyAsync = scope.$applyAsync;
      scope.$applyAsync = function (exp) {
        $applyAsync.call(this, wrapDeferred($parse(exp), '$applyAsync'));
      };

      const $$postDigest = scope.$$postDigest;
      scope.$$postDigest = function (fn) {
        $applyAsync.call(this, wrapDeferred(fn, '$$postDigest'));
      };

      if (PATCH_$ON) {
        // We may not actually want to do that, as this would obscure how the event got triggered
        // and, instead, show how path from where it got registered.
        const $on = scope.$on;
        scope.$on = function (name, listener) {
          return $on.call(this, name, wrapDeferred(listener, `$on<${name}>`));
        };
    }

      const $watch = scope.$watch;
      scope.$watch = function (exp, listener, objEq, prettyPrint) {
        let strExp = '';
        if (typeof exp == 'string') {
          strExp = exp;
        }
        if (typeof exp == 'function' && exp.name) {
          strExp = exp.name;
        }
        const get = $parse(exp);

        // Watch delegates need access to properties on the parsed expression.
        // Call it here directly to mimic what $watch() does.
        // Wrapping will still occur when the delegate, in turn, calls $watch().
        if (get.$$watchDelegate) {
          return get.$$watchDelegate(this, listener, objEq, get, exp);
        }

        return $watch.call(this,
          wrapDeferred(get, `$watch<${strExp}>`),
          wrapDeferred(listener, `$watch.listener<${strExp}>`),
          objEq,
          prettyPrint);
      };
    }]);
  }

  function benchmark() {
    const iterations = 50000;
    const runs = 5;

    for (let run = 0; run < runs; run++) {
      console.time('benchmark');
      let i = iterations;
      while (i--) {
        const trace = captureTrace('iteration_' + i);
        try {
          trace.set();
        } finally {
          trace.restore();
        }
      }
      console.timeEnd('benchmark');
    }
  }

  // Init.  
  patchZoneJs();
  patchAngularJs();

  // Default is 15, definitely not enough.
  Error.stackTraceLimit = 100;

  window.trace = trace;
  window.benchmarkTrace = benchmark;
})();