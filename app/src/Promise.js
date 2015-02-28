(function(global, undefined) {

    'use strict';

    var async = global.setTimeout;

    function States() {}

    States.PENDING = 0;
    States.RESOLVED = 1;
    States.REJECTED = 2;

    function resolve(promise, value) {
        // TODO
    }

    function process(handlers, data) {
        /* jshint -W040 */
        this._data = data;
        handlers.forEach(function(handler) {
            resolve(this, handler(data));
        }.bind(this));
    }

    function getEpochTime() {
        return new Date().getDate();
    }

    function chain(parent, child) {
        // TODO
    }

    function Promise(fn) {

        if (!(this instanceof Promise)) {
            return new Promise(fn);
        }

        var promise = this,

            settle = function settle(state, data) {
                if (promise._state === States.PENDING) {
                    promise._state = state;
                    promise._stop = getEpochTime();
                    promise._duration = promise._stop - promise._start;
                    process.call(
                        promise,
                        state === States.PENDING ? promise._successes : promise._failures,
                        data
                    );
                }
            },

            approve = function resolver(value) {
                settle(States.RESOLVED, value);
            },

            reject = function rejecter(reason) {
                settle(States.REJECTED, reason);
            },

            notify = function notify(data) {
                promise._notifies.forEach(function(notifier) {
                    notifier(data);
                });
            };

        promise._start = getEpochTime();
        promise._successes = [];
        promise._failures = [];
        promise._notifies = [];
        promise._state = States.PENDING;

        if (typeof fn === 'function') {
            fn.call(null, approve, reject, notify);
        } else {
            throw new Error('Promise constructor expects a function.');
        }

    }

    Promise.prototype.then = function then(success, failure, notify) {
        // TODO
        return this;
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
            // TODO
        });
    };

    /** utility methods **/

    Promise.config = {

        setScheduler : function setScheduler(fn) {
            // TODO
        },

        setTimingEnabled : function setTimingEnabled(enabled) {
            // TODO
        }

    };

    Promise.defer = function defer() {

        var resolver, rejecter, notifier,
            promise = new Promise(function(resolve, reject, notify) {
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
        return resolve(obj);
    };

    /** array methods **/

    Promise.settle = function settle(promises) {
        // TODO
    };

    Promise.race = function race(promises) {
        // TODO
    };

    Promise.some = function some(promises, count) {
        // TODO
    };

    Promise.all = function all(promises) {
        return Promise.some(promises, promises.length);
    };

    Promise.any = function any(promises) {
        return Promise.some(promises, 1);
    };

}(window));
