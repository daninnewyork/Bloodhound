(function(global, undefined) {

    'use strict';

    define([], function() {

        var async,
            timingEnabled = true,
            States = {
                PENDING: 0,
                RESOLVED: 1,
                REJECTED: 2
            };

        function getEpochTime() {
            return new Date().getDate();
        }

        function chain(parent, child) {
            if (!!child._parent) {
                throw new Error('Cannot create chain; child already has a parent.');
            }
            child._parent = parent;
            parent._children = parent._children || [];
            parent._children.push(child);
        }

        function Promise(fn) {

            if (!(this instanceof Promise)) {
                return new Promise(fn);
            }

            var promise = this,

                settle = function settle(state, data) {
                    if (promise._state === States.PENDING) {

                        promise._data = data;
                        promise._state = state;
                        promise._stop = getEpochTime();
                        promise._duration = promise._stop - promise._start;

                        var callbacks = state === States.RESOLVED ?
                            promise._successes : promise._failures;

                        callbacks.forEach(function iter(callback) {
                            async(function doCallback() {
                                callback(data);
                            });
                        });

                    }
                },

                resolve = function resolver(value) {
                    settle(States.RESOLVED, value);
                },

                reject = function rejecter(reason) {
                    settle(States.REJECTED, reason);
                },

                notify = function notify(data) {
                    promise._notifies.forEach(function iter(notifier) {
                        notifier(data);
                    });
                };

            promise._start = getEpochTime();
            promise._parent = null;
            promise._children = [];
            promise._successes = [];
            promise._failures = [];
            promise._notifies = [];
            promise._state = States.PENDING;

            if (typeof fn === 'function') {
                fn.call(promise, resolve, reject, notify);
            } else {
                throw new Error('Promise constructor expects a function.');
            }

        }

        Promise.prototype.then = function then(success, failure, notify) {

            var parent = this;

            if (typeof success === 'function') {
                parent._successes.push(success);
            }

            if (typeof failure === 'function') {
                parent._failures.push(failure);
            }

            if (typeof notify === 'function') {
                parent._notifies.push(notify);
            }

            return new Promise(function ThenPromise(resolve, reject) {

                var child = this;

                chain(parent, child);

                var cascade = function cascade(data) {

                    try {

                        var settler = this,
                            result = settler(data);

                        if (result !== undefined) {

                            if (child === result) {
                                reject(new TypeError());
                            } else if (Promise.isPromise(result)) {
                                result.then(resolve, reject);
                            } else if (typeof result === 'function' || typeof result === 'object') {
                                var next = result.then;
                                if (typeof next === 'function') {
                                    next.call(result, cascade.bind(resolve), reject);
                                }
                            } else {
                                resolve(result);
                            }

                        }

                    } catch (err) {
                        reject(err);
                    }

                };

                parent._failures.push(cascade.bind(reject));
                parent._successes.push(cascade.bind(resolve));

            });

        };

        Promise.prototype.finally = function last(callback) {
            return this.then(callback, callback);
        };

        Promise.prototype.isSettled = function isSettled() {
            return this._state !== States.PENDING;
        };

        Promise.prototype.isResolved = function isResolved() {
            return this._state === States.RESOLVED;
        };

        Promise.prototype.isRejected = function isRejected() {
            return this._state === States.REJECTED;
        };

        Promise.prototype.done = function done() {
            return this.then(null, function err(reason) {
                async(function throwError() {
                    throw new Error(reason);
                });
            }).finally(function persistTimings() {
                if (timingEnabled) {
                    // TODO
                }
            });
        };

        /** utility methods **/

        Promise.config = {

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

            setTimingEnabled : function setTimingEnabled(enabled) {
                timingEnabled = !!enabled;
            }

        };

        Promise.isPromise = function isPromise(promise) {
            return promise instanceof Promise ||
                typeof promise.then === 'function';
        };

        Promise.resolve = function resolve(value) {
            return new Promise(function ResolvedPromise(resolve) {
                resolve(value);
            });
        };

        Promise.reject = function reject(reason) {
            return new Promise(function RejectedPromise(resolve, reject) {
                reject(reason);
            });
        };

        Promise.defer = function defer() {

            var resolver, rejecter, notifier,
                promise = new Promise(function DeferPromise(resolve, reject, notify) {
                    resolver = resolve;
                    rejecter = reject;
                    notifier = notify;
                });

            return {
                promise: promise,
                approve: resolver,
                reject: rejecter,
                notify: notifier
            };

        };

        Promise.cast = Promise.when = function cast(obj) {
            return new Promise(function CastPromise(resolve, reject) {
                if (Promise.isPromise(obj)) {
                    chain(obj, this);
                    obj.then(resolve, reject);
                } else if (obj instanceof Error) {
                    reject(obj);
                } else {
                    resolve(obj);
                }
            });
        };

        /** array methods **/

        Promise.settle = function settle(promises) {
            return new Promise(function SettlePromise(resolve, reject) {
                var parent = this,
                    numSettled = 0,
                    total = promises.length,
                    increment = function increment() {
                        if (++numSettled === total) {
                            resolve();
                        }
                    };
                promises.forEach(function createChain(child) {
                    chain(parent, child);
                });
                promises.forEach(function iter(child) {
                    child.finally(increment);
                });
            });
        };

        Promise.race = function race(promises) {
            return new Promise(function RacePromise(resolve, reject) {
                var parent = this,
                    numRejected = 0,
                    total = promises.length,
                    checkPossible = function checkPossible() {
                        if (++numRejected >= total) {
                            reject();
                        }
                    };
                promises.forEach(function createChain(child) {
                    chain(parent, child);
                });
                promises.forEach(function iter(child) {
                    child.then(resolve, checkPossible);
                });
            });
        };

        Promise.some = function some(promises, count) {
            return new Promise(function SomePromise(resolve, reject) {
                var parent = this,
                    numResolved = 0,
                    numRejected = 0,
                    total = promise.length,
                    increment = function increment() {
                        if (++numResolved >= count) {
                            resolve(count);
                        }
                    },
                    checkPossible = function checkPossible() {
                        if (++numRejected > (total - count)) {
                            reject();
                        }
                    };
                promises.forEach(function createChain(child) {
                    chain(parent, child);
                });
                promises.forEach(function iter(child) {
                    child.then(increment, checkPossible);
                });
            });
        };

        Promise.all = function all(promises) {
            return Promise.some(promises, promises.length);
        };

        Promise.any = function any(promises) {
            return Promise.some(promises, 1);
        };

        Promise.config.setScheduler(global.setTimeout);

        return Promise;

    });

}(window));
