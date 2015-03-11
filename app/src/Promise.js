(function(global, undefined) {

    'use strict';

    define([], function() {

        var async,
            collectors = [],

            States = {
                PENDING: 0,
                RESOLVED: 1,
                REJECTED: 2
            },

            noop = function noop() {},

            err = function err(reason) {
                async(function throwError() {
                    throw new Error(reason);
                });
            },

            Cycle = {

                inChildren : function inChildren(toCheck, promise) {
                    return promise._children.indexOf(toCheck) !== -1 ||
                        promise._children.some(inChildren.bind(null, toCheck));
                },

                inParents : function inParents(toCheck, promise) {
                    return !!promise._parent && (
                        promise._parent === toCheck || inParents(toCheck, promise._parent)
                    );
                },

                inChain : function inChain(toCheck, promise) {
                    return toCheck === promise ||
                        Cycle.inParents(toCheck, promise) ||
                        Cycle.inChildren(toCheck, promise);
                }

            },

            RESOLVER = function RESOLVER(promise, x, parentValue) {
                // NOTE: logic is based on the Promises/A+ spec
                // found at https://promisesaplus.com/
                if (!!promise && promise === x) {
                    promise._reject(new TypeError());
                } else if (Promise.isPromise(x)) {
                    if (Cycle.inChain(x, promise)) {
                        throw new Error('Cycle created in promise chain.');
                    }
                    x.then(promise._resolve, promise._reject);
                    chain(promise._parent || promise, x);
                } else if (x === undefined) {
                    if (parentValue instanceof Error) {
                        parentValue = undefined;
                    }
                    promise._resolve(parentValue);
                } else if (typeof x === 'function' || typeof x === 'object') {
                    try {
                        var next = x.then;
                        if (typeof next === 'function') {
                            next.call(x, RESOLVER.bind(null, promise), promise._reject);
                        } else {
                            promise._resolve(x);
                        }
                    } catch (e) {
                        promise._reject(e);
                    }
                } else {
                    promise._resolve(x);
                }
            },

            Timing = {

                enabled : true,
                useSaneTimings : false,
                epochMethod : Date.now ? Date.now : function getTime() {
                    return new Date().getTime();
                },

                getUTCEpochTime : function getUTCEpochTime() {
                    return Timing.epochMethod();
                },

                anyActiveTracks : function anyActiveTracks(node) {
                    return !!node._trackName && (!node._isPassive || node._children.some(Timing.anyActiveTracks));
                },

                addChildren : function addChildren(timing, children) {
                    (children || []).forEach(function iter(child) {
                        if (child.isSettled()) {
                            timing.children.push(Timing.getTimingTree(child));
                        }
                    });
                },

                getTimingTree : function getTimingTree(node) {

                    var timing = {
                        name: node._trackName || 'anonymous',
                        data: node._data,
                        start: node._start,
                        stop: node._stop,
                        duration: node._duration,
                        children: []
                    };

                    Timing.addChildren(timing, node._children);

                    return timing;

                },

                getTimingData : function getTimingData(promise) {

                    var tree,
                        root = promise,
                        ancestor = root._parent;

                    while (!!ancestor) {
                        root = ancestor;
                        ancestor = root._parent;
                    }

                    if (!root.isSettled() || !Timing.anyActiveTracks(root)) {
                        return;
                    }

                    tree = Timing.getTimingTree(root);

                    if (Timing.useSaneTimings) {
                        Timing.sanitize(tree);
                    }

                    return tree;

                },

                getMinStart : function getMinStartTime(timing) {
                    return [timing.start].concat(timing.children.map(Timing.getMinStart)).sort().shift();
                },

                getMaxStop : function getMaxStopTime(timing) {
                    return [timing.stop].concat(timing.children.map(Timing.getMaxStop)).sort().pop();
                },

                sanitize : function sanitize(timing) {
                    timing.start = Timing.getMinStart(timing);
                    timing.stop = Timing.getMaxStop(timing);
                    timing.duration = Math.max(0, timing.stop - timing.start);
                    timing.children.forEach(sanitize);
                },

                persistTimings : function persistTimings() {
                    if (!Timing.enabled) {
                        return;
                    }
                    var timing = Timing.getTimingData(this);
                    if (!!timing) {
                        collectors.forEach(function persist(collector) {
                            collector.collect(timing);
                        });
                    }
                }

            },

            chain = function chain(parent, child) {

                if (Cycle.inChain(parent, child)) {
                    return;
                }

                var root = child,
                    ancestor = root._parent;

                while (!!ancestor) {
                    if (ancestor === parent) {
                        return;
                    }
                    root = ancestor;
                    ancestor = root._parent;
                }

                root._parent = parent;
                parent._children.push(root);

            },

            wrapCallback = function wrapCallback(child, callback, propagate, reject) {
                // used by promise.then() to wrap the success and failure callbacks
                // so any values returned from those methods can be propagated correctly
                // according to the Promise/A+ specification
                return function parentSettled(value) {
                    if (typeof callback === 'function') {
                        if (!child._trackName) {
                            // if the callback is not anonymous, we use the function
                            // name as the passively tracked name so any persisted
                            // timing data will be more easily understood
                            var cbName = callback.toString().match(/function\s(\w+)/);
                            if (cbName instanceof Array) {
                                child.trackAs(cbName.pop(), false);
                            }
                        }
                        try {
                            RESOLVER(child, callback(value), value);
                        } catch (err) {
                            reject(err);
                        }
                    } else {
                        propagate(value);
                    }
                };
            },

            wrapPush = function wrapPush(promise, arr, state) {
                // if someone tries to add a callback to
                // a promise that is already settled, we
                // immediately schedule the callback for
                // invocation; otherwise, we add it to the
                // queue to be invoked once the promise is
                // resolved or rejected
                arr.push = function push(fn) {
                    if (promise._state === state) {
                        async(fn, promise._data);
                    } else {
                        Array.prototype.push.call(arr, fn);
                    }
                };
                return arr;
            },

            settle = function settle(promise, state, data) {
                // this is the method used by resolve and
                // reject to ensure a settled promise cannot
                // be settled again, that timing data is
                // finalized, and that any queued success or
                // failure callbacks are invoked
                if (promise._state === States.PENDING) {

                    promise._data = data;
                    promise._state = state;
                    promise._stop = Timing.getUTCEpochTime();
                    promise._duration = promise._stop - promise._start;

                    var callbacks = state === States.RESOLVED ?
                        promise._successes : promise._failures;

                    callbacks.forEach(function iter(callback) {
                        async(function doCallback() {
                            callback(promise._data);
                        });
                    });

                }
            };

        /**
         * Promises/A+ specification-compliant promise
         * implementation that includes timing data.
         * @class Bloodhound.Promise
         * @param {Function} fn A resolver function that will
         *  be invoked asynchronously and passed the following
         *  arguments:
         *
         *  - resolve - a function that can be invoked with an
         *    optional parameter; when invoked, the promise will
         *    be resolved with the specified value
         *  - reject - a function that can be invoked with an
         *    optional reason or Error instance; when invoked,
         *    the promise will be rejected with the specified
         *    reason
         *  - notify - a function that can be invoked with an
         *    optional parameter; when invoked, any registered
         *    notification callbacks will be invoked with the
         *    specified data
         * @returns Bloodhound.Promise
         * @example
         * var promise = new Promise(function(resolve, reject) {
         *   // NOTE: this method is invoked asynchronously
         *   try {
         *     var result = someLongRunningMethod();
         *     resolve(result);
         *   } catch (err) {
         *     reject(err);
         *   }
         * });
         */
        function Promise(fn) {

            if (!(this instanceof Promise)) {
                return new Promise(fn);
            }

            if (typeof fn !== 'function') {
                throw new Error('Promise constructor expects a function.');
            }

            var promise = this,

                resolve = function resolver(value) {
                    if (value instanceof Error) {
                        settle(promise, States.REJECTED, value);
                    } else {
                        settle(promise, States.RESOLVED, value);
                    }
                },

                reject = function rejecter(reason) {
                    settle(promise, States.REJECTED, reason);
                },

                notify = function notify(data) {
                    promise._notifies.forEach(function iter(notifier) {
                        notifier(data);
                    });
                };

            promise._notify = notify;
            promise._reject = reject;
            promise._resolve = resolve;
            promise._start = Timing.getUTCEpochTime();
            promise._parent = null;
            promise._children = [];
            promise._notifies = [];
            promise._successes = wrapPush(promise, [], States.RESOLVED);
            promise._failures = wrapPush(promise, [], States.REJECTED);
            promise._state = States.PENDING;

            async(function invoke() {
                try {
                    fn.call(promise, resolve, reject, notify);
                } catch (err) {
                    reject(err);
                }
            });

        }

        /**
         * Registers optional success, failure, and notification callbacks
         * that will be invoked when the promise is resolved, rejected,
         * or updated.
         * @function Bloodhound.Promise#then
         * @param [success] {Function} A method to invoke when the promise
         *  is resolved. The method can accept an optional `value` parameter
         *  that will be set to the value of the resolved promise. If the
         *  method returns a value, the returned promise will be resolved
         *  with that value; otherwise, the returned promise will be resolved
         *  with the value of its parent promise.
         * @param [failure] {Function} A method to invoke when the promise
         *  is rejected. The method can accept an optional `reason` parameter
         *  that will be set to the reason the promise was rejected. If the
         *  method does not return a new rejected promise or throw an error,
         *  the returned promise will be considered resolved.
         * @param [notify] {Function} A method to invoke when the promise is
         *  updated. The method can accept an optional `data` parameter that
         *  will be set to the update value.
         * @returns {Bloodhound.Promise}
         * @example
         * function myLongRunningOperation() {
         *   var defer = Promise.defer();
         *
         *   setTimeout(function loadData() {
         *     // pretend we're loading
         *     // a bunch of stuff...
         *     defer.update(15);
         *     defer.update(40);
         *     defer.update(85);
         *     defer.update(100);
         *     defer.resolve('finished loading');
         *   });
         *
         *   return defer.promise;
         * }
         *
         * var success = function(value) {
         *       log('success', value);
         *     },
         *
         *     failure = function(reason) {
         *       log('failure', reason);
         *     },
         *
         *     update = function(data) {
         *       log('update', data);
         *     };
         *
         * myLongRunningOperation()
         *   .then(success, failure, update)
         *   .done();
         */
        Promise.prototype.then = function then(success, failure, notify) {

            var parent = this,
                child = new Promise(function ThenPromise(resolve, reject) {
                    parent._successes.push(wrapCallback(child, success, resolve, reject));
                    parent._failures.push(wrapCallback(child, failure, reject, reject));
                });

            if (typeof notify === 'function') {
                parent._notifies.push(notify);
            }

            chain(parent, child);

            return child;

        };

        /**
         * Registers a failure callback that will be invoked if
         * the promise is rejected. If invoked, an optional reason
         * will be supplied to the callback as the only parameter.
         * @function Bloodhound.Promise#catch
         * @alias Bloodhound.Promise#else
         * @param [callback] {Function} A method to invoke when the promise
         *  is rejected. The method can accept an optional `reason` parameter
         *  that will be set to the reason the promise was rejected. If the
         *  method does not return a new rejected promise or throw an error,
         *  the returned promise will be considered resolved.
         * @returns {Bloodhound.Promise}
         * @example
         * var promise = doSomeLongRunningOperation();
         * promise.catch(function(reason) {
         *   log('an error occurred:', reason);
         *
         *   // if we do not return a rejected promise
         *   // or throw an exception, the promise will
         *   // be considered resolved (as if we had
         *   // fixed whatever error occurred)
         *
         *   // if we want to propagate the rejection:
         *   return Promise.reject(reason);
         *   // or: throw new Error(reason);
         * }).done();
         */
        Promise.prototype.catch = Promise.prototype.else = function onRejected(callback) {
            return this.then(null, callback);
        };

        /**
         * Registers a callback method to be invoked when
         * the promise is updated. The callback can accept
         * an optional `data` parameter that represents
         * the specified update data.
         * @function Bloodhound.Promise#notifed
         * @param [callback] {Function} A method to invoke when the promise is
         *  updated. The method can accept an optional `data` parameter that
         *  will be set to the update value.
         * @returns {Bloodhound.Promise}
         * @example
         * var promise = new Promise(function(resolve, reject, notify) {
         *   notify(30);
         *   notify(55);
         *   notify(90);
         *   notify(100);
         * });
         *
         * promise.notified(function(data) {
         *   log('updated:', data); // outputs 30, 55, 90, 100
         * }).done();
         */
        Promise.prototype.notified = function onNotify(callback) {
            return this.then(null, null, callback);
        };

        /**
         * Registers a method that will be invoked when the
         * promise is resolved; if the callback returns a value,
         * it will be ignored; the value of the original promise
         * will propagate to the promise returned by tap.
         * @function Bloodhound.Promise#tap
         * @param [callback] {Function} An optional method to
         *  invoke when the promise is resolved; the method
         *  will be supplied with the promise's resolved value.
         * @returns {Bloodhound.Promise}
         * @example
         * Promise.delay(100, 'abc')
         *   .tap(function(value) {
         *     log(value); // 'abc'
         *     return 'def'; // ignored
         *   })
         *   .then(function(value) {
         *     log(value); // still 'abc'
         *   })
         *   .done();
         */
        Promise.prototype.tap = function onTap(callback) {
            return this.then(function tapValue(value) {
                if (typeof callback === 'function') {
                    callback(value);
                }
            });
        };

        /**
         * Rejects the promise if it has not been resolved
         * by the time the specified number of milliseconds
         * have passed.
         * @function Bloodhound.Promise#timeout
         * @param ms {Number} The number of milliseconds to wait
         *  before rejecting the promise.
         * @param [reason='timed out'] {String} An optional
         *  rejection reason you can specify; if not provided,
         *  'timed out' will be used.
         * @returns {Promise} The same promise that `timeout`
         *  was called on.
         * @example
         * Promise.delay(100, 'never resolved')
         *   .timeout(50, 'took too long')
         *   .catch(function(reason) {
         *     log(reason); // 'took too long'
         *   }).done();
         */
        Promise.prototype.timeout = function timeout(ms, reason) {
            var reject = this._reject.bind(this, reason || 'timed out'),
                token = global.setTimeout(reject, ms);
            this.finally(global.clearTimeout.bind(global, token));
            return this;
        };

        /**
         * Registers a callback to be invoked when the promise
         * is settled (i.e. either resolved or rejected).
         * @function Bloodhound.Promise#finally
         * @param [callback] {Function} The function to invoke
         *  when the promise is settled (resolved or rejected).
         * @returns {Bloodhound.Promise}
         * @example
         * Promise.delay(50, 'abc')
         *   .then(function(value) {
         *     log(value); // 'abc';
         *     return 'def';
         *   }).finally(function(valueOrReason) {
         *     log(valueOrReason); // 'def'
         *   });
         */
        Promise.prototype.finally = function onSettled(callback) {
            return this.then(callback, callback);
        };

        /**
         * Returns `true` if the promise is either
         * resolved or rejected (i.e. no longer in
         * a pending state).
         * @function Bloodhound.Promise#isSettled
         * @returns {boolean}
         * @example
         * Promise.resolve('abc').isSettled(); // true
         * Promise.reject('reason').isSettled(); // true
         * Promise.delay(50).isSettled(); // false
         */
        Promise.prototype.isSettled = function isSettled() {
            return this._state !== States.PENDING;
        };

        /**
         * Returns `true` if the promise is resolved
         * (i.e. neither pending nor rejected).
         * @function Bloodhound.Promise#isResolved
         * @returns {boolean}
         * @example
         * Promise.resolve('abc').isResolved(); // true
         * Promise.reject('reason').isResolved(); // false
         * Promise.delay(50).isResolved(); // false
         */
        Promise.prototype.isResolved = function isResolved() {
            return this._state === States.RESOLVED;
        };

        /**
         * Returns `true` if the promise is rejected
         * (i.e. neither pending nor resolved).
         * @function Bloodhound.Promise#isRejected
         * @returns {boolean}
         * @example
         * Promise.resolve('abc').isRejected(); // false
         * Promise.reject('reason').isRejected(); // true
         * Promise.delay(50).isRejected(); // false
         */
        Promise.prototype.isRejected = function isRejected() {
            return this._state === States.REJECTED;
        };

        /**
         * Tells Bloodhound to track this promise with the specified
         * name. If someone calls `done()` on a promise chain that
         * includes this promise, all captured timing data will be
         * persisted to any registered collectors.
         *
         * If you specify `passive` as true, then the timing data
         * will only be persisted if another promise in the tree is
         * being tracked and is *not* passive. See the examples for
         * details.
         * @function Bloodhound.Promise#trackAs
         * @param name {String} The name to associate with this promise;
         *  the name will appear in timing data passed to collectors.
         * @param [passive] {Boolean} Whether or not the promise should
         *  be passively tracked. Default is `false`. If `true`, then
         *  timing data will not be persisted to collectors when `done()`
         *  is called unless some other promise in the chain was being
         *  actively tracked.
         * @returns {Promise}
         * @example
         * function doLogIn(username, password) {
         *   return new Promise(function(resolve, reject) {
         *     try {
         *       // pretend to make a remote call:
         *       Promise.delay(150, [username, password]).then(resolve, reject);
         *     } catch (err) {
         *       reject(err);
         *     }
         *   }).trackAs('user login', true);
         *
         *   // by tracking this, we ensure it appears in timing
         *   // output with the name we want ('user login'); we
         *   // can use the timing data in reports to ensure our
         *   // login process is not taking too long
         *
         *   // however, because we specified `true` for the passive
         *   // parameter, we will not persist login timing data to
         *   // our collectors *unless* the promise is part of a larger
         *   // actively tracked promise tree
         * }
         *
         * // let's pretend we need to perform a bunch of concurrent
         * // operations, one of which includes logging in; by actively
         * // tracking the combined promise and calling `done()`, we
         * // will persist all timing data to any registered collectors;
         * // and because doLogIn() returned a passively tracked promise,
         * // it will appear in our logs with the desired name ('user login')
         * Promise.all([
         *   doLogIn('user', 'password'), // passively tracked
         *   doSomethingElse(),
         *   doAnotherThing()
         * ])
         *   .trackAs('application setup') // actively tracked
         *   .done(); // persists timing data to collectors
         */
        Promise.prototype.trackAs = function trackAs(name, passive) {
            if (typeof name !== 'string') {
                throw new TypeError('Method `trackAs` expects a string name.');
            }
            this._trackName = name;
            this._isPassive = !!passive;
            return this;
        };

        /**
         * If the promise is in a rejected state, throws an
         * exception. Also, persists the promise tree to any
         * registered timing collectors, if at least one promise
         * in the tree was actively tracked.
         * @function Bloodhound.Promise#done
         * @returns {Promise}
         * @example
         * Promise.resolve('abc').trackAs('promise-1').done();
         * Promise.reject('reason').trackAs('promise-2').done();
         * // both promises will be persisted to any registered
         * // collectors, but promise-2 will also throw an
         * // exception so you can respond to its rejection
         */
        Promise.prototype.done = function done() {
            var persist = Timing.persistTimings.bind(this);
            this._failures.push(err);
            this._failures.push(persist);
            this._successes.push(persist);
            return this;
        };

        /**
         * If the promise is resolved with an array of values,
         * the arguments of the callback passed to this method
         * will be populated with that array of values. If the
         * callback returns a value, the new promise will be
         * resolved with that value.
         * @function Bloodhound.Promise#spread
         * @param [callback] {Function} A method that will be
         *  invoked with the resolved array of values passed
         *  in as parameters.
         * @returns {Bloodhound.Promise}
         * @example
         * Promise.all([
         *   Promise.delay(10, 1),
         *   Promise.delay(40, 2),
         *   Promise.delay(25, 3)
         * ]).spread(function(a, b, c) {
         *   log(a, b, c); // 1, 2, 3
         *   return a + b + c;
         * }).then(function(sum) {
         *   log(sum); // 6
         * });
         */
        Promise.prototype.spread = function spread(callback) {
            return this.then(function spread(values) {
                if (typeof callback === 'function') {
                    return callback.apply(null, values);
                }
            });
        };

        /** utility methods **/

        /**
         * Returns `true` if the value is a Bloodhound promise
         * or "thenable" object that can be cast to a Bloodhound
         * promise.
         * @function Bloodhound.Promise.isPromise
         * @param [promise] {*}
         * @returns {boolean}
         * @example
         * log(Promise.isPromise(Promise.resolve('abc'))); // true
         * log(Promise.isPromise(Q.when('abc'))); // true
         * log(Promise.isPromise(new Date())); // false
         */
        Promise.isPromise = function isPromise(promise) {
            return promise instanceof Promise ||
                (!!promise && typeof promise.then === 'function');
        };

        /**
         * Returns a promise that is immediately resolve with
         * the specified value.
         * @param value {*}
         * @returns {Bloodhound.Promise}
         * @example
         * Promise.resolve('abc');
         * Promise.resolve([1, 2, 3]);
         */
        Promise.resolve = function resolve(value) {
            var promise = new Promise(noop);
            promise._resolve(value);
            return promise;
        };

        /**
         * Returns a promise that is immediately rejected
         * with the specified reason.
         * @param reason {String|Error}
         * @returns {Bloodhound.Promise}
         * @example
         * Promise.reject('the operation failed');
         * Promise.reject(new TypeError('expected string but got array'));
         */
        Promise.reject = function reject(reason) {
            var promise = new Promise(noop);
            promise._reject(reason);
            return promise;
        };

        /**
         * Returns an object that can be used to asynchronously
         * resolve, reject, or update a promise.
         * @function Bloodhound.Promise.defer
         * @deprecated This method has been deprecated in favor of
         *  the new promise constructor syntax where you can pass
         *  in a function that will be executed asynchronously that
         *  can resolve, reject, and/or update the promise.
         * @returns {Object}
         * @example
         * function myLongRunningOperation() {
         *   var defer = Promise.defer();
         *   // possible methods:
         *   defer.resolve('some value');
         *   // also: defer.reject('some reason');
         *   // also: defer.notify('in progress');
         *   return defer.promise;
         * }
         *
         * myLongRunningOperation().then(...).done();
         * @example
         * // same as the previous example, but with the
         * // preferred constructor syntax:
         * function myLongRunningOperation() {
         *   return new Promise(function(resolve, reject, notify) {
         *     resolve('some value');
         *     // also: reject('some reason');
         *     // also: notify('in progress');
         *   });
         * }
         *
         * myLongRunningOperation().then(...).done();
         */
        Promise.defer = function defer() {

            var promise = new Promise(noop);

            return {
                promise: promise,
                resolve: promise._resolve,
                reject: promise._reject,
                notify: promise._notify
            };

        };

        /**
         * Converts an object into a Bloodhound promise.
         *
         *  - If the object is an Error, a rejected promise is returned.
         *  - If the object is already a Bloodhound promise, it will be
         *    returned unaltered.
         *  - If the object is a "thenable", it will be converted into
         *    a Bloodhound promise that will be resolved or rejected
         *    when the object is.
         *  - Otherwise, a Bloodhound promise will be returned that is
         *    immediately resolved with the specified value.
         * @function Bloodhound.Promise.cast
         * @alias Bloodhound.Promise.when
         * @param {*} obj The object to cast to a Bloodhound promise.
         * @returns {Bloodhound.Promise}
         * @example
         * Promise.cast(123); // a promise resolved with 123
         * Promise.cast(new Error()); // a promise rejected the given error
         * Promise.cast(Promise.resolve()); // returns the original promise
         * Promise.cast(Q.when(123)); // returns a Bloodhound promise resolved to 123
         */
        Promise.cast = Promise.when = function cast(obj) {
            if (obj instanceof Promise) {
                return obj;
            } else if (Promise.isPromise(obj)) {
                return new Promise(function CastPromise(resolve, reject) {
                    obj.then(resolve, reject);
                });
            } else if (obj instanceof Error) {
                return Promise.reject(obj);
            } else {
                return Promise.resolve(obj);
            }
        };

        /**
         * Returns a promise that will be resolved with the specified
         * value after the specified number of milliseconds.
         * @function Bloodhound.Promise.delay
         * @alias Bloodhound.Promise.wait
         * @param ms {Number} The number of milliseconds to wait before
         *  resolving the returned promise.
         * @param value {*} The value to resolve the returned promise
         *  with. If value is an Error instance, the returned promise
         *  will be rejected.
         * @returns {Bloodhound.Promise}
         * @example
         * function myDelayedFunction() {
         *   return Promise.delay(25);
         * }
         * myDelayedFunction().then(...).done();
         * @example
         * Promise.delay(50, 'abc').then(function(value) {
         *   log(value); // 'abc'
         * }).done();
         * @example
         * Promise.delay(10, new Error('oops')).catch(function(err) {
         *   log(err.reason); // 'oops'
         * }).done();
         */
        Promise.delay = Promise.wait = function delay(ms, value) {
            return new Promise(function DelayedPromise(resolve) {
                global.setTimeout(resolve.bind(this, value), ms);
            });
        };

        /**
         * Wraps a function call in a promise. The return value of
         * the function will become the resolved promise value. If
         * the function throws an exception, the promise will be
         * rejected with the specified Error instance.
         * @function Bloodhound.Promise.call
         * @param fn {Function} The function to wrap in a promise.
         * @throws Method expects a function to be specified.
         * @returns {Bloodhound.Promise}
         * @example
         * function sum(arg1, arg2) {
         *   log(arg1, arg2);
         *   return arg1 + arg2;
         * }
         *
         * Promise.call(sum, 10, 20).then(function(value) {
         *   log(value); // 30
         * }).done();
         */
        Promise.call = function callMethod(fn) {
            if (typeof fn !== 'function') {
                throw new TypeError('Method expects a function to be specified.');
            }
            var args = [].slice.call(arguments, 1);
            return new Promise(function TryPromise(resolve) {
                resolve(fn.apply(null, args));
            });
        };

        /**
         * Wraps a function apply in a promise. The return value of
         * the function will become the resolved promise value. If
         * the function throws an exception, the promise will be
         * rejected with the specified Error instance.
         * @function Bloodhound.Promise.apply
         * @param fn {Function} The function to wrap in a promise.
         * @param [args] {Array} An optional array of arguments
         *  to pass to the specified function.
         * @throws Method expects a function to be specified.
         * @returns {Bloodhound.Promise}
         * @example
         * function sum() {
         *   var sum = 0,
         *       args = [].slice.call(arguments);
         *   args.forEach(function(arg) {
         *     sum += arg;
         *   });
         *   return sum;
         * }
         *
         * Promise.apply(sum, [10, 20]).then(function(value) {
         *   log(value); // 30
         * }).done();
         *
         * Promise.apply(sum, [1, 2, 3, 4, 5]).then(function(value) {
         *   log(value); // 15
         * }).done();
         */
        Promise.apply = function applyMethod(fn, args) {
            return Promise.call.apply(Promise, [fn].concat(args || []));
        };

        /** array methods **/

        function getArrayPromise(promises, resolver) {
            if (!(promises instanceof Array)) {
                throw new TypeError('This method expects an array.');
            }
            promises.forEach(function cast(promise, index) {
                promises[index] = Promise.cast(promise);
            });
            var parent = new Promise(resolver);
            promises.forEach(chain.bind(null, parent));
            return parent;
        }

        /**
         * Returns a promise that will be resolved with an object
         * whose keys match the incoming object's keys, and whose
         * values are the incoming object's values when resolved
         * or reasons when rejected. See the example for details.
         * @function Bloodhound.Promise.hash
         * @param obj {Object} An object whose keys will be used
         *  for the keys of the resolved promise value, and whose
         *  values, if promises, will be resolved.
         * @returns {Bloodhound.Promise}
         * @example
         * function getUserData() {
         *   return new Promise(function(resolve) {
         *     // make remote call, then resolve
         *     // with the user's data:
         *     resolve({
         *       userName: 'user123',
         *       lastLogin: '2015-03-02'
         *     });
         *   });
         * }
         *
         * function getUserPermissions() {
         *   return ['edit', 'delete', 'create'];
         * }
         *
         * function getAvailableApps() {
         *   return new Error('invalid operation');
         * }
         *
         * Promise.hash({
         *   'userData' : getUserData(), // returns a promise
         *   'permissions' : getUserPermissions(), // returns an array
         *   'apps' : getAvailableApps() // throws an error
         * }).then(function(result) {
         *   log(result.permissions); // ['edit', 'delete', 'create']
         *   log(result.userData); // {userName: 'user123', lastLogin: '2015-03-02'}
         *   log(result.apps); // [Error]
         * }).done();
         */
        Promise.hash = function hash(obj) {
            var keys = Object.getOwnPropertyNames(obj),
                promises = keys.map(function cast(key) {
                    return Promise.cast(obj[key]);
                });
            return getArrayPromise(promises, function HashPromise(resolve, reject) {
                Promise.settle(promises).then(function(results) {
                    var result = {};
                    keys.forEach(function iter(key, index) {
                        result[key] = results[index]._data;
                    });
                    resolve(result);
                }, reject);
            });
        };

        /**
         * Returns a promise that is resolved when all of the
         * specified promises are either resolved or rejected.
         * The returned promise is resolved with the original
         * array of promises, so they can be further inspected.
         * @function Bloodhound.Promise.settle
         * @param promises {Bloodhound.Promise[]}
         * @returns {Bloodhound.Promise}
         * @example
         * Promise.settle([
         *   Promise.delay(25, new Date()),
         *   Promise.delay(15, new Error())
         * ]).then(function(promises) {
         *   log(promises[0].isResolved()); // true
         *   log(promises[1].isResolved()); // false
         * }).done();
         */
        Promise.settle = function settle(promises) {
            return getArrayPromise(promises, function SettlePromise(resolve) {
                var numSettled = 0,
                    total = promises.length,
                    increment = function increment() {
                        if (++numSettled >= total) {
                            resolve(promises);
                        }
                    };
                if (total === 0) {
                    resolve([]);
                } else {
                    promises.forEach(function iter(child) {
                        child._failures.push(increment);
                        child._successes.push(increment);
                    });
                }
            });
        };

        /**
         * Returns a promise that is resolved with the
         * value of the first of the specified promises
         * that resolves. If none of the specified promises
         * resolves, the returned promise will be rejected.
         * @function Bloodhound.Promise.race
         * @param promises {Bloodhound.Promise[]}
         * @returns {Bloodhound.Promise}
         * @example
         * Promise.race([
         *   Promise.delay(20, 'first'),
         *   Promise.delay(5, 'second'),
         *   Promise.delay(100, 'last')
         * ]).then(function(winner) {
         *   log(winner); // 'second'
         * }).done();
         */
        Promise.race = function race(promises) {
            return getArrayPromise(promises, function RacePromise(resolve, reject) {
                var numRejected = 0,
                    total = promises.length,
                    checkPossible = function checkPossible() {
                        if (++numRejected >= total) {
                            reject();
                        }
                    };
                if (total === 0) {
                    reject('No promises to race.');
                } else {
                    promises.forEach(function iter(child) {
                        child._successes.push(resolve);
                        child._failures.push(checkPossible);
                    });
                }
            });
        };

        /**
         * Returns a promise that is resolved if the
         * specified number of provided promises resolve.
         * The resolved value will be an array of the
         * resolved promise values. If the expected number
         * of promises do not resolve, the returned promise
         * will be rejected.
         * @function Bloodhound.Promise.some
         * @param promises {Bloodhound.Promise[]}
         * @param count {Number}
         * @returns {Bloodhound.Promise}
         * @example
         * Promise.some([
         *   Promise.delay(10, 1),
         *   Promise.delay(50, 2),
         *   Promise.reject(),
         *   Promise.delay(20, 3)
         * ], 2).then(function(values) {
         *   log(values); // [1, 3]
         * }).done();
         */
        Promise.some = function some(promises, count) {

            if (typeof count !== 'number' || count !== count) {
                throw new TypeError('Promise.some expects a numeric count to be provided.');
            }

            return getArrayPromise(promises, function SomePromise(resolve, reject) {

                var numRejected = 0,
                    numResolved = 0,
                    BAD_TOKEN = '\x18',
                    total = promises.length,
                    resolved = new Array(total),
                    increment = function increment(index, value) {
                        resolved[index] = value;
                        if (++numResolved >= count) {
                            resolve(resolved.filter(function(value) {
                                return value !== BAD_TOKEN;
                            }));
                        }
                    },
                    checkPossible = function checkPossible(index) {
                        resolved[index] = BAD_TOKEN;
                        if (++numRejected > (total - count)) {
                            reject('Desired count not met.');
                        }
                    };

                if (total < count) {
                    reject('Not enough promises to meet desired count.');
                } else if (total === 0) {
                    resolve([]);
                } else {
                    promises.forEach(function iter(child, index) {
                        child._failures.push(checkPossible);
                        child._successes.push(increment.bind(null, index));
                    });
                }

            });

        };

        /**
         * Returns a promise that will be resolved if
         * any of the specified promises resolve. The
         * resolved value will be an array that contains
         * the resolved promise(s).
         * @function Bloodhound.Promise.any
         * @param promises {Bloodhound.Promise[]}
         * @returns {Bloodhound.Promise}
         * @example
         * Promise.any([
         *   Promise.delay(30, 'abc'),
         *   Promise.delay(20, new Error()),
         *   Promise.delay(50, 'def')
         * ]).then(function(values) {
         *   log(values); // ['abc']
         * }).done();
         */
        Promise.any = function any(promises) {
            return Promise.some(promises, 1);
        };

        /**
         * Returns a promise that will resolve only
         * once all of the specified promises resolve.
         * If even one of the specified promises is
         * rejected, the returned promise will also
         * be rejected. The resolved value will be an
         * array containing all of the resolved values.
         * @function Bloodhound.Promise.all
         * @param promises {Bloodhound.Promise[]}
         * @returns {Bloodhound.Promise}
         * @example
         * Promise.all([
         *   Promise.delay(10, 'abc'),
         *   Promise.delay(20, 'def')
         * ]).then(function(values) {
         *   log(values); // ['abc', 'def']
         * }).done();
         */
        Promise.all = function all(promises) {
            return Promise.some(promises, promises.length);
        };

        /** configuration **/

        Promise.config = {

            /**
             * Sets the scheduler function used internally by
             * Bloodhound to execute asynchronous operations.
             * @function Bloodhound.Promise.config.setScheduler
             * @param scheduler {Function} A function which will
             *  be passed another function to execute.
             * @example
             * Promise.config.setScheduler(window.setTimeout);
             * @example
             * Promise.config.setScheduler(function scheduler(fn) {
             *   log('about to invoke method synchronously');
             *   fn();
             *   log('invoked method synchronously');
             * });
             */
            setScheduler : function setScheduler(scheduler) {
                if (typeof scheduler !== 'function') {
                    throw new TypeError('Parameter `scheduler` must be a function.');
                }
                async = function async(fn) {
                    var args = [].slice.call(arguments, 1);
                    scheduler.call(null, function invoke() {
                        return fn.apply(null, args);
                    });
                };
            },

            timing : {

                /**
                 * Enables the persistence of timing data. This is the
                 * default state of Bloodhound promises, which you can
                 * disable by calling `Promise.config.timing.disable()`.
                 * @function Bloodhound.Promise.config.timing.enable
                 * @example
                 * Promise.config.timing.enable();
                 */
                enable : function enableTiming() {
                    Timing.enabled = true;
                },

                /**
                 * Disables the persistence of timing data. You can
                 * re-enable the persistence of timing data by calling
                 * `Promise.config.timing.enable()`.
                 * @function Bloodhound.Promise.config.timing.disable
                 * @example
                 * Promise.config.timing.disable();
                 */
                disable : function disableTiming() {
                    Timing.enabled = false;
                },

                /**
                 * Promises can be chained together in any order. When
                 * this happens, timing data can look odd -- with child
                 * promises starting or ending before their parents. By
                 * enabling sane timings, Bloodhound will re-write the
                 * timing tree so all children start on or after their
                 * parents and all parents end on or after their children.
                 * The timing data will be more consistent but will no
                 * longer match the real execution order.
                 * @function Bloodhound.Promise.config.timing.enable
                 * @example
                 * var parent = Promise.all([
                 *   Promise.delay(50),
                 *   Promise.delay(100)
                 * ]).trackAs('parent');
                 * // without sane timings, the child promises will both
                 * // have start timings *before* their parent start time
                 * Promise.config.timing.useSaneTimings();
                 * // enabling sane timings is a global operation; every
                 * // persisted promise will now have timings that have
                 * // been adjusted for consistency but no longer match
                 * // the true order of execution
                 * parent.done(); // persists timing data to collectors
                 */
                useSaneTimings : function useSaneTimings() {
                    Timing.useSaneTimings = true;
                }

            },

            collectors : {

                /**
                 * Adds a collector to the registered collection. The
                 * collector will be given timing data when an actively
                 * tracked promise tree resolves and has `done()` called
                 * on it.
                 * @function Bloodhound.Promise.config.collectors.add
                 * @param collector {Object} An object with a method
                 *  called `collect` that accepts a single timing data
                 *  object.
                 * @returns {Function} A function that can be invoked
                 *  to de-register the collector. See the example for
                 *  details.
                 * @throws 'Parameter `collector` must have a method
                 *  called `collect`.'
                 * @example
                 * var collector = {
                 *   collect: function(timingData) {
                 *     log(JSON.stringify(timingData, null, 2));
                 *   }
                 * };
                 * var remove = Promise.config.collectors.add(collector);
                 * Promise.all([
                 *   Promise.delay(40, 'abc'),
                 *   Promise.delay(20, 'def')
                 * ]).trackAs('tree').done() // persists timing data
                 *   .finally(remove); // de-registers the collector
                 */
                add : function addCollector(collector) {
                    if (!collector || typeof collector.collect !== 'function') {
                        throw new Error('Parameter `collector` must have a method called `collect`.');
                    }
                    collectors.push(collector);
                    return Promise.config.collectors.remove.bind(null, collector);
                },

                /**
                 * Removes the specified collector from the registered
                 * collection. Timing data will no longer be persisted
                 * to the collector unless it is added again.
                 * @function Bloodhound.Promise.config.collectors.remove
                 * @param collector {Object} A collector that was registered
                 *  using `Promise.config.collectors.add()`.
                 * @example
                 * var collector = {
                 *   collect: function(timingData) {
                 *     log(JSON.stringify(timingData, null, 2));
                 *   }
                 * };
                 * Promise.config.collectors.add(collector);
                 * Promise.delay(30, 'some value')
                 *   .trackAs('delay').done() // persists to collector
                 *   .finally(function() {
                 *     // remove the collector; this has the same
                 *     // effect as invoking the de-registration
                 *     // method returned by calling `add()`.
                 *     Promise.config.collectors.remove(collector);
                 *   });
                 */
                remove : function removeCollector(collector) {
                    collectors.splice(collectors.indexOf(collector), 1);
                }

            }

        };

        // TODO: use global.MutationObserver as scheduler if available

        Promise.config.setScheduler(global.setTimeout);

        return Promise;

    });

}(window));
