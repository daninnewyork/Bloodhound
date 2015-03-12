define(['Promise'], function(Promise) {

    'use strict';

    if (!Function.prototype.bind) {
        Function.prototype.bind = function bind(context) {
            var fn = this,
                initial = [].slice.call(arguments, 1);
            return function boundFunction() {
                var args = [].slice.call(arguments);
                return fn.apply(context, initial.concat(args));
            };
        };
    }

    describe('Promise', function() {

        beforeEach(function() {
            this.enableSync = function enableSync() {
                this.origScheduler = window.setTimeout;
                Promise.config.setScheduler(function scheduler(fn) {
                    return fn.apply(null, [].slice.call(arguments, 1));
                });
            }.bind(this);
        });

        afterEach(function() {
            if (!!this.origScheduler) {
                Promise.config.setScheduler(this.origScheduler);
            }
        });

        it('exists', function() {
            expect(typeof Promise).toBe('function');
        });

        describe('constructor', function() {

            it('throws if function not provided', function() {
                expect(Promise).toThrow();
            });

            it('calls itself if new not specified', function() {
                /* jshint -W064 */
                var promise = Promise(function() {});
                expect(Promise.isPromise(promise)).toBe(true);
            });

            it('sets start time', function() {
                var promise = new Promise(function() {});
                expect(promise._start).toBeDefined();
            });

            it('initializes to pending state', function() {
                var promise = new Promise(function() {});
                expect(promise._state).toBe(0);
            });

            it('invokes the function asynchronously', function(done) {
                var hit = false;
                var promise = new Promise(function() {
                    expect(hit).toBe(true);
                    done();
                });
                hit = true;
            });

            it('calling resolve resolves the promise with the specified value', function(done) {
                new Promise(function(resolve) {
                    resolve('abc');
                }).then(function(value) {
                    expect(value).toBe('abc');
                    done();
                });
            });

            it('calling reject rejects the promise with the reason value', function(done) {
                new Promise(function(resolve, reject) {
                    reject('reason');
                }).catch(function(reason) {
                    expect(reason).toBe('reason');
                    done();
                });
            });

            it('calling notify notifies subscribers with the specified value', function(done) {
                var index = 0,
                    values = [0, 28, 77, 100];
                new Promise(function(resolve, reject, notify) {
                    notify(values[0]);
                    notify(values[1]);
                    notify(values[2]);
                    notify(values[3]);
                }).notified(function(value) {
                    expect(value).toBe(values[index++]);
                    if (index === values.length) {
                        done();
                    }
                });
            });

        });

        describe('then', function() {

            it('returns a new promise', function() {
                var original = Promise.resolve(),
                    second = original.then();
                expect(second).not.toBe(original);
            });

            it('returned promise is child of original promise', function() {
                var parent = Promise.resolve(),
                    child = parent.then();
                expect(child._parent).toBe(parent);
                expect(parent._children.indexOf(child)).not.toBe(-1);
            });

            it('ignores success callback if not a function', function() {
                var parent = Promise.resolve();
                expect(parent._successes.length).toBe(0);
                parent.then();
                expect(parent._successes.length).toBe(0);
            });

            it('ignores failure callback if not a function', function() {
                var parent = Promise.resolve();
                expect(parent._failures.length).toBe(0);
                parent.then();
                expect(parent._failures.length).toBe(0);
            });

            it('ignores notify callback if not a function', function() {
                var parent = Promise.resolve();
                expect(parent._notifies.length).toBe(0);
                parent.then();
                expect(parent._notifies.length).toBe(0);
            });

            it('success callback on resolved promise fires', function(done) {
                Promise.resolve('abc').then(function success(value) {
                    expect(value).toBe('abc');
                    done();
                });
            });

            it('failure callback on rejected promise fires', function(done) {
                Promise.reject('reason').then(null, function failure(reason) {
                    expect(reason).toBe('reason');
                    done();
                });
            });

            it('returned promise resolves with value of original promise', function(done) {
                var parent = Promise.delay(100, 'abc'),
                    child = parent.then(function success(value) {
                        expect(value).toBe('abc');
                        done();
                    });
            });

            it('returned promise rejects with reason of original promise', function(done) {
                var err = new Error(),
                    parent = Promise.delay(100, err),
                    child = parent.then(null, function rejected(reason) {
                        expect(reason).toBe(err);
                        done();
                    });
            });

            it('parent resolved with child promise throws TypeError', function(done) {
                var parent = Promise.resolve(),
                    child = parent.then(function() {
                        return child;
                    });
                child.catch(function(err) {
                    expect(err instanceof TypeError).toBe(true);
                    done();
                });
            });

            it('parent resolved with promise resolves child when promise resolves', function(done) {
                Promise.resolve().then(function inner() {
                    return Promise.delay(50, 'inner');
                }).then(function last(value) {
                    expect(value).toBe('inner');
                    done();
                });
            });

            it('parent resolved with promise rejects child when promise rejects', function(done) {
                Promise.resolve().then(function inner() {
                    return Promise.delay(50, new Error('reason'));
                }).catch(function last(err) {
                    expect(err.message).toBe('reason');
                    done();
                });
            });

            it('parent resolved with value resolves child with same value', function(done) {
                var parent = Promise.resolve(123),
                    child = parent.then(function(value) {
                        expect(value).toBe(123);
                        done();
                    });
            });

            it('child resolved with undefined value gets parent resolved value', function(done) {
                Promise.resolve('abc').then(function handler1(value) {
                    expect(value).toBe('abc');
                }).then(function handler2(value) {
                    expect(value).toBe('abc');
                    done();
                });
            });

        });

        describe('catch', function() {

            it('is alias of else', function() {
                var promise = Promise.resolve();
                expect(promise.catch).toBe(promise.else);
            });

            it('calls then with null, callback', function() {
                var promise = Promise.resolve(),
                    callback = function() {};
                spyOn(promise, 'then');
                promise.catch(callback);
                expect(promise.then).toHaveBeenCalledWith(null, callback);
            });

        });

        describe('notify', function() {

            it('calls then with null, null, callback', function() {
                var promise = Promise.resolve(),
                    callback = function() {};
                spyOn(promise, 'then');
                promise.notified(callback);
                expect(promise.then).toHaveBeenCalledWith(null, null, callback);
            });

        });

        describe('tap', function() {

            it('calls then with wrapped function', function() {
                var promise = Promise.resolve(),
                    callback = function() {};
                spyOn(promise, 'then');
                promise.tap(callback);
                expect(typeof promise.then.calls.argsFor(0)[0]).toBe('function');
            });

            it('ignores non-function callback arguments', function(done) {
                Promise.resolve('abc')
                    .tap(null)
                    .tap(undefined)
                    .tap(NaN)
                    .tap({})
                    .then(function(value) {
                        expect(value).toBe('abc');
                        done();
                    });
            });

            it('callback only invoked if promise is resolved', function(done) {
                Promise.reject('reason').tap(jasmine.unimplementedMethod_);
                Promise.resolve('abc').tap(done);
            });

            it('returning a value from callback does not change promise resolved value', function(done) {
                Promise.resolve('abc').tap(function(value) {
                    expect(value).toBe('abc');
                    return 'def';
                }).then(function(value) {
                    expect(value).toBe('abc');
                    done();
                });
            });

            it('throwing an exception in the callback does not affect next promise', function(done) {
                Promise.resolve('abc').tap(function() {
                    throw new Error();
                }).then(function(value) {
                    expect(value).toBe('abc');
                    done();
                });
            });

        });

        describe('finally', function() {

            it('calls then with callback, callback', function() {
                var promise = Promise.resolve(),
                    callback = function() {};
                spyOn(promise, 'then');
                promise.finally(callback);
                expect(promise.then).toHaveBeenCalledWith(callback, callback);
            });

        });

        describe('isSettled', function() {

            it('returns false if promise is pending', function() {
                var promise = Promise.delay(100);
                expect(promise.isSettled()).toBe(false);
            });

            it('returns true if promise is resolved', function() {
                var promise = Promise.resolve();
                expect(promise.isSettled()).toBe(true);
            });

            it('returns true if promise is rejected', function() {
                var promise = Promise.reject();
                expect(promise.isSettled()).toBe(true);
            });

        });

        describe('isResolved', function() {

            it('returns false if promise is pending', function() {
                var promise = Promise.delay(100);
                expect(promise.isResolved()).toBe(false);
            });

            it('returns true if promise is resolved', function() {
                var promise = Promise.resolve();
                expect(promise.isResolved()).toBe(true);
            });

            it('returns false if promise is rejected', function() {
                var promise = Promise.reject();
                expect(promise.isResolved()).toBe(false);
            });

        });

        describe('isRejected', function() {

            it('returns false if promise is pending', function() {
                var promise = Promise.delay(100);
                expect(promise.isRejected()).toBe(false);
            });

            it('returns false if promise is resolved', function() {
                var promise = Promise.resolve();
                expect(promise.isRejected()).toBe(false);
            });

            it('returns true if promise is rejected', function() {
                var promise = Promise.reject();
                expect(promise.isRejected()).toBe(true);
            });

        });

        describe('done', function() {

            it('throws error if promise rejected', function() {
                this.enableSync();
                try {
                    Promise.reject('rejected').done();
                } catch (err) {
                    expect(err.message).toBe('rejected');
                }
            });

            it('does not throw error if rejection caught before done', function(done) {
                Promise.reject('rejected').catch(function(reason) {
                    expect(reason).toBe('rejected');
                }).done().then(done);
            });

            it('notifies collectors of timing if timing enabled', function(done) {
                var collector = {
                    collect: function(timing) {
                        expect(timing.data).toBe('value');
                        expect(timing.duration).toBeGreaterThan(99);
                        Promise.config.collectors.remove(collector);
                        done();
                    }
                };
                Promise.config.collectors.add(collector);
                Promise.delay(100, 'value').trackAs('promise').done();
            });

            it('does not notify collectors if timing is not enabled', function(done) {
                var collector = {collect: jasmine.unimplementedMethod_};
                Promise.config.collectors.add(collector);
                Promise.config.timing.disable();
                Promise.delay(50, 'value').done().finally(function() {
                    Promise.config.collectors.remove(collector);
                    Promise.config.timing.enable();
                    done();
                });
            });

        });

        describe('isPromise', function() {

            it('returns true for Promise', function() {
                expect(Promise.isPromise(Promise.resolve())).toBe(true);
            });

            it('returns true for thenable', function() {
                expect(Promise.isPromise({then: function() {}})).toBe(true);
            });

        });

        describe('resolve', function() {

            it('resolves synchronously', function() {
                spyOn(window, 'setTimeout');
                expect(window.setTimeout.calls.any()).toBe(false);
                Promise.resolve('value');
                expect(window.setTimeout.calls.any()).toBe(false);
            });

            it('resolves with specified value', function() {
                spyOn(window, 'setTimeout');
                expect(window.setTimeout.calls.any()).toBe(false);
                expect(Promise.resolve('value')._data).toBe('value');
                expect(window.setTimeout.calls.any()).toBe(false);
            });

        });

        describe('reject', function() {

            it('rejects synchronously', function() {
                spyOn(window, 'setTimeout');
                expect(window.setTimeout.calls.any()).toBe(false);
                Promise.reject('reason');
                expect(window.setTimeout.calls.any()).toBe(false);
            });

            it('rejects with the specified reason', function() {
                spyOn(window, 'setTimeout');
                expect(window.setTimeout.calls.any()).toBe(false);
                expect(Promise.reject('reason')._data).toBe('reason');
                expect(window.setTimeout.calls.any()).toBe(false);
            });

        });

        describe('defer', function() {

            it('returns object with expected members', function() {
                var defer = Promise.defer();
                expect(defer.promise instanceof Promise).toBe(true);
                expect(typeof defer.resolve).toBe('function');
                expect(typeof defer.reject).toBe('function');
                expect(typeof defer.notify).toBe('function');
            });

            it('calling approve resolves promise with specified value', function(done) {
                var defer = Promise.defer();
                defer.promise.then(function(value) {
                    expect(value).toBe('value');
                    done();
                });
                defer.resolve('value');
            });

            it('calling reject rejects promise with specified reason', function(done) {
                var defer = Promise.defer();
                defer.promise.catch(function(reason) {
                    expect(reason).toBe('reason');
                    done();
                });
                defer.reject('reason');
            });

            it('calling notify notifies callbacks with specified data', function(done) {
                var defer = Promise.defer();
                defer.promise.notified(function(data) {
                    expect(data).toBe(123);
                    done();
                });
                defer.notify(123);
            });

        });

        describe('cast', function() {

            it('returns obj if obj is Promise', function() {
                var promise = Promise.resolve();
                expect(Promise.cast(promise)).toBe(promise);
            });

            it('chains returned promise if thenable passed in', function(done) {

                var thenable = {
                    fns: [],
                    then: function(fn) {
                        this.fns.push(fn);
                    },
                    resolve: function(val) {
                        this.fns.forEach(function(fn) {
                            fn(val);
                        });
                    }
                };

                var promise = Promise.cast(thenable);

                promise.then(function(value) {
                    expect(value).toBe('abc');
                    done();
                });

                spyOn(thenable, 'then').and.callThrough();

                var token = window.setInterval(function() {
                    if (thenable.then.calls.any()) {
                        window.clearInterval(token);
                        thenable.resolve('abc');
                    }
                }, 10);

            });

            it('rejects returned promise if parameter is an error', function() {
                var promise = Promise.cast(new TypeError('reason'));
                expect(promise.isRejected()).toBe(true);
                expect(promise._data instanceof TypeError).toBe(true);
            });

            it('resolves returned promise if parameter is not an error or a promise', function() {
                var promise = Promise.cast('abc');
                expect(promise.isResolved()).toBe(true);
                expect(promise._data).toBe('abc');
            });

        });

        describe('delay', function() {

            it('is alias of wait', function() {
                expect(Promise.delay).toBe(Promise.wait);
            });

            it('resolves after specified ms', function(done) {
                var promise = Promise.delay(100);
                promise.then(function() {
                    expect(promise._stop).toBeGreaterThan(promise._start + 99);
                    done();
                });
            });

            it('resolves with specified value', function(done) {
                var promise = Promise.delay(100, 'abc');
                promise.then(function(value) {
                    expect(value).toBe('abc');
                    done();
                });
            });

        });

        describe('timeout', function() {

            it('rejects after specified ms', function(done) {
                Promise.delay(50).timeout(30).catch(function(reason) {
                    expect(reason).toBe('timed out');
                    done();
                });
            });

            it('does not reject if resolved before timeout', function(done) {
                Promise.delay(20).timeout(40).then(done);
            });

            it('rejects with optional reason when provided', function(done) {
                Promise.delay(50).timeout(30, 'too long').catch(function(reason) {
                    expect(reason).toBe('too long');
                    done();
                });
            });

            it('earliest of multiple timeouts rejects first', function(done) {
                Promise.delay(100)
                    .timeout(20, '20')
                    .timeout(30, '30')
                    .timeout(10, '10')
                    .catch(function(msg) {
                        expect(msg).toBe('10');
                        done();
                    });
            });

        });

        describe('call', function() {

            it('returns a promise', function() {
                expect(Promise.isPromise(Promise.call(function() {}))).toBe(true);
            });

            it('throws if function not specified', function() {
                expect(Promise.call.bind(Promise)).toThrow();
                expect(Promise.call.bind(Promise, 123)).toThrow();
                expect(Promise.call.bind(Promise, 'abc')).toThrow();
            });

            it('passes additional args to function', function(done) {
                Promise.call(function(arg1, arg2) {
                    expect(arg1).toBe('abc');
                    expect(arg2).toBe(123);
                    done();
                }, 'abc', 123);
            });

            it('resolves promise with function result', function(done) {
                Promise.call(function() { return 'value'; }).then(function(value) {
                    expect(value).toBe('value');
                    done();
                });
            });

            it('rejects promise with error if function throws', function(done) {
                Promise.call(jasmine.unimplementedMethod_).catch(function(err) {
                    expect(err instanceof Error).toBe(true);
                    done();
                });
            });

        });

        describe('apply', function() {

            it('defers to call', function(done) {
                spyOn(Promise, 'call').and.callThrough();
                Promise.apply(function(arg1, arg2) {
                    expect(Promise.call).toHaveBeenCalled();
                    expect(arg1).toBe('abc');
                    expect(arg2).toBe(123);
                    done();
                }, ['abc', 123]);
            });

        });

        describe('hash', function() {

            it('resolves with correct results', function(done) {
                var input = {
                    a: Promise.delay(40, 'world'),
                    b: Promise.delay(10, 'hello'),
                    c: 123456,
                    d: new Error()
                };
                Promise.hash(input).then(function(results) {
                    expect(results.a).toBe('world');
                    expect(results.b).toBe('hello');
                    expect(results.c).toBe(123456);
                    expect(results.d instanceof Error).toBe(true);
                    done();
                });
            });

        });

        describe('settle', function() {

            it('resolves with resolved and rejected promises', function(done) {
                Promise.settle([
                    Promise.delay(50),
                    Promise.delay(50, new Error()),
                    Promise.reject(),
                    'abc'
                ]).then(function(promises) {
                    expect(promises[0].isResolved()).toBe(true);
                    expect(promises[1].isRejected()).toBe(true);
                    expect(promises[2].isRejected()).toBe(true);
                    expect(promises[3].isResolved()).toBe(true);
                    done();
                }).catch(function(reason) {
                    console.log(reason);
                });
            });

            it('resolves with empty array if no promises specified', function(done) {
                Promise.settle([]).then(function(promises) {
                    expect(promises).toEqual([]);
                    done();
                });
            });

            it('updates with percentage compled', function(done) {
                var index = 0,
                    percents = [25, 50, 75, 100];
                Promise.settle([
                    Promise.delay(10),
                    Promise.delay(20),
                    Promise.delay(25),
                    Promise.delay(35)
                ]).notified(function(percent) {
                    expect(percent).toBe(percents[index++]);
                }).finally(done);
            });

        });

        describe('race', function() {

            it('resolves with first resolved value', function(done) {
                Promise.race([
                    Promise.delay(100, 'abc'),
                    Promise.delay(50, 'def'),
                    Promise.delay(10, 'ghi')
                ]).then(function(value) {
                    expect(value).toBe('ghi');
                    done();
                });
            });

            it('rejects if all promises reject', function(done) {
                Promise.race([
                    Promise.delay(50, new Error()),
                    Promise.delay(25, new Error()),
                    Promise.reject()
                ]).catch(done);
            });

            it('rejects if empty array provided', function(done) {
                Promise.race([]).catch(done);
            });

        });

        describe('some', function() {

            it('throws if array not specified', function() {
                expect(Promise.some.bind(null)).toThrow();
                expect(Promise.some.bind(null, 'abc')).toThrow();
                expect(Promise.some.bind(null, {key: 'value'})).toThrow();
            });

            it('throws if non-number specified', function() {
                expect(Promise.some.bind(null, [])).toThrow();
                expect(Promise.some.bind(null, [], NaN)).toThrow();
                expect(Promise.some.bind(null, [], 'abc')).toThrow();
                expect(Promise.some.bind(null, [], {key: 'value'})).toThrow();
            });

            it('rejects if not enough promises specified', function(done) {
                Promise.some([
                    Promise.delay(50)
                ], 2).catch(done);
            });

            it('resolves with empty array if no promises given but count is 0', function(done) {
                Promise.some([], 0).then(function(values) {
                    expect(values).toEqual([]);
                    done();
                });
            });

            it('rejects as soon as it is not possible to meet count', function(done) {
                Promise.some([
                    Promise.delay(20, 'abc'),
                    Promise.delay(40, new Error()),
                    Promise.delay(60, 'def'),
                    Promise.delay(100, 'ghi'),
                    Promise.reject()
                ], 4).catch(function(reason) {
                    expect(reason).toBe('Desired count not met.');
                    done();
                });
            });

            it('resolves as soon as count is met, with only count values', function(done) {
                Promise.some([
                    Promise.delay(20, 'abc'),
                    Promise.delay(40, new Error()),
                    Promise.delay(100, 'def'),
                    Promise.delay(60, 'ghi'),
                    123456,
                    Promise.reject()
                ], 2).then(function(values) {
                    expect(values).toEqual(['abc', 123456]);
                    done();
                });
            });

            it('creates chains', function() {
                var children = [
                        Promise.delay(20, 'abc'),
                        Promise.delay(40, new Error()),
                        Promise.delay(100, 'def'),
                        Promise.delay(60, 'ghi'),
                        Promise.reject()
                    ],
                    parent = Promise.some(children, 2);
                expect(parent._children).toEqual(children);
            });

        });

        describe('all', function() {

            it('delegates to Promise.some', function() {
                spyOn(Promise, 'some');
                var promises = [
                    Promise.resolve(),
                    Promise.delay(50)
                ];
                Promise.all(promises);
                expect(Promise.some).toHaveBeenCalledWith(promises, 2);
            });

        });

        describe('any', function() {

            it('delegates to Promise.some', function(done) {
                spyOn(Promise, 'some').and.callThrough();
                var promises = [
                    Promise.resolve(),
                    Promise.delay(50)
                ];
                Promise.any(promises).then(function(values) {
                    expect(values).toEqual([undefined]);
                    done();
                });
                expect(Promise.some).toHaveBeenCalledWith(promises, 1);
            });

        });

        describe('spread', function() {

            it('ignores non-function callbacks', function(done) {
                Promise.all([
                    Promise.delay(10, 'abc'),
                    Promise.delay(20, 'def')
                ])  .spread(null)
                    .spread(new Date())
                    .spread(NaN)
                    .spread({})
                    .then(function(values) {
                        expect(values[0]).toBe('abc');
                        expect(values[1]).toBe('def');
                        done();
                    });
            });

            it('passes resolved array as parameters', function(done) {
                Promise.all([
                    Promise.resolve('abc'),
                    123456,
                    Promise.delay(40, 'def'),
                    Promise.delay(10, 'ghi')
                ]).spread(function(val1, val2, val3, val4) {
                    expect(val1).toBe('abc');
                    expect(val2).toBe(123456);
                    expect(val3).toBe('def');
                    expect(val4).toBe('ghi');
                    done();
                });
            });

        });

        describe('trackAs', function() {

            it('throws if non-string is passed', function() {
                var promise = Promise.resolve(),
                    message = 'Method `trackAs` expects a string name.';
                expect(promise.trackAs.bind(promise)).toThrowError(message);
                expect(promise.trackAs.bind(promise, 123)).toThrowError(message);
                expect(promise.trackAs.bind(promise, new Date())).toThrowError(message);
            });

            it('if passive not specified, defaults to active', function() {
                expect(Promise.resolve().trackAs('active')._isPassive).toBe(false);
            });

            it('passively tracked not collected on done', function(done) {
                var collector = jasmine.createSpyObj('collector', ['collect']),
                    promise = Promise.all([
                        Promise.delay(10, 'abc').trackAs('child-1', true),
                        Promise.delay(30, 'def').trackAs('child-2', true),
                        Promise.delay(20, 'ghi')
                    ]).trackAs('parent', true);
                Promise.config.collectors.add(collector);
                promise.done().then(function() {
                    expect(collector.collect).not.toHaveBeenCalled();
                    Promise.config.collectors.remove(collector);
                    done();
                });
            });

            it('timing data is correct', function(done) {
                var collector = {
                    collect: function(timingData) {
                        expect(timingData.name).toBe('active-parent');
                        expect(timingData.children.length).toBe(3);
                        expect(timingData.children[0].name).toBe('child-1');
                        expect(timingData.children[1].name).toBe('child-2');
                        expect(timingData.children[2].name).toBe('anonymous');
                        expect(timingData.children[0].children.length).toBe(0);
                        expect(timingData.children[1].children.length).toBe(0);
                        expect(timingData.children[2].children.length).toBe(1);
                        expect(timingData.children[2].children[0].name).toBe('hello');
                        Promise.config.collectors.remove(collector);
                        done();
                    }
                };
                Promise.config.collectors.add(collector);
                Promise.all([
                    Promise.resolve('abc').trackAs('child-1', true).done(),
                    Promise.delay(30, 'def').trackAs('child-2', true),
                    Promise.delay(20, 'ghi').then(function hello() {})
                ]).trackAs('active-parent').done();
            });

            it('if child done but parent not settled, nothing collected', function() {
                var collector = jasmine.createSpyObj('collector', ['collect']);
                Promise.config.collectors.add(collector);
                Promise.all([
                    Promise.resolve('abc').trackAs('child-1', true).done(),
                    Promise.delay(30, 'def').trackAs('child-2', true),
                    Promise.delay(20, 'ghi')
                ]).trackAs('active-parent');
                expect(collector.collect).not.toHaveBeenCalled();
                Promise.config.collectors.remove(collector);
            });

        });

        describe('chain', function() {

            beforeEach(function addUtilMethods() {
                this.showChain = function showChain(promise) {
                    var index = 0,
                        target = promise,
                        root = target._parent,
                        log = function log(node) {
                            console.log(new Array(++index).join('  ') + (node._trackName || 'anonymous'));
                            node._children.forEach(log);
                        };
                    while (!!root) {
                        target = root;
                        root = target._parent;
                    }
                    log(target, 0);
                };
            });

            it('adds child to parent', function() {
                var parent = Promise.resolve(),
                    child = parent.then();
                expect(child._parent).toBe(parent);
                expect(parent._children.indexOf(child)).not.toBe(-1);
            });

            it('adds root of child to parent', function(done) {

                var parent = Promise.resolve(),
                    root = Promise.resolve().trackAs('root'),
                    child = root.then().then().then();

                parent.then(function() {
                    return child;
                }).finally(function() {
                    expect(root._parent).toBe(parent);
                    done();
                });

            });

            it('throws if child is ancestor of parent', function(done) {
                var ancestor = Promise.delay(20),
                    parent = ancestor.then(function() {
                        return parent;
                    }).catch(function(err) {
                        expect(err.message).toBe('Cycle created in promise chain.');
                        done();
                    });
            });

            it('does not chain if parent is child', function(done) {
                var parent = Promise.delay(20),
                    chained = parent.then(function() {
                        return parent;
                    }).finally(function() {
                        expect(parent._parent).toBe(null);
                        expect(chained._children.length).toBe(0);
                        done();
                    });
            });

            it('does not chain if parent is ancestor of child', function(done) {
                var parent = Promise.delay(20).trackAs('parent'),
                    child = parent.then().trackAs('child');
                child.then(function() {
                    return parent;
                }).finally(function() {
                    expect(child._parent).toBe(parent);
                    expect(parent._children.indexOf(child)).not.toBe(-1);
                    done();
                });
            });

        });

        describe('config', function() {

            describe('setScheduler', function() {

                it('throws if argument is not a function', function() {
                    expect(Promise.config.setScheduler.bind(null)).toThrow();
                    expect(Promise.config.setScheduler.bind(null, 123)).toThrow();
                    expect(Promise.config.setScheduler.bind(null, 'abc')).toThrow();
                });

                it('sets async method', function(done) {
                    Promise.config.setScheduler(function() {
                        Promise.config.setScheduler(window.setTimeout);
                        done();
                    });
                    Promise.delay(10);
                });

            });

            describe('collectors', function() {

                describe('add', function() {

                    it('adds collector', function(done) {
                        var collector = {
                            collect: function() {
                                Promise.config.collectors.remove(collector);
                                done();
                            }
                        };
                        Promise.config.collectors.add(collector);
                        Promise.delay(10).trackAs('promise').done();
                    });

                    it('returns method to remove the collector', function(done) {
                        var collector = {
                                collect: function() {
                                    remove();
                                    done();
                                }
                            },
                            remove = Promise.config.collectors.add(collector);
                        Promise.delay(10).trackAs('promise').done();
                    });

                    it('throws if argument falsy', function() {
                        expect(Promise.config.collectors.add.bind(null)).toThrow();
                        expect(Promise.config.collectors.add.bind(null, NaN)).toThrow();
                        expect(Promise.config.collectors.add.bind(null, null)).toThrow();
                        expect(Promise.config.collectors.add.bind(null, false)).toThrow();
                    });

                    it('throws if collect method not found', function() {
                        expect(Promise.config.collectors.add.bind(null, {})).toThrow();
                    });

                });

                describe('remove', function() {

                    it('remove removes collector', function(done) {
                        var collector = {
                                collect: jasmine.createSpy('collect')
                            },
                            remove = Promise.config.collectors.add(collector);
                        Promise.delay(10).trackAs('promise').done();
                        var interval = setInterval(function() {
                            if (collector.collect.calls.any()) {
                                clearInterval(interval);
                                remove();
                                Promise.delay(10).trackAs('promise').done();
                                setTimeout(function() {
                                    if (collector.collect.calls.count() !== 1) {
                                        throw new Error();
                                    }
                                    done();
                                }, 50);
                            }
                        }, 10);
                    });

                    it('removing collector that DNE has no effect', function() {
                        Promise.config.collectors.remove();
                        Promise.config.collectors.remove(null);
                        Promise.config.collectors.remove({});
                        Promise.config.collectors.remove({collect: jasmine.unimplementedMethod_ });
                    });

                });

            });


            describe('timing', function() {

                it('disable disables timing', function(done) {
                    Promise.config.timing.disable();
                    var remove = Promise.config.collectors.add({
                        collect: jasmine.unimplementedMethod_
                    });
                    Promise.delay(10).trackAs('promise').done().finally(remove).then(done);
                });

                it('enable enables timing', function(done) {
                    Promise.config.timing.disable();
                    Promise.config.timing.enable();
                    var remove = Promise.config.collectors.add({
                        collect: done
                    });
                    Promise.delay(10).trackAs('promise').done().finally(remove);
                });

                it('useSaneTimings works', function(done) {
                    var collector = {
                        collect: function(timingData) {
                            var getMinMax = function getMinMax(timing, prop, op) {
                                    return timing.children.map(function map(t) {
                                        return t[prop];
                                    }).sort()[op]();
                                },
                                minChildStart = getMinMax(timingData, 'start', 'shift'),
                                maxChildStop = getMinMax(timingData, 'stop', 'pop');
                            expect(timingData.start).not.toBeGreaterThan(minChildStart);
                            expect(timingData.stop).not.toBeLessThan(maxChildStop);
                            Promise.config.collectors.remove(collector);
                            done();
                        }
                    };
                    Promise.config.timing.useSaneTimings();
                    Promise.config.collectors.add(collector);
                    Promise.all([
                        Promise.delay(20).trackAs('child').then(function grandchild() {})
                    ]).trackAs('parent').done();
                });

            });
        });

    });

});
