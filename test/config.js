(function() {

    'use strict';

    /**
     * @author Dan
     * @date 2015-02-28
     */

    var isTest = function isTest(uri) {
            return uri.match(/\-spec\.js/);
        },

        specs = Object
            .keys(window.__karma__.files)
            .filter(isTest);

    if (!!specs.length) {

        console.debug('tests:');
        specs.forEach(function(spec) {
            console.debug('\t' + spec);
        });

        requirejs.config({
            baseUrl: '/base/app/src',
            deps: specs,
            paths: {},
            shim: {},
            callback: window.__karma__.start
        });

    }

}());
