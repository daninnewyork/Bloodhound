(function() {

    'use strict';

    /**
     * @author Dan
     * @date 10/31/2014
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
            paths: {
                angular: '/base/app/bower_components/angular/angular',
                'angular-mocks': '/base/app/bower_components/angular-mocks/angular-mocks'
            },
            deps: specs,
            shim: {
                angular: {
                    exports: 'angular'
                },
                'angular-mocks': {
                    deps: ['angular', 'boot'],
                    exports: 'angular.mock'
                }
            },
            callback: window.__karma__.start
        });

    }

}());
