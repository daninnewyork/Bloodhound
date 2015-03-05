(function(global, undefined) {

    'use strict';

    define([], function() {

        var async,
            timingEnabled = true,
            collectors = [],

            States = {
                PENDING: 0,
                RESOLVED: 1,
                REJECTED: 2
            },

            RESOLVER = function RESOLVER(promise, x, parentValue) {
                if (promise === x) {
                    promise._reject(new TypeError());
                } else if (Promise.isPromise(x)) {
                    x.then(promise._resolve, promise._reject);
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
                } else if (x === undefined) {
                    if (parentValue instanceof Error) {
                        parentValue = undefined;
                    }
                    promise._resolve(parentValue);
                } else {
                    promise._resolve(x);
                }
            },

            persistTimings = function persistTimings() {
                if (timingEnabled) {
                    var timing = getTimingData(this);
                    if (!!timing) {
                        collectors.forEach(function persist(collector) {
                            collector.collect(timing);
                        });
                    }
                }
            },

            err = function err(reason) {
                async(function throwError() {
                    throw new Error(reason);
                });
            },

            getEpochTime = function getEpochTime() {
                return new Date().getTime();
            },

            getTimingData = function getTimingData(promise) {

                var root = promise,
                    ancestor = root._parent,

                    anyActiveTracks = function anyActiveTracks(node) {
                        return !!node._trackName && (!node._isPassive || node._children.some(anyActiveTracks));
                    },

                    addChildren = function addChildren(timing, children) {
                        children = children || [];
                        children.forEach(function iter(child) {
                            var inner = getTimingTree(child);
                            addChildren(inner, child._children);
                            timing.children.push(inner);
                        });
                    },

                    getTimingTree = function getTimingTree(node) {

                        var timing = {
                            name: node._trackName || 'anonymous',
                            data: node._data,
                            start: node._start,
                            stop: node._stop,
                            duration: node._duration,
                            children: []
                        };

                        addChildren(timing, node._children);

                        return timing;

                    };

                while (!!ancestor) {
                    root = ancestor;
                    ancestor = root._parent;
                }

                if (!root.isSettled() || !anyActiveTracks(root)) {
                    return;
                }

                return getTimingTree(root);

            },

            chain = function chain(parent, child) {

                var root = child,
                    ancestor = root._parent,
                    target = parent._parent;

                while (!!target) {
                    if (target === child) {
                        throw new Error('`child` is already an ancestor of `parent`.');
                    }
                    target = target._parent;
                }

                while (!!ancestor) {
                    if (ancestor === parent) {
                        return;
                    }
                    root = ancestor;
                    ancestor = root._parent;
                }

                if (root === parent || parent._children.indexOf(root) !== -1) {
                    return;
                }

                root._parent = parent;
                parent._children = parent._children || [];
                parent._children.push(root);

            };

        /**
         * @todo document
         * @todo unit test
         */

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
                                callback(promise._data);
                            });
                        });

                    }
                },

                resolve = function resolver(value) {
                    if (value instanceof Error) {
                        settle(States.REJECTED, value);
                    } else {
                        settle(States.RESOLVED, value);
                    }
                },

                reject = function rejecter(reason) {
                    settle(States.REJECTED, reason);
                },

                notify = function notify(data) {
                    promise._notifies.forEach(function iter(notifier) {
                        notifier(data);
                    });
                },

                wrapPush = function wrapPush(arr, state) {
                    arr.push = function push(fn) {
                        if (promise._state === state) {
                            async(fn, promise._data);
                        } else {
                            Array.prototype.push.call(arr, fn);
                        }
                    };
                    return arr;
                };

            promise._notify = notify;
            promise._reject = reject;
            promise._resolve = resolve;
            promise._start = getEpochTime();
            promise._parent = null;
            promise._children = [];
            promise._notifies = [];
            promise._successes = wrapPush([], States.RESOLVED);
            promise._failures = wrapPush([], States.REJECTED);
            promise._state = States.PENDING;

            if (typeof fn === 'function') {
                async(function invoke() {
                    try {
                        fn.bind(promise)(resolve, reject, notify);
                    } catch (err) {
                        reject(err);
                    }
                });
            } else {
                throw new Error('Promise constructor expects a function.');
            }

        }

        Promise.prototype.then = function then(success, failure, notify) {

            var parent = this,
                child = new Promise(function ThenPromise(resolve, reject) {

                    var wrapCallback = function wrapCallback(callback, propagate) {
                        return function parentSettled(value) {
                            if (typeof callback === 'function') {
                                try {
                                    RESOLVER(child, callback(value), value);
                                } catch (err) {
                                    reject(err);
                                }
                            } else {
                                propagate(value);
                            }
                        };
                    };

                    parent._successes.push(wrapCallback(success, resolve));
                    parent._failures.push(wrapCallback(failure, reject));

                });

            if (typeof notify === 'function') {
                parent._notifies.push(notify);
            }

            chain(parent, child);

            return child;

        };

        Promise.prototype.catch = Promise.prototype.else = function onRejected(callback) {
            return this.then(null, callback);
        };

        Promise.prototype.notify = function onNotify(callback) {
            return this.then(null, null, callback);
        };

        Promise.prototype.tap = function onTap(callback) {
            return this.then(function tapValue(value) {
                callback(value);
            });
        };

        Promise.prototype.finally = Promise.prototype.last = function onSettled(callback) {
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

        Promise.prototype.trackAs = function trackAs(name, passive) {
            if (typeof name !== 'string') {
                throw new TypeError('Method `trackAs` expects a string name.');
            }
            this._trackName = name;
            this._isPassive = !!passive;
            return this;
        };

        Promise.prototype.done = function done() {
            this._failures.push(err);
            this._failures.push(persistTimings.bind(this));
            this._successes.push(persistTimings.bind(this));
            return this;
        };

        Promise.prototype.spread = function spread(callback) {
            return this.then(function spread(values) {
                return callback.apply(null, values);
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

            timing : {

                enable: function enableTiming() {
                    timingEnabled = true;
                },

                disable: function disableTiming() {
                    timingEnabled = false;
                }

            },

            collectors : {

                add : function addCollector(collector) {
                    if (!collector || typeof collector.collect !== 'function') {
                        throw new Error('Parameter `collector` must have a method called `collect`.');
                    }
                    collectors.push(collector);
                },

                remove : function removeCollector(collector) {
                    collectors.splice(collectors.indexOf(collector), 1);
                }

            }

        };

        Promise.isPromise = function isPromise(promise) {
            return promise instanceof Promise ||
                (!!promise && typeof promise.then === 'function');
        };

        Promise.resolve = function resolve(value) {
            var promise = new Promise(function() {});
            promise._resolve(value);
            return promise;
        };

        Promise.reject = function reject(reason) {
            var promise = new Promise(function() {});
            promise._reject(reason);
            return promise;
        };

        Promise.defer = function defer() {

            var promise = new Promise(function DeferPromise() {});

            return {
                promise: promise,
                resolve: promise._resolve,
                reject: promise._reject,
                notify: promise._notify
            };

        };

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

        Promise.delay = function delay(ms, value) {
            return new Promise(function DelayedPromise(resolve) {
                global.setTimeout(resolve.bind(this, value), ms);
            });
        };

        Promise.call = function callMethod(fn) {
            if (typeof fn !== 'function') {
                throw new TypeError('Method `try` expects a function to be specified.');
            }
            var args = [].slice.call(arguments, 1);
            return new Promise(function TryPromise(resolve, reject) {
                resolve(fn.apply(null, args));
            });
        };

        Promise.apply = function applyMethod(fn, args) {
            return Promise.call.apply(Promise, [fn].concat(args || []));
        };

        /** array methods **/

        function getArrayPromise(promises, resolver) {
            var parent = new Promise(resolver);
            promises.forEach(chain.bind(null, parent));
            return parent;
        }

        Promise.settle = function settle(promises) {
            return getArrayPromise(promises, function SettlePromise(resolve, reject) {
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

        Promise.some = function some(promises, count) {

            if (!(promises instanceof Array)) {
                throw new TypeError('Promise.some expects an array to be provided.');
            }

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
