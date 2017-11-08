# angularjs-tracer

## Overview

Presentation given at Seattle Angular meetup - http://bit.ly/angularjs-tracer.

**DISCLAIMER**: This started out as a tool I wrote to help me debug performance and latency of Google Cloud Console. I figured it might be useful to folks, so I've extracted it out into something that can be put out there, but it still has some rough edges.


In a large and complex AngularJS application, a lot of things are happening and get scheduled to happen. Due to how the AngularJS framework is designed, stack traces captured on exceptions or when putting a breakpoint in a debugger do not accurately represent what is happening. For example, setting a breakpoint on the same place in code and triggering it via the same steps can lead to getting completely different stack traces. They may be overwhelmingly long and point to something unrelated. They may be way too short and start seemingly out of nowhere. In either case, they are lying to you.

This happens due to AngularJS's use of the digest cycle and the various mechanisms it uses to schedule work for later execution. These mechanisms include **$watch**, **$evalAsync**, **$applyAsync**, **$$postDigest**, **$q promises**, and more.

This script patches AngularJS to capture and preserve the execution context so that a complete stack trace can be re-constructed when needed, as well as provide a lot of helpful debugging information.

## Features

* See the **real** stack traces with less noise.
* Visibility into what event triggered the action.
* Visibility into what parsed expressions triggered the action.
* Latency (duration between when a function was scheduled and executed).
* Run count + recent calls with scope and args.
* Network calls and other Performance API entries between scheduling and execution (useful for critical path analysis).

## Usage

Include/run the script shortly after AngularJS bootstrapping (after the injector is available). You do want to do this as early as possible since it doesn't have any visibility into what happened before we bootstrapped it.
Include Zone.js to get async calls to show up in stack traces.
Then, at any point print the trace out with **window.trace()**.

## Overhead ##

The overhead is pretty small at **~7ms per 1,000 calls** in my tests, which should make it suitable for inclusion into production code and for integration into the runtime error reporting, though it does put more pressure on the GC.
You can run the benchmark yourself via **window.benchmarkTrace()**.

## Gotchas ##

* Chrome debugger has broader support for async stack traces than Zone.js, including things like MutationObservers and postMessage/onMessage, which means some calls might not get traced correctly.
* Sourcemaps don't work with Error.prototype.stack ([Chrome bug](https://bugs.chromium.org/p/chromium/issues/detail?id=376409)).
* Best used with unminified sources for now.

## Next steps ##
There's a lot that can be done here to productionize it.

* Make it do something better than just log to the console.
* Integrate with [stacktrace.js](https://www.stacktracejs.com/#!/docs/stacktrace-js) to parse sourcemaps.
* Make it available as a Chrome extension of a Dev Tools panel to make it easy to inject the script into any running AngularJS app.
* Instead of hard-coding a list of blacklisted frames, discover them at runtime ([Zone.js does this](https://github.com/angular/zone.js/blob/326a07fb9095e4a87ff7561cb45fe1d4917c2174/lib/common/error-rewrite.ts#L197)).



