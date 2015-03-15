'use strict';

/* jshint -W079 */
/* jshint node: true */
var Promise = require('../app/src/Promise');

exports.resolved = Promise.resolve;
exports.rejected = Promise.reject;
exports.deferred = Promise.defer;
