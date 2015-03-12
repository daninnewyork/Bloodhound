## Bloodhound
### Tracked Promises in JavaScript

## Why?

Promises are fantastic. They encapsulate a long-running operation into a simple object that
invokes callbacks based on the operation's success or failure.

But more than that, promises can be chained together into complex trees, where the root's
success or failure will depend on the success or failure of all its children.

This tree-like structure accurately represents much of the real-world transactional logic of
modern web applications.

Unfortunately, because these operations can overlap, current performance tracking libraries
have no way to distinguish each operation -- they simply assume all transactions on a page
should be grouped together. Or in a single-page application, they assume that everything in
the current view should be timed together.

But modern single-page applications can have micro-content loading alongside primary content.
The user can be in any part of an application -- like a slideout drawer showing user messages
while the main area shows an edit-record view. Current tracking libraries have no way to
handle this situation.

Enter Bloodhound.

## How?

Bloodhound promises work just like regular promises (in fact, it fully implements the
[A+ spec](https://promisesaplus.com/)), with a lot of the syntactic sugar that other promise
implementations have popularized.

But unlike other promise libraries, Bloodhound also adds the following instance methods:

`promise.trackAs(name [, passive]) : Promise`

This marks the promise instance as a tracked promise, and then returns that instance for chaining.
Optionally, you can say the promise is passively tracked. What that means will be explained
below.

`promise.done() : Promise`

Not all promise libraries have a done method, but it's vital to using promises correctly.
Basically, the golden rule of promises is:

    If you don't return the promise, you must call done.

Calling `done` is what tells Bloodhound that it should attempt to gather up any timing data
in the tree and persist it to any registered collectors. It also throws any unhandled
rejections / exceptions so you know there's an error in your application. (Otherwise, your
app could end up in an inconsistent state.)

Let's look at an example that combines the two new methods:

    function loadMessages() {
        return new Promise(function(resolve, reject) {
            // do real stuff here and
            // call resolve(...) when done
        }).trackAs('load messages', true);
    }
    
    function loadAppData() {
        return new Promise(function(resolve, reject) {
            // do real stuff here and
            // call resolve(...) when done
        }).trackAs('load app data', true);
    }
    
    Promise.all([
        loadMessages(),
        loadAppData()
    ]).trackAs('loading').done();

What does the code do? Both `loadMessages` and `loadAppData` return a promise that would
be resolved once their data calls completed. But before the promises are returned, they
are passively tracked with an appropriate name. Because the promise is being returned,
we do not call `done()` -- after all, someone else will be consuming our promise, so we
can't throw any unhandled errors just yet.

    WHAT DOES IT MEAN TO BE PASSIVELY TRACKED?
    
    Basically, a passively tracked promise is just a promise that has been given the
    specified name but will not be persisted to any registered collectors when `done`
    is called...UNLESS it is part of a larger tree of promises that contains at
    least one actively tracked promise and that tree has completely settled.
    
    WHY USE PASSIVE TRACKING AT ALL?
    
    Sometimes you want to control how your promise will appear in timing data but don't
    actually want it persisted. For example, let's say you're routing all remote HTTP
    calls through a custom data layer. Your data layer could return a promise that is
    passively tracked using the remote URL as the name. That way, any reports you run
    on the generated timing data show clearly what endpoint was taking the longest time
    to run. But that timing data would not be logged EVERY time a remote call was made,
    only when a call was made as part of a larger, actively tracked promise tree.

Finally, we wrap our example promises in a call to `Promise.all`, a static method that
returns a promise which is only resolved if all child promises resolve. But whether that
promise resolves or reject, we actively track it as 'loading'. You can tell it's actively
tracked because we didn't specify `true` for the optional `passive` parameter of
`trackAs`.

Then we call `done()`, which waits until the promise is either resolved or rejected to
check for unhandled exceptions and also persist the timing data to any registered
collectors.

In this case, the timing data might look like the following:

    {
      "name": "loading",
      "data": [
        [
          "sample",
          "messages"
        ],
        [
          "sample",
          "app",
          "data"
        ]
      ],
      "start": 1425943275662,
      "stop": 1425943275786,
      "duration": 124,
      "children": [
        {
          "name": "load messages",
          "data": [
            "sample",
            "messages"
          ],
          "start": 1425943275661,
          "stop": 1425943275716,
          "duration": 55,
          "children": []
        },
        {
          "name": "load app data",
          "data": [
            "sample",
            "app",
            "data"
          ],
          "start": 1425943275662,
          "stop": 1425943275776,
          "duration": 114,
          "children": []
        },
        {
          "name": "anonymous",
          "start": 1425943275663,
          "children": []
        }
      ]
    }

This is already excellent data -- we can quickly see that our application
is taking a long time loading application data. Before, we would simply see
that the initial load took 124 seconds; but figuring out why would be a lot
more difficult.

If you look closely, you'll notice that the timing data for 'load messages'
and 'load app data' both start *before* the parent and end *after*. Why?
Because that's when they actually occurred. We kicked off those calls *and
then* passed those promises to `Promise.all`.

Some people don't like seeing data like this; they prefer more consistent
timing data, where parent promises always start on or before their children
and always end on or after the last child settles. If this is needed for
your particular situation, simply configure Bloodhound using the following
command:

`Promise.config.timing.useSaneTimings();`

This adjusts timing data so parents start on or before their children and
end on or after their last child settles. With sane timings enabled, the
above timing data might look like the following:

    {
      "name": "loading",
      "data": [
        [
          "sample",
          "messages"
        ],
        [
          "sample",
          "app",
          "data"
        ]
      ],
      "start": 1425943993069,
      "stop": 1425943993193,
      "duration": 124,
      "children": [
        {
          "name": "load messages",
          "data": [
            "sample",
            "messages"
          ],
          "start": 1425943993069,
          "stop": 1425943993129,
          "duration": 60,
          "children": []
        },
        {
          "name": "load app data",
          "data": [
            "sample",
            "app",
            "data"
          ],
          "start": 1425943993069,
          "stop": 1425943993183,
          "duration": 114,
          "children": []
        }
      ]
    }

## Configuration

Bloodhound provides a number of ways to configure timings, collectors, and how
asynchronous operations are invoked.

### Scheduling Asynchronous Operations

`Promise.config.setScheduler(mySchedulerFunction)`

Use the specified function to invoke an asynchronous operation. By default, Bloodhound
uses `window.setTimeout` to execute an operation on the next tick of the clock.

In node environments, you may wish to set the scheduler to `async`.

In Angular environments, you may wish to use `$rootScope.$digest.bind($rootScope)`.

Finally, if you're looking for the fastest possible async execution in modern browsers,
you could set the scheduler to use a predefined MutationObserver callback:

**TODO:** MutationObserver example code

### Timing Configuration

`Promise.config.timing.enable()`

Enables the persistence of timing data to any registered collectors. This is the default
state of Bloodhound.

`Promise.config.timing.disable()`

Disables the persistence of timing data to registered collectors. You can re-enable
persistence by calling `Promise.config.timing.enable()`.

`Promise.config.timing.useSaneTimings()`

Ensures parent promises are shown as starting on or before their child promises and
ending on or after their last child promise settles.

### Timing Collectors

Collectors are objects with a single method called `collect` that accepts a timing data
object and decides what to do with it. For example, a collector for Google Analytics
may look like this:

    var GACollector = {
        collect: function(timingData) {
            ga('send', 'timing', 'myApp', timingData.name, timingData.duration);
        }
    };

We could modify our GACollector to send a timing event for all our child timings, too,
instead of just the root timing. Some collectors may also want us to persist start and
stop times. All of this information is available through the timingData object, which
has the following properties:

    name {String} the tracked name of the promise, or 'anonymouse'
    data {*} either the resolved value or rejection reason
    start {Number} when the promise was created, as the number of milliseconds since
        midnight, January 1, 1970 UTC
    stop {Number} when the promise was finally settled, as the number of milliseconds
        since midnight, January 1, 1970 UTC
    duration {Number} the difference between start and stop
    children {Array} an array of child timings

To register or de-register collectors, use the following methods:
    
`Promise.config.collectors.add(collector) : Function`

Adds the specified collector to the list of registered collectors, and returns a function
you can invoke to remove the collector again.

    var collector = {
        collect: function(timingData) {
            console.log(JSON.stringify(timingData, null, 2));
        }
    };
    
    var remove = Promise.config.collectors.add(collector);

The above collector simply logs the timingData instance to the browser's console.

`Promise.config.collectors.remove(collector)`

Removes the specified collector from the list of registered collectors. This has the
same effect as invoking the function returned by `Promise.config.collectors.add`.

## Full API

### Promise constructor

You create a new instance of a Bloodhound promise by calling the constructor and
passing your 'resolver' function -- the method that will be run asynchronously
and either resolve or reject the promise:

    new Promise(function(resolve, reject, notify) {
        // this method will be invoked asynchronously;
        // when it completes, call resolve or reject;
        // if it throws an exception, reject will be
        // called automatically; if you want to notify
        // any listeners of progress updates, call
        // notify with any data you want your listeners
        // to receive (such as a progress percentage)
    });
    
### Static Methods

#### Promise.all(Array) : Promise

Resolves if all child promises resolve; rejects if any child promise rejects.

    Promise.all([
        Promise.delay(50, 'hello'),
        Promise.reject('world')
    ]).catch(function(reason) {
        log(reason); // 'world'
    }).done();

#### Promise.any(Array) : Promise

Resolves if any child promise resolves; rejects if all child promises reject.

    Promise.any([
        Promise.delay(50, 'hello'),
        Promise.reject('world')
    ]).then(function(value) {
        log(value); // 'hello'
    }).done();

#### Promise.some(Array) : Promise

Resolves if the specified number of child promises resolve; rejects if enough
promises reject that the specified count can't be reached.

    Promise.some([
        Promise.delay(50, 'hello'),
        Promise.delay(100, 'world'),
        Promise.reject('reason')
    ], 2).then(function(values) {
        log(values); // ['hello', 'world']
    }).done();

#### Promise.race(Array) : Promise

Resolves with the value of the first child to resolve. If no children
resolve, the promise will be rejected.

    Promise.race([
        Promise.delay(50, 'hello'),
        Promise.delay(20, 'world'),
        Promise.reject('reason')
    ]).then(function(value) {
        log(value); // 'world'
    }).done();

#### Promise.settle(Array) : Promise

Resolves with an array of all child promises once they have been resolved
or rejected. The resolved array will contain the values of any resolved
child promises and the reasons for any rejected child promises.

    Promise.settle([
        Promise.delay(50, 'hello'),
        Promise.delay(20, 'world'),
        Promise.reject(new Error('reason'))
    ]).then(function(results) {
        log(results); // ['hello', 'world', Error]
    }).done();

#### Promise.call(Function*[, arg1, arg2...]*) : Promise

Invokes the specified function with any optionally supplied arguments
passed in as parameters, and returns a promise. The promise will be
resolved with the return value of the function. If the function throws
an exception, the promise will be rejected with the exception data.

    function someMethod(a, b) {
        return a + b;
    }
    
    Promise.call(someMethod, 10, 20)
        .then(function(result) {
            log(result); // 30
        }).done();

#### Promise.apply(Function*[, Array]*) : Promise

Similar to `Promise.call`, but allows you to specify an optional array
of arguments.

    function someMethod() {
        var args = [].slice.call(arguments);
        return args.reduce(function(result, arg) {
            return result + arg;
        }, 0);
    }
    
    Promise.apply(someMethod, [10, 20, 30, 40])
        .then(function(result) {
            log(result); // 100
        }).done();

#### Promise.cast(\*) : Promise

Converts the specified value into a Bloodhound promise using the following
rules:

 - If the value is a Bloodhound promise, it will be returned unaltered.
 - If the value is an Error, a promise will be returned that was immediately
   rejected with the Error data.
 - If the value is a "thenable" -- like a promise from another library, the
   returned promise will be resolved or rejected when the value is.
 - Otherwise, the returned promise will be immediately resolved with the
   given value.

Sample code:

    Promise.cast(new Date()).then(function(now) {
        log(now); // outputs the current date and time
    }).done();
    
    Promise.cast(new Error()).catch(function(err) {
        log(err); // outputs the error instance
    }).done();
    
    Promise.cast($q.when(123)).then(function(value) {
        log(value); // 123
    }).done();

#### Promise.hash(Object) : Promise

Returns a promise that will be resolved with an object. The object's keys will
match the keys of the object passed in, and the object's values will represent
the resolved values of the incoming object's promises, or the reasons it was
rejected.

    Promise.hash({
        'key1': 'you can use normal values',
        'key2': Promise.delay(30, 'and resolved values'),
        'key3': Promise.reject('even rejections')
    }).then(function(results) {
        log(results.key1); // 'you can use normal values'
        log(results.key2); // 'and resolved values'
        log(results.key3); // 'even rejections'
    }).done();

#### Promise.defer() : Object

*DEPRECATED!* This method is only provided for compatibility with any existing
legacy promise code you may be using. You are encouraged instead to use the
Promise constructor to return a promise.

Returns an object with properties and methods you can use to manage an
asynchronous operation. 

    function doAsyncOperation() {
        var defer = Promise.defer();
        try {
            window.setTimeout(function() {
                // do some long-running
                // operation, then resolve
                // with the value you want
                // to pass to handlers:
                defer.resolve(...);
            });
        } catch (err) {
            defer.reject(err);
        }
        return defer.promise;
    }
    
    doAsyncOperation().then(...).done();

The preferred approach is to use the Promise constructor:

    function doAsyncOperation() {
        return new Promise(function(resolve, reject) {
            // do some long-running operation, then
            // resolve with the value you want to
            // pass to handlers; reject will be called
            // automatically if your method throws an
            // exception
            resolve(...);
        });
    }
    
    // how you use the result is the same:
    doAsyncOperation().then(...).done();

#### Promise.delay(Number*[, *]*) : Promise

Returns a promise that will be resolved with the specified value
after the given number of milliseconds. If you provide an instance
of an Error, the returned promise will be rejected when the given
number of milliseconds have elapsed.

This is more of a utility method that you can use during development
to simulate an asynchronous operation that results in a success or
failure.

    Promise.delay(100).then(function(value) {
        log(value); // undefined
    }).done();
    
    Promise.delay(45, 'abc').then(function(value) {
        log(value); // 'abc'
    }).done()
    
    Promise.delay(85, new Error()).catch(function(err) {
        log(err); // Error
    }).done();

#### Promise.isPromise(\*) : Boolean

Returns `true` if the value is a Bloodhound promise or "thenable"
object; otherwise, returns `false`.

    log(Promise.isPromise(Q.when())); // true
    log(Promise.isPromise(Promise.cast())); // true
    log(Promise.isPromise(new Date())); // false

### Instance Methods

#### promise.then(*[Function, Function, Function]*) : Promise

Registers optional callbacks for success, failure, and notification,
and returns a new promise. If your success or failure callback returns
a value, it will become the new value of the returned promise. If
either callback throws an exception the returned promise will be rejected
with the error. If either callback returns a promise, the original
promise will be resolved or rejected with the returned promise.

    Promise.delay(10, 'a')
        .then(function(value) {
            log(value); // 'a'
            return 'b';
        }).then(function(value) {
            log(value); // 'b'
            return Promise.delay(30, 'c');
        }).then(function(value) {
            log(value); // 'c'
            return Promise.reject('some reason');
        }).catch(function(reason) {
            log(reason); // 'some reason'
        }).done();

#### promise.tap(*[Function]*) : Promise

Registers a callback that will be invoked when the promise resolves.
The callback will be provided with the resolved value, but anything
you return from the callback will be ignored. If your callback throws
an error, it will be ignored.

    Promise.delay(50, 'hello')
        .tap(function(value) {
            log(value); // 'hello'
            return 'world'; // ignored
        }).then(function(value) {
            log(value); // still 'hello'
            return value + ' world'; // not ignored
        }).then(function(value) {
            log(value); // 'hello world'
        }).tap(function(value) {
            throw new Error('this is ignored');
        }).then(function(value) {
            log(value); // still 'hello world'
        }).done();

#### promise.catch(*[Function]*) : Promise

Registers a callback that will be invoked only if the promise is
rejected, and returns a new promise that will be resolved or rejected
based on the callback's behavior.

If the callback does not return anything, the returned promise will
be resolved. If the callback returns a value, the returned promise
will be resolved with that value. If the callback throws an exception
or returns a rejected promise, the child promise will be rejected.

    Promise.delay(50, new Error())
        .catch(function(err) {
            // by handling the error, the original
            // promise will switch from rejected
            // to resolve UNLESS we re-throw the
            // error or return a rejected promise
            throw err;
            // or: return Promise.reject(err);
        }).done();

    Promise.delay(40, new Error())
        .catch(function(err) {
            // let's handle the error; if we
            // do not return anything, then we
            // effectively "swallowed" the
            // rejection and converted this
            // to a resolved promise; if we
            // explicitly return a value, it
            // will become the new resolved
            // value for any chained handlers:
            return 'new value';
        }).then(function(value) {
            log(value); // 'new value'
        }).done();

The ability to swallow exceptions is just one reason why calling
`done()` is so important at the end of a promise chain. It ensures
that any *un-*handled exceptions are rethrown so your application
won't end up in an inconsistent state.

#### promise.notified(*[Function]*) : Promise

You can schedule a notification callback to be invoked whenever an
update is announced. Long-running operations can take advantage of
notification callbacks to present status data to the user (e.g. in
the form of a progress bar).

    new Promise(function(resolve, reject, update) {
        $('#myBar).css({width: 0}).show();
        // do long-running operation #1
        update(20); // 20% done
        // do long-running operation #2
        update(45);
        // do long-running operation #3
        update(70);
        // do long-running operation #4
        update(100);
    }).notified(function(percent) {
        $('#myBar').css({width: percent});
    }).finally(function() {
        $('#myBar').hide();
    });

The static methods `hash` and `settle` will call any registered
notification handlers automatically with the percent of promises
that have been settled at any point in time.

#### promise.finally(*[Function]*) : Promise

Allows you to register a callback that will be invoked when the
promise is settled, regardless of whether it was resolved or
rejected.

    Promise.delay(50, 'resolved')
        .finally(function(value) {
            log(value); // resolved
        }).done();

    Promise.delay(50, new Error())
        .finally(function(value) {
            log(value); // Error
        }).done();

#### promise.done() : Promise

This is a very important method. The golden rule of promises is:

    If you do not return the promise, you must call done.

Calling `done()` is what throws any unhandled rejections up to
the browser, ensuring any errors in your application can be found
and handled correctly. Look at the following example:

    Promise.resolve(new Date()).then(myHandler);

    // because we don't call done here, what would
    // happen if an exception occurred in the myHandler
    // method? we would never know the error occurred
    // because it would have been converted into a
    // rejected promise!

    Promise.resolve(new Date()).then(myHandler).done();
    
    // now any unhandled rejections will be propagated
    // up to the UI so we know a problem occurred

Calling `done()` also persists timing data to your collectors.
Because promises can be chained together into complex trees,
there is no other way for Bloodhound to know that you are done
constructing the promise tree and that it is safe to persist.

    function myLongRunningOperation() {
        // because we are returning the promise,
        // we DO NOT call done(); this ensures
        // callers can incorporate this promise
        // into their trees -- we have to rely
        // on them calling done() at the correct
        // time and place
        return Promise.delay(2000, 'sample data');
    }
    
    Promise.all([
        myLongRunningOperation(),
        someOtherLongRunningOperation(),
        anotherLongRunningOperation(),
        ...
    ]).trackAs('lots of operations').done();
    
    // we call done() when it's finally safe to
    // look for unhandled exceptions and to persist
    // the timing data to collectors

#### promise.timeout(Number*[, String]*) : Promise

If the promise is not settled in the amount of time specified,
automatically reject it. You can provide a custom rejection
string, or use the default of 'timed out'.

    Promise.delay(50).timeout(20); // rejects after 20ms with 'timed out'
    Promise.delay(50).timeout(100); // does not time out
    Promise.delay(50).timeout(20, 'too slow'); // rejects with 'too slow'

The original promise is returned from this method, so you can
continue chaining handlers:

    Promise.delay(50)
        .timeout(Math.random() * 100)
        .then(success, failure);

#### promise.spread(*[Function]*) : Promise

If the promise is resolved with an array, this method will invoke
the specified callback with each array value passed in as arguments.

    Promise.all([
        Promise.delay(40, 'a'),
        Promise.delay(10, 'b'),
        Promise.delay(20, 'c')
    ]).spread(function(a, b, c) {
        log(a, b, c); // 'a', 'b', 'c'
    }).done();

This can be a useful alternative to nesting promises. Without `all`,
you would've had to write code like this:

    Promise.delay(40, 'a').then(function(a) {
        Promise.delay(10, 'b').then(function(b) {
            Promise.delay(20, 'c').then(function(c) {
                log(a, b, c); // 'a', 'b', 'c'
            }).done();
        }).done();
    }).done();

#### promise.trackAs(String*[, Boolean]*) : Promise

#### promise.isRejected() : Boolean
#### promise.isResolved() : Boolean
#### promise.isSettled() : Boolean